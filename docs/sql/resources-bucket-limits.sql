-- =====================================================================
-- resources-bucket-limits.sql — `resources` 버킷 업로드 제한 (수동 적용용)
--
-- 번호 있는 마이그레이션이 아니다. 운영자가 Supabase SQL Editor 에서 직접 실행한다.
--   (상단 프로젝트가 100p_books/PRODUCTION 인지 확인)
-- 값의 근거: lib/admin/resources.ts RESOURCE_CONSTRAINTS (배경 10MB, 폰트 5MB, 클립아트 2MB).
-- 버킷 한도는 type 별 한도의 상한(10MB)이며, type 별 세부 한도는 앱이 검증한다.
-- 폰트 MIME 은 브라우저가 octet-stream 으로 보내는 경우가 있어 포함한다.
-- =====================================================================

-- 1) 적용 전 현재값 확인
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'resources';

-- 2) 적용
update storage.buckets
   set file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = array[
         'font/ttf', 'font/otf', 'font/woff2',
         'application/font-sfnt',
         'application/x-font-ttf',
         'application/x-font-opentype',
         'application/octet-stream',
         'image/svg+xml', 'image/png', 'image/jpeg'
       ]
 where id = 'resources';

-- 3) 롤백 (제한 해제)
-- update storage.buckets
--    set file_size_limit = null, allowed_mime_types = null
--  where id = 'resources';
