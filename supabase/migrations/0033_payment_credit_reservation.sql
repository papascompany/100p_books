-- =====================================================================
-- 0033_payment_credit_reservation.sql — 결제 크레딧 선점 + finalize 멱등화
--   (DEBT-1, DEBT-7, SEC-7, SEC-8 후속)
--
-- 배경:
--   결제 confirm 은 토스 캡처 **뒤**에 포인트 차감·할인 사용 기록을 했다.
--   그래서 같은 포인트/1인 1회 코드를 쓴 서로 다른 pending 주문 2건을 동시에
--   confirm 하면 둘 다 캡처되고 차감은 한 번만 됐다(SEC-7). 차감 실패는 warn 만
--   남았고, 환불 시 restoreOrderCredits 는 points_used 를 무조건 복원했다(DEBT-7).
--
-- 이 마이그레이션:
--   (1) reserve_order_credits  — 캡처 **전**, 주문 행 잠금 아래에서 포인트 차감 +
--       할인 사용 기록(active·expires_at·max_uses·1인 1회 재검증)을 한 트랜잭션으로
--       실행하고 paymentKey 를 주문에 묶는다. 이미 잡혀 있으면 no-op(멱등).
--   (2) release_order_credits  — 이 주문에 **실제로 잡혀 있는** 크레딧만 되돌린다.
--       판정은 point_ledger 순액(order_use + order_refund)과 discount_uses.order_id.
--       'abort'  : 캡처 실패·금액 불일치 롤백 (status=pending + paymentKey 일치일 때만)
--       'refund' : 환불/취소 복원 (status in refunded, cancelled 일 때만)
--       두 번 호출해도 두 번째는 되돌릴 것이 없어 no-op. 단 'abort' 가 paymentKey 까지 해제한
--       뒤 같은 키로 다시 abort 하면 키 불일치로 ok:false(PAYMENT_KEY_MISMATCH)를 돌려준다
--       (상태 변화 없음 — 호출측은 RELEASE_FAILED 만 오류로 취급).
--   (3) orders.finalize_started_at / finalized_at — 결제 확정 부수효과(finalizePaidOrder)
--       단일 실행 리스와 완료 마커. confirm·webhook·재시도가 동시에 와도 한 곳만 실행.
--   (4) funnel_events order_paid 주문당 1회 부분 유니크 인덱스.
--
-- 잠금 순서(교착 방지): orders → discount_codes → user_points. 두 함수 모두 이 순서를 지킨다.
--
-- 앱은 이 마이그레이션 **적용 전에도** 동작한다: RPC/컬럼이 없으면(PGRST202·42703·PGRST204)
-- 기존 경로(캡처 후 차감, 원장 기준 복원)로 폴백한다 — lib/orders/refund.ts, finalize-paid.ts.
--
-- 재실행 안전: add column if not exists / create or replace / create index if not exists.
-- ⚠️ SECURITY DEFINER 는 반드시 revoke-then-grant (0031 에서 실측된 anon 실행 함정).
--
-- 적용 후 검증 SQL:
--   select proname, proacl from pg_proc
--    where proname in ('reserve_order_credits', 'release_order_credits');
--     → proacl 에 service_role=X 만 있고 anon/authenticated/PUBLIC(=X) 가 없어야 한다.
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'orders'
--      and column_name in ('finalize_started_at', 'finalized_at');   → 2행
--   select indexname from pg_indexes where indexname = 'uq_funnel_order_paid_once'; → 1행
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) orders — finalize 리스 + 완료 마커
--    기존 결제 주문은 백필하지 않는다(updated_at 트리거가 전 주문을 건드리는 것을 피함).
--    앱의 자동 복구는 paid_at 이 최근(72h)인 주문에만 동작하고, 효과별 마커(원장·
--    discount_uses·pdf_build_jobs·email_jobs)로 이미 실행된 효과는 건너뛴다.
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists finalize_started_at timestamptz,
  add column if not exists finalized_at        timestamptz;

-- ---------------------------------------------------------------------
-- 2) funnel_events — order_paid 주문당 1회
--    지금까지 order_paid 는 confirm 클레임 승자만 기록해 중복이 없어야 정상이다.
--    그래도 인덱스 생성이 실패하지 않도록 가장 이른 1건만 남긴다(0030 과 같은 관례).
--    점검: select props->>'orderId', count(*) from public.funnel_events
--           where event = 'order_paid' group by 1 having count(*) > 1;
-- ---------------------------------------------------------------------
delete from public.funnel_events dup
 using public.funnel_events keep
 where dup.event = 'order_paid'
   and keep.event = 'order_paid'
   and dup.props->>'orderId' is not null
   and dup.props->>'orderId' = keep.props->>'orderId'
   and (dup.created_at, dup.id) > (keep.created_at, keep.id);

create unique index if not exists uq_funnel_order_paid_once
  on public.funnel_events ((props->>'orderId'))
  where event = 'order_paid';

-- ---------------------------------------------------------------------
-- 3) reserve_order_credits — 캡처 전 크레딧 선점 + paymentKey 바인딩
--
--   반환 jsonb:
--     { ok: true,  pointsReserved: int, discountReserved: bool }
--     { ok: false, code: 'NOT_FOUND' | 'NOT_PENDING' | 'ORDER_CHANGED' |
--                        'PAYMENT_KEY_CONFLICT' | 'CREDITS_STATE_INVALID' |
--                        'DISCOUNT_INVALID' | 'POINTS_INSUFFICIENT' | 'INVALID_ARGS', ... }
--   실패는 예외가 아니라 ok=false 로 돌려준다 — 아무것도 바꾸기 전에 반환하므로 원자적.
-- ---------------------------------------------------------------------
create or replace function public.reserve_order_credits(
  p_order_id      uuid,
  p_payment_key   text,
  p_amount        int,
  p_toss_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        public.orders%rowtype;
  v_code         public.discount_codes%rowtype;
  v_held_points  int;
  v_need_points  int;
  v_balance      int;
  v_after        int;
  v_use_count    int;
  v_use_code     uuid;
  v_reserve_disc boolean;
begin
  if p_payment_key is null or length(p_payment_key) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS');
  end if;

  -- (a) 주문 행 잠금 — 같은 주문의 동시 confirm 은 여기서 직렬화된다.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'NOT_PENDING', 'status', v_order.status);
  end if;
  -- 주문서 재사용(orders/create)으로 금액·토스 주문번호가 바뀌었으면 캡처하지 않는다.
  -- p_amount 가 NULL 이면 <> 비교가 NULL 이 되어 검사를 건너뛰므로 is distinct from 을 쓴다.
  if v_order.amount is distinct from p_amount
     or v_order.toss_order_id is distinct from p_toss_order_id then
    return jsonb_build_object('ok', false, 'code', 'ORDER_CHANGED');
  end if;
  if v_order.toss_payment_key is not null
     and v_order.toss_payment_key <> p_payment_key then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_KEY_CONFLICT');
  end if;

  -- (b) 이 주문에 이미 잡혀 있는 크레딧 — 원장 순액 + 사용 기록.
  select coalesce(-sum(amount), 0)::int
    into v_held_points
    from public.point_ledger
   where ref_type = 'orders'
     and ref_id = v_order.id
     and reason in ('order_use', 'order_refund');

  select count(*)::int, (array_agg(code_id))[1]
    into v_use_count, v_use_code
    from public.discount_uses
   where order_id = v_order.id;

  if (v_held_points <> 0 and v_held_points <> coalesce(v_order.points_used, 0))
     or v_use_count > 1
     or (v_use_count = 1 and v_use_code is distinct from v_order.discount_code_id) then
    return jsonb_build_object(
      'ok', false, 'code', 'CREDITS_STATE_INVALID',
      'heldPoints', v_held_points, 'heldDiscountUses', v_use_count
    );
  end if;

  v_need_points  := coalesce(v_order.points_used, 0) - v_held_points;
  v_reserve_disc := v_order.discount_code_id is not null and v_use_count = 0;

  -- (c) 할인 코드 재검증 — 코드 행 잠금으로 같은 코드의 동시 선점을 직렬화(max_uses).
  if v_reserve_disc then
    select * into v_code
      from public.discount_codes
     where id = v_order.discount_code_id
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'DISCOUNT_INVALID', 'reason', 'not_found');
    end if;
    if not v_code.active then
      return jsonb_build_object('ok', false, 'code', 'DISCOUNT_INVALID', 'reason', 'inactive');
    end if;
    if v_code.expires_at is not null and v_code.expires_at <= now() then
      return jsonb_build_object('ok', false, 'code', 'DISCOUNT_INVALID', 'reason', 'expired');
    end if;
    if v_code.max_uses is not null and v_code.used_count >= v_code.max_uses then
      return jsonb_build_object('ok', false, 'code', 'DISCOUNT_INVALID', 'reason', 'limit_reached');
    end if;
    if exists (
      select 1 from public.discount_uses
       where code_id = v_code.id and user_id = v_order.user_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'DISCOUNT_INVALID', 'reason', 'already_used');
    end if;
  end if;

  -- (d) 포인트 잔액 — 잔액 행 잠금(다른 주문의 동시 선점과 직렬화).
  if v_need_points > 0 then
    select balance into v_balance
      from public.user_points
     where user_id = v_order.user_id
     for update;
    if coalesce(v_balance, 0) < v_need_points then
      return jsonb_build_object(
        'ok', false, 'code', 'POINTS_INSUFFICIENT',
        'balance', coalesce(v_balance, 0), 'requested', v_need_points
      );
    end if;
  end if;

  -- (e) 적용 — 여기부터는 한 트랜잭션으로 전부 반영되거나 전부 롤백된다.
  if v_reserve_disc then
    insert into public.discount_uses (code_id, user_id, order_id)
    values (v_code.id, v_order.user_id, v_order.id);
    update public.discount_codes
       set used_count = used_count + 1
     where id = v_code.id;
  end if;

  if v_need_points > 0 then
    v_after := v_balance - v_need_points;
    update public.user_points
       set balance = v_after, updated_at = now()
     where user_id = v_order.user_id;
    insert into public.point_ledger (
      user_id, amount, reason, ref_type, ref_id, balance_after, memo
    ) values (
      v_order.user_id, -v_need_points, 'order_use', 'orders', v_order.id, v_after,
      '주문 ' || left(v_order.id::text, 8) || ' 결제 시 포인트 사용'
    );
  end if;

  if v_order.toss_payment_key is null then
    update public.orders set toss_payment_key = p_payment_key where id = v_order.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'pointsReserved', greatest(v_need_points, 0),
    'discountReserved', v_reserve_disc
  );
end;
$$;

revoke all on function public.reserve_order_credits(uuid, text, int, text)
  from public, anon, authenticated;
grant execute on function public.reserve_order_credits(uuid, text, int, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 4) release_order_credits — 실제로 잡힌 크레딧만 되돌림(멱등)
--
--   반환 jsonb:
--     { ok: true,  pointsRestored: int, discountUsesRestored: int }
--     { ok: false, code: 'NOT_FOUND' | 'NOT_PENDING' | 'PAYMENT_KEY_MISMATCH' |
--                        'NOT_RELEASABLE_STATE' | 'INVALID_MODE', ... }
-- ---------------------------------------------------------------------
create or replace function public.release_order_credits(
  p_order_id          uuid,
  p_mode              text,
  p_payment_key       text,
  p_clear_payment_key boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_held  int;
  v_after int;
  v_disc  int := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if p_mode = 'abort' then
    -- 캡처 전 롤백 — 동시에 다른 경로(웹훅 등)가 paid 로 올렸다면 되돌리지 않는다.
    if v_order.status <> 'pending' then
      return jsonb_build_object('ok', false, 'code', 'NOT_PENDING', 'status', v_order.status);
    end if;
    if p_payment_key is null or v_order.toss_payment_key is distinct from p_payment_key then
      return jsonb_build_object('ok', false, 'code', 'PAYMENT_KEY_MISMATCH');
    end if;
  elsif p_mode = 'refund' then
    if v_order.status not in ('refunded', 'cancelled') then
      return jsonb_build_object('ok', false, 'code', 'NOT_RELEASABLE_STATE', 'status', v_order.status);
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'INVALID_MODE');
  end if;

  -- 할인 먼저(잠금 순서: 주문 → 코드 → 포인트). 이 주문의 사용 기록이 있을 때만 감액.
  with d as (
    delete from public.discount_uses
     where order_id = v_order.id
    returning code_id
  ), dec_codes as (
    update public.discount_codes c
       set used_count = greatest(c.used_count - 1, 0)
      from d
     where c.id = d.code_id
    returning c.id
  )
  select count(*)::int into v_disc from d;

  -- 포인트 — 원장 순액만큼만 복원(차감된 적 없으면 0).
  select coalesce(-sum(amount), 0)::int
    into v_held
    from public.point_ledger
   where ref_type = 'orders'
     and ref_id = v_order.id
     and reason in ('order_use', 'order_refund');

  if v_held > 0 then
    insert into public.user_points (user_id, balance, updated_at)
    values (v_order.user_id, v_held, now())
    on conflict (user_id) do update
      set balance    = public.user_points.balance + excluded.balance,
          updated_at = now()
    returning balance into v_after;

    insert into public.point_ledger (
      user_id, amount, reason, ref_type, ref_id, balance_after, memo
    ) values (
      v_order.user_id, v_held, 'order_refund', 'orders', v_order.id, v_after,
      case when p_mode = 'abort'
        then '주문 ' || left(v_order.id::text, 8) || ' 결제 미완료 — 포인트 선점 해제'
        else '주문 ' || left(v_order.id::text, 8) || ' 환불/취소 — 사용 포인트 복원'
      end
    );
  end if;

  if p_mode = 'abort' and coalesce(p_clear_payment_key, true) then
    update public.orders set toss_payment_key = null where id = v_order.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'pointsRestored', greatest(v_held, 0),
    'discountUsesRestored', v_disc
  );
end;
$$;

revoke all on function public.release_order_credits(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.release_order_credits(uuid, text, text, boolean)
  to service_role;

-- PostgREST 스키마 캐시 갱신(새 RPC·컬럼 노출).
notify pgrst, 'reload schema';
