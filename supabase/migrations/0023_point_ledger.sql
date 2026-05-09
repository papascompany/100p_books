-- =====================================================================
-- 0023_point_ledger.sql — 포인트 적립/사용 거래 내역
--
-- 배경:
--   user_points 는 잔액(balance)만 보관하므로 적립/사용 이력을 추적할 수 없다.
--   정산/CS/사용자 마이페이지 표시를 위해 거래 내역(ledger)이 필요하다.
--
-- 설계:
--   point_ledger — 모든 포인트 변동을 append-only 로 기록.
--     amount > 0 적립, amount < 0 사용/차감.
--     reason  : 'attendance' | 'attendance_bonus' | 'referral_reward' |
--               'order_use' | 'order_refund' | 'admin_adjust' | 'welcome'
--     ref_type/ref_id : 연관 테이블 id (orders, referrals, attendances ...).
--
--   기존 RPC (add_user_points, deduct_user_points, award_referral_reward) 는
--   ledger 자동 기록을 위해 _v2 변형을 추가한다 (기존 함수도 보존 — 하위 호환).
--
-- 보안:
--   - ledger.SELECT 본인만, INSERT/UPDATE/DELETE 는 service_role 전용.
--   - RPC 는 SECURITY DEFINER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) point_ledger
-- ---------------------------------------------------------------------
create table if not exists public.point_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      int  not null check (amount <> 0),
  reason      text not null check (reason in (
    'attendance',
    'attendance_bonus',
    'referral_reward',
    'order_use',
    'order_refund',
    'admin_adjust',
    'welcome'
  )),
  ref_type    text,
  ref_id      uuid,
  -- 거래 후 잔액 (감사용 — 동시 트랜잭션에서 RPC 가 안전하게 채움).
  balance_after int not null check (balance_after >= 0),
  memo        text,
  created_at  timestamptz not null default now()
);

create index if not exists point_ledger_user_id_created_at_idx
  on public.point_ledger (user_id, created_at desc);

create index if not exists point_ledger_ref_idx
  on public.point_ledger (ref_type, ref_id)
  where ref_type is not null;

alter table public.point_ledger enable row level security;

drop policy if exists "point_ledger_select_own" on public.point_ledger;
create policy "point_ledger_select_own" on public.point_ledger
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT/UPDATE/DELETE 정책 의도적으로 생략 → service_role 만 가능.

-- ---------------------------------------------------------------------
-- 2) add_user_points 재정의 — ledger 기록 + balance 누적 atomic.
--    기존 시그니처(p_user_id, p_amount) 를 보존하면서 reason 기본값 추가.
--    RPC 시그니처 변경을 피하기 위해 add_user_points_v2 로 신규 등록한다.
-- ---------------------------------------------------------------------
create or replace function public.add_user_points_v2(
  p_user_id  uuid,
  p_amount   int,
  p_reason   text,
  p_ref_type text default null,
  p_ref_id   uuid default null,
  p_memo     text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be a positive integer';
  end if;

  -- atomic 누적 (기존 add_user_points 와 동일 패턴)
  insert into public.user_points (user_id, balance, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set balance    = public.user_points.balance + p_amount,
        updated_at = now()
  returning balance into v_balance;

  -- ledger
  insert into public.point_ledger (
    user_id, amount, reason, ref_type, ref_id, balance_after, memo
  ) values (
    p_user_id, p_amount, p_reason, p_ref_type, p_ref_id, v_balance, p_memo
  );

  return v_balance;
end;
$$;

grant execute on function public.add_user_points_v2(uuid, int, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 3) deduct_user_points_v2 — atomic 차감 + ledger.
--    잔액 부족 시 -1 반환 (기존 deduct_user_points 와 동일).
-- ---------------------------------------------------------------------
create or replace function public.deduct_user_points_v2(
  p_user_id  uuid,
  p_amount   int,
  p_reason   text,
  p_ref_type text default null,
  p_ref_id   uuid default null,
  p_memo     text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_after   int;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'p_amount must be >= 0';
  end if;
  if p_amount = 0 then
    return coalesce((select balance from public.user_points where user_id = p_user_id), 0);
  end if;

  select balance
    into v_balance
    from public.user_points
   where user_id = p_user_id
   for update;

  if v_balance is null then
    return -1;
  end if;
  if v_balance < p_amount then
    return -1;
  end if;

  v_after := v_balance - p_amount;

  update public.user_points
     set balance    = v_after,
         updated_at = now()
   where user_id = p_user_id;

  -- ledger (음수 amount)
  insert into public.point_ledger (
    user_id, amount, reason, ref_type, ref_id, balance_after, memo
  ) values (
    p_user_id, -p_amount, p_reason, p_ref_type, p_ref_id, v_after, p_memo
  );

  return v_after;
end;
$$;

grant execute on function public.deduct_user_points_v2(uuid, int, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 4) award_referral_reward_v2 — 기존 RPC 와 동일 동작 + ledger 자동 기록.
-- ---------------------------------------------------------------------
create or replace function public.award_referral_reward_v2(
  p_referee_id uuid,
  p_reward     int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_balance int;
begin
  select *
    into v_ref
    from public.referrals
   where referee_id = p_referee_id
     and reward_status = 'pending'
   for update
   limit 1;

  if not found then
    return null;
  end if;

  update public.referrals
     set reward_status = 'rewarded'
   where id = v_ref.id;

  insert into public.user_points (user_id, balance, updated_at)
  values (v_ref.referrer_id, p_reward, now())
  on conflict (user_id)
  do update set
    balance    = public.user_points.balance + excluded.balance,
    updated_at = now()
  returning balance into v_balance;

  insert into public.point_ledger (
    user_id, amount, reason, ref_type, ref_id, balance_after, memo
  ) values (
    v_ref.referrer_id, p_reward, 'referral_reward',
    'referrals', v_ref.id, v_balance,
    '친구 추천 보상 (피추천인 첫 결제 완료)'
  );

  return v_ref.referrer_id;
end;
$$;

grant execute on function public.award_referral_reward_v2(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- 5) sync_oauth_profile(p_user_id) — auth.users.raw_user_meta_data 에서
--    카카오/구글 등 OAuth 프로바이더가 채워준 닉네임/아바타를 profiles 로 반영.
--    기존 display_name 이 비어있을 때만 채운다 (사용자가 편집한 값을 덮지 않음).
-- ---------------------------------------------------------------------
create or replace function public.sync_oauth_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_meta     jsonb;
  v_name     text;
  v_avatar   text;
  v_provider text;
begin
  select raw_user_meta_data,
         coalesce(raw_app_meta_data->>'provider', '')
    into v_meta, v_provider
    from auth.users
   where id = p_user_id;

  if v_meta is null then
    return;
  end if;

  -- Kakao OAuth: name (or nickname / preferred_username), picture (or avatar_url)
  -- Google: name, picture / Generic: full_name, avatar_url
  v_name := coalesce(
    v_meta->>'name',
    v_meta->>'full_name',
    v_meta->>'nickname',
    v_meta->>'preferred_username',
    v_meta->'kakao_account'->'profile'->>'nickname'
  );
  v_avatar := coalesce(
    v_meta->>'avatar_url',
    v_meta->>'picture',
    v_meta->'kakao_account'->'profile'->>'profile_image_url'
  );

  update public.profiles
     set
       display_name = case
         when display_name is null or display_name = ''
           then coalesce(v_name, display_name)
         else display_name
       end,
       avatar_url   = case
         when avatar_url is null or avatar_url = ''
           then coalesce(v_avatar, avatar_url)
         else avatar_url
       end,
       oauth_provider = case
         when oauth_provider is null and v_provider <> '' then v_provider
         else oauth_provider
       end
   where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) profiles 컬럼 추가 — avatar_url, oauth_provider
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  add column if not exists oauth_provider text;

-- 5번 RPC 가 위 컬럼을 참조하므로 컬럼 추가 후 다시 실행하도록 GRANT.
grant execute on function public.sync_oauth_profile(uuid) to service_role;
