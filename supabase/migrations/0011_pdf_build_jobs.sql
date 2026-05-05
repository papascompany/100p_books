-- =====================================================================
-- 0011_pdf_build_jobs.sql — PDF 빌드 잡 영속 큐 (재시도/모니터링)
--
-- 정책:
--   • 결제 confirm → enqueuePdfJob → runPdfJob 즉시 실행 → 행 1개 기록.
--   • 실패 시 status='failed', last_error 저장. 관리자가 재시도 가능 (max_attempts 까지).
--   • 사용자는 자신의 잡만 SELECT (진행률 폴링 등). 쓰기는 service_role 만.
--   • 잡 행은 6개월 후 cron 으로 정리하는 것이 권장 (현재 단계는 보존).
--
-- 컬럼:
--   id              uuid pk
--   order_id        nullable (사용자 직접 빌드 흐름에서는 null)
--   project_id      not null
--   user_id         nullable (FK on delete set null — 탈퇴 후에도 잡 행 유지)
--   target          'cover' | 'interior' | 'all'
--   status          'pending' | 'running' | 'success' | 'failed'
--   attempt         성공/실패 횟수와 무관한 시도 카운터 (running 진입 시 +1)
--   max_attempts    기본 3
--   last_error      마지막 실패 메시지 (text)
--   cover_pdf_key   결과 storage key (성공 시)
--   interior_pdf_key
--   created_at / started_at / finished_at  타임스탬프
-- =====================================================================

create table if not exists public.pdf_build_jobs (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid references public.orders(id)   on delete cascade,
  project_id        uuid references public.projects(id) on delete cascade not null,
  user_id           uuid references public.profiles(id) on delete set null,
  target            text not null check (target in ('cover', 'interior', 'all')),
  status            text not null default 'pending'
                      check (status in ('pending', 'running', 'success', 'failed')),
  attempt           int  not null default 0,
  max_attempts      int  not null default 3,
  last_error        text,
  cover_pdf_key     text,
  interior_pdf_key  text,
  created_at        timestamptz default now() not null,
  started_at        timestamptz,
  finished_at       timestamptz
);

create index if not exists idx_pdf_jobs_status
  on public.pdf_build_jobs (status, created_at);

create index if not exists idx_pdf_jobs_order
  on public.pdf_build_jobs (order_id);

create index if not exists idx_pdf_jobs_project
  on public.pdf_build_jobs (project_id, created_at desc);

alter table public.pdf_build_jobs enable row level security;

-- 정책: 사용자는 자신의 잡 SELECT
drop policy if exists "users select own pdf jobs" on public.pdf_build_jobs;
create policy "users select own pdf jobs"
  on public.pdf_build_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

-- 정책: admin SELECT 전체
drop policy if exists "admin select all pdf jobs" on public.pdf_build_jobs;
create policy "admin select all pdf jobs"
  on public.pdf_build_jobs
  for select
  to authenticated
  using (public.is_admin());

-- 쓰기는 service_role 만 (정책 미설정 → RLS 차단). admin client 가 service_role 키 사용.
