-- =====================================================================
-- 0031_tighten_public_grants.sql — 공개 노출된 권한 잠그기 (보안)
--
-- 오픈 전 감사(2026-08-09)에서 **실측으로 확인된** 두 가지 구멍을 닫는다.
-- anon 키는 브라우저 번들에 들어 있는 공개 값이므로, 누구나 PostgREST
-- (`/rest/v1/...`, `/rest/v1/rpc/...`)를 직접 호출할 수 있다는 전제에서 봐야 한다.
--
-- =====================================================================
-- (A) SECURITY DEFINER 함수의 PUBLIC 실행 권한
-- =====================================================================
-- Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 를 기본 부여한다. 대부분의 RPC 가
-- `grant execute ... to service_role` 만 하고 **선행 revoke 를 빠뜨려서**,
-- anon 도 그대로 실행할 수 있었다.
--
--   실측(2026-08-09): anon 키로
--     POST /rest/v1/rpc/deduct_user_points_v2 → `-1` 반환.
--   즉 권한 거부가 아니라 **함수가 실제로 실행됐다**(잔액 부족이라 -1).
--   같은 패턴인 `add_user_points_v2` 는 SECURITY DEFINER 로 잔액을 올리므로,
--   누구나 자기 계정에 포인트를 무한 발급할 수 있었다. 1P = 1원이고 주문 결제에서
--   차감되므로 **곧바로 금전 손실**이다.
--
-- 아래 DO 블록은 시그니처를 손으로 적지 않고 카탈로그에서 읽어 처리한다
-- (오타로 인한 적용 실패를 없애고, 놓친 함수도 남기지 않는다).
-- 재실행해도 안전하며, 나중에 함수를 추가한 뒤 다시 돌려도 된다.
--
-- ⚠️ 제외 대상 2개 — 이건 호출자 권한이 반드시 필요하다:
--   • public.is_admin()          RLS 정책 22곳과 storage 정책에서 호출된다.
--                                revoke 하면 관리자 정책이 통째로 깨진다.
--   • public.lookup_referral_code(text)
--                                추천 코드 확인용으로 anon 에 **의도적으로** 열어 둔 것.
-- 앱의 다른 RPC 호출은 전부 service_role(`createAdminSupabase`)이므로 영향 없다.
-- =====================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef                                  -- SECURITY DEFINER 만
       and p.proname not in ('is_admin', 'lookup_referral_code')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    raise notice 'locked down: %', r.sig;
  end loop;
end $$;

-- =====================================================================
-- (B) 토큰 테이블의 전체 공개 SELECT 정책
-- =====================================================================
-- 두 정책이 `using (true)` 였다:
--   • share_tokens_public_read  — to anon, authenticated  (0016)
--   • gifts_recipient_select    — to authenticated        (0017)
-- 곧 "누구나 전체 토큰 목록을 덤프할 수 있다"는 뜻이다:
--   GET /rest/v1/share_tokens?select=*  → 모든 공유 링크 토큰
--   GET /rest/v1/gifts?select=*         → 모든 선물 토큰(로그인만 하면 됨)
-- 선물은 토큰 소지자가 수령하는 구조라, gift_token 유출은 **결제 완료된 포토북을
-- 제3자가 대신 수령**할 수 있다는 의미다.
--
-- 2026-08-09 실측 기준 두 테이블 모두 0행이라 실제 유출은 아직 없었다
-- (대조군: projects 는 37행인데 anon 조회가 빈 배열 → RLS 정상 동작 확인).
-- 서비스를 열고 공유·선물이 쓰이기 시작하면 그 순간 열리는 구멍이었다.
--
-- 제거해도 기능이 깨지지 않는 이유: 두 테이블의 토큰 조회는 전부 service_role 이다.
--   app/api/share/[token]/route.ts:66-70   createAdminSupabase()
--   app/api/gifts/[token]/route.ts:227     createAdminSupabase()
--   app/api/orders/[id]/gift/route.ts:106  createAdminSupabase()
-- 만료·조회수 검증도 라우트가 담당한다. 클라이언트가 anon 키로 이 테이블을 직접
-- 읽는 코드는 레포에 없다.
--
-- 소유자 경로는 그대로 둔다(내 공유·내가 보낸 선물 조회):
--   share_tokens 소유자 정책(projects.user_id = auth.uid()), gifts_sender_all.
-- =====================================================================

drop policy if exists "share_tokens_public_read" on public.share_tokens;
drop policy if exists "gifts_recipient_select" on public.gifts;
