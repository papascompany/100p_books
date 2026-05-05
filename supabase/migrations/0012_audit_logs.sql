-- =====================================================================
-- 0012_audit_logs.sql — 관리자 감사 로그
--
-- 정책:
--   • admin 핵심 액션 (주문 상태 전이, 리소스 CRUD, 사용자 권한 변경, PDF 재빌드 등)
--     수행 시 audit_logs 에 row INSERT.
--   • 사용자(actor)는 본인 액션을 보지 못함 — admin 만 SELECT.
--   • INSERT 는 service_role 만. (logAdminAction 헬퍼가 admin client 로 INSERT)
--   • 로그 보존: 무기한 (장기적으로 GDPR 등 정책에 따라 cron 으로 정리).
--
-- 컬럼:
--   id           uuid pk
--   actor_id     profiles.id (탈퇴 시 set null — actor_email 은 보존)
--   actor_email  스냅샷 (탈퇴/이메일 변경 후에도 추적 가능)
--   action       'order.transition', 'resource.delete', 'user.role_change', 'pdf.rebuild' 등
--   target_type  'order' | 'resource' | 'user' | 'project' | 'book_size' 등
--   target_id    uuid (대상 행 id, 가능하면)
--   details      jsonb — action 별 컨텍스트 (from/to, changedFields 등)
--   ip_address   request 헤더에서 추출
--   user_agent   request 헤더에서 추출
--   created_at   timestamptz
-- =====================================================================

create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_email  text,
  action       text not null,
  target_type  text not null,
  target_id    uuid,
  details      jsonb default '{}'::jsonb,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz default now() not null
);

create index if not exists idx_audit_actor
  on public.audit_logs (actor_id, created_at desc);

create index if not exists idx_audit_target
  on public.audit_logs (target_type, target_id, created_at desc);

create index if not exists idx_audit_action
  on public.audit_logs (action, created_at desc);

create index if not exists idx_audit_created_at
  on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

-- 정책: admin 만 SELECT
drop policy if exists "admin select audit logs" on public.audit_logs;
create policy "admin select audit logs"
  on public.audit_logs
  for select
  to authenticated
  using (public.is_admin());

-- INSERT 는 service_role 만 (정책 미설정 → RLS 차단). admin client 가 service_role 키 사용.
