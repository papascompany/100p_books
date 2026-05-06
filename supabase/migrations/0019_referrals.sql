-- =====================================================================
-- 0019_referrals.sql — 친구 추천 시스템 (M16-4)
--
-- 모델:
--   user_points  — 사용자 포인트 잔액 (1인 1행)
--   referrals    — 추천 관계 (referrer → referee, code, reward_status)
--   profiles     — referral_code 컬럼 추가 (사용자별 고유, 가입 후 발급)
--
-- 보상 정책:
--   referee 가 첫 결제(paid) 완료 시 referrer 에게 +5000P 지급.
--   결제 confirm 라우트(service_role)에서 referrals.reward_status='rewarded'
--   마킹 + user_points.balance += 5000 (upsert).
--
-- 보안:
--   - user_points: 본인만 SELECT, INSERT/UPDATE/DELETE 는 service_role 전용.
--   - referrals  : 본인이 referrer/referee 인 행만 SELECT, 쓰기는 service_role.
--   - profiles.referral_code: 기존 0001 정책에 의해 본인 SELECT/UPDATE.
--     단, referee 가 가입 시 referrer 의 코드를 lookup 해야 하므로 별도 RPC
--     `lookup_referral_code(text)` 를 SECURITY DEFINER 로 제공한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) profiles.referral_code 컬럼 추가
--    기존 마이그레이션(0001_init.sql)에서 profiles 가 이미 생성되어 있으므로
--    안전하게 컬럼만 추가한다.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists referral_code text unique;

create index if not exists profiles_referral_code_idx
  on public.profiles(referral_code)
  where referral_code is not null;

-- ---------------------------------------------------------------------
-- 2) user_points
-- ---------------------------------------------------------------------
create table if not exists public.user_points (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  balance     int not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_user_points_updated_at on public.user_points;
create trigger trg_user_points_updated_at
  before update on public.user_points
  for each row execute function public.set_updated_at();

alter table public.user_points enable row level security;

drop policy if exists "user_points_select_own" on public.user_points;
create policy "user_points_select_own" on public.user_points
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT/UPDATE/DELETE 정책은 의도적으로 생략 → service_role 만 가능.

-- ---------------------------------------------------------------------
-- 3) referrals
-- ---------------------------------------------------------------------
create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  referrer_id    uuid not null references auth.users(id) on delete cascade,
  referee_id     uuid references auth.users(id) on delete set null,
  referral_code  text not null,
  reward_status  text not null default 'pending'
                 check (reward_status in ('pending', 'rewarded')),
  created_at     timestamptz not null default now(),
  -- 한 referee 가 동일 referrer 로 중복 등록되는 것을 방지
  unique (referrer_id, referee_id),
  -- self-referral 방지 (referee_id 가 채워진 경우)
  check (referee_id is null or referee_id <> referrer_id)
);

create index if not exists referrals_referrer_id_idx on public.referrals(referrer_id);
create index if not exists referrals_referral_code_idx on public.referrals(referral_code);
create index if not exists referrals_referee_id_idx on public.referrals(referee_id);

alter table public.referrals enable row level security;

drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own" on public.referrals
  for select
  to authenticated
  using (referrer_id = auth.uid() or referee_id = auth.uid());

-- INSERT/UPDATE/DELETE 정책은 의도적으로 생략 → service_role 만 가능.

-- ---------------------------------------------------------------------
-- 4) lookup_referral_code(text) — 가입 직후 referrer profile 을 찾기 위한
--    SECURITY DEFINER 헬퍼. RLS 를 우회하지 않고도 referral_code → user_id
--    매핑만 안전하게 노출.
-- ---------------------------------------------------------------------
create or replace function public.lookup_referral_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.profiles
  where referral_code = upper(p_code)
    and deleted_at is null
  limit 1;
$$;

grant execute on function public.lookup_referral_code(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 5) ensure_user_points(uuid) — upsert 헬퍼 (service_role 사용 가정)
--    user_points 행이 없으면 0 으로 만든다.
-- ---------------------------------------------------------------------
create or replace function public.ensure_user_points(p_user_id uuid)
returns void
language sql
as $$
  insert into public.user_points (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;
$$;

-- ---------------------------------------------------------------------
-- 6) award_referral_reward(referee_id uuid, reward int) — atomic 보상 지급
--    referee 의 pending referral 을 'rewarded' 로 마킹 + referrer 에게 포인트 지급.
--    이미 rewarded 면 no-op (멱등). 반환: 지급된 referrer_id (없으면 null).
--    SECURITY DEFINER — 결제 confirm 에서 RLS 우회 호출.
-- ---------------------------------------------------------------------
create or replace function public.award_referral_reward(
  p_referee_id uuid,
  p_reward int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
begin
  -- pending 인 referral 한 건만 잠금 + 갱신 (referee 1명당 최대 1건이지만 안전하게 LIMIT 1)
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
    updated_at = now();

  return v_ref.referrer_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) orders.points_used — 주문에 사용된 포인트 (KRW 정수)
--    결제 confirm 시 user_points 에서 차감 + 주문에 기록 → 환불/통계용.
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists points_used int not null default 0
    check (points_used >= 0);

create index if not exists orders_points_used_idx
  on public.orders(points_used)
  where points_used > 0;

-- ---------------------------------------------------------------------
-- 8) deduct_user_points(user_id uuid, amount int) — atomic 차감
--    잔액 부족 시 -1 을 반환. SECURITY DEFINER.
-- ---------------------------------------------------------------------
create or replace function public.deduct_user_points(
  p_user_id uuid,
  p_amount int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be >= 0';
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

  update public.user_points
     set balance = balance - p_amount,
         updated_at = now()
   where user_id = p_user_id;

  return v_balance - p_amount;
end;
$$;
