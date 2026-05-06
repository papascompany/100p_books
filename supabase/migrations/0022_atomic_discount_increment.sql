-- =====================================================================
-- 0022_atomic_discount_increment.sql — 동시성 안전 RPC 보강
--
-- 배경:
--   기존 코드는 read-then-write 패턴으로 두 카운터를 갱신했다.
--     - discount_codes.used_count    (payments/confirm)
--     - user_points.balance          (attendance/check)
--   동시 호출 시 lost-update 가 발생할 수 있음 (할인 한도 초과, 포인트 중복 지급).
--
-- 본 마이그레이션은 두 케이스를 atomic SQL 한 문장으로 처리하는 RPC 를 추가한다.
--   - increment_discount_used(p_code_id)
--       한도 검사 + 증가를 단일 UPDATE 로. 한도 초과 / 비활성이면 P0001 예외.
--   - add_user_points(p_user_id, p_amount)
--       INSERT ... ON CONFLICT DO UPDATE 로 잔액 누적 (음수 방어).
--       기존 0019 의 award_referral_reward 패턴과 동일.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 할인 코드 atomic 증가
--    한도(max_uses) 또는 비활성(active=false) 시 NOT FOUND → P0001 예외.
-- ---------------------------------------------------------------------
create or replace function public.increment_discount_used(
  p_code_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.discount_codes
     set used_count = used_count + 1
   where id = p_code_id
     and (max_uses is null or used_count < max_uses)
     and active = true;

  if not found then
    raise exception 'DISCOUNT_LIMIT_REACHED' using errcode = 'P0001';
  end if;
end;
$$;

grant execute on function public.increment_discount_used(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 2) 포인트 안전 적립 (positive only)
--    음수 적립이 호출되면 즉시 예외. user_points 행이 없으면 신규 생성,
--    있으면 +p_amount. user_points.balance >= 0 CHECK 제약은 자연히 보존.
--    user_points.balance >= 0 CHECK 제약(0019_referrals.sql) 으로 음수는 절대 발생 X.
-- ---------------------------------------------------------------------
create or replace function public.add_user_points(
  p_user_id uuid,
  p_amount  int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'p_amount must be a non-negative integer';
  end if;

  if p_amount = 0 then
    return;
  end if;

  insert into public.user_points (user_id, balance, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set balance    = public.user_points.balance + p_amount,
        updated_at = now();
end;
$$;

grant execute on function public.add_user_points(uuid, int) to service_role;
