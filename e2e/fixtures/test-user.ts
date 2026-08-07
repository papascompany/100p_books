import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 인증 E2E 전용 테스트 계정 유틸.
 *
 * 왜 별도 파일인가:
 *   - `lib/db/admin.ts` 는 `server-only` 를 import 해서 Playwright(node) 프로세스에서
 *     불러올 수 없다. E2E 는 여기서 직접 service_role 클라이언트를 만든다.
 *
 * 안전 규칙 (지키지 않으면 운영 데이터가 오염된다):
 *   - service_role 키는 절대 로그·아티팩트에 남기지 않는다.
 *   - 테스트 계정 비밀번호는 실행할 때마다 새로 만들고 프로세스 메모리에만 둔다.
 *     디스크에 남는 것은 Playwright storageState(세션 쿠키)뿐이다.
 *   - 이 계정이 만든 데이터는 `cleanupProjects` 로 되돌린다. 운영 DB 를 그대로 쓰는
 *     구성이라, 테스트가 남긴 프로젝트/사진/스토리지 오브젝트를 반드시 지운다.
 */

let envLoaded = false;

/**
 * `.env.local` 을 읽어 process.env 에 채운다.
 *
 * Next.js 가 아니라 Playwright(node) 프로세스라 env 자동 로드가 없다. `@next/env` 는
 * 직접 의존성이 아니고 dotenv 도 없어서, 새 패키지를 늘리지 않고 최소 파서를 둔다.
 * 이미 정의된 값(CI 시크릿 등)은 덮어쓰지 않는다.
 */
function ensureEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  let raw: string;
  try {
    raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // 파일이 없으면 CI 처럼 실제 env 만 사용
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (!key || process.env[key] !== undefined) continue;
    let value = (m[2] ?? "").trim();
    // 따옴표로 감싼 값은 벗기고, 그렇지 않은 값의 줄 끝 주석은 잘라낸다.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = value;
  }
}

export interface E2eEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  email: string;
}

/**
 * 인증 E2E 실행에 필요한 env 를 모은다.
 * 하나라도 없으면 null — 호출부에서 `test.skip` 한다(파이프라인을 깨지 않는다).
 */
export function readE2eEnv(): E2eEnv | null {
  ensureEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  // 기본값은 실제로 메일이 가지 않는 주소. 운영 사용자와 절대 겹치지 않게 고정 prefix 사용.
  const email = process.env.E2E_USER_EMAIL ?? "e2e+golden-flow@100pbooks.test";
  return { supabaseUrl, serviceRoleKey, email };
}

export function createServiceClient(env: E2eEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface ProvisionedUser {
  userId: string;
  email: string;
  /** 이번 실행에서만 유효한 임시 비밀번호. 로그에 찍지 말 것. */
  password: string;
}

/**
 * 테스트 계정을 "있으면 재사용, 없으면 생성" 하고 비밀번호를 이번 실행 값으로 재설정한다.
 * 재설정하는 이유: 비밀번호를 어디에도 저장하지 않으므로 이전 실행 값을 알 수 없다.
 */
export async function provisionTestUser(
  admin: SupabaseClient,
  email: string,
): Promise<ProvisionedUser> {
  const password = `E2e-${randomUUID()}`;

  const existingId = await findUserIdByEmail(admin, email);
  if (existingId) {
    const { error } = await admin.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`테스트 계정 비밀번호 재설정 실패: ${error.message}`);
    return { userId: existingId, email, password };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`테스트 계정 생성 실패: ${error?.message ?? "unknown"}`);
  }
  return { userId: data.user.id, email, password };
}

/** listUsers 는 페이지네이션이라 이메일로 찾으려면 순회가 필요하다. */
async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`사용자 조회 실패: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * 테스트 계정이 만든 프로젝트와 그 파생물을 삭제한다.
 *
 * 삭제 순서가 중요하다 — `orders.project_id` 에는 ON DELETE CASCADE 가 없어서
 * (supabase/migrations/0001_init.sql:161) 주문을 먼저 지우지 않으면 프로젝트 삭제가
 * FK 위반으로 실패한다. photos/pages/share_tokens/pdf_build_jobs 는 CASCADE 다.
 * 스토리지 오브젝트는 DB 삭제로 지워지지 않으므로 별도로 제거한다.
 */
export async function cleanupProjects(
  admin: SupabaseClient,
  userId: string,
): Promise<{ projects: number; storageObjects: number }> {
  const { data: projects, error: pErr } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", userId);
  if (pErr) throw new Error(`정리 대상 조회 실패: ${pErr.message}`);
  const ids = (projects ?? []).map((p) => p.id as string);
  if (ids.length === 0) return { projects: 0, storageObjects: 0 };

  // 1) 스토리지 키를 먼저 수집한다(행이 사라지면 경로를 알 수 없다).
  const { data: photos } = await admin
    .from("photos")
    .select("storage_key, thumb_key")
    .in("project_id", ids);
  const originals = (photos ?? [])
    .map((p) => p.storage_key as string | null)
    .filter((k): k is string => !!k);
  const thumbs = (photos ?? [])
    .map((p) => p.thumb_key as string | null)
    .filter((k): k is string => !!k);

  // 2) 퍼널 이벤트 — FK 가 없어 CASCADE 되지 않는다. 남으면 지표가 오염된다.
  await admin.from("funnel_events").delete().in("project_id", ids);
  // 3) CASCADE 가 없는 주문 → PDF 잡 순으로 제거.
  await admin.from("pdf_build_jobs").delete().in("project_id", ids);
  await admin.from("orders").delete().in("project_id", ids);

  // 4) 스토리지.
  let storageObjects = 0;
  if (originals.length > 0) {
    const { error } = await admin.storage.from("photo-originals").remove(originals);
    if (!error) storageObjects += originals.length;
  }
  if (thumbs.length > 0) {
    const { error } = await admin.storage.from("photo-thumbs").remove(thumbs);
    if (!error) storageObjects += thumbs.length;
  }

  // 5) 프로젝트 → photos/pages/share_tokens 는 CASCADE.
  const { error: dErr } = await admin.from("projects").delete().in("id", ids);
  if (dErr) throw new Error(`프로젝트 삭제 실패: ${dErr.message}`);

  return { projects: ids.length, storageObjects };
}
