-- =====================================================================
-- 0018_discount_codes.sql — 할인 코드 시스템 (M16-3)
--
-- 모델:
--   discount_codes  — 코드 발급 + 정책 (% / 정액, 만료, 한도)
--   discount_uses   — 사용 이력 (1인 1회 제약 — UNIQUE(code_id, user_id))
--
-- orders 컬럼 추가:
--   discount_code_id  uuid           — 적용된 코드 (refund/통계)
--   discount_amount   int default 0  — 실제 할인 금액 (KRW)
--
-- 보안:
--   - 코드 CRUD 는 admin 만 (public.is_admin()).
--   - validate API 가 안정적으로 동작하도록, authenticated 가 active=true
--     코드만 SELECT 가능 (코드 enumeration 위험은 코드값이 충분히 임의일 때 낮음).
--     실제로는 service_role 라우트에서 처리하므로 RLS 는 안전망.
--   - discount_uses 는 본인만 SELECT, INSERT/UPDATE/DELETE 는 service_role 전용.
--
-- 기존 컨벤션 참고:
--   - 기존 마이그레이션은 `public.is_admin()` 헬퍼를 사용 (auth.users.raw_user_meta
--     를 직접 참조하지 않음). M16-3 도 동일하게 유지.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 타입 + 테이블
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discount_type') then
    create type public.discount_type as enum ('percent', 'amount');
  end if;
end$$;

create table if not exists public.discount_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  type         public.discount_type not null,
  /** percent: 0 < value <= 100,  amount: KRW 정수 양수 */
  value        numeric not null check (value > 0),
  /** null = 무제한 */
  max_uses     int check (max_uses is null or max_uses > 0),
  used_count   int not null default 0 check (used_count >= 0),
  /** null = 무기한 */
  expires_at   timestamptz,
  active       bool not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.discount_uses (
  id         uuid primary key default gen_random_uuid(),
  code_id    uuid not null references public.discount_codes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  order_id   uuid references public.orders(id) on delete set null,
  used_at    timestamptz not null default now(),
  unique(code_id, user_id)
);

create index if not exists discount_codes_code_idx on public.discount_codes(code);
create index if not exists discount_codes_active_idx on public.discount_codes(active) where active = true;
create index if not exists discount_uses_user_id_idx on public.discount_uses(user_id);
create index if not exists discount_uses_code_id_idx on public.discount_uses(code_id);
create index if not exists discount_uses_order_id_idx on public.discount_uses(order_id);

-- ---------------------------------------------------------------------
-- 2) orders 컬럼 추가
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists discount_amount  int not null default 0 check (discount_amount >= 0);

create index if not exists orders_discount_code_id_idx
  on public.orders(discount_code_id)
  where discount_code_id is not null;

-- ---------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------
alter table public.discount_codes enable row level security;
alter table public.discount_uses  enable row level security;

-- discount_codes -------------------------------------------------------
-- admin: 전체 CRUD
drop policy if exists "discount_codes_admin" on public.discount_codes;
create policy "discount_codes_admin" on public.discount_codes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 인증 사용자: active 코드만 SELECT (validate API 에서 활용 가능. 실제 검증은 server에서)
drop policy if exists "discount_codes_public_read" on public.discount_codes;
create policy "discount_codes_public_read" on public.discount_codes
  for select
  to authenticated
  using (active = true);

-- discount_uses --------------------------------------------------------
-- 본인 사용기록 SELECT
drop policy if exists "discount_uses_own" on public.discount_uses;
create policy "discount_uses_own" on public.discount_uses
  for select
  to authenticated
  using (user_id = auth.uid());

-- admin 전체 SELECT
drop policy if exists "discount_uses_admin_read" on public.discount_uses;
create policy "discount_uses_admin_read" on public.discount_uses
  for select
  to authenticated
  using (public.is_admin());

-- INSERT/UPDATE/DELETE 정책은 의도적으로 생략 — service_role 로만 기록.
