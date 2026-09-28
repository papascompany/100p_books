// 0032 운영 적용 확인 — `pnpm exec tsx scripts/verify-0032.ts`
// 목적: 0032(lock_client_writes)가 PostgREST 직접 쓰기 경로(anon 키 / anon 키 + 사용자 JWT)를 실제로 막는지 바깥에서 실측한다.
// 데이터 불변: 쓰기 프로브는 전부 어떤 행에도 일치하지 않는 필터(ZERO uuid)라, 설령 열려 있어도 0행만 건드린다.
//   예외는 "본인 profiles 행 role=admin" 1건인데, 앞선 ZERO 프로브가 42501 일 때만 실행하며 대상은 이번에 만든 임시 계정이다.
//   INSERT/upsert·스토리지 업로드 프로브는 하지 않는다. 운영 auth 에 임시 계정(e2e+verify-0032-*@100pbooks.test)을
//   만들고 finally 에서 hard delete 한다(주문·스토리지가 없는 새 계정이라 profiles 등은 cascade 로 함께 지워진다).
// 기대(적용 후): anon·authenticated 쓰기 프로브 전부 error.code "42501"(permission denied) ·
//   service_role 로 본 임시 계정 role 은 admin 아님 · service_role profiles 조회 ok.
// 미적용이면: 쓰기 프로브가 오류 없이 rows=0(ZERO 필터라 일치 행 없음)으로 끝나고, 본인 행 프로브는 건너뛴다.
// 키·이메일·비밀번호는 출력하지 않는다(.env.local 의 service_role·anon 키를 런타임에만 사용).
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readE2eEnv, createServiceClient, provisionTestUser } from "../e2e/fixtures/test-user";

const ZERO = "00000000-0000-0000-0000-000000000000";
const DENIED = "42501";

interface ProbeError { code?: string; message?: string }
interface ProbeResult { error: ProbeError | null; count?: number | null }
interface ProbeRecord { label: string; expected: string; ok: boolean; result: string }

const results: ProbeRecord[] = [];

function brief(r: ProbeResult): string {
  return r.error
    ? JSON.stringify({ error: { code: r.error.code, message: (r.error.message ?? "").slice(0, 80) } })
    : JSON.stringify({ ok: true, rows: r.count ?? null });
}

function record(label: string, expected: string, ok: boolean, result: string): boolean {
  results.push({ label, expected, ok, result });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${result} (기대 ${expected})`);
  return ok;
}

async function expectDenied(label: string, run: () => PromiseLike<ProbeResult>): Promise<boolean> {
  let r: ProbeResult;
  try {
    r = await run();
  } catch (e) {
    r = { error: { code: "THROWN", message: e instanceof Error ? e.message : String(e) } };
  }
  return record(label, DENIED, r.error?.code === DENIED, brief(r));
}

function publicClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function probeAnon(url: string, anonKey: string): Promise<void> {
  const anon = publicClient(url, anonKey);
  await expectDenied("[anon] profiles update role=admin (id=ZERO)", () =>
    anon.from("profiles").update({ role: "admin" }, { count: "exact" }).eq("id", ZERO));
  await expectDenied("[anon] gifts update status=expired (id=ZERO)", () =>
    anon.from("gifts").update({ status: "expired" }, { count: "exact" }).eq("id", ZERO));
  await expectDenied("[anon] attendances delete (user_id=ZERO)", () =>
    anon.from("attendances").delete({ count: "exact" }).eq("user_id", ZERO));
  await expectDenied("[anon] review_likes delete (review_id=ZERO)", () =>
    anon.from("review_likes").delete({ count: "exact" }).eq("review_id", ZERO));
  await expectDenied("[anon] photos update storage_key (id=ZERO)", () =>
    anon.from("photos").update({ storage_key: "probe-0032" }, { count: "exact" }).eq("id", ZERO));
  await expectDenied("[anon] reviews update likes_count=1 (id=ZERO)", () =>
    anon.from("reviews").update({ likes_count: 1 }, { count: "exact" }).eq("id", ZERO));
}

async function runAuthenticatedProbes(svc: SupabaseClient, authed: SupabaseClient, userId: string): Promise<void> {
  const zeroBlocked = await expectDenied("[authenticated] profiles update role=admin (id=ZERO)", () =>
    authed.from("profiles").update({ role: "admin" }, { count: "exact" }).eq("id", ZERO));
  if (zeroBlocked) {
    await expectDenied("[authenticated] profiles update role=admin (id=본인)", () =>
      authed.from("profiles").update({ role: "admin" }, { count: "exact" }).eq("id", userId));
    const self = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (self.error) {
      record("[service] 임시 계정 profiles.role 확인", "isAdmin=false", false, brief(self));
    } else {
      const isAdmin = self.data?.role === "admin";
      record("[service] 임시 계정 profiles.role 확인", "isAdmin=false", self.data !== null && !isAdmin,
        JSON.stringify({ rowFound: self.data !== null, isAdmin }));
    }
  } else {
    console.log("SKIP [authenticated] profiles update role=admin (id=본인): ZERO 프로브가 42501 이 아니라 건너뜀");
  }
  await expectDenied("[authenticated] reviews update likes_count=1 (id=ZERO)", () =>
    authed.from("reviews").update({ likes_count: 1 }, { count: "exact" }).eq("id", ZERO));
  await expectDenied("[authenticated] photos update storage_key (id=ZERO)", () =>
    authed.from("photos").update({ storage_key: "probe-0032" }, { count: "exact" }).eq("id", ZERO));
  await authed.auth.signOut({ scope: "local" });
}

async function probeAuthenticated(svc: SupabaseClient, url: string, anonKey: string): Promise<boolean> {
  const email = `e2e+verify-0032-${randomUUID().slice(0, 8)}@100pbooks.test`;
  let userId: string | null = null;
  let cleaned = false;
  try {
    const user = await provisionTestUser(svc, email);
    userId = user.userId;
    console.log("[auth] 임시 계정 생성: ok");

    const authed = publicClient(url, anonKey);
    const signIn = await authed.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signIn.error || !signIn.data.session) {
      record("[auth] 임시 계정 로그인", "session", false,
        JSON.stringify({ error: { code: signIn.error?.code ?? "NO_SESSION", status: signIn.error?.status } }));
    } else {
      console.log("[auth] 임시 계정 로그인: ok (authenticated 세션)");
      await runAuthenticatedProbes(svc, authed, user.userId);
    }
  } finally {
    if (userId) {
      const del = await svc.auth.admin.deleteUser(userId);
      const gone = await svc.auth.admin.getUserById(userId);
      const prof = await svc.from("profiles").select("id", { count: "exact", head: true }).eq("id", userId);
      cleaned = !del.error && !gone.data.user && !prof.error && (prof.count ?? 0) === 0;
      console.log("[cleanup] 임시 계정 삭제:", JSON.stringify({
        deleteOk: !del.error,
        deleteErrorCode: del.error?.code ?? null,
        authUserGone: !gone.data.user,
        profileRows: prof.error ? `error ${prof.error.code}` : (prof.count ?? 0),
      }));
    } else {
      console.log("[cleanup] 임시 계정 없음(생성 전 실패)");
    }
  }
  return cleaned;
}

async function main(): Promise<void> {
  const env = readE2eEnv();
  if (!env) throw new Error("env 없음");
  const svc = createServiceClient(env);
  console.log("host:", new URL(env.supabaseUrl).host.split(".")[0]);

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("anon 키 없음");

  await probeAnon(env.supabaseUrl, anonKey);
  const cleaned = await probeAuthenticated(svc, env.supabaseUrl, anonKey);

  const s1 = await svc.from("profiles").select("id").limit(1);
  record("[service] profiles select id limit 1", "ok", !s1.error,
    s1.error ? brief(s1) : `ok (rows=${s1.data?.length ?? 0})`);

  const failed = results.filter((r) => !r.ok);
  console.log(`SUMMARY: ${results.length - failed.length}/${results.length} PASS · 임시 계정 정리=${cleaned ? "ok" : "확인 필요"}`);
  if (failed.length > 0 || !cleaned) process.exitCode = 1;
}
main().catch((e) => { console.error("probe error:", e instanceof Error ? e.message : String(e)); process.exit(1); });
