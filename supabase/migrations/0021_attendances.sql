-- =====================================================================
-- 0021_attendances.sql — 출석체크 (M16-6)
--
-- 모델:
--   attendances — 사용자별 일자별 출석 기록 (KST 기준 일자)
--
-- 보상 정책 (애플리케이션 라우트에서 처리):
--   - 일일 출석: +100P
--   - 월 10일 달성: +500P 추가
--   - 월 20일 이상 (전월 마감 cron): +1000P 추가
--
-- 보안:
--   - attendances: 본인만 SELECT/INSERT, admin 은 SELECT 전용.
--   - INSERT 는 RLS 정책으로 본인 user_id 강제 (with check).
--   - 누적 카운트는 별도 집계하지 않고 COUNT(*) 쿼리 사용.
-- =====================================================================

create table if not exists public.attendances (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  checked_date  date not null,
  -- 'YYYY-MM' 형식. 인덱스/집계 편의용. checked_date 로부터 파생.
  month_key     text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, checked_date)
);

create index if not exists attendances_user_id_month_idx
  on public.attendances (user_id, month_key);

create index if not exists attendances_checked_date_idx
  on public.attendances (checked_date desc);

alter table public.attendances enable row level security;

-- 본인 SELECT
drop policy if exists "attendances_select_own" on public.attendances;
create policy "attendances_select_own" on public.attendances
  for select
  to authenticated
  using (user_id = auth.uid());

-- 본인 INSERT (with check 으로 user_id 위조 차단)
drop policy if exists "attendances_insert_own" on public.attendances;
create policy "attendances_insert_own" on public.attendances
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- 관리자 SELECT (전체 조회)
drop policy if exists "attendances_admin_select" on public.attendances;
create policy "attendances_admin_select" on public.attendances
  for select
  to authenticated
  using (public.is_admin());

-- UPDATE/DELETE 정책은 의도적으로 생략 → service_role 만 가능 (관리자 보정용).
