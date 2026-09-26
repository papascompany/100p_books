// 0033 운영 적용 확인 — `pnpm exec tsx scripts/verify-0033.ts`
// 읽기 전용: 존재하지 않는 주문 id 로 RPC 를 불러 함수 존재·권한만 본다(NOT_FOUND 즉시 반환, 쓰기 없음).
// 기대: service reserve/release = {ok:false,code:"NOT_FOUND"} · orders 신규 컬럼 ok · anon 호출은 오류(42501/PGRST202).
// 미적용이면 service 호출이 PGRST202, 컬럼 조회가 42703. 키 값은 출력하지 않는다(.env.local 의 service_role 사용).
import { createClient } from "@supabase/supabase-js";
import { readE2eEnv, createServiceClient } from "../e2e/fixtures/test-user";

const ZERO = "00000000-0000-0000-0000-000000000000";
function brief(r: { data: unknown; error: { code?: string; message?: string } | null }) {
  return r.error ? { error: { code: r.error.code, message: (r.error.message ?? "").slice(0, 120) } } : { data: r.data };
}
async function main() {
  const env = readE2eEnv();
  if (!env) throw new Error("env 없음");
  const svc = createServiceClient(env);
  console.log("host:", new URL(env.supabaseUrl).host.split(".")[0]);

  const r1 = await svc.rpc("reserve_order_credits", { p_order_id: ZERO, p_payment_key: "probe-0033", p_amount: 100, p_toss_order_id: "probe-0033" });
  console.log("[service] reserve_order_credits:", JSON.stringify(brief(r1)));
  const r2 = await svc.rpc("release_order_credits", { p_order_id: ZERO, p_mode: "abort", p_payment_key: "probe-0033", p_clear_payment_key: false });
  console.log("[service] release_order_credits:", JSON.stringify(brief(r2)));
  const r3 = await svc.from("orders").select("finalize_started_at, finalized_at").limit(1);
  console.log("[service] orders 신규 컬럼 조회:", r3.error ? JSON.stringify(brief(r3)) : `ok (rows=${r3.data?.length ?? 0})`);

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) { console.log("[anon] anon 키 없음 — 건너뜀"); return; }
  const anon = createClient(env.supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const a1 = await anon.rpc("reserve_order_credits", { p_order_id: ZERO, p_payment_key: "probe-0033", p_amount: 100, p_toss_order_id: "probe-0033" });
  console.log("[anon] reserve_order_credits:", JSON.stringify(brief(a1)));
  const a2 = await anon.rpc("release_order_credits", { p_order_id: ZERO, p_mode: "abort", p_payment_key: "probe-0033", p_clear_payment_key: false });
  console.log("[anon] release_order_credits:", JSON.stringify(brief(a2)));
}
main().catch((e) => { console.error("probe error:", e instanceof Error ? e.message : String(e)); process.exit(1); });
