-- =====================================================================
-- 0007_pdf_storage.sql — PDF 산출물 저장 버킷 + RLS
-- 버킷:
--   pdfs (private) — 표지/내지 PDF. 경로: {userId}/{projectId}/{cover|interior}.pdf
--   1번째 path segment 가 auth.uid() 인 객체만 사용자가 SELECT 가능.
--   업로드/UPDATE/DELETE 는 service_role 만 (서버 빌드 잡 전용).
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', false)
on conflict (id) do nothing;

-- 사용자는 자신의 pdfs/{userId}/... 만 SELECT
drop policy if exists "pdfs_user_select" on storage.objects;
create policy "pdfs_user_select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 일반 사용자에게 INSERT/UPDATE/DELETE 정책은 의도적으로 부여하지 않음.
-- 빌드 잡(service_role)에서만 PDF 를 작성한다.

-- service_role 전권 (정책 명시로 의도 선언)
drop policy if exists "pdfs_service_all" on storage.objects;
create policy "pdfs_service_all" on storage.objects
  for all
  to service_role
  using (bucket_id = 'pdfs')
  with check (bucket_id = 'pdfs');
