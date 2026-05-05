-- =====================================================================
-- 0009_resources_storage.sql — 폰트/클립아트/배경 리소스 Storage 버킷
--
-- 버킷:
--   resources (private) — 경로 규약: {type}/{resourceId}.{ext}
--                         예) fonts/<uuid>.ttf, cliparts/<uuid>.svg, backgrounds/<uuid>.jpg
--
-- 정책:
--   SELECT  — 인증된 모든 사용자 (active 필터링은 API 레이어 `/api/resources`)
--   INSERT/UPDATE/DELETE — service_role 만 (관리자 라우트에서 admin client 로 업로드)
--
-- 참고:
--   /api/resources GET 은 admin client 로 createSignedUrls() 를 사용하므로
--   bucket SELECT 정책이 비어 있어도 동작하지만, 향후 사용자측 직접 다운로드/캐시 등
--   확장을 고려해 인증 사용자에게 SELECT 를 허용해 둔다.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do nothing;

-- 인증 사용자 SELECT 허용 (active 필터는 API 레이어에서)
drop policy if exists "resources_user_select" on storage.objects;
create policy "resources_user_select" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'resources');

-- INSERT/UPDATE/DELETE 정책은 일반 유저에게 부여하지 않음 (service_role 만).

-- service_role 전권 (의도 명시)
drop policy if exists "resources_service_all" on storage.objects;
create policy "resources_service_all" on storage.objects
  for all
  to service_role
  using (bucket_id = 'resources')
  with check (bucket_id = 'resources');
