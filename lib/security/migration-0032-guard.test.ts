import { readFileSync } from "node:fs";
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
 *  8) storage.objects 의 reviews 버킷 사용자 세션 정책(reviews_storage_owner_all)을
 *     제거하고 service_role 정책은 유지한다.
 */

const ROOT = process.cwd();
const MIGRATION_PATH = path.resolve(
  ROOT,
  "supabase/migrations/0032_lock_client_writes.sql",
);
const REVIEWS_ROUTE_PATH = path.resolve(ROOT, "app/api/reviews/route.ts");
const REVIEW_ID_ROUTE_PATH = path.resolve(ROOT, "app/api/reviews/[id]/route.ts");

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

/** `grant <priv> (<cols>) on table public.reviews to <roles>;` 의 컬럼 목록들. */
function reviewsColumnGrants(priv: "insert" | "update"): {
  columns: string[];
  roles: string;
}[] {
  const re = new RegExp(
    `grant ${priv} \\(([^)]*)\\) on (?:table )?public\\.reviews to ([^;]*);`,
    "g",
  );
  return Array.from(NORM.matchAll(re)).map((m) => ({
    columns: (m[1] ?? "")
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""))
      .filter((c) => c.length > 0)
      .sort(),
    roles: (m[2] ?? "").trim(),
  }));
}

/** 마이그레이션의 모든 grant 문. */
function grantStatements(): string[] {
  return NORM.match(/\bgrant [^;]*;/g) ?? [];
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

    it("photos: DELETE 는 회수하지 않는다 (projects/[id] DELETE 가 사용자 세션으로 씀)", () => {
      for (const role of REVOKE_ROLES) {
        expect(hasRevoke("photos", "delete", role)).toBe(false);
      }
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

  describe("(8) storage.objects — reviews 버킷 사용자 세션 정책만 제거", () => {
    it("reviews_storage_service_all(service_role)은 drop 하지 않는다", () => {
      expect(NORM).not.toContain('drop policy if exists "reviews_storage_service_all"');
    });

    it("storage.objects 에 새 정책을 만들지 않는다 (제거만)", () => {
      expect(NORM).not.toMatch(/create policy "[^"]*" on storage\.objects/);
    });

    it("다른 버킷(photo-originals 등)의 storage 정책은 건드리지 않는다", () => {
      const storageDrops = NORM.match(/drop policy if exists "[^"]*" on storage\.objects;/g) ?? [];
      expect(storageDrops).toEqual([
        'drop policy if exists "reviews_storage_owner_all" on storage.objects;',
      ]);
    });
  });
});
