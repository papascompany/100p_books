-- =====================================================================
-- 0014_photos_soft_delete.sql — 사진 소프트 삭제(휴지통) 지원
--
-- - photos.deleted_at timestamptz 컬럼 추가 (NULL = active, NOT NULL = trash)
-- - 활성 사진 조회용 부분 인덱스(deleted_at IS NULL)
-- - 휴지통 조회용 부분 인덱스(deleted_at IS NOT NULL)
--
-- 호환성:
--   - 기존 행은 자동으로 deleted_at = NULL → active 로 유지.
--   - RLS 정책은 deleted_at 을 별도로 검사하지 않는다 (라우트에서 필터).
-- =====================================================================

alter table public.photos
  add column if not exists deleted_at timestamptz;

create index if not exists idx_photos_active
  on public.photos (project_id, order_idx)
  where deleted_at is null;

create index if not exists idx_photos_deleted
  on public.photos (project_id, deleted_at desc)
  where deleted_at is not null;
