import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 0032_lock_client_writes.sql 정적 가드.
 *
 * 로컬 DB 가 없으므로 실제 권한/정책 적용은 docs/sql/0032-postcheck.sql 로 운영에서
 * 검증한다. 여기서는 마이그레이션 SQL 텍스트를 파싱해 "닫아야 할 표면을 닫고,
 * 지켜야 할 것은 지켰는가" 의 구조적 불변식을 회귀 가드로 고정한다.
 *
 * 불변식:
 *  1) profiles/gifts/attendances/review_likes 의 사용자 세션 쓰기(정책+권한)를 닫고,
 *     photos 는 INSERT/UPDATE 만 닫는다(DELETE 는 앱이 사용자 세션으로 쓴다).
 *  2) 각 테이블에서 anon,authenticated 의 쓰기성 권한(insert/update/delete/truncate/
 *     references/trigger)을 revoke 한다. SELECT 는 회수하지 않는다.
 *  3) profiles 민감 컬럼 가드 트리거를 심고, role/deleted_at/deletion_reason/email/
 *     referral_code 를 모두 검사한다. 가드 함수는 SECURITY INVOKER 여야 한다
 *     (definer 면 함수 안 current_user 가 소유자로 바뀌어 검사가 발동하지 않는다).
 *  4) is_admin()/lookup_referral_code() 의 EXECUTE 와 기존 SELECT 정책은 건드리지 않는다.
 *  5) 앱이 사용자 세션으로 쓰는 테이블(projects/pages/share_tokens)과 photos DELETE 는
 *     이 마이그레이션에서 회수·제거하지 않는다(과잉 적용 방지).
 *  6) service_role 권한은 회수하지 않는다.
 *  7) reviews 는 앱이 사용자 세션으로 쓰므로 회수 대신 축소한다:
 *     포괄 정책(reviews_own_all) 제거 → 명령별 정책 + 컬럼 grant.
 *     INSERT 는 주문 소유·후기 가능 상태·이미지 키 본인 폴더·개수·본문 길이를 WITH CHECK,
 *     UPDATE 는 likes_count/order_id/user_id 등 컬럼 제외 + 이미지 키 검사.
 *     컬럼·상태·한도는 라우트 소스와 일치해야 한다(어긋나면 앱이 깨지거나 표면이 남는다).
 *     정책 조건은 **최상위 AND 결합**이어야 한다 — 필수 조건 하나를 OR 로 바꾸면 나머지
 *     조건이 무력화되므로, 부분 문자열 포함이 아니라 괄호 깊이를 따라 결합 구조를 검사한다.
 *     grant 는 권한 목록 순서와 무관하게 파싱해(예: "grant select, insert on public.reviews")
 *     컬럼 grant 대상 테이블에 테이블 수준 INSERT/UPDATE/ALL 이 섞이지 않았는지 본다.
 *  8) storage.objects 의 reviews·photo-originals·photo-thumbs 버킷 사용자 세션 **쓰기** 정책을
 *     제거하고, 읽기 정책과 service_role 정책은 유지한다. 드롭 목록은 0032 이전 마이그레이션이
 *     만든 해당 버킷 사용자 쓰기 정책과 정확히 같아야 한다(누락·이름 오타는 SQL 에서 조용히 no-op).
 *     앱은 storage 를 service_role(admin) 과 서명 업로드 토큰으로만 쓴다 — 소스와 결합해 고정한다.
 */

const ROOT = process.cwd();
const MIGRATION_PATH = path.resolve(
  ROOT,
  "supabase/migrations/0032_lock_client_writes.sql",
);
const MIGRATIONS_DIR = path.resolve(ROOT, "supabase/migrations");
const REVIEWS_ROUTE_PATH = path.resolve(ROOT, "app/api/reviews/route.ts");
const REVIEW_ID_ROUTE_PATH = path.resolve(ROOT, "app/api/reviews/[id]/route.ts");
const SIGN_UPLOAD_ROUTE_PATH = path.resolve(ROOT, "app/api/photos/sign-upload/route.ts");
const UPLOAD_QUEUE_PATH = path.resolve(ROOT, "lib/image/upload-queue.ts");

/** 라인/블록 주석을 제거해 실제 실행되는 SQL 만 남긴다. */
function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

const RAW = readFileSync(MIGRATION_PATH, "utf8");
const SQL = stripSqlComments(RAW);
/** 공백 정규화 + 소문자 — 토큰 순서를 유연하게 매칭. */
const NORM = SQL.replace(/\s+/g, " ").toLowerCase();

const LOCKED_TABLES = ["profiles", "gifts", "attendances", "review_likes"] as const;
/** 기본 grant 에 포함되는 쓰기성 권한. SELECT 는 제외. */
const WRITE_PRIVS = [
  "insert",
  "update",
  "delete",
  "truncate",
  "references",
  "trigger",
] as const;
const REVOKE_ROLES = ["anon", "authenticated"] as const;

/** reviews 에 사용자 세션으로 허용할 컬럼(라우트가 실제로 쓰는 컬럼). */
const REVIEWS_INSERT_COLUMNS = [
  "body",
  "image_keys",
  "order_id",
  "public",
  "rating",
  "user_id",
] as const;
const REVIEWS_UPDATE_COLUMNS = ["body", "image_keys", "public", "rating"] as const;
/** 기본값·트리거·RPC 만 채워야 하는 컬럼 — 어떤 사용자 grant 에도 없어야 한다. */
const REVIEWS_SERVER_ONLY_COLUMNS = [
  "id",
  "likes_count",
  "created_at",
  "updated_at",
] as const;

/** `create or replace function public.<name>(` 부터 첫 `$$;` 까지의 정의 블록. */
function functionBlock(name: string): string {
  const start = NORM.indexOf(`function public.${name}(`);
  if (start < 0) return "";
  const end = NORM.indexOf("$$;", start);
  return end < 0 ? NORM.slice(start) : NORM.slice(start, end + 3);
}

/** `revoke ... <priv> ... on [table] public.<tbl> from ... <role> ...` 존재 여부. */
function hasRevoke(table: string, priv: string, role: string): boolean {
  const re = new RegExp(
    `revoke[^;]*\\b${priv}\\b[^;]*\\bon\\b[^;]*\\bpublic\\.${table}\\b[^;]*\\bfrom\\b[^;]*\\b${role}\\b[^;]*;`,
  );
  return re.test(NORM);
}

/** `create policy "<name>" on <table> ... ;` 문 전체(정규화 텍스트). 없으면 "". */
function policyStatement(name: string, table: string): string {
  const head = `create policy "${name}" on ${table} `;
  const start = NORM.indexOf(head);
  if (start < 0) return "";
  const end = NORM.indexOf(";", start);
  return end < 0 ? NORM.slice(start) : NORM.slice(start, end + 1);
}

/** 정책 문에서 `with check (` 이후 텍스트(없으면 ""). */
function withCheckPart(stmt: string): string {
  const i = stmt.indexOf(" with check ");
  return i < 0 ? "" : stmt.slice(i);
}

/** 정책 문에서 `using (` ~ `with check` 직전 텍스트(없으면 ""). */
function usingPart(stmt: string): string {
  const i = stmt.indexOf(" using ");
  if (i < 0) return "";
  const j = stmt.indexOf(" with check ", i);
  return j < 0 ? stmt.slice(i) : stmt.slice(i, j);
}

/**
 * 대상 테이블 자신의 `user_id = auth.uid()` 비교가 있는가.
 * `o.user_id = auth.uid()`(orders 서브쿼리) 같은 한정 이름은 세지 않는다.
 */
function hasOwnUserIdCheck(part: string): boolean {
  return /(?<![.\w])user_id = auth\.uid\(\)/.test(part);
}

/** 마이그레이션의 모든 grant 문. */
function grantStatements(): string[] {
  return NORM.match(/\bgrant [^;]*;/g) ?? [];
}

// ---------------------------------------------------------------------------
// 괄호 깊이·따옴표를 따르는 최소 SQL 스캐너 (정규화 텍스트 전용)
// ---------------------------------------------------------------------------

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9_]/.test(ch);
}

/**
 * 작은따옴표 밖·괄호 깊이 0 에서 `token` 이 나타나는 위치들.
 * 단어 토큰(and/or/on/to/using/...)은 앞뒤가 단어 문자가 아닐 때만 센다(`anon` 안의 on 제외).
 */
function topLevelIndexes(text: string, token: string): number[] {
  const wordToken = isWordChar(token[0]);
  const out: number[] = [];
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      continue;
    }
    if (depth !== 0 || !text.startsWith(token, i)) continue;
    if (wordToken && (isWordChar(text[i - 1]) || isWordChar(text[i + token.length]))) continue;
    out.push(i);
  }
  return out;
}

/** 깊이 0 의 `sep`(and/or/,) 로 나눈 조각들. */
function splitTopLevel(text: string, sep: "and" | "or" | ","): string[] {
  const parts: string[] = [];
  let prev = 0;
  for (const i of topLevelIndexes(text, sep)) {
    parts.push(text.slice(prev, i).trim());
    prev = i + sep.length;
  }
  parts.push(text.slice(prev).trim());
  return parts;
}

/** `text[open]` 이 `(` 일 때 짝이 맞는 `)` 의 위치와 안쪽 텍스트. */
function balancedParen(text: string, open: number): { inner: string; close: number } | null {
  if (text[open] !== "(") return null;
  let depth = 0;
  let inQuote = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === "(") depth++;
    if (ch === ")" && --depth === 0) return { inner: text.slice(open + 1, i).trim(), close: i };
  }
  return null;
}

/** 정책 문의 최상위 `using (...)` / `with check (...)` 안쪽 식. 없으면 null. */
function clauseExpr(stmt: string, clause: "using" | "with check"): string | null {
  const at = topLevelIndexes(stmt, clause)[0];
  if (at === undefined) return null;
  const open = stmt.indexOf("(", at + clause.length);
  if (open < 0 || stmt.slice(at + clause.length, open).trim() !== "") return null;
  return balancedParen(stmt, open)?.inner ?? null;
}

/** 식 전체를 감싼 괄호를 벗긴다. `(a) and (b)` 처럼 전체를 감싸지 않으면 그대로. */
function unwrapParens(expr: string): string {
  let cur = expr.trim();
  for (;;) {
    const b = balancedParen(cur, 0);
    if (!b || b.close !== cur.length - 1) return cur;
    cur = b.inner;
  }
}

/** `[not ]exists ( select ... where <조건> )` 의 최상위 where 조건. 형태가 다르면 null. */
function existsWhere(conjunct: string): string | null {
  const m = /^(?:not )?exists /.exec(conjunct);
  if (!m) return null;
  const b = balancedParen(conjunct, m[0].length);
  if (!b || b.close !== conjunct.length - 1) return null;
  const w = topLevelIndexes(b.inner, "where")[0];
  return w === undefined ? null : b.inner.slice(w + "where".length).trim();
}

/** 최상위가 순수 AND 결합이면 조각들, 깊이 0 에 OR 가 하나라도 있으면 null. */
function andConjuncts(expr: string): string[] | null {
  const e = unwrapParens(expr);
  return topLevelIndexes(e, "or").length > 0 ? null : splitTopLevel(e, "and");
}

/** 최상위가 순수 OR 결합이면 조각들, 깊이 0 에 AND 가 하나라도 있으면 null. */
function orDisjuncts(expr: string): string[] | null {
  const e = unwrapParens(expr);
  return topLevelIndexes(e, "and").length > 0 ? null : splitTopLevel(e, "or");
}

// ---------------------------------------------------------------------------
// grant 파서 — 권한 목록 순서·table 키워드 유무와 무관하게 구조로 판정
// ---------------------------------------------------------------------------

type GrantPrivilege = { name: string; columns: string[] | null };
type ParsedGrant = {
  privileges: GrantPrivilege[];
  /** `table` 키워드와 따옴표를 뗀 대상 객체들. */
  objects: string[];
  /** `on all tables in schema <s>` 이면 스키마 이름. */
  allTablesInSchema: string | null;
  roles: string[];
};

/** `grant <privs> on <objects> to <roles>;` 파싱. 객체 권한 grant 가 아니면(역할 멤버십 등) null. */
function parseGrant(stmt: string): ParsedGrant | null {
  const body = stmt.replace(/^grant /, "").replace(/;$/, "").trim();
  const onAt = topLevelIndexes(body, "on")[0];
  if (onAt === undefined) return null;
  const toAt = topLevelIndexes(body, "to").find((i) => i > onAt);
  if (toAt === undefined) return null;

  const privileges: GrantPrivilege[] = [];
  for (const item of splitTopLevel(body.slice(0, onAt), ",")) {
    const m = /^([a-z]+(?: [a-z]+)?)\s*(?:\(([^)]*)\))?$/.exec(item);
    if (!m) return null;
    const cols = m[2];
    privileges.push({
      name: (m[1] ?? "").trim(),
      columns:
        cols === undefined
          ? null
          : cols
              .split(",")
              .map((c) => c.trim().replace(/"/g, ""))
              .filter((c) => c.length > 0)
              .sort(),
    });
  }

  const objPart = body.slice(onAt + "on".length, toAt).trim();
  const schema = /^all tables in schema (.+)$/.exec(objPart);
  const objects = schema
    ? []
    : splitTopLevel(objPart.replace(/^table /, ""), ",").map((o) => o.replace(/"/g, ""));
  const roles = splitTopLevel(
    body.slice(toAt + "to".length).replace(/ with grant option$/, ""),
    ",",
  ).map((r) => r.replace(/"/g, ""));

  return {
    privileges,
    objects,
    allTablesInSchema: schema ? (schema[1] ?? "").replace(/"/g, "").trim() : null,
    roles,
  };
}

/** grant 대상이 public.<table> 인가(스키마 생략 포함). */
function grantTargetsTable(g: ParsedGrant, table: string): boolean {
  return (
    g.allTablesInSchema === "public" ||
    g.objects.some((o) => o === table || o === `public.${table}`)
  );
}

function parsedGrants(): ParsedGrant[] {
  return grantStatements()
    .map(parseGrant)
    .filter((g): g is ParsedGrant => g !== null);
}

/** reviews 에 대한 `<priv> (<cols>)` 컬럼 grant 들 — 같은 문에 다른 권한이 섞여 있어도 잡는다. */
function reviewsColumnGrants(priv: "insert" | "update"): {
  columns: string[];
  roles: string;
}[] {
  return parsedGrants()
    .filter((g) => g.allTablesInSchema === null && grantTargetsTable(g, "reviews"))
    .flatMap((g) =>
      g.privileges.flatMap((p) =>
        p.name === priv && p.columns !== null
          ? [{ columns: p.columns, roles: g.roles.join(", ") }]
          : [],
      ),
    );
}

/** 테이블 수준(컬럼 목록 없음)으로 주면 컬럼 grant 를 무력화하는 권한. */
const TABLE_LEVEL_WIDENING_PRIVS = new Set(["insert", "update", "all", "all privileges"]);

// ---------------------------------------------------------------------------
// storage.objects 정책 이력 — 0032 이전 마이그레이션을 순서대로 재생
// ---------------------------------------------------------------------------

/** 사용자 세션 쓰기 정책을 0032 가 제거해야 하는 버킷. */
const USER_WRITE_LOCKED_BUCKETS = ["photo-originals", "photo-thumbs", "reviews"] as const;

type StoragePolicy = { name: string; cmd: string; roles: string[]; buckets: string[] };

function parseStoragePolicy(name: string, rest: string): StoragePolicy {
  const head = /^(?:as (?:permissive|restrictive) )?(?:for (all|select|insert|update|delete) )?(?:to ([a-z_, ]+?) )?(?:using|with check)\b/.exec(
    rest,
  );
  const buckets = new Set<string>();
  for (const m of rest.matchAll(/bucket_id = '([^']+)'/g)) buckets.add(m[1] ?? "");
  for (const m of rest.matchAll(/bucket_id in \(([^)]*)\)/g)) {
    for (const b of (m[1] ?? "").matchAll(/'([^']+)'/g)) buckets.add(b[1] ?? "");
  }
  return {
    name,
    cmd: head?.[1] ?? "all",
    roles: (head?.[2] ?? "public").split(",").map((r) => r.trim()),
    buckets: Array.from(buckets),
  };
}

/** 번호가 `before` 미만인 마이그레이션을 재생한 뒤 남는 storage.objects 정책. */
function storagePoliciesBefore(before: number): Map<string, StoragePolicy> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) < before)
    .sort();
  const state = new Map<string, StoragePolicy>();
  for (const f of files) {
    const norm = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
      .replace(/\s+/g, " ")
      .toLowerCase();
    const re =
      /drop policy if exists "([^"]+)" on storage\.objects;|create policy "([^"]+)" on storage\.objects ([^;]*);/g;
    for (const m of norm.matchAll(re)) {
      if (m[1] !== undefined) state.delete(m[1]);
      else if (m[2] !== undefined) state.set(m[2], parseStoragePolicy(m[2], m[3] ?? ""));
    }
  }
  return state;
}

/** 소스 트리(app/lib/components)의 비테스트 TS 파일. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("0032 lock_client_writes — 구조적 가드", () => {
  it("마이그레이션 파일이 존재하고 비어 있지 않다", () => {
    expect(RAW.length).toBeGreaterThan(500);
  });

  describe("(1) 닫아야 할 쓰기 정책 제거", () => {
    const dropped: { policy: string; table: string }[] = [
      { policy: "profiles_update_self", table: "public.profiles" },
      { policy: "gifts_sender_all", table: "public.gifts" },
      { policy: "attendances_insert_own", table: "public.attendances" },
      { policy: "review_likes_own_all", table: "public.review_likes" },
      { policy: "photos_insert_own", table: "public.photos" },
      { policy: "photos_update_own", table: "public.photos" },
      { policy: "reviews_own_all", table: "public.reviews" },
      { policy: "reviews_storage_owner_all", table: "storage.objects" },
      { policy: "photo_originals_user_insert", table: "storage.objects" },
      { policy: "photo_originals_user_update", table: "storage.objects" },
      { policy: "photo_originals_user_delete", table: "storage.objects" },
      { policy: "photo_thumbs_user_delete", table: "storage.objects" },
    ];
    for (const { policy, table } of dropped) {
      it(`drop policy if exists "${policy}" on ${table}`, () => {
        expect(NORM).toContain(`drop policy if exists "${policy}" on ${table};`);
      });
    }

    it("제거한 포괄 정책을 같은 이름으로 다시 만들지 않는다", () => {
      for (const { policy } of dropped) {
        expect(NORM).not.toContain(`create policy "${policy}"`);
      }
    });
  });

  describe("(2) anon/authenticated 의 쓰기성 권한 회수 (SELECT 는 제외)", () => {
    for (const table of [...LOCKED_TABLES, "reviews"]) {
      for (const priv of WRITE_PRIVS) {
        for (const role of REVOKE_ROLES) {
          it(`${table}: revoke ${priv} from ${role}`, () => {
            expect(hasRevoke(table, priv, role)).toBe(true);
          });
        }
      }
    }

    for (const priv of WRITE_PRIVS.filter((p) => p !== "delete")) {
      for (const role of REVOKE_ROLES) {
        it(`photos: revoke ${priv} from ${role}`, () => {
          expect(hasRevoke("photos", priv, role)).toBe(true);
        });
      }
    }

    it("photos: authenticated DELETE 는 회수하지 않는다 (projects/[id] DELETE 가 사용자 세션으로 씀)", () => {
      expect(hasRevoke("photos", "delete", "authenticated")).toBe(false);
    });

    it("photos: anon DELETE 는 회수한다 (잔여 grant 제거)", () => {
      expect(hasRevoke("photos", "delete", "anon")).toBe(true);
    });

    it("SELECT 를 회수하지 않는다 (revoke 문에 select 토큰이 없어야 함)", () => {
      const revokeStatements = NORM.match(/revoke[^;]*;/g) ?? [];
      for (const stmt of revokeStatements) {
        expect(stmt.includes("select")).toBe(false);
      }
    });
  });

  describe("(3) profiles 민감 컬럼 가드 트리거", () => {
    it("가드 함수를 정의한다", () => {
      expect(NORM).toContain(
        "function public.guard_profiles_sensitive_columns()",
      );
    });

    it("가드 함수는 SECURITY INVOKER 다 (definer 면 current_user 검사가 발동하지 않음)", () => {
      const block = functionBlock("guard_profiles_sensitive_columns");
      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain("security invoker");
      expect(block).not.toContain("security definer");
      expect(block).toContain("set search_path = public");
    });

    it("마이그레이션 어디에서도 SECURITY DEFINER 함수를 새로 만들지 않는다", () => {
      expect(NORM).not.toContain("security definer");
    });

    it("profiles 에 before update 트리거를 건다", () => {
      expect(
        /drop trigger if exists trg_profiles_guard_sensitive on public\.profiles;/i.test(
          SQL,
        ),
      ).toBe(true);
      expect(
        /create trigger trg_profiles_guard_sensitive\s+before update on public\.profiles/i.test(
          SQL,
        ),
      ).toBe(true);
    });

    it("민감 컬럼 5종(role/deleted_at/deletion_reason/email/referral_code)을 모두 검사한다", () => {
      for (const col of [
        "role",
        "deleted_at",
        "deletion_reason",
        "email",
        "referral_code",
      ]) {
        expect(NORM).toContain(`new.${col} is distinct from old.${col}`);
      }
    });

    it("request 역할이 anon/authenticated 일 때만 차단한다 (service_role/RPC 는 통과)", () => {
      expect(NORM).toContain("current_user in ('anon', 'authenticated')");
    });

    it("차단 시 권한 오류(42501)로 raise 한다", () => {
      expect(NORM).toContain("raise exception");
      expect(NORM).toContain("42501");
    });
  });

  describe("(4) 건드리지 말아야 할 것 — is_admin / lookup_referral_code / SELECT 정책", () => {
    it("is_admin() 의 권한/정의를 변경하지 않는다", () => {
      expect(NORM).not.toMatch(/revoke[^;]*\bis_admin\b/);
      expect(NORM).not.toMatch(/(create|replace)[^;]*function[^;]*\bis_admin\b/);
      expect(NORM).not.toMatch(/drop[^;]*\bis_admin\b/);
    });

    it("lookup_referral_code() 의 권한/정의를 변경하지 않는다", () => {
      expect(NORM).not.toMatch(/revoke[^;]*\blookup_referral_code\b/);
      expect(NORM).not.toMatch(/drop[^;]*\blookup_referral_code\b/);
    });

    it("보존해야 할 SELECT 정책을 drop 하지 않는다", () => {
      // 조회 경로가 의존하는 기존 SELECT 정책들. (gifts_sender_select/reviews_select_own 은
      // 이 마이그레이션이 멱등 재생성하려 drop-then-create 하므로 여기 목록에서 제외한다.)
      const preservedSelectPolicies = [
        "profiles_select_self",
        "attendances_select_own",
        "attendances_admin_select",
        "review_likes_read_own",
        "photos_select_own",
        "reviews_public_read",
      ];
      for (const policy of preservedSelectPolicies) {
        expect(NORM).not.toContain(`drop policy if exists "${policy}"`);
      }
    });

    it("gifts 는 사용자 SELECT 여지를 정책으로 보존한다", () => {
      expect(
        /create policy "gifts_sender_select" on public\.gifts\s+for select/i.test(
          SQL,
        ),
      ).toBe(true);
    });
  });

  describe("(5) 과잉 적용 방지 — 사용자 세션으로 쓰는 테이블은 건드리지 않는다", () => {
    const untouched = ["projects", "pages", "share_tokens"];
    for (const table of untouched) {
      it(`${table}: revoke 대상이 아니다`, () => {
        for (const priv of WRITE_PRIVS) {
          for (const role of REVOKE_ROLES) {
            expect(hasRevoke(table, priv, role)).toBe(false);
          }
        }
      });
    }

    it("사용자 세션 쓰기 정책(예: projects_update_own/share_tokens_owner_all/photos_delete_own)을 drop 하지 않는다", () => {
      expect(NORM).not.toContain('drop policy if exists "projects_update_own"');
      expect(NORM).not.toContain('drop policy if exists "share_tokens_owner_all"');
      expect(NORM).not.toContain('drop policy if exists "photos_delete_own"');
    });
  });

  describe("(6) service_role 권한을 회수하지 않는다", () => {
    it("어떤 revoke 문도 service_role 을 대상으로 하지 않는다", () => {
      const revokeStatements = NORM.match(/revoke[^;]*;/g) ?? [];
      for (const stmt of revokeStatements) {
        expect(stmt).not.toContain("service_role");
      }
    });
  });

  describe("(7) reviews — 사용자 세션 쓰기를 라우트 검증과 같은 조건으로 축소", () => {
    const selectOwn = policyStatement("reviews_select_own", "public.reviews");
    const insertOwn = policyStatement("reviews_insert_own", "public.reviews");
    const updateOwn = policyStatement("reviews_update_own", "public.reviews");
    const deleteOwn = policyStatement("reviews_delete_own", "public.reviews");

    it("명령별 정책 4개를 authenticated 대상으로 만든다 (for all 금지)", () => {
      expect(selectOwn).toMatch(/ for select to authenticated using \(user_id = auth\.uid\(\)\);$/);
      expect(insertOwn).toMatch(/ for insert to authenticated with check /);
      expect(updateOwn).toMatch(/ for update to authenticated using \(user_id = auth\.uid\(\)\) with check /);
      expect(deleteOwn).toMatch(/ for delete to authenticated using \(user_id = auth\.uid\(\)\);$/);
      expect(NORM).not.toMatch(/create policy "[^"]*" on public\.reviews for all/);
    });

    it("정책을 멱등 재생성한다 (drop if exists → create)", () => {
      for (const name of [
        "reviews_select_own",
        "reviews_insert_own",
        "reviews_update_own",
        "reviews_delete_own",
      ]) {
        const drop = NORM.indexOf(`drop policy if exists "${name}" on public.reviews;`);
        const create = NORM.indexOf(`create policy "${name}" on public.reviews `);
        expect(drop).toBeGreaterThanOrEqual(0);
        expect(create).toBeGreaterThan(drop);
      }
    });

    it("INSERT WITH CHECK: 작성자 = auth.uid() (orders 서브쿼리의 o.user_id 와 별개)", () => {
      expect(hasOwnUserIdCheck(withCheckPart(insertOwn))).toBe(true);
    });

    it("INSERT WITH CHECK: 주문 소유 검증 (남의 주문 슬롯 선점 차단)", () => {
      const chk = withCheckPart(insertOwn);
      expect(chk).toContain("from public.orders o");
      expect(chk).toContain("o.id = reviews.order_id");
      expect(chk).toContain("o.user_id = auth.uid()");
    });

    it("INSERT WITH CHECK: 후기 가능 주문 상태만 (shipped, delivered)", () => {
      expect(withCheckPart(insertOwn)).toContain(
        "o.status in ('shipped', 'delivered')",
      );
    });

    for (const [label, getStmt] of [
      ["INSERT", () => insertOwn],
      ["UPDATE", () => updateOwn],
    ] as const) {
      it(`${label} WITH CHECK: image_keys 모든 원소의 첫 세그먼트 = auth.uid() (null 거부)`, () => {
        const chk = withCheckPart(getStmt());
        expect(chk).toContain("not exists");
        expect(chk).toContain("from unnest(reviews.image_keys) as k(image_key)");
        expect(chk).toContain("k.image_key is null");
        expect(chk).toContain("split_part(k.image_key, '/', 1) <> auth.uid()::text");
      });

      it(`${label} WITH CHECK: 이미지 개수·본문 길이 한도`, () => {
        const chk = withCheckPart(getStmt());
        expect(chk).toMatch(/cardinality\(reviews\.image_keys\) <= \d+/);
        expect(chk).toMatch(/char_length\(reviews\.body\) <= \d+/);
      });
    }

    it("UPDATE: USING 과 WITH CHECK 모두 작성자 = auth.uid()", () => {
      expect(hasOwnUserIdCheck(usingPart(updateOwn))).toBe(true);
      expect(hasOwnUserIdCheck(withCheckPart(updateOwn))).toBe(true);
    });

    it("revoke 가 모든 grant 보다 먼저 온다 (revoke 가 컬럼 grant 까지 지우므로 순서가 중요)", () => {
      const revokeAt = NORM.search(
        /revoke [^;]*\bon table public\.reviews from anon, authenticated;/,
      );
      const firstGrantAt = NORM.search(/grant [^;]*\bpublic\.reviews\b/);
      expect(revokeAt).toBeGreaterThanOrEqual(0);
      expect(firstGrantAt).toBeGreaterThan(revokeAt);
    });

    it("INSERT 는 라우트가 쓰는 6개 컬럼만 컬럼 grant 한다", () => {
      const grants = reviewsColumnGrants("insert");
      expect(grants).toHaveLength(1);
      expect(grants[0]?.columns).toEqual([...REVIEWS_INSERT_COLUMNS].sort());
      expect(grants[0]?.roles).toBe("authenticated");
    });

    it("UPDATE 는 rating/body/image_keys/public 4개 컬럼만 grant 한다 (order_id/user_id 이전 차단)", () => {
      const grants = reviewsColumnGrants("update");
      expect(grants).toHaveLength(1);
      expect(grants[0]?.columns).toEqual([...REVIEWS_UPDATE_COLUMNS].sort());
      expect(grants[0]?.columns).not.toContain("order_id");
      expect(grants[0]?.columns).not.toContain("user_id");
      expect(grants[0]?.roles).toBe("authenticated");
    });

    it("id/likes_count/created_at/updated_at 은 어떤 grant 에도 없다", () => {
      const reviewGrants = grantStatements().filter((g) => g.includes("public.reviews"));
      for (const g of reviewGrants) {
        for (const col of REVIEWS_SERVER_ONLY_COLUMNS) {
          expect(g).not.toMatch(new RegExp(`\\b${col}\\b`));
        }
      }
    });

    it("테이블 수준 INSERT/UPDATE/ALL grant 를 주지 않는다 (컬럼 grant 무력화 방지)", () => {
      expect(NORM).not.toMatch(/grant (insert|update|all)[^(;]* on (table )?public\.reviews\b/);
      expect(NORM).not.toMatch(/grant [^;]*\ball privileges\b[^;]*public\.reviews/);
    });

    it("모든 grant 문은 객체 권한 grant 로 파싱된다 (역할 멤버십 grant·파싱 불가 문 금지)", () => {
      for (const g of grantStatements()) {
        expect(parseGrant(g), g).not.toBeNull();
      }
    });

    it("컬럼 grant 대상 테이블에 테이블 수준 INSERT/UPDATE/ALL 을 섞지 않는다 (권한 목록 순서 무관)", () => {
      const grants = parsedGrants();
      // 컬럼 grant 가 하나라도 있는 테이블 + reviews(항상 컬럼 grant 로만 연다).
      const columnGrantTables = new Set<string>(["reviews"]);
      for (const g of grants) {
        if (!g.privileges.some((p) => p.columns !== null)) continue;
        for (const o of g.objects) columnGrantTables.add(o.replace(/^public\./, ""));
      }
      for (const g of grants) {
        const widening = g.privileges.filter(
          (p) => p.columns === null && TABLE_LEVEL_WIDENING_PRIVS.has(p.name),
        );
        if (widening.length === 0) continue;
        for (const table of columnGrantTables) {
          expect(
            grantTargetsTable(g, table),
            `테이블 수준 ${widening.map((p) => p.name).join("/")} grant 가 ${table} 컬럼 grant 를 무력화한다`,
          ).toBe(false);
        }
      }
    });

    it("회수한 쓰기 권한을 다시 grant 하지 않는다 (profiles/gifts/attendances/review_likes 전부, photos 는 DELETE 외)", () => {
      const reopening = new Set<string>([...WRITE_PRIVS, "all", "all privileges"]);
      for (const g of parsedGrants()) {
        for (const p of g.privileges) {
          if (!reopening.has(p.name)) continue;
          for (const table of LOCKED_TABLES) {
            expect(grantTargetsTable(g, table), `${p.name} on ${table}`).toBe(false);
          }
          if (p.name !== "delete") {
            expect(grantTargetsTable(g, "photos"), `${p.name} on photos`).toBe(false);
          }
        }
      }
    });

    describe("정책 조건 결합 구조 — 필수 조건은 최상위 AND (OR 치환 시 실패)", () => {
      const OWN_USER = "user_id = auth.uid()";
      const IMAGE_KEY_DISJUNCTS = [
        "k.image_key is null",
        "split_part(k.image_key, '/', 1) <> auth.uid()::text",
      ];

      /** 이미지 키·개수·본문 한도 조건이 각각 독립된 최상위 AND 조각인지. */
      function expectContentLimits(conjuncts: string[]): void {
        expect(
          conjuncts.filter((c) => /^cardinality\(reviews\.image_keys\) <= \d+$/.test(c)),
        ).toHaveLength(1);

        const imageKeys = conjuncts.filter((c) =>
          c.startsWith("not exists ( select 1 from unnest(reviews.image_keys) as k(image_key) where "),
        );
        expect(imageKeys).toHaveLength(1);
        const where = existsWhere(imageKeys[0] ?? "");
        expect(where).not.toBeNull();
        // not exists (… where 널 OR 타인 폴더) — 여기만은 OR 여야 "모든 원소가 본인 폴더" 가 된다.
        expect(orDisjuncts(where ?? "")).toEqual(IMAGE_KEY_DISJUNCTS);

        const body = conjuncts.filter((c) => c.startsWith("(reviews.body is null "));
        expect(body).toHaveLength(1);
        const bodyDisjuncts = orDisjuncts(body[0] ?? "");
        expect(bodyDisjuncts).toHaveLength(2);
        expect(bodyDisjuncts?.[0]).toBe("reviews.body is null");
        expect(bodyDisjuncts?.[1]).toMatch(/^char_length\(reviews\.body\) <= \d+$/);
      }

      it("reviews_insert_own WITH CHECK: 작성자·주문 소유/상태·이미지 키·한도가 모두 AND", () => {
        const expr = clauseExpr(policyStatement("reviews_insert_own", "public.reviews"), "with check");
        expect(expr).not.toBeNull();
        const conjuncts = andConjuncts(expr ?? "");
        expect(conjuncts, "WITH CHECK 최상위에 OR 가 있다").not.toBeNull();
        const c = conjuncts ?? [];
        expect(c).toContain(OWN_USER);

        const orders = c.filter((x) => x.startsWith("exists ( select 1 from public.orders o where "));
        expect(orders).toHaveLength(1);
        const ordersWhere = andConjuncts(existsWhere(orders[0] ?? "") ?? "or");
        expect(ordersWhere, "orders 서브쿼리 where 최상위에 OR 가 있다").not.toBeNull();
        expect(ordersWhere).toContain("o.id = reviews.order_id");
        expect(ordersWhere).toContain("o.user_id = auth.uid()");
        expect(
          (ordersWhere ?? []).filter((x) => /^o\.status in \('[a-z_]+'(?:, '[a-z_]+')*\)$/.test(x)),
        ).toHaveLength(1);

        expectContentLimits(c);
      });

      it("reviews_update_own: USING 작성자 AND, WITH CHECK 작성자·이미지 키·한도 AND", () => {
        const stmt = policyStatement("reviews_update_own", "public.reviews");
        expect(andConjuncts(clauseExpr(stmt, "using") ?? "or")).toContain(OWN_USER);
        const conjuncts = andConjuncts(clauseExpr(stmt, "with check") ?? "or");
        expect(conjuncts, "WITH CHECK 최상위에 OR 가 있다").not.toBeNull();
        expect(conjuncts).toContain(OWN_USER);
        expectContentLimits(conjuncts ?? []);
      });

      it("reviews_select_own / reviews_delete_own / gifts_sender_select USING 은 소유자 조건 AND", () => {
        for (const [name, table, owner] of [
          ["reviews_select_own", "public.reviews", OWN_USER],
          ["reviews_delete_own", "public.reviews", OWN_USER],
          ["gifts_sender_select", "public.gifts", "sender_id = auth.uid()"],
        ] as const) {
          const conjuncts = andConjuncts(clauseExpr(policyStatement(name, table), "using") ?? "or");
          expect(conjuncts, `${name} USING 최상위에 OR 가 있다`).not.toBeNull();
          expect(conjuncts).toContain(owner);
        }
      });
    });

    it("DELETE 는 authenticated 에만 다시 준다", () => {
      expect(NORM).toContain("grant delete on table public.reviews to authenticated;");
    });

    it("모든 grant 는 authenticated 만 대상으로 한다 (anon/PUBLIC/service_role 금지)", () => {
      const grants = grantStatements();
      expect(grants.length).toBeGreaterThan(0);
      for (const g of grants) {
        expect(g).toMatch(/ to authenticated;$/);
      }
    });

    it("reviews_public_read(공개 갤러리 SELECT)는 유지한다", () => {
      expect(NORM).not.toContain('drop policy if exists "reviews_public_read"');
      expect(NORM).not.toContain('create policy "reviews_public_read"');
    });

    describe("라우트 소스와의 결합 (어긋나면 앱이 깨지거나 표면이 남는다)", () => {
      const createRoute = readFileSync(REVIEWS_ROUTE_PATH, "utf8");
      const idRoute = readFileSync(REVIEW_ID_ROUTE_PATH, "utf8");

      it("POST /api/reviews 의 insert payload 키 = INSERT grant 컬럼", () => {
        const m = createRoute.match(/\.from\("reviews"\)\s*\.insert\(\{([\s\S]*?)\}\)/);
        expect(m).not.toBeNull();
        // `key: value,` 와 단축 속성 `key,` 를 모두 센다.
        const keys = Array.from((m?.[1] ?? "").matchAll(/^\s*([a-z_]+)\s*(?::|,|$)/gm))
          .map((k) => k[1] ?? "")
          .sort();
        expect(keys).toEqual([...REVIEWS_INSERT_COLUMNS].sort());
      });

      it("PATCH /api/reviews/[id] 의 updatePayload 키 ⊆ UPDATE grant 컬럼", () => {
        expect(idRoute).toMatch(/\.from\("reviews"\)\s*\.update\(updatePayload\)/);
        const keys = Array.from(idRoute.matchAll(/updatePayload\.([a-z_]+)\s*=/g)).map(
          (k) => k[1] ?? "",
        );
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
          expect(REVIEWS_UPDATE_COLUMNS as readonly string[]).toContain(key);
        }
      });

      it("라우트의 REVIEWABLE_ORDER_STATUSES = 정책의 주문 상태 목록", () => {
        const m = createRoute.match(/REVIEWABLE_ORDER_STATUSES = new Set\(\[([^\]]*)\]\)/);
        expect(m).not.toBeNull();
        const routeStatuses = Array.from((m?.[1] ?? "").matchAll(/"([a-z_]+)"/g))
          .map((s) => s[1] ?? "")
          .sort();
        const p = withCheckPart(insertOwn).match(/o\.status in \(([^)]*)\)/);
        expect(p).not.toBeNull();
        const policyStatuses = Array.from((p?.[1] ?? "").matchAll(/'([a-z_]+)'/g))
          .map((s) => s[1] ?? "")
          .sort();
        expect(policyStatuses).toEqual(routeStatuses);
      });

      it("라우트의 REVIEW_MAX_IMAGES / body max = 정책 한도", () => {
        for (const src of [createRoute, idRoute]) {
          const maxImages = Number(src.match(/const REVIEW_MAX_IMAGES = (\d+);/)?.[1]);
          const bodyMax = Number(src.match(/body: z\.string\(\)\.trim\(\)\.max\((\d+)\)/)?.[1]);
          expect(Number.isInteger(maxImages)).toBe(true);
          expect(Number.isInteger(bodyMax)).toBe(true);
          for (const stmt of [insertOwn, updateOwn]) {
            const chk = withCheckPart(stmt);
            expect(chk).toContain(`cardinality(reviews.image_keys) <= ${maxImages}`);
            expect(chk).toContain(`char_length(reviews.body) <= ${bodyMax}`);
          }
        }
      });
    });
  });

  describe("(8) storage.objects — reviews·photo 버킷 사용자 세션 쓰기 정책만 제거", () => {
    const EXPECTED_STORAGE_DROPS = [
      "photo_originals_user_delete",
      "photo_originals_user_insert",
      "photo_originals_user_update",
      "photo_thumbs_user_delete",
      "reviews_storage_owner_all",
    ];
    const storageDrops = Array.from(
      NORM.matchAll(/drop policy if exists "([^"]+)" on storage\.objects;/g),
    )
      .map((m) => m[1] ?? "")
      .sort();

    it("storage.objects drop 목록 = 사용자 세션 쓰기 정책 5개 (그 밖의 정책은 건드리지 않음)", () => {
      expect(storageDrops).toEqual(EXPECTED_STORAGE_DROPS);
    });

    it("읽기 정책과 service_role 정책은 drop 하지 않는다", () => {
      for (const policy of [
        "photo_originals_user_select",
        "photo_thumbs_user_select",
        "photo_buckets_service_all",
        "reviews_storage_service_all",
        "pdfs_user_select",
        "pdfs_service_all",
        "resources_user_select",
        "resources_service_all",
        "site_assets_public_read",
      ]) {
        expect(NORM).not.toContain(`drop policy if exists "${policy}"`);
      }
    });

    it("storage.objects 에 새 정책을 만들지 않는다 (제거만)", () => {
      expect(NORM).not.toMatch(/create policy "[^"]*" on storage\.objects/);
    });

    it("0032 이전에 열린 reviews/photo 버킷 사용자 세션 쓰기 정책 = 0032 drop 목록 (누락·이름 오타 차단)", () => {
      const before = storagePoliciesBefore(32);
      const userWrites = Array.from(before.values())
        .filter(
          (p) =>
            p.cmd !== "select" &&
            p.roles.some((r) => r === "authenticated" || r === "anon" || r === "public") &&
            p.buckets.some((b) => (USER_WRITE_LOCKED_BUCKETS as readonly string[]).includes(b)),
        )
        .map((p) => p.name)
        .sort();
      expect(userWrites).toEqual(EXPECTED_STORAGE_DROPS);
      // 유지하는 읽기·service_role 정책이 실제로 존재하는 이름인지(오타 방지)도 확인.
      for (const kept of ["photo_originals_user_select", "photo_thumbs_user_select", "photo_buckets_service_all"]) {
        expect(before.has(kept), kept).toBe(true);
      }
    });

    describe("앱 소스와의 결합 — storage 쓰기는 service_role·서명 토큰뿐이어야 한다", () => {
      it("app/lib/components 의 모든 `.storage` 접근은 admin(service_role) 클라이언트다", () => {
        const offenders: string[] = [];
        for (const dir of ["app", "lib", "components"]) {
          for (const file of sourceFiles(path.resolve(ROOT, dir))) {
            const src = readFileSync(file, "utf8");
            for (const m of src.matchAll(/([\w$)\]]+)\s*\??\.storage\b/g)) {
              if (m[1] !== "admin") {
                const line = src.slice(0, m.index).split("\n").length;
                offenders.push(`${path.relative(ROOT, file)}:${line} ${m[0]}`);
              }
            }
          }
        }
        // 사용자 세션(서버·브라우저 anon 클라이언트)으로 storage 를 쓰게 되면 0032 (H) 가 앱을
        // 깨뜨린다 — 정책을 되살리기 전에 라우트 경유(service_role)로 옮길 수 있는지 먼저 검토.
        expect(offenders).toEqual([]);
      });

      it("사진 업로드 URL 은 service_role 이 upsert 없이 발급한다 (기존 객체 덮어쓰기 불가 토큰)", () => {
        const src = readFileSync(SIGN_UPLOAD_ROUTE_PATH, "utf8");
        expect(src).toMatch(/admin\.storage\s*\.from\(ORIGINALS_BUCKET\)\s*\.createSignedUploadUrl\(storageKey\)/);
        expect(src).not.toMatch(/createSignedUploadUrl\([^)]*upsert/);
      });

      it("클라이언트는 서명 URL 로 PUT 만 하고 Supabase 클라이언트를 쓰지 않는다", () => {
        const src = readFileSync(UPLOAD_QUEUE_PATH, "utf8");
        expect(src).toContain('xhr.open("PUT", url, true)');
        expect(src).not.toMatch(/@supabase\/|getBrowserSupabase|\.storage\b/);
      });
    });
  });
});
