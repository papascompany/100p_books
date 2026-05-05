-- =====================================================================
-- 0015_email_jobs.sql — 이메일 발송 큐 (M15 / Phase 14.5)
--
-- 결제·주문 상태 전이·회원가입·탈퇴 등의 시점에 enqueueEmail() 로 행을 INSERT
-- 한 뒤 Vercel Cron 워커(`/api/cron/process-emails`) 가 batch 로 처리한다.
-- SMTP 미통합 상태에서는 워커가 status='cancelled' + last_error="SMTP not configured"
-- 로 마킹하여 큐만 쌓이는 상태가 된다 (Phase 12 후속에서 Resend 등 통합).
-- =====================================================================

create table if not exists public.email_jobs (
  id              uuid primary key default gen_random_uuid(),
  template        text not null,           -- 'order.paid', 'order.shipped', 'user.welcome' …
  to_email        text not null,
  to_name         text,
  subject         text not null,
  body_text       text not null,           -- 평문
  body_html       text,                    -- HTML (선택)
  context         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt         int  not null default 0,
  max_attempts    int  not null default 3,
  last_error      text,
  related_type    text,                    -- 'order', 'user' …
  related_id      uuid,
  scheduled_at    timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_email_jobs_status_scheduled
  on public.email_jobs (status, scheduled_at)
  where status in ('pending', 'failed');

create index if not exists idx_email_jobs_related
  on public.email_jobs (related_type, related_id);

create index if not exists idx_email_jobs_created
  on public.email_jobs (created_at desc);

-- updated_at 자동 갱신 (0001 의 set_updated_at 함수 재사용)
drop trigger if exists trg_email_jobs_updated_at on public.email_jobs;
create trigger trg_email_jobs_updated_at
  before update on public.email_jobs
  for each row execute function public.set_updated_at();

-- RLS — 사용자는 to_email 매핑이 어렵고, 운영상 admin 만 조회 가능.
-- INSERT/UPDATE/DELETE 는 service_role 만 (RLS 우회).
alter table public.email_jobs enable row level security;

drop policy if exists "admin select email jobs" on public.email_jobs;
create policy "admin select email jobs"
  on public.email_jobs for select
  to authenticated
  using (public.is_admin());
