-- =====================================================================
-- 0029_funnel_events.sql — 온보딩 퍼널 계측 (S1-2)
--
-- 정책:
--   • 서버 라우트가 service_role 로만 INSERT (lib/analytics/funnel.ts 헬퍼).
--   • 일반 사용자 접근 불가, admin 만 SELECT (집계는 관리자 콘솔/SQL).
--   • signup_completed 는 (user_id, event) 부분 유니크로 사용자당 1회만 기록.
--
-- 이벤트 4종:
--   signup_completed  이메일 인증/OAuth 세션 교환 성공 (가입 완료)
--   project_created   draft 프로젝트 생성 (props.first = 사용자의 첫 프로젝트 여부)
--   book_completed    표지 저장 성공 (책 완성 시점)
--   order_paid        토스 confirm 클레임 승자 (props.orderId, props.amount)
-- =====================================================================

create table if not exists public.funnel_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  event      text not null,
  project_id uuid,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_funnel_events_event_time
  on public.funnel_events (event, created_at desc);

create index if not exists idx_funnel_events_user
  on public.funnel_events (user_id, created_at desc);

-- 가입 완료는 사용자당 1회 — 반복 로그인 중복 기록 차단
create unique index if not exists uq_funnel_signup_once
  on public.funnel_events (user_id, event)
  where event = 'signup_completed';

alter table public.funnel_events enable row level security;

-- admin 만 SELECT. INSERT/UPDATE/DELETE 정책 없음 → service_role 외에는 불가.
create policy "funnel_events_admin_select"
  on public.funnel_events for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
