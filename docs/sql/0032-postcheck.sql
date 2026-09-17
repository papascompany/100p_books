-- =====================================================================
-- 0032-postcheck.sql — 0032 적용 "후" 기대값 검증 (읽기 전용)
--
-- 사용법: Supabase SQL Editor(100p_books/PRODUCTION)에서 섹션별 실행.
--   각 쿼리에 "기대" 를 주석으로 적었다. 어긋나면 적용 실패 또는 회귀다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- [1] 대상 테이블에 anon/authenticated 쓰기성 권한이 남아 있지 않아야 한다.
--     기대: 0 rows.
--     (photos 는 DELETE 를 의도적으로 남긴다 — projects/[id] DELETE 가 사용자 세션으로 씀.)
-- ---------------------------------------------------------------------
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated')
   and (
         (table_name in ('profiles', 'gifts', 'attendances', 'review_likes')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
      or (table_name = 'photos'
          and privilege_type in ('INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
       )
 order by table_name, grantee, privilege_type;

-- has_table_privilege 로 재확인(4개 테이블). 기대: 결과의 모든 권한 컬럼이 false.
select
  t.tab as table_name,
  has_table_privilege('authenticated', 'public.' || t.tab, 'INSERT') as auth_insert,
  has_table_privilege('authenticated', 'public.' || t.tab, 'UPDATE') as auth_update,
  has_table_privilege('authenticated', 'public.' || t.tab, 'DELETE') as auth_delete,
  has_table_privilege('anon',          'public.' || t.tab, 'INSERT') as anon_insert,
  has_table_privilege('anon',          'public.' || t.tab, 'UPDATE') as anon_update,
  has_table_privilege('anon',          'public.' || t.tab, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', 'public.' || t.tab, 'TRUNCATE') as auth_truncate,
  has_table_privilege('authenticated', 'public.' || t.tab, 'TRIGGER')  as auth_trigger
from (values ('profiles'), ('gifts'), ('attendances'), ('review_likes')) as t(tab);

-- 컬럼 수준 grant 잔존까지 확인(테이블 권한만 보면 컬럼 grant 를 놓친다).
-- 기대: photos 행 포함 모두 false.
select
  t.tab as table_name,
  has_any_column_privilege('authenticated', 'public.' || t.tab, 'INSERT') as auth_col_insert,
  has_any_column_privilege('authenticated', 'public.' || t.tab, 'UPDATE') as auth_col_update,
  has_any_column_privilege('anon',          'public.' || t.tab, 'INSERT') as anon_col_insert,
  has_any_column_privilege('anon',          'public.' || t.tab, 'UPDATE') as anon_col_update
from (values ('profiles'), ('gifts'), ('attendances'), ('review_likes'), ('photos')) as t(tab);

-- photos: INSERT/UPDATE 는 false, DELETE 는 true(앱 사용자 세션 경로) 여야 한다.
-- 기대: auth_insert=false, auth_update=false, auth_delete=true.
select
  has_table_privilege('authenticated', 'public.photos', 'INSERT') as auth_insert,
  has_table_privilege('authenticated', 'public.photos', 'UPDATE') as auth_update,
  has_table_privilege('authenticated', 'public.photos', 'DELETE') as auth_delete;

-- SELECT 권한은 유지되어야 한다(조회 경로 보존). 기대: 모두 true.
select
  t.tab as table_name,
  has_table_privilege('authenticated', 'public.' || t.tab, 'SELECT') as auth_select
from (values ('profiles'), ('gifts'), ('attendances'), ('review_likes'), ('photos'), ('reviews')) as t(tab);

-- reviews: 테이블 수준 INSERT/UPDATE 는 없고(컬럼 grant 로만 허용), DELETE 는 authenticated 만.
-- 기대: auth_insert=false, auth_update=false, auth_delete=true, auth_truncate=false,
--       auth_references=false, auth_trigger=false, anon_* 모두 false.
select
  has_table_privilege('authenticated', 'public.reviews', 'INSERT')     as auth_insert,
  has_table_privilege('authenticated', 'public.reviews', 'UPDATE')     as auth_update,
  has_table_privilege('authenticated', 'public.reviews', 'DELETE')     as auth_delete,
  has_table_privilege('authenticated', 'public.reviews', 'TRUNCATE')   as auth_truncate,
  has_table_privilege('authenticated', 'public.reviews', 'REFERENCES') as auth_references,
  has_table_privilege('authenticated', 'public.reviews', 'TRIGGER')    as auth_trigger,
  has_table_privilege('anon', 'public.reviews', 'INSERT')              as anon_insert,
  has_table_privilege('anon', 'public.reviews', 'UPDATE')              as anon_update,
  has_table_privilege('anon', 'public.reviews', 'DELETE')              as anon_delete,
  has_any_column_privilege('anon', 'public.reviews', 'INSERT')         as anon_col_insert,
  has_any_column_privilege('anon', 'public.reviews', 'UPDATE')         as anon_col_update;

-- reviews: 컬럼별 authenticated INSERT/UPDATE.
-- 기대: auth_insert=true 는 order_id, user_id, rating, body, image_keys, public 6개뿐.
--       auth_update=true 는 rating, body, image_keys, public 4개뿐.
--       id / likes_count / created_at / updated_at 은 둘 다 false,
--       order_id / user_id 는 auth_update=false.
select a.attname as column_name,
       has_column_privilege('authenticated', 'public.reviews', a.attname, 'INSERT') as auth_insert,
       has_column_privilege('authenticated', 'public.reviews', a.attname, 'UPDATE') as auth_update
  from pg_attribute a
 where a.attrelid = 'public.reviews'::regclass
   and a.attnum > 0
   and not a.attisdropped
 order by a.attnum;

-- ---------------------------------------------------------------------
-- [2] 쓰기 정책은 제거/대체되고, SELECT 정책은 유지되어야 한다.
--     기대에 포함(있어야): profiles_select_self, gifts_sender_select,
--        attendances_select_own, attendances_admin_select, review_likes_read_own,
--        photos_select_own, photos_delete_own.
--     기대에서 사라짐(없어야): profiles_update_self, gifts_sender_all,
--        gifts_recipient_select, attendances_insert_own, review_likes_own_all,
--        photos_insert_own, photos_update_own, reviews_own_all.
--     reviews 는 아래 별도 쿼리로 정책 구성과 조건 텍스트를 확인한다.
-- ---------------------------------------------------------------------
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('profiles', 'gifts', 'attendances', 'review_likes', 'photos')
 order by tablename, policyname;

-- 사라져야 하는 정책만 콕 집어 확인. 기대: 0 rows.
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and policyname in (
     'profiles_update_self',
     'gifts_sender_all',
     'gifts_recipient_select',
     'attendances_insert_own',
     'review_likes_own_all',
     'photos_insert_own',
     'photos_update_own',
     'reviews_own_all'
   );

-- reviews 정책 구성. 기대: 정확히 5 rows —
--   reviews_public_read(SELECT, {anon,authenticated}), reviews_select_own(SELECT),
--   reviews_insert_own(INSERT), reviews_update_own(UPDATE), reviews_delete_own(DELETE).
--   cmd='ALL' 행이 있으면 실패(컬럼·키 조건 없는 포괄 정책 잔존).
-- 조건 텍스트 기대:
--   reviews_insert_own.with_check 에 orders / 'shipped' / 'delivered' / split_part / cardinality 포함.
--   reviews_update_own.with_check 에 split_part / cardinality 포함, qual 에 auth.uid().
select policyname, cmd, roles,
       qual,
       with_check,
       coalesce(with_check, '') ilike '%orders%'      as chk_order_owner,
       coalesce(with_check, '') ilike '%delivered%'   as chk_order_status,
       coalesce(with_check, '') ilike '%split_part%'  as chk_image_keys,
       coalesce(with_check, '') ilike '%cardinality%' as chk_image_count
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'reviews'
 order by cmd, policyname;

-- ---------------------------------------------------------------------
-- [3] profiles 민감 컬럼 가드 트리거가 존재해야 한다.
--     기대: 1 row, tgenabled='O', security_definer = false.
--     security_definer 가 true 면 **결함**이다 — 함수 안 current_user 가 소유자(postgres)로
--     바뀌어 anon/authenticated 검사가 절대 발동하지 않는다. 0032 를 다시 적용할 것.
-- ---------------------------------------------------------------------
select t.tgname,
       t.tgenabled,          -- 'O' = origin/local 에서 활성
       p.proname as function_name,
       p.prosecdef as security_definer
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.profiles'::regclass
   and t.tgname = 'trg_profiles_guard_sensitive';

-- 트리거 함수가 검사하는 컬럼이 모두 들어 있는지(텍스트 확인). 기대: 5개 컬럼 모두 t.
select
  pg_get_functiondef(p.oid) ilike '%new.role%'            as has_role,
  pg_get_functiondef(p.oid) ilike '%new.deleted_at%'      as has_deleted_at,
  pg_get_functiondef(p.oid) ilike '%new.deletion_reason%' as has_deletion_reason,
  pg_get_functiondef(p.oid) ilike '%new.email%'           as has_email,
  pg_get_functiondef(p.oid) ilike '%new.referral_code%'   as has_referral_code
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'guard_profiles_sensitive_columns';

-- [3-선택] 트리거 동작 프로브 — rollback 전용. 운영 객체를 만들거나 바꾸지 않는다.
--   임시 테이블(세션 한정, rollback 시 소멸)에 같은 가드 함수를 걸고 역할을 바꿔 UPDATE 한다.
--   실제 profiles 행을 복사하지 않는다(합성 행 1개). SET ROLE 권한이 없는 환경이면 생략.
--   가능하면 운영보다 브랜치/스테이징에서 먼저 실행한다. 한 번에 통째로 실행한다.
--
--   begin;
--   create temp table _guard_probe (
--     id uuid primary key default gen_random_uuid(),
--     role text, deleted_at timestamptz, deletion_reason text,
--     email text, referral_code text, display_name text
--   ) on commit drop;
--   insert into _guard_probe (role, email, display_name)
--     values ('user', 'probe@example.invalid', 'probe');
--   create trigger _guard_probe_trg before update on _guard_probe
--     for each row execute function public.guard_profiles_sensitive_columns();
--   grant select, update on _guard_probe to authenticated, service_role;
--
--   set local role authenticated;
--   update _guard_probe set display_name = 'probe2' where true;   -- 기대: UPDATE 1 (비민감 컬럼 통과)
--   savepoint s1;
--   update _guard_probe set role = 'admin' where true;            -- 기대: ERROR 42501 (차단)
--   rollback to savepoint s1;
--   savepoint s2;
--   update _guard_probe set deleted_at = now() where true;        -- 기대: ERROR 42501 (차단)
--   rollback to savepoint s2;
--
--   reset role;
--   set local role service_role;
--   update _guard_probe set role = 'admin' where true;            -- 기대: UPDATE 1 (service_role 통과)
--   reset role;
--   rollback;

-- ---------------------------------------------------------------------
-- [4] 0031 에서 지킨 것들이 회귀하지 않았는지 재확인.
--     기대: is_admin / lookup_referral_code 의 EXECUTE 가 유지(각각 true).
-- ---------------------------------------------------------------------
select
  has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')             as auth_is_admin,
  has_function_privilege('anon',          'public.is_admin()', 'EXECUTE')             as anon_is_admin,
  has_function_privilege('authenticated', 'public.lookup_referral_code(text)', 'EXECUTE') as auth_lookup,
  has_function_privilege('anon',          'public.lookup_referral_code(text)', 'EXECUTE') as anon_lookup;

-- ---------------------------------------------------------------------
-- [5] 손대지 않기로 한 테이블의 쓰기 정책은 그대로 남아 있어야 한다(앱 경로 보존).
--     기대에 포함: projects_insert_own/projects_update_own/projects_delete_own,
--        pages_*_own(insert/update/delete), photos_delete_own, share_tokens_owner_all,
--        reviews_insert_own/reviews_update_own/reviews_delete_own.
--        (이 목록이 사라졌다면 과잉 적용 — 후기 작성/수정/삭제가 깨진다.)
--     photos 는 photos_delete_own 만 남고 insert/update 정책은 없어야 한다.
--     reviews 에 cmd='ALL' 정책(reviews_own_all)이 남아 있으면 실패.
-- ---------------------------------------------------------------------
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('projects', 'pages', 'photos', 'share_tokens', 'reviews')
   and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
 order by tablename, policyname;

-- 전체 쓰기 표면 재확인: docs/sql/0032-precheck.sql 의 [1-c] 를 다시 실행한다.
-- 기대: profiles / gifts / attendances / review_likes 행이 없다. photos 는 DELETE 만,
--   reviews 는 authenticated 의 INSERT(any_column_priv)·UPDATE(any_column_priv)·DELETE 만 남는다.
--   projects / pages / share_tokens 는 적용 전과 같다. 그 밖에 새로 보이는 테이블은 없어야 한다.

-- [5-선택] reviews 컬럼 권한 프로브 — rollback 전용, **행을 바꾸지 않는다**(where false).
--   컬럼 권한 검사는 실행 계획 단계에서 일어나므로 대상 행이 0건이어도 거부가 드러난다.
--   RLS WITH CHECK(주문 소유·이미지 키)는 실제 행이 필요하므로 여기서는 검사하지 않는다
--   → 스테이징에서 테스트 계정으로 PostgREST 직접 호출해 확인한다([6] 참고).
--   한 번에 통째로 실행한다.
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
--   update public.reviews set rating = rating where false;               -- 기대: UPDATE 0 (허용 컬럼)
--   savepoint s1;
--   update public.reviews set likes_count = likes_count where false;     -- 기대: ERROR 42501 permission denied
--   rollback to savepoint s1;
--   savepoint s2;
--   update public.reviews set user_id = user_id where false;             -- 기대: ERROR 42501
--   rollback to savepoint s2;
--   savepoint s3;
--   insert into public.reviews (order_id, user_id, rating, likes_count)
--     select null, null, 1, 999 where false;                            -- 기대: ERROR 42501
--   rollback to savepoint s3;
--   savepoint s4;
--   insert into public.reviews (order_id, user_id, rating, created_at)
--     select null, null, 1, now() where false;                          -- 기대: ERROR 42501
--   rollback to savepoint s4;
--   insert into public.reviews (order_id, user_id, rating, body, image_keys, public)
--     select null, null, 1, null, '{}', true where false;               -- 기대: INSERT 0 0 (허용 컬럼)
--   delete from public.reviews where false;                             -- 기대: DELETE 0
--   reset role;
--   set local role anon;
--   savepoint s5;
--   delete from public.reviews where false;                             -- 기대: ERROR 42501
--   rollback to savepoint s5;
--   reset role;
--   rollback;

-- ---------------------------------------------------------------------
-- [6] (선택) 실사용 경로 기준 런타임 프로브 — anon 키로 직접 쓰기가 거부되는지.
--     대시보드가 아니라 셸에서 실행. <ref>/<anon> 은 프로젝트 값.
--     기대: 42501(permission denied) 또는 401/403. 200/201 이면 실패.
--
--   # 예시(형식만): 존재하지 않는 자기 profiles UPDATE 시도
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X PATCH "https://<ref>.supabase.co/rest/v1/profiles?id=eq.00000000-0000-0000-0000-000000000000" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
--     -H "Content-Type: application/json" -H "Prefer: return=minimal" \
--     -d '{"role":"admin"}'
--   # 기대: 401/403/42501 계열. 200/204 면 표면이 아직 열려 있는 것.
--
--   # reviews(스테이징 권장): 테스트 계정 JWT(<user_jwt>)로 본인 후기 <review_id> 에
--   #   (1) likes_count 조작       → 기대 401/403(42501). 200/204 면 실패.
--   #   (2) 타인 폴더 이미지 키    → 기대 403(42501, RLS WITH CHECK 위반). 200/204 면 실패.
--   #   (3) 허용 컬럼(rating) 수정 → 기대 200/204(앱 경로 보존). 403 이면 과잉 차단.
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X PATCH "https://<ref>.supabase.co/rest/v1/reviews?id=eq.<review_id>" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <user_jwt>" \
--     -H "Content-Type: application/json" -H "Prefer: return=minimal" \
--     -d '{"likes_count":9999}'
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X PATCH "https://<ref>.supabase.co/rest/v1/reviews?id=eq.<review_id>" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <user_jwt>" \
--     -H "Content-Type: application/json" -H "Prefer: return=minimal" \
--     -d '{"image_keys":["00000000-0000-0000-0000-000000000000/x/y.jpg"]}'
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X PATCH "https://<ref>.supabase.co/rest/v1/reviews?id=eq.<review_id>" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <user_jwt>" \
--     -H "Content-Type: application/json" -H "Prefer: return=minimal" \
--     -d '{"rating":5}'
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- [7] storage.objects — reviews 버킷 사용자 세션 정책 제거 확인.
--     기대: reviews_storage_service_all 1 row 만(roles={service_role}).
--     reviews_storage_owner_all / reviews_storage_public_read 가 보이면 실패.
--     후기 이미지 업로드(POST /api/reviews/upload)·삭제·갤러리 서명은 service_role 이라
--     이 정책 제거로 깨지지 않는다 — 적용 후 후기 작성(사진 포함)·삭제를 1회 스모크한다.
-- ---------------------------------------------------------------------
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and policyname like 'reviews_storage%'
 order by policyname;

-- ---------------------------------------------------------------------
-- [8] storage.objects — photo-originals/photo-thumbs 사용자 세션 쓰기 정책 제거 확인.
--     사진 업로드는 서명 업로드 URL(service_role 발급 → storage-api 가 토큰 검증 후 RLS 없이
--     기록)이고, 검증·재업로드·복사·삭제·서명 URL 발급은 전부 service_role 이라 이 제거로
--     깨지지 않는다.
-- ---------------------------------------------------------------------
-- photo 버킷 정책 구성. 기대: 정확히 3 rows —
--   photo_buckets_service_all   (ALL,    {service_role})
--   photo_originals_user_select (SELECT, {authenticated})
--   photo_thumbs_user_select    (SELECT, {authenticated})
-- photo_originals_user_insert / _update / _delete, photo_thumbs_user_delete 가 보이면 실패.
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and policyname like 'photo\_%' escape '\'
 order by policyname;

-- storage.objects 전체의 비-SELECT 정책 중 service_role 전용이 아닌 것.
-- 기대: 정확히 3 rows — site_assets_admin_delete / site_assets_admin_update / site_assets_admin_write
--   (roles={authenticated}, qual/with_check 에 is_admin() 포함 → 관리자만 통과).
-- 그 밖의 행이 보이면 사용자 세션 storage 쓰기 표면이 남아 있는 것이다
-- (0032 범위 밖 새 정책이면 앱이 사용자 세션으로 그 버킷을 쓰는지 대조).
select policyname, cmd, roles, qual, with_check,
       (coalesce(qual, '') || coalesce(with_check, '')) ilike '%is_admin%' as admin_gated
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and cmd <> 'SELECT'
   and roles <> array['service_role']::name[]
 order by policyname;

-- [8-스모크] 적용 직후 앱 경로 1회 확인(운영 계정 또는 스테이징):
--   (1) 사진 업로드 — 업로드 화면에서 JPEG 1장 → 완료 표시(sign-upload 200 → 서명 URL PUT 200 →
--       complete 200, inserted 1). PUT 이 403 이면 서명 업로드가 사용자 정책에 의존한 것 → 즉시 보고.
--   (2) 휴지통 이동 → 영구 삭제(purge) — 성공한다(둘 다 service_role 경로).
--   (3) docs/sql/0032-precheck.sql [11] (b)~(d) 를 다시 실행 — 적용 전 결과 외에 새 행이 없어야 한다.
--
-- [8-선택] 런타임 프로브 — 사용자 JWT 로 직접 storage 쓰기가 거부되는지(스테이징 권장, 셸에서 실행).
--   <ref>/<anon>/<user_jwt>/<user_id> 는 프로젝트·테스트 계정 값. 경로는 실제 사진과 겹치지 않는 probe 폴더.
--   기대: 4xx(본문 statusCode 403 / "new row violates row-level security policy" 또는 not found).
--   200 이면 표면이 열려 있는 것이다 → 생성된 probe 객체를 대시보드(Storage)에서 지우고 0032 (H) 재확인.
--
--   # (1) 직접 업로드(INSERT)
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X POST "https://<ref>.supabase.co/storage/v1/object/photo-originals/<user_id>/probe-0032/probe.jpg" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <user_jwt>" \
--     -H "Content-Type: image/jpeg" --data-binary 'probe'
--   # (2) upsert 덮어쓰기(UPDATE) — 같은 경로에 x-upsert
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X POST "https://<ref>.supabase.co/storage/v1/object/photo-originals/<user_id>/probe-0032/probe.jpg" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <user_jwt>" \
--     -H "Content-Type: image/jpeg" -H "x-upsert: true" --data-binary 'probe'
--   # DELETE 는 프로브하지 않는다 — 없는 경로 삭제는 적용 전후 모두 빈 결과라 구분되지 않고,
--   #   실제 사진 키로 시험하면 데이터가 지워진다. 위 정책 조회(3 rows)로 판정한다.

