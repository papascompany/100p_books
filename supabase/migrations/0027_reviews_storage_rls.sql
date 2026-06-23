-- =====================================================================
-- 0027_reviews_storage_rls.sql — reviews 버킷 storage RLS 교정 (보안)
--
-- 배경 (0020_reviews.sql:198-206):
--   `reviews_storage_public_read` 정책이 bucket_id='reviews' 인 *모든* 객체를
--   anon/authenticated 에게 SELECT 허용했다. storage 레이어에서는 객체 단위로
--   reviews.public 플래그를 판별할 수 없으므로, 비공개(public=false) 후기 첨부도
--   경로(reviews/{userId}/{reviewId}/{uuid}.{ext})만 추측/유출되면 signedUrl 생성·
--   직접 다운로드가 가능했다. 즉 reviews.public 이 storage 에서 강제되지 않았다.
--
-- 교정:
--   후기 갤러리는 라우트가 *항상* service_role(createSignedUrls)로만 첨부를 노출하므로
--   anon/authenticated 전역 SELECT 정책은 불필요하다. 이를 제거하여 다음만 남긴다.
--     - reviews_storage_owner_all  : 본인 경로(폴더 첫 segment = auth.uid()) R/W
--     - reviews_storage_service_all: service_role 전권 (갤러리 signedUrl 생성 경로)
--   결과적으로 비공개 후기 첨부는 소유자/service_role 외에는 직접 접근 불가.
-- =====================================================================

drop policy if exists "reviews_storage_public_read" on storage.objects;
