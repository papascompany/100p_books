-- =====================================================================
-- 0004_storage.sql — Supabase Storage 버킷 + RLS
-- 버킷:
--   photo-originals  (private) — orientation 정규화된 원본
--   photo-thumbs     (private) — 480px webp 썸네일
-- 경로 규약: {userId}/{projectId}/{photoId}.{ext}
--   1번째 세그먼트가 auth.uid() 인지로 소유권을 검증한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 버킷 생성 (private)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('photo-originals', 'photo-originals', false),
  ('photo-thumbs',    'photo-thumbs',    false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Storage RLS
-- storage.objects 는 이미 Supabase 기본에서 RLS enabled.
-- 정책 이름은 멱등성을 위해 drop-if-exists 선행.
-- name 컬럼의 첫 path segment 를 auth.uid() 와 비교.
-- ---------------------------------------------------------------------

-- 사용자는 자신의 photo-originals/{userId}/... 경로만 INSERT
drop policy if exists "photo_originals_user_insert" on storage.objects;
create policy "photo_originals_user_insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 사용자는 자신의 photo-originals/{userId}/... 경로만 SELECT
drop policy if exists "photo_originals_user_select" on storage.objects;
create policy "photo_originals_user_select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 사용자는 자신의 photo-originals/{userId}/... 경로만 UPDATE (orientation 정규화 재업로드)
drop policy if exists "photo_originals_user_update" on storage.objects;
create policy "photo_originals_user_update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 사용자는 자신의 photo-originals/{userId}/... 경로만 DELETE
drop policy if exists "photo_originals_user_delete" on storage.objects;
create policy "photo_originals_user_delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- photo-thumbs: 동일 규칙 (썸네일은 서버가 service_role 로 업로드하므로 user INSERT 는 방지)
drop policy if exists "photo_thumbs_user_select" on storage.objects;
create policy "photo_thumbs_user_select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'photo-thumbs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photo_thumbs_user_delete" on storage.objects;
create policy "photo_thumbs_user_delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'photo-thumbs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- service_role 전권 허용 (RLS 우회되지만 명시적 정책 추가로 의도 선언)
drop policy if exists "photo_buckets_service_all" on storage.objects;
create policy "photo_buckets_service_all" on storage.objects
  for all
  to service_role
  using (bucket_id in ('photo-originals', 'photo-thumbs'))
  with check (bucket_id in ('photo-originals', 'photo-thumbs'));
