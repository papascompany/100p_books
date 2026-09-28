-- =====================================================================
-- 0032-postcheck-summary.sql — 0032-postcheck.sql 의 점검을 **PASS/FAIL 세로표**로 (읽기 전용)
--
-- 왜: SQL Editor 는 여러 문장을 한 번에 Run 하면 **마지막 결과만** 보여 준다. postcheck 는 쿼리가
--      17개(+ 0032-precheck.sql [1-c] 재실행)라 하나씩 돌려야 했다. 이 파일은 각 쿼리를 **원문 그대로**
--      서브쿼리로 감싸고(끝의 ; 만 제거) 바깥에서 actual 텍스트로 정규화해 expected 와 비교한다.
-- 사용법: 0032 적용 후 전체 붙여넣고 선택 없이 Run → 27행(no · check_name · actual · expected · pass · note).
--         **모든 행 pass = true** 면 통과. false 인 행만 0032-postcheck.sql 의 해당 섹션(note 의 [n])을
--         따로 실행해 목록을 본다(c5_surface_* 는 0032-precheck.sql [1-c]).
--         actual 센티널: '(정책 없음)' / '(트리거 없음)' / '(함수 없음)' = 대상 객체 자체가 없음 → 항상 FAIL.
--         '(없음)' 은 10·12·13·16·18행에선 "빠진 것 없음"(정상), 22·23행에선 "표면 행 없음"(FAIL)이다.
-- 유지보수: 0032-postcheck.sql / 0032-precheck.sql [1-c] 의 쿼리를 고치면 이 파일의 같은 쿼리도 함께
--           고칠 것(같은 원문이 여러 번 들어 있다 — [1] 82행 2회, [2] 129행 3회, [5] 219행 2회,
--           [1-c] 5회). 15행(c3_trigger_shape)만 원문 없는 보강 행이다(postcheck [3] 에 해당 쿼리 없음).
--           expected 는 맨 아래 values 목록에 모여 있다. 목록 정렬은 collate "C".
-- 검증: PGlite(PostgreSQL 18.3)에서 supabase/migrations 0001~0033 을 **실제 적용**(Supabase 역할·기본
--       권한·auth/storage 스텁만 추가)해 확인(2026-09-28). 0032 적용 전(0001~0031+0033)은 23행 FAIL(적용
--       전에도 PASS 인 회귀 가드 4행: c1_select_kept·c4_0031·c5_surface_app_kept·c5_surface_out_of_scope),
--       운영과 같은 순서(0033 → 0032)로 적용한 뒤에는 27행 모두 pass=true(0032 재적용 후에도 같음).
--       0032 적용 상태에서 한 가지씩 망가뜨린 음성 대조 42건(트리거 definer·비활성·삭제·함수 재지정·
--       BEFORE INSERT·AFTER·WHEN·UPDATE OF, 정책 삭제·약화·역할 변경, reviews WITH CHECK 작성자·주문 연결·
--       주문 소유·키 첫 세그먼트 제거와 한도 완화, grant 재부여·회수, storage 정책 복귀 등)이 모두 해당 행
--       FAIL 로 잡혔다. 정상 변형(search_path 기본값·'', profiles 관리자 SELECT 정책 추가, 권한 없는 컬럼
--       추가)은 전 행 PASS 였다.
-- 주의: 읽기 전용 SELECT 한 문장이다. 다음은 포함하지 않는다 — 필요하면 원문에서 따로 한다.
--       · [3-선택]·[5-선택] 프로브 — begin / set role / savepoint 가 필요한 다문장 rollback 쓰기.
--       · [6]·[8-선택] 런타임 프로브 — 셸 curl.
--       · [7] 후기 작성(사진 포함)·삭제 1회 스모크, [8-스모크](1)(2) 사진 업로드·휴지통→영구 삭제 — 앱 조작.
--       · [8-스모크](3) 은 SQL 이지만 적용 전 값과의 비교라 고정 expected 로 넣지 않았다 →
--         0032-precheck-summary.sql 을 다시 Run 해 28~33행(c11b_user_written ~ c11d_with_order)이 적용 전
--         값보다 늘지 않았는지(특히 기대 0 인 28·30·32·33행) 비교한다.
--       12·13행은 정책 조건 **텍스트**(pg_policies deparse)에 토큰이 있는지만 본다(대소문자 구분 부분
--       문자열). WITH CHECK 가 실제로 거부하는지는 [6](스테이징 런타임)에서만 확인된다 — [5-선택]은 컬럼
--       권한만 본다. 토큰은 PG 18.3 deparse 로 search_path 기본값("$user", public, extensions)과 '' 에서
--       확인했다. search_path 에 auth 가 들어 있으면 auth.uid() 가 uid() 로 출력돼 12·13행이 오경보를 낸다
--       (show search_path 로 확인). 운영 PG 버전의 deparse 가 달라 토큰이 빠졌다고 나오면 postcheck [2]
--       129행 쿼리의 with_check 원문과 대조한다.
--       원문 기대보다 엄격한 곳: 11행(나머지 4개 정책의 roles={authenticated} 도 비교), 12·13행(원문 토큰
--       5·3개에 작성자·주문 연결/소유·키 첫 세그먼트·한도 토큰 추가), 14행(function_name), 21행(authenticated
--       DELETE 만 — 0032 (E) 가 anon DELETE 도 회수), 27행(cmd·roles).
--       원문보다 좁은 곳: 23행은 authenticated 만 비교한다. 세 테이블 정책이 to public 이라 anon 행은 anon
--       grant 만으로 정해지고(앱 경로 아님) 적용 전 기준선이 기록돼 있지 않다. 0032 는 이 세 테이블을
--       건드리지 않으므로 23행 FAIL 은 0032 밖의 변경이다 — precheck [1-c] 원문 결과와 비교한다.
--       남는 한계: 원문 기대에 없는 정책 조건의 의미 약화(예: photos_delete_own 을 using (true) 로)와
--       reviews 의 anon TRUNCATE/REFERENCES/TRIGGER grant 는 이 표로 잡히지 않는다.
-- =====================================================================
with s as (
select
  -- [1] 4개 테이블 쓰기성 grant·photos INSERT/UPDATE 등 grant 잔존 행 수
  (select count(*)::text from (
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
       order by table_name, grantee, privilege_type
  ) q) as c1_grants,
  -- [1] profiles·gifts·attendances·review_likes 중 쓰기 권한 true 가 있는 테이블 수
  (select (count(*) filter (where auth_insert or auth_update or auth_delete or anon_insert or anon_update or anon_delete or auth_truncate or auth_trigger))::text from (
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
      from (values ('profiles'), ('gifts'), ('attendances'), ('review_likes')) as t(tab)
  ) q) as c1_table_priv,
  -- [1] 컬럼 수준 INSERT/UPDATE 권한이 남은 테이블 수(photos 포함)
  (select (count(*) filter (where auth_col_insert or auth_col_update or anon_col_insert or anon_col_update))::text from (
      select
        t.tab as table_name,
        has_any_column_privilege('authenticated', 'public.' || t.tab, 'INSERT') as auth_col_insert,
        has_any_column_privilege('authenticated', 'public.' || t.tab, 'UPDATE') as auth_col_update,
        has_any_column_privilege('anon',          'public.' || t.tab, 'INSERT') as anon_col_insert,
        has_any_column_privilege('anon',          'public.' || t.tab, 'UPDATE') as anon_col_update
      from (values ('profiles'), ('gifts'), ('attendances'), ('review_likes'), ('photos')) as t(tab)
  ) q) as c1_col_priv,
  -- [1] photos authenticated 권한 — DELETE 만 유지
  (select 'insert=' || auth_insert::text || ' update=' || auth_update::text || ' delete=' || auth_delete::text from (
      select
        has_table_privilege('authenticated', 'public.photos', 'INSERT') as auth_insert,
        has_table_privilege('authenticated', 'public.photos', 'UPDATE') as auth_update,
        has_table_privilege('authenticated', 'public.photos', 'DELETE') as auth_delete
  ) q) as c1_photos,
  -- [1] authenticated SELECT 가 빠진 테이블 수(조회 경로 보존)
  (select (count(*) filter (where auth_select is not true))::text from (
      select
        t.tab as table_name,
        has_table_privilege('authenticated', 'public.' || t.tab, 'SELECT') as auth_select
      from (values ('profiles'), ('gifts'), ('attendances'), ('review_likes'), ('photos'), ('reviews')) as t(tab)
  ) q) as c1_select_kept,
  -- [1] reviews 테이블 수준 권한 중 true 인 것 — authenticated DELETE 만
  (select coalesce(string_agg(e.key, ',' order by e.key collate "C"), '(없음)')
     from (
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
        has_any_column_privilege('anon', 'public.reviews', 'UPDATE')         as anon_col_update
  ) q
    cross join lateral jsonb_each(to_jsonb(q)) as e(key, value)
    where e.value = 'true'::jsonb) as c1_reviews_table,
  -- [1] reviews 컬럼 INSERT(authenticated) — 라우트가 보내는 6개만
  (select coalesce(string_agg(column_name::text, ',' order by column_name::text collate "C") filter (where auth_insert), '(없음)') from (
      select a.attname as column_name,
             has_column_privilege('authenticated', 'public.reviews', a.attname, 'INSERT') as auth_insert,
             has_column_privilege('authenticated', 'public.reviews', a.attname, 'UPDATE') as auth_update
        from pg_attribute a
       where a.attrelid = 'public.reviews'::regclass
         and a.attnum > 0
         and not a.attisdropped
       order by a.attnum
  ) q) as c1_reviews_col_insert,
  -- [1] reviews 컬럼 UPDATE(authenticated) — 4개만(order_id/user_id 불가)
  (select coalesce(string_agg(column_name::text, ',' order by column_name::text collate "C") filter (where auth_update), '(없음)') from (
      select a.attname as column_name,
             has_column_privilege('authenticated', 'public.reviews', a.attname, 'INSERT') as auth_insert,
             has_column_privilege('authenticated', 'public.reviews', a.attname, 'UPDATE') as auth_update
        from pg_attribute a
       where a.attrelid = 'public.reviews'::regclass
         and a.attnum > 0
         and not a.attisdropped
       order by a.attnum
  ) q) as c1_reviews_col_update,
  -- [2] 제거돼야 할 정책 8개 중 남은 수
  (select count(*)::text from (
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
         )
  ) q) as c2_removed,
  -- [2] 유지돼야 할 SELECT/DELETE 정책 7개 중 없는 것
  (select coalesce(string_agg(req.policyname, ',' order by req.ord), '(없음)')
     from (values (1, 'profiles_select_self'), (2, 'gifts_sender_select'), (3, 'attendances_select_own'), (4, 'attendances_admin_select'), (5, 'review_likes_read_own'), (6, 'photos_select_own'), (7, 'photos_delete_own')) as req(ord, policyname)
    where not exists (select 1 from (
      select tablename, policyname, cmd, roles
        from pg_policies
       where schemaname = 'public'
         and tablename in ('profiles', 'gifts', 'attendances', 'review_likes', 'photos')
       order by tablename, policyname
  ) q where q.policyname::text = req.policyname)) as c2_required_missing,
  -- [2] reviews 정책 구성(policyname:cmd:roles) — ALL 없이 정확히 5개, reviews_public_read 만 {anon,authenticated}
  (select coalesce(string_agg(q.policyname::text || ':' || q.cmd || ':' || q.roles::text, ',' order by q.policyname::text collate "C"), '(정책 없음)') from (
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
       order by cmd, policyname
  ) q) as c2_reviews_policies,
  -- [2] reviews_insert_own WITH CHECK 에 없는 토큰 — 작성자 (user_id = auth.uid())·주문 연결 o.id = reviews.order_id·주문 소유 o.user_id = auth.uid()·상태·이미지 키 첫 세그먼트·장수 3·본문 2000
  coalesce((
    select coalesce(
             (select string_agg(tok.t, ' | ' order by tok.ord)
                from (values (1, 'orders'),
                        (2, '''shipped'''),
                        (3, '''delivered'''),
                        (4, 'split_part'),
                        (5, 'cardinality'),
                        (6, '(user_id = auth.uid())'),
                        (7, 'o.id = reviews.order_id'),
                        (8, 'o.user_id = auth.uid()'),
                        (9, 'split_part(k.image_key, ''/''::text, 1) <> (auth.uid())::text'),
                        (10, 'cardinality(image_keys) <= 3)'),
                        (11, 'char_length(body) <= 2000)')) as tok(ord, t)
               where strpos(coalesce(q.with_check, ''), tok.t) = 0),
             '(없음)')
      from (
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
       order by cmd, policyname
  ) q
     where q.policyname = 'reviews_insert_own'), '(정책 없음)') as c2_reviews_insert_check,
  -- [2] reviews_update_own 에 없는 토큰 — with_check 작성자·이미지 키 첫 세그먼트·장수 3·본문 2000, qual 본인 (user_id = auth.uid())
  coalesce((
    select coalesce(
             (select string_agg(tok.col || ':' || tok.t, ' | ' order by tok.ord)
                from (values (1, 'with_check', 'split_part'),
                        (2, 'with_check', 'cardinality'),
                        (3, 'with_check', '(user_id = auth.uid())'),
                        (4, 'with_check', 'split_part(k.image_key, ''/''::text, 1) <> (auth.uid())::text'),
                        (5, 'with_check', 'cardinality(image_keys) <= 3)'),
                        (6, 'with_check', 'char_length(body) <= 2000)'),
                        (7, 'qual', '(user_id = auth.uid())')) as tok(ord, col, t)
               where strpos(coalesce(case tok.col when 'qual' then q.qual else q.with_check end, ''), tok.t) = 0),
             '(없음)')
      from (
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
       order by cmd, policyname
  ) q
     where q.policyname = 'reviews_update_own'), '(정책 없음)') as c2_reviews_update_check,
  -- [3] profiles 가드 트리거 — 활성(O)·SECURITY INVOKER(definer=true 면 결함)·가드 함수 연결(fn)
  coalesce((select q.tgenabled::text || ' definer=' || q.security_definer::text || ' fn=' || q.function_name::text from (
      select t.tgname,
             t.tgenabled,          -- 'O' = origin/local 에서 활성
             p.proname as function_name,
             p.prosecdef as security_definer
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.profiles'::regclass
         and t.tgname = 'trg_profiles_guard_sensitive'
  ) q), '(트리거 없음)') as c3_trigger,
  -- [3] 보강(원문 없음) — 트리거 발화 조건: 19=ROW|BEFORE|UPDATE, WHEN 조건 없음, UPDATE OF 컬럼 한정 없음
  coalesce((
    select 'tgtype=' || t.tgtype::text
           || ' when=' || case when t.tgqual is null then 'none' else 'set' end
           || ' cols=' || case when t.tgattr::text = '' then 'all' else t.tgattr::text end
      from pg_trigger t
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'trg_profiles_guard_sensitive'), '(트리거 없음)') as c3_trigger_shape,
  -- [3] 가드 함수 본문에 없는 민감 컬럼 검사(has_*)
  (select case when count(*) = 0 then '(함수 없음)'
                 else coalesce(string_agg(e.key, ',' order by e.key collate "C")
                                 filter (where e.value is distinct from 'true'::jsonb), '(없음)') end
     from (
      select
        pg_get_functiondef(p.oid) ilike '%new.role%'            as has_role,
        pg_get_functiondef(p.oid) ilike '%new.deleted_at%'      as has_deleted_at,
        pg_get_functiondef(p.oid) ilike '%new.deletion_reason%' as has_deletion_reason,
        pg_get_functiondef(p.oid) ilike '%new.email%'           as has_email,
        pg_get_functiondef(p.oid) ilike '%new.referral_code%'   as has_referral_code
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'guard_profiles_sensitive_columns'
  ) q
    cross join lateral jsonb_each(to_jsonb(q)) as e(key, value)) as c3_trigger_cols,
  -- [4] 0031 유지 — is_admin(auth,anon)·lookup_referral_code(auth,anon) EXECUTE
  (select q.auth_is_admin::text || ',' || q.anon_is_admin::text || ',' || q.auth_lookup::text || ',' || q.anon_lookup::text from (
      select
        has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')             as auth_is_admin,
        has_function_privilege('anon',          'public.is_admin()', 'EXECUTE')             as anon_is_admin,
        has_function_privilege('authenticated', 'public.lookup_referral_code(text)', 'EXECUTE') as auth_lookup,
        has_function_privilege('anon',          'public.lookup_referral_code(text)', 'EXECUTE') as anon_lookup
  ) q) as c4_0031,
  -- [5] 유지돼야 할 앱 쓰기 정책 11개 중 없는 것(없으면 과잉 적용)
  (select coalesce(string_agg(req.policyname, ',' order by req.ord), '(없음)')
     from (values (1, 'projects_insert_own'), (2, 'projects_update_own'), (3, 'projects_delete_own'), (4, 'pages_insert_own'), (5, 'pages_update_own'), (6, 'pages_delete_own'), (7, 'photos_delete_own'), (8, 'share_tokens_owner_all'), (9, 'reviews_insert_own'), (10, 'reviews_update_own'), (11, 'reviews_delete_own')) as req(ord, policyname)
    where not exists (select 1 from (
      select tablename, policyname, cmd
        from pg_policies
       where schemaname = 'public'
         and tablename in ('projects', 'pages', 'photos', 'share_tokens', 'reviews')
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       order by tablename, policyname
  ) q where q.policyname::text = req.policyname)) as c5_kept_missing,
  -- [5] photos 의 photos_delete_own 외 쓰기 정책 수(INSERT/UPDATE/DELETE/ALL)
  (select (count(*) filter (where tablename = 'photos' and policyname::text <> 'photos_delete_own'))::text from (
      select tablename, policyname, cmd
        from pg_policies
       where schemaname = 'public'
         and tablename in ('projects', 'pages', 'photos', 'share_tokens', 'reviews')
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       order by tablename, policyname
  ) q) as c5_photos_write_policies,
  -- [5] precheck [1-c] 재실행 — 잠근 4개 테이블의 쓰기 표면 행 수
  (select (count(*) filter (where table_name in ('profiles', 'gifts', 'attendances', 'review_likes')))::text from (
      with t as (
        select c.oid, c.relname, c.relkind, c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'f')
      ),
      r(role_name) as (values ('anon'::name), ('authenticated'::name)),
      k(cmd) as (values ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)),
      surface as (
        select t.relname, t.relkind, t.relrowsecurity, r.role_name, k.cmd,
               has_table_privilege(r.role_name, t.oid, k.cmd) as table_priv,
               case when k.cmd = 'DELETE' then false
                    else has_any_column_privilege(r.role_name, t.oid, k.cmd) end as any_column_priv,
               (select string_agg(p.policyname, ', ' order by p.policyname)
                  from pg_policies p
                 where p.schemaname = 'public'
                   and p.tablename  = t.relname
                   and p.permissive = 'PERMISSIVE'
                   and p.cmd in (k.cmd, 'ALL')
                   and (r.role_name = any (p.roles) or 'public'::name = any (p.roles))
               ) as write_policies
          from t cross join r cross join k
      )
      select relname as table_name, relkind, role_name, cmd,
             relrowsecurity as rls_enabled, table_priv, any_column_priv, write_policies
        from surface
       where (table_priv or any_column_priv)
         and (not relrowsecurity or write_policies is not null)
       order by relrowsecurity, relname, role_name, cmd
  ) q) as c5_surface_locked,
  -- [5] precheck [1-c] — photos 는 authenticated DELETE 외 행 수(anon DELETE 도 0032 가 회수)
  (select (count(*) filter (where table_name = 'photos' and (cmd <> 'DELETE' or role_name <> 'authenticated')))::text from (
      with t as (
        select c.oid, c.relname, c.relkind, c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'f')
      ),
      r(role_name) as (values ('anon'::name), ('authenticated'::name)),
      k(cmd) as (values ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)),
      surface as (
        select t.relname, t.relkind, t.relrowsecurity, r.role_name, k.cmd,
               has_table_privilege(r.role_name, t.oid, k.cmd) as table_priv,
               case when k.cmd = 'DELETE' then false
                    else has_any_column_privilege(r.role_name, t.oid, k.cmd) end as any_column_priv,
               (select string_agg(p.policyname, ', ' order by p.policyname)
                  from pg_policies p
                 where p.schemaname = 'public'
                   and p.tablename  = t.relname
                   and p.permissive = 'PERMISSIVE'
                   and p.cmd in (k.cmd, 'ALL')
                   and (r.role_name = any (p.roles) or 'public'::name = any (p.roles))
               ) as write_policies
          from t cross join r cross join k
      )
      select relname as table_name, relkind, role_name, cmd,
             relrowsecurity as rls_enabled, table_priv, any_column_priv, write_policies
        from surface
       where (table_priv or any_column_priv)
         and (not relrowsecurity or write_policies is not null)
       order by relrowsecurity, relname, role_name, cmd
  ) q) as c5_surface_photos,
  -- [5] precheck [1-c] — reviews 쓰기 표면 전체(role:cmd, (col)=컬럼 grant 로만 허용). anon 행이 보이거나 authenticated 행이 빠지면 FAIL
  (select coalesce(string_agg(role_name::text || ':' || cmd || case when table_priv then '' else '(col)' end, ',' order by (role_name::text || ':' || cmd || case when table_priv then '' else '(col)' end) collate "C") filter (where table_name = 'reviews'), '(없음)') from (
      with t as (
        select c.oid, c.relname, c.relkind, c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'f')
      ),
      r(role_name) as (values ('anon'::name), ('authenticated'::name)),
      k(cmd) as (values ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)),
      surface as (
        select t.relname, t.relkind, t.relrowsecurity, r.role_name, k.cmd,
               has_table_privilege(r.role_name, t.oid, k.cmd) as table_priv,
               case when k.cmd = 'DELETE' then false
                    else has_any_column_privilege(r.role_name, t.oid, k.cmd) end as any_column_priv,
               (select string_agg(p.policyname, ', ' order by p.policyname)
                  from pg_policies p
                 where p.schemaname = 'public'
                   and p.tablename  = t.relname
                   and p.permissive = 'PERMISSIVE'
                   and p.cmd in (k.cmd, 'ALL')
                   and (r.role_name = any (p.roles) or 'public'::name = any (p.roles))
               ) as write_policies
          from t cross join r cross join k
      )
      select relname as table_name, relkind, role_name, cmd,
             relrowsecurity as rls_enabled, table_priv, any_column_priv, write_policies
        from surface
       where (table_priv or any_column_priv)
         and (not relrowsecurity or write_policies is not null)
       order by relrowsecurity, relname, role_name, cmd
  ) q) as c5_surface_reviews,
  -- [5] precheck [1-c] — projects·pages·share_tokens 의 authenticated 쓰기 표면(적용 전과 같아야 함). FAIL 이면 적용 전 precheck [1-c] 원문 결과와 비교
  (select coalesce(string_agg(table_name::text || ':' || role_name::text || ':' || cmd || case when table_priv then '' else '(col)' end, ',' order by (table_name::text || ':' || role_name::text || ':' || cmd || case when table_priv then '' else '(col)' end) collate "C") filter (where table_name in ('projects', 'pages', 'share_tokens') and role_name = 'authenticated'), '(없음)') from (
      with t as (
        select c.oid, c.relname, c.relkind, c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'f')
      ),
      r(role_name) as (values ('anon'::name), ('authenticated'::name)),
      k(cmd) as (values ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)),
      surface as (
        select t.relname, t.relkind, t.relrowsecurity, r.role_name, k.cmd,
               has_table_privilege(r.role_name, t.oid, k.cmd) as table_priv,
               case when k.cmd = 'DELETE' then false
                    else has_any_column_privilege(r.role_name, t.oid, k.cmd) end as any_column_priv,
               (select string_agg(p.policyname, ', ' order by p.policyname)
                  from pg_policies p
                 where p.schemaname = 'public'
                   and p.tablename  = t.relname
                   and p.permissive = 'PERMISSIVE'
                   and p.cmd in (k.cmd, 'ALL')
                   and (r.role_name = any (p.roles) or 'public'::name = any (p.roles))
               ) as write_policies
          from t cross join r cross join k
      )
      select relname as table_name, relkind, role_name, cmd,
             relrowsecurity as rls_enabled, table_priv, any_column_priv, write_policies
        from surface
       where (table_priv or any_column_priv)
         and (not relrowsecurity or write_policies is not null)
       order by relrowsecurity, relname, role_name, cmd
  ) q) as c5_surface_app_kept,
  -- [5] precheck [1-c] — 0032 범위 밖 새 쓰기 표면(관리자 정책 4개 제외, precheck-summary c1_out_of_scope 와 같은 필터)
  (select (count(*) filter (where table_name not in ('profiles','gifts','attendances','review_likes','photos','reviews','projects','pages','share_tokens') and coalesce(write_policies, '') not in ('book_sizes_admin_write','discount_codes_admin','resources_admin_write','site_content_admin_write')))::text from (
      with t as (
        select c.oid, c.relname, c.relkind, c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'f')
      ),
      r(role_name) as (values ('anon'::name), ('authenticated'::name)),
      k(cmd) as (values ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)),
      surface as (
        select t.relname, t.relkind, t.relrowsecurity, r.role_name, k.cmd,
               has_table_privilege(r.role_name, t.oid, k.cmd) as table_priv,
               case when k.cmd = 'DELETE' then false
                    else has_any_column_privilege(r.role_name, t.oid, k.cmd) end as any_column_priv,
               (select string_agg(p.policyname, ', ' order by p.policyname)
                  from pg_policies p
                 where p.schemaname = 'public'
                   and p.tablename  = t.relname
                   and p.permissive = 'PERMISSIVE'
                   and p.cmd in (k.cmd, 'ALL')
                   and (r.role_name = any (p.roles) or 'public'::name = any (p.roles))
               ) as write_policies
          from t cross join r cross join k
      )
      select relname as table_name, relkind, role_name, cmd,
             relrowsecurity as rls_enabled, table_priv, any_column_priv, write_policies
        from surface
       where (table_priv or any_column_priv)
         and (not relrowsecurity or write_policies is not null)
       order by relrowsecurity, relname, role_name, cmd
  ) q) as c5_surface_out_of_scope,
  -- [7] storage reviews 버킷 정책 — service_role 전용 1개만
  (select coalesce(string_agg(q.policyname::text || ':' || q.cmd || ':' || q.roles::text, ',' order by q.policyname::text collate "C"), '(정책 없음)') from (
      select policyname, cmd, roles
        from pg_policies
       where schemaname = 'storage'
         and tablename  = 'objects'
         and policyname like 'reviews_storage%'
       order by policyname
  ) q) as c7_reviews_storage,
  -- [8] storage photo 버킷 정책 — service_all + 사용자 SELECT 2개만
  (select coalesce(string_agg(q.policyname::text || ':' || q.cmd || ':' || q.roles::text, ',' order by q.policyname::text collate "C"), '(정책 없음)') from (
      select policyname, cmd, roles
        from pg_policies
       where schemaname = 'storage'
         and tablename  = 'objects'
         and policyname like 'photo\_%' escape '\'
       order by policyname
  ) q) as c8_photo_policies,
  -- [8] storage 비-SELECT·비-service_role 정책 — site_assets 관리자 3개만, roles={authenticated}((!admin)=is_admin 게이트 없음)
  (select coalesce(string_agg(q.policyname::text || ':' || q.cmd || ':' || q.roles::text || case when q.admin_gated is true then '' else '(!admin)' end, ',' order by q.policyname::text collate "C"), '(정책 없음)') from (
      select policyname, cmd, roles, qual, with_check,
             (coalesce(qual, '') || coalesce(with_check, '')) ilike '%is_admin%' as admin_gated
        from pg_policies
       where schemaname = 'storage'
         and tablename  = 'objects'
         and cmd <> 'SELECT'
         and roles <> array['service_role']::name[]
       order by policyname
  ) q) as c8_storage_nonservice
)
select v.no, v.check_name, v.actual, v.expected,
       (v.actual is not distinct from v.expected) as pass,
       v.note
  from s
  cross join lateral (values
    (1, 'c1_grants', s.c1_grants, '0', '[1] 4개 테이블 쓰기성 grant·photos INSERT/UPDATE 등 grant 잔존 행 수'),
    (2, 'c1_table_priv', s.c1_table_priv, '0', '[1] profiles·gifts·attendances·review_likes 중 쓰기 권한 true 가 있는 테이블 수'),
    (3, 'c1_col_priv', s.c1_col_priv, '0', '[1] 컬럼 수준 INSERT/UPDATE 권한이 남은 테이블 수(photos 포함)'),
    (4, 'c1_photos', s.c1_photos, 'insert=false update=false delete=true', '[1] photos authenticated 권한 — DELETE 만 유지'),
    (5, 'c1_select_kept', s.c1_select_kept, '0', '[1] authenticated SELECT 가 빠진 테이블 수(조회 경로 보존)'),
    (6, 'c1_reviews_table', s.c1_reviews_table, 'auth_delete', '[1] reviews 테이블 수준 권한 중 true 인 것 — authenticated DELETE 만'),
    (7, 'c1_reviews_col_insert', s.c1_reviews_col_insert, 'body,image_keys,order_id,public,rating,user_id', '[1] reviews 컬럼 INSERT(authenticated) — 라우트가 보내는 6개만'),
    (8, 'c1_reviews_col_update', s.c1_reviews_col_update, 'body,image_keys,public,rating', '[1] reviews 컬럼 UPDATE(authenticated) — 4개만(order_id/user_id 불가)'),
    (9, 'c2_removed', s.c2_removed, '0', '[2] 제거돼야 할 정책 8개 중 남은 수'),
    (10, 'c2_required_missing', s.c2_required_missing, '(없음)', '[2] 유지돼야 할 SELECT/DELETE 정책 7개 중 없는 것'),
    (11, 'c2_reviews_policies', s.c2_reviews_policies, 'reviews_delete_own:DELETE:{authenticated},reviews_insert_own:INSERT:{authenticated},reviews_public_read:SELECT:{anon,authenticated},reviews_select_own:SELECT:{authenticated},reviews_update_own:UPDATE:{authenticated}', '[2] reviews 정책 구성(policyname:cmd:roles) — ALL 없이 정확히 5개, reviews_public_read 만 {anon,authenticated}'),
    (12, 'c2_reviews_insert_check', s.c2_reviews_insert_check, '(없음)', '[2] reviews_insert_own WITH CHECK 에 없는 토큰 — 작성자 (user_id = auth.uid())·주문 연결 o.id = reviews.order_id·주문 소유 o.user_id = auth.uid()·상태·이미지 키 첫 세그먼트·장수 3·본문 2000'),
    (13, 'c2_reviews_update_check', s.c2_reviews_update_check, '(없음)', '[2] reviews_update_own 에 없는 토큰 — with_check 작성자·이미지 키 첫 세그먼트·장수 3·본문 2000, qual 본인 (user_id = auth.uid())'),
    (14, 'c3_trigger', s.c3_trigger, 'O definer=false fn=guard_profiles_sensitive_columns', '[3] profiles 가드 트리거 — 활성(O)·SECURITY INVOKER(definer=true 면 결함)·가드 함수 연결(fn)'),
    (15, 'c3_trigger_shape', s.c3_trigger_shape, 'tgtype=19 when=none cols=all', '[3] 보강(원문 없음) — 트리거 발화 조건: 19=ROW|BEFORE|UPDATE, WHEN 조건 없음, UPDATE OF 컬럼 한정 없음'),
    (16, 'c3_trigger_cols', s.c3_trigger_cols, '(없음)', '[3] 가드 함수 본문에 없는 민감 컬럼 검사(has_*)'),
    (17, 'c4_0031', s.c4_0031, 'true,true,true,true', '[4] 0031 유지 — is_admin(auth,anon)·lookup_referral_code(auth,anon) EXECUTE'),
    (18, 'c5_kept_missing', s.c5_kept_missing, '(없음)', '[5] 유지돼야 할 앱 쓰기 정책 11개 중 없는 것(없으면 과잉 적용)'),
    (19, 'c5_photos_write_policies', s.c5_photos_write_policies, '0', '[5] photos 의 photos_delete_own 외 쓰기 정책 수(INSERT/UPDATE/DELETE/ALL)'),
    (20, 'c5_surface_locked', s.c5_surface_locked, '0', '[5] precheck [1-c] 재실행 — 잠근 4개 테이블의 쓰기 표면 행 수'),
    (21, 'c5_surface_photos', s.c5_surface_photos, '0', '[5] precheck [1-c] — photos 는 authenticated DELETE 외 행 수(anon DELETE 도 0032 가 회수)'),
    (22, 'c5_surface_reviews', s.c5_surface_reviews, 'authenticated:DELETE,authenticated:INSERT(col),authenticated:UPDATE(col)', '[5] precheck [1-c] — reviews 쓰기 표면 전체(role:cmd, (col)=컬럼 grant 로만 허용). anon 행이 보이거나 authenticated 행이 빠지면 FAIL'),
    (23, 'c5_surface_app_kept', s.c5_surface_app_kept, 'pages:authenticated:DELETE,pages:authenticated:INSERT,pages:authenticated:UPDATE,projects:authenticated:DELETE,projects:authenticated:INSERT,projects:authenticated:UPDATE,share_tokens:authenticated:DELETE,share_tokens:authenticated:INSERT,share_tokens:authenticated:UPDATE', '[5] precheck [1-c] — projects·pages·share_tokens 의 authenticated 쓰기 표면(적용 전과 같아야 함). FAIL 이면 적용 전 precheck [1-c] 원문 결과와 비교'),
    (24, 'c5_surface_out_of_scope', s.c5_surface_out_of_scope, '0', '[5] precheck [1-c] — 0032 범위 밖 새 쓰기 표면(관리자 정책 4개 제외, precheck-summary c1_out_of_scope 와 같은 필터)'),
    (25, 'c7_reviews_storage', s.c7_reviews_storage, 'reviews_storage_service_all:ALL:{service_role}', '[7] storage reviews 버킷 정책 — service_role 전용 1개만'),
    (26, 'c8_photo_policies', s.c8_photo_policies, 'photo_buckets_service_all:ALL:{service_role},photo_originals_user_select:SELECT:{authenticated},photo_thumbs_user_select:SELECT:{authenticated}', '[8] storage photo 버킷 정책 — service_all + 사용자 SELECT 2개만'),
    (27, 'c8_storage_nonservice', s.c8_storage_nonservice, 'site_assets_admin_delete:DELETE:{authenticated},site_assets_admin_update:UPDATE:{authenticated},site_assets_admin_write:INSERT:{authenticated}', '[8] storage 비-SELECT·비-service_role 정책 — site_assets 관리자 3개만, roles={authenticated}((!admin)=is_admin 게이트 없음)')
  ) as v(no, check_name, actual, expected, note)
 order by v.no;
