-- =====================================================================
-- 0032-precheck-summary.sql — 0032-precheck.sql 의 점검을 **세로 요약표**로 (읽기 전용)
--
-- 왜: SQL Editor 는 여러 문장을 한 번에 Run 하면 **마지막 결과만** 보여 준다. precheck 는 쿼리가 29개라
--      하나씩 돌려야 했다. 이 파일은 각 쿼리를 **원문 그대로** 서브쿼리로 감싸 건수만 모은다.
-- 사용법: 전체 붙여넣고 선택 없이 Run → 33행(no · check_name · value · expectation).
--         expectation 과 다른 행만 0032-precheck.sql 의 해당 섹션을 따로 실행해 목록을 본다
--         (조치 템플릿도 그 파일에 있다).
-- 유지보수: 0032-precheck.sql 의 쿼리를 고치면 이 파일의 같은 쿼리도 함께 고칠 것.
-- 검증: PGlite(스텁 스키마)에서 실행해 오탐 행·의심 행·관리자 정책 제외가 기대대로 갈리는 것을 확인(2026-09-28).
-- 주의: 원문 쿼리의 limit(200/500) 때문에 건수가 그 값에서 잘릴 수 있다(0 인지 아닌지 판정에는 영향 없음).
-- 운영 실측(2026-09-28, 1차 가로판): c1_out_of_scope=21 은 is_admin() 관리자 정책 4개
--   (book_sizes·resources·site_content 각 6 + discount_codes 3)였다 → 이 판에서 c1_admin_only 로 분리.
-- =====================================================================
with s as (
select
  -- [1-c] RLS 꺼진 채 쓰기 가능(기대 0)
  (select count(*) filter (where not rls_enabled) from (
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
  ) q) as c1_rls_off_write,
  -- [1-c] 0032 범위 밖 쓰기 표면 — is_admin() 관리자 정책 4개 제외(기대 0)
  (select count(*) filter (where table_name not in ('profiles','gifts','attendances','review_likes','photos','reviews','projects','pages','share_tokens') and coalesce(write_policies, '') not in ('book_sizes_admin_write','discount_codes_admin','resources_admin_write','site_content_admin_write')) from (
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
  ) q) as c1_out_of_scope,
  -- [1-c] 관리자 전용 쓰기 정책 행(참고 — 운영 실측 21 = 6+6+6+3)
  (select count(*) filter (where write_policies in ('book_sizes_admin_write','discount_codes_admin','resources_admin_write','site_content_admin_write')) from (
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
  ) q) as c1_admin_only,
  -- [2-b] RLS 꺼진 테이블 중 권한 있음(기대 0)
  (select count(*) filter (where anon_select or anon_insert or anon_update or anon_delete or auth_select or auth_insert or auth_update or auth_delete) from (
      select c.relname as table_name,
             c.relkind,
             c.relrowsecurity      as rls_enabled,
             c.relforcerowsecurity as rls_forced,
             has_table_privilege('anon',          c.oid, 'SELECT') as anon_select,
             has_table_privilege('anon',          c.oid, 'INSERT') as anon_insert,
             has_table_privilege('anon',          c.oid, 'UPDATE') as anon_update,
             has_table_privilege('anon',          c.oid, 'DELETE') as anon_delete,
             has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
             has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
             has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
             has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and not c.relrowsecurity
       order by c.relname
  ) q) as c2b_rls_off_priv,
  -- [2-c] 권한 있고 security_invoker 아닌 뷰(0 아니면 목록 확인)
  (select count(*) filter (where (anon_select or auth_select or auth_insert or auth_update or auth_delete) and reloptions !~ 'security_invoker=(true|on|1|yes)') from (
      select c.relname as view_name,
             coalesce(c.reloptions::text, '') as reloptions,   -- security_invoker=true 여부
             has_table_privilege('anon',          c.oid, 'SELECT') as anon_select,
             has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
             has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
             has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
             has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('v', 'm')
       order by c.relname
  ) q) as c2c_views_review,
  -- [2-d] 예상 밖 storage 쓰기 정책(기대 0)
  (select count(*) filter (where policyname not in ('reviews_storage_owner_all','photo_originals_user_insert','photo_originals_user_update','photo_originals_user_delete','photo_thumbs_user_delete','photo_buckets_service_all','pdfs_service_all','resources_service_all','reviews_storage_service_all','site_assets_admin_write','site_assets_admin_update','site_assets_admin_delete')) from (
      select policyname, permissive, cmd, roles, qual, with_check
        from pg_policies
       where schemaname = 'storage'
         and tablename  = 'objects'
         and cmd <> 'SELECT'
       order by policyname
  ) q) as c2d_storage_extra,
  -- [3] 관리자 수(의도한 수와 같은지)
  (select count(*) from (
      select p.id, p.email, p.role, p.created_at, p.deleted_at, p.oauth_provider
        from public.profiles p
       where p.role = 'admin'
       order by p.created_at
  ) q) as c3_admins,
  -- [4] 익명화 흔적인데 활성(기대 0)
  (select count(*) from (
      select p.id, p.email, p.display_name, p.deleted_at, p.deletion_reason, p.created_at
        from public.profiles p
       where p.deleted_at is null
         and (p.email is null or p.display_name = '탈퇴회원')
       order by p.created_at desc
  ) q) as c4_revived,
  -- [4] 탈퇴 메일 후 활성(기대 0)
  (select count(*) from (
      select j.related_id as user_id, j.created_at as delete_notice_at,
             p.deleted_at, p.email, p.display_name
        from public.email_jobs j
        join public.profiles p on p.id = j.related_id
       where j.template = 'user.account_deleted'
         and p.deleted_at is null
       order by j.created_at desc
  ) q) as c4_notice_active,
  -- [5] 남의 주문 선물(기대 0)
  (select count(*) from (
      select g.id as gift_id, g.status, g.sender_id,
             o.user_id as order_owner_id, g.order_id,
             g.claimed_project_id, g.claimed_at, g.created_at
        from public.gifts g
        join public.orders o on o.id = g.order_id
       where g.sender_id <> o.user_id
       order by g.created_at desc
  ) q) as c5_gift_idor,
  -- [6a] 미래 일자 출석(기대 0)
  (select count(*) from (
      select a.user_id, a.checked_date, a.month_key, a.created_at
        from public.attendances a
       where a.checked_date > ((now() at time zone 'Asia/Seoul')::date)
       order by a.checked_date desc
       limit 200
  ) q) as c6a_future,
  -- [6b] 같은 초 대량 삽입(기대 0)
  (select count(*) from (
      select user_id, date_trunc('second', created_at) as created_second, count(*) as rows
        from public.attendances
       group by user_id, date_trunc('second', created_at)
      having count(*) > 3
       order by rows desc
       limit 200
  ) q) as c6b_burst,
  -- [6c] 보너스 기준 미달/중복(0 아니면 목록 확인)
  (select count(*) from (
      select b.user_id, b.memo, b.bonus_rows, b.threshold, b.month_key,
             count(distinct a.id) as month_days,
             count(distinct a.id) filter (
               where dl.id is not null
                 and to_char(a.checked_date, 'YYYY-MM') = b.month_key
             ) as ledger_days
        from (
          select l.user_id, l.memo,
                 count(*) as bonus_rows,
                 case
                   when l.memo like '%10일 달성 보너스%' then 10
                   when l.memo like '%(20일+)%'          then 20
                 end as threshold,
                 substring(l.memo from '^[0-9]{4}-[0-9]{2}') as month_key
            from public.point_ledger l
           where l.reason = 'attendance_bonus'
           group by l.user_id, l.memo
        ) b
        left join public.attendances a
          on a.user_id   = b.user_id
         and a.month_key = b.month_key
        left join lateral (
          select dl.id
            from public.point_ledger dl
           where dl.user_id = a.user_id
             and dl.reason  = 'attendance'
             and dl.memo    = '일일 출석 (' || to_char(a.checked_date, 'YYYY-MM-DD') || ')'
           limit 1
        ) dl on true
       group by b.user_id, b.memo, b.bonus_rows, b.threshold, b.month_key
      having b.threshold is null
          or b.bonus_rows > 1
          or count(distinct a.id) < b.threshold
          or count(distinct a.id) filter (
               where dl.id is not null
                 and to_char(a.checked_date, 'YYYY-MM') = b.month_key
             ) < b.threshold
       order by b.threshold nulls first, ledger_days asc
       limit 200
  ) q) as c6c_bonus,
  -- [6d] month_key 불일치(기대 0)
  (select count(*) from (
      select a.user_id, a.checked_date, a.month_key, a.created_at
        from public.attendances a
       where a.month_key <> to_char(a.checked_date, 'YYYY-MM')
       order by a.created_at desc
       limit 200
  ) q) as c6d_monthkey,
  -- [6e] ledger 없는 출석 (user,월) — 1차 판정(기대 0)
  (select count(*) from (
      select a.user_id, a.month_key,
             count(*)                                         as total_days,
             count(*) filter (where dl.id is null)            as ledger_less_days,
             array_agg(a.checked_date order by a.checked_date)
               filter (where dl.id is null)                   as ledger_less_dates,
             exists (
               select 1 from public.point_ledger bl
                where bl.user_id = a.user_id
                  and bl.reason  = 'attendance_bonus'
                  and bl.memo like a.month_key || '%'
             )                                                as got_bonus
        from public.attendances a
        left join lateral (
          select dl.id
            from public.point_ledger dl
           where dl.user_id = a.user_id
             and dl.reason  = 'attendance'
             and dl.memo    = '일일 출석 (' || to_char(a.checked_date, 'YYYY-MM-DD') || ')'
           limit 1
        ) dl on true
       where a.checked_date >= (
               select (min(l.created_at) at time zone 'Asia/Seoul')::date
                 from public.point_ledger l
                where l.reason = 'attendance'
             )
       group by a.user_id, a.month_key
      having count(*) filter (where dl.id is null) > 0
       order by got_bonus desc, ledger_less_days desc
       limit 200
  ) q) as c6e_ledgerless,
  -- [6e] 그중 보너스 받은 달(기대 0)
  (select count(*) filter (where got_bonus) from (
      select a.user_id, a.month_key,
             count(*)                                         as total_days,
             count(*) filter (where dl.id is null)            as ledger_less_days,
             array_agg(a.checked_date order by a.checked_date)
               filter (where dl.id is null)                   as ledger_less_dates,
             exists (
               select 1 from public.point_ledger bl
                where bl.user_id = a.user_id
                  and bl.reason  = 'attendance_bonus'
                  and bl.memo like a.month_key || '%'
             )                                                as got_bonus
        from public.attendances a
        left join lateral (
          select dl.id
            from public.point_ledger dl
           where dl.user_id = a.user_id
             and dl.reason  = 'attendance'
             and dl.memo    = '일일 출석 (' || to_char(a.checked_date, 'YYYY-MM-DD') || ')'
           limit 1
        ) dl on true
       where a.checked_date >= (
               select (min(l.created_at) at time zone 'Asia/Seoul')::date
                 from public.point_ledger l
                where l.reason = 'attendance'
             )
       group by a.user_id, a.month_key
      having count(*) filter (where dl.id is null) > 0
       order by got_bonus desc, ledger_less_days desc
       limit 200
  ) q) as c6e_with_bonus,
  -- [6f] created_at↔일자 불일치(보조)
  (select count(*) from (
      select a.user_id, a.checked_date, a.month_key, a.created_at,
             (a.created_at at time zone 'Asia/Seoul') as created_at_kst
        from public.attendances a
       where a.created_at <  (a.checked_date::timestamp at time zone 'Asia/Seoul')
          or a.created_at >= ((a.checked_date + 1)::timestamp at time zone 'Asia/Seoul')
                             + interval '5 minutes'
       order by a.created_at desc
       limit 500
  ) q) as c6f_created_off,
  -- [7] 좋아요 수 불일치(기대 0)
  (select count(*) from (
      select r.id as review_id, r.user_id, r.likes_count,
             count(rl.id) as actual_likes,
             r.likes_count - count(rl.id) as inflated_by
        from public.reviews r
        left join public.review_likes rl on rl.review_id = r.id
       group by r.id, r.user_id, r.likes_count
      having r.likes_count <> count(rl.id)
       order by abs(r.likes_count - count(rl.id)) desc
       limit 200
  ) q) as c7_likes,
  -- [8] 타인 경로 사진 키(선물 폴백 제외, 기대 0)
  (select count(*) filter (where not via_gift_fallback) from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id                                   as project_owner_id,
             split_part(ph.storage_key, '/', 1)           as storage_key_owner,
             split_part(coalesce(ph.thumb_key, ''), '/', 1) as thumb_key_owner,
             (g.id is not null)                           as via_gift_fallback,
             ph.created_at, ph.deleted_at
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
        left join public.gifts g
          on g.claimed_project_id = pr.id
         and (g.sender_id::text = split_part(ph.storage_key, '/', 1)
              or g.sender_id::text = split_part(coalesce(ph.thumb_key, ''), '/', 1))
       where split_part(ph.storage_key, '/', 1) <> pr.user_id::text
          or (ph.thumb_key is not null
              and split_part(ph.thumb_key, '/', 1) <> pr.user_id::text)
       order by via_gift_fallback, ph.created_at desc
       limit 500
  ) q) as c8_key_swap,
  -- [8] 선물 폴백(정상일 수 있음)
  (select count(*) filter (where via_gift_fallback) from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id                                   as project_owner_id,
             split_part(ph.storage_key, '/', 1)           as storage_key_owner,
             split_part(coalesce(ph.thumb_key, ''), '/', 1) as thumb_key_owner,
             (g.id is not null)                           as via_gift_fallback,
             ph.created_at, ph.deleted_at
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
        left join public.gifts g
          on g.claimed_project_id = pr.id
         and (g.sender_id::text = split_part(ph.storage_key, '/', 1)
              or g.sender_id::text = split_part(coalesce(ph.thumb_key, ''), '/', 1))
       where split_part(ph.storage_key, '/', 1) <> pr.user_id::text
          or (ph.thumb_key is not null
              and split_part(ph.thumb_key, '/', 1) <> pr.user_id::text)
       order by via_gift_fallback, ph.created_at desc
       limit 500
  ) q) as c8_gift_fallback,
  -- [9a] 후기에 타인 이미지 키(기대 0, 필수 조치)
  (select count(*) from (
      select r.id as review_id, r.user_id, r.order_id, r.public, r.created_at, r.updated_at,
             array_agg(k.image_key) filter (
               where k.image_key is null
                  or split_part(k.image_key, '/', 1) <> r.user_id::text
             ) as foreign_keys
        from public.reviews r
        cross join lateral unnest(r.image_keys) as k(image_key)
       group by r.id, r.user_id, r.order_id, r.public, r.created_at, r.updated_at
      having count(*) filter (
               where k.image_key is null
                  or split_part(k.image_key, '/', 1) <> r.user_id::text
             ) > 0
       order by r.updated_at desc
  ) q) as c9a_foreign_img,
  -- [9b] 주문 소유자 불일치 후기(기대 0)
  (select count(*) filter (where owner_mismatch or order_id is null) from (
      select r.id as review_id, r.user_id as review_user_id,
             o.id as order_id, o.user_id as order_owner_id, o.status as order_status,
             (o.user_id is distinct from r.user_id)        as owner_mismatch,
             (o.status not in ('shipped', 'delivered'))    as status_not_reviewable,
             r.public, r.created_at
        from public.reviews r
        left join public.orders o on o.id = r.order_id
       where o.id is null
          or o.user_id is distinct from r.user_id
          or o.status not in ('shipped', 'delivered')
       order by owner_mismatch desc, r.created_at desc
  ) q) as c9b_owner_mismatch,
  -- [9b] 후기 불가 상태만(환불 등 정상 가능)
  (select count(*) filter (where not owner_mismatch and order_id is not null) from (
      select r.id as review_id, r.user_id as review_user_id,
             o.id as order_id, o.user_id as order_owner_id, o.status as order_status,
             (o.user_id is distinct from r.user_id)        as owner_mismatch,
             (o.status not in ('shipped', 'delivered'))    as status_not_reviewable,
             r.public, r.created_at
        from public.reviews r
        left join public.orders o on o.id = r.order_id
       where o.id is null
          or o.user_id is distinct from r.user_id
          or o.status not in ('shipped', 'delivered')
       order by owner_mismatch desc, r.created_at desc
  ) q) as c9b_status_only,
  -- [9c] 장수/글자 한도 위반(기대 0)
  (select count(*) from (
      select r.id as review_id, r.user_id,
             cardinality(r.image_keys)  as image_count,
             char_length(r.body)        as body_chars,
             r.created_at, r.updated_at
        from public.reviews r
       where cardinality(r.image_keys) > 3
          or char_length(r.body) > 2000
       order by r.updated_at desc
  ) q) as c9c_limits,
  -- [10] 후기 버킷 직접 업로드(기대 0)
  (select count(*) from (
      select o.id, o.name, o.created_at,
             coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') as uploader,
             o.metadata ->> 'mimetype' as mimetype,
             (o.metadata ->> 'size')::bigint as size_bytes,
             exists (
               select 1 from public.reviews r
                where o.name = any (r.image_keys)
             ) as referenced_by_review
        from storage.objects o
       where o.bucket_id = 'reviews'
         and coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null
       order by o.created_at desc
       limit 500
  ) q) as c10_review_upload,
  -- [11a] 사진 버킷 객체 수
  (select coalesce(sum(objects),0) from (
      select o.bucket_id,
             count(*) as objects,
             count(*) filter (
               where coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null
             ) as with_uploader
        from storage.objects o
       where o.bucket_id in ('photo-originals', 'photo-thumbs')
       group by o.bucket_id
       order by o.bucket_id
  ) q) as c11a_objects,
  -- [11a] 그중 uploader 채워짐(객체 수에 가까우면 11b 기준 무효)
  (select coalesce(sum(with_uploader),0) from (
      select o.bucket_id,
             count(*) as objects,
             count(*) filter (
               where coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null
             ) as with_uploader
        from storage.objects o
       where o.bucket_id in ('photo-originals', 'photo-thumbs')
       group by o.bucket_id
       order by o.bucket_id
  ) q) as c11a_with_uploader,
  -- [11b] 사용자 JWT 로 쓴 사진 객체(기대 0)
  (select count(*) from (
      select o.bucket_id, o.name, o.created_at, o.updated_at,
             coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') as uploader,
             o.metadata ->> 'mimetype'       as mimetype,
             (o.metadata ->> 'size')::bigint as size_bytes,
             exists (
               select 1 from public.photos ph
                where (o.bucket_id = 'photo-originals' and ph.storage_key = o.name)
                   or (o.bucket_id = 'photo-thumbs'    and ph.thumb_key   = o.name)
             ) as referenced
        from storage.objects o
       where o.bucket_id in ('photo-originals', 'photo-thumbs')
         and coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null
       order by referenced desc, o.updated_at desc
       limit 500
  ) q) as c11b_user_written,
  -- [11c] 행↔객체 불일치 전체
  (select count(*) from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id as project_owner_id, pr.status as project_status,
             (select array_agg(distinct od.status order by od.status)
                from public.orders od
               where od.project_id = ph.project_id)  as order_statuses,
             ph.storage_key, ph.mime, ph.size_bytes, ph.created_at as photo_created_at, ph.deleted_at,
             o.metadata ->> 'mimetype'               as object_mimetype,
             (o.metadata ->> 'size')::bigint         as object_size,
             o.updated_at                            as object_updated_at,
             coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') as uploader,
             ((o.metadata ->> 'size')::bigint is distinct from ph.size_bytes) as size_mismatch,
             ((o.metadata ->> 'mimetype') is distinct from ph.mime)          as mime_mismatch,
             (o.updated_at > ph.created_at + interval '5 minutes')          as overwritten_after_row
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
        join storage.objects o
          on o.bucket_id = 'photo-originals'
         and o.name = ph.storage_key
       where (o.metadata ->> 'size')::bigint is distinct from ph.size_bytes
          or (o.metadata ->> 'mimetype') is distinct from ph.mime
          or o.updated_at > ph.created_at + interval '5 minutes'
       order by overwritten_after_row desc,
                (coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null) desc,
                ph.created_at desc
       limit 500
  ) q) as c11c_total,
  -- [11c] 그중 의심(행 뒤 덮어씀·uploader·06-24 이후 생성, 기대 0)
  (select count(*) filter (where overwritten_after_row or uploader is not null or photo_created_at >= timestamptz '2026-06-24 00:00+09') from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id as project_owner_id, pr.status as project_status,
             (select array_agg(distinct od.status order by od.status)
                from public.orders od
               where od.project_id = ph.project_id)  as order_statuses,
             ph.storage_key, ph.mime, ph.size_bytes, ph.created_at as photo_created_at, ph.deleted_at,
             o.metadata ->> 'mimetype'               as object_mimetype,
             (o.metadata ->> 'size')::bigint         as object_size,
             o.updated_at                            as object_updated_at,
             coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') as uploader,
             ((o.metadata ->> 'size')::bigint is distinct from ph.size_bytes) as size_mismatch,
             ((o.metadata ->> 'mimetype') is distinct from ph.mime)          as mime_mismatch,
             (o.updated_at > ph.created_at + interval '5 minutes')          as overwritten_after_row
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
        join storage.objects o
          on o.bucket_id = 'photo-originals'
         and o.name = ph.storage_key
       where (o.metadata ->> 'size')::bigint is distinct from ph.size_bytes
          or (o.metadata ->> 'mimetype') is distinct from ph.mime
          or o.updated_at > ph.created_at + interval '5 minutes'
       order by overwritten_after_row desc,
                (coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null) desc,
                ph.created_at desc
       limit 500
  ) q) as c11c_suspicious,
  -- [11c] 불일치 행 중 가장 최근 생성 시각(06-23 이전이면 구 기록 방식 오탐)
  (select max(photo_created_at) from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id as project_owner_id, pr.status as project_status,
             (select array_agg(distinct od.status order by od.status)
                from public.orders od
               where od.project_id = ph.project_id)  as order_statuses,
             ph.storage_key, ph.mime, ph.size_bytes, ph.created_at as photo_created_at, ph.deleted_at,
             o.metadata ->> 'mimetype'               as object_mimetype,
             (o.metadata ->> 'size')::bigint         as object_size,
             o.updated_at                            as object_updated_at,
             coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') as uploader,
             ((o.metadata ->> 'size')::bigint is distinct from ph.size_bytes) as size_mismatch,
             ((o.metadata ->> 'mimetype') is distinct from ph.mime)          as mime_mismatch,
             (o.updated_at > ph.created_at + interval '5 minutes')          as overwritten_after_row
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
        join storage.objects o
          on o.bucket_id = 'photo-originals'
         and o.name = ph.storage_key
       where (o.metadata ->> 'size')::bigint is distinct from ph.size_bytes
          or (o.metadata ->> 'mimetype') is distinct from ph.mime
          or o.updated_at > ph.created_at + interval '5 minutes'
       order by overwritten_after_row desc,
                (coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null) desc,
                ph.created_at desc
       limit 500
  ) q) as c11c_newest,
  -- [11d] 활성 사진인데 객체 없음(기대 0)
  (select count(*) from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id as project_owner_id,
             (select array_agg(distinct od.status order by od.status)
                from public.orders od
               where od.project_id = ph.project_id) as order_statuses,
             ph.storage_key, ph.thumb_key, ph.created_at,
             not exists (
               select 1 from storage.objects o
                where o.bucket_id = 'photo-originals' and o.name = ph.storage_key
             ) as original_missing,
             (ph.thumb_key is not null and not exists (
               select 1 from storage.objects o
                where o.bucket_id = 'photo-thumbs' and o.name = ph.thumb_key
             )) as thumb_missing
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
       where ph.deleted_at is null
         and (
               not exists (
                 select 1 from storage.objects o
                  where o.bucket_id = 'photo-originals' and o.name = ph.storage_key
               )
            or (ph.thumb_key is not null and not exists (
                 select 1 from storage.objects o
                  where o.bucket_id = 'photo-thumbs' and o.name = ph.thumb_key
               ))
             )
       order by original_missing desc, ph.created_at desc
       limit 500
  ) q) as c11d_missing,
  -- [11d] 그중 주문 있는 프로젝트(인쇄 원본 유실, 기대 0)
  (select count(*) filter (where order_statuses is not null) from (
      select ph.id as photo_id, ph.project_id,
             pr.user_id as project_owner_id,
             (select array_agg(distinct od.status order by od.status)
                from public.orders od
               where od.project_id = ph.project_id) as order_statuses,
             ph.storage_key, ph.thumb_key, ph.created_at,
             not exists (
               select 1 from storage.objects o
                where o.bucket_id = 'photo-originals' and o.name = ph.storage_key
             ) as original_missing,
             (ph.thumb_key is not null and not exists (
               select 1 from storage.objects o
                where o.bucket_id = 'photo-thumbs' and o.name = ph.thumb_key
             )) as thumb_missing
        from public.photos ph
        join public.projects pr on pr.id = ph.project_id
       where ph.deleted_at is null
         and (
               not exists (
                 select 1 from storage.objects o
                  where o.bucket_id = 'photo-originals' and o.name = ph.storage_key
               )
            or (ph.thumb_key is not null and not exists (
                 select 1 from storage.objects o
                  where o.bucket_id = 'photo-thumbs' and o.name = ph.thumb_key
               ))
             )
       order by original_missing desc, ph.created_at desc
       limit 500
  ) q) as c11d_with_order
)
select v.no, v.check_name, v.value, v.expectation
  from s
  cross join lateral (values
    (1, 'c1_rls_off_write', s.c1_rls_off_write::text, '[1-c] RLS 꺼진 채 쓰기 가능(기대 0)'),
    (2, 'c1_out_of_scope', s.c1_out_of_scope::text, '[1-c] 0032 범위 밖 쓰기 표면 — is_admin() 관리자 정책 4개 제외(기대 0)'),
    (3, 'c1_admin_only', s.c1_admin_only::text, '[1-c] 관리자 전용 쓰기 정책 행(참고 — 운영 실측 21 = 6+6+6+3)'),
    (4, 'c2b_rls_off_priv', s.c2b_rls_off_priv::text, '[2-b] RLS 꺼진 테이블 중 권한 있음(기대 0)'),
    (5, 'c2c_views_review', s.c2c_views_review::text, '[2-c] 권한 있고 security_invoker 아닌 뷰(0 아니면 목록 확인)'),
    (6, 'c2d_storage_extra', s.c2d_storage_extra::text, '[2-d] 예상 밖 storage 쓰기 정책(기대 0)'),
    (7, 'c3_admins', s.c3_admins::text, '[3] 관리자 수(의도한 수와 같은지)'),
    (8, 'c4_revived', s.c4_revived::text, '[4] 익명화 흔적인데 활성(기대 0)'),
    (9, 'c4_notice_active', s.c4_notice_active::text, '[4] 탈퇴 메일 후 활성(기대 0)'),
    (10, 'c5_gift_idor', s.c5_gift_idor::text, '[5] 남의 주문 선물(기대 0)'),
    (11, 'c6a_future', s.c6a_future::text, '[6a] 미래 일자 출석(기대 0)'),
    (12, 'c6b_burst', s.c6b_burst::text, '[6b] 같은 초 대량 삽입(기대 0)'),
    (13, 'c6c_bonus', s.c6c_bonus::text, '[6c] 보너스 기준 미달/중복(0 아니면 목록 확인)'),
    (14, 'c6d_monthkey', s.c6d_monthkey::text, '[6d] month_key 불일치(기대 0)'),
    (15, 'c6e_ledgerless', s.c6e_ledgerless::text, '[6e] ledger 없는 출석 (user,월) — 1차 판정(기대 0)'),
    (16, 'c6e_with_bonus', s.c6e_with_bonus::text, '[6e] 그중 보너스 받은 달(기대 0)'),
    (17, 'c6f_created_off', s.c6f_created_off::text, '[6f] created_at↔일자 불일치(보조)'),
    (18, 'c7_likes', s.c7_likes::text, '[7] 좋아요 수 불일치(기대 0)'),
    (19, 'c8_key_swap', s.c8_key_swap::text, '[8] 타인 경로 사진 키(선물 폴백 제외, 기대 0)'),
    (20, 'c8_gift_fallback', s.c8_gift_fallback::text, '[8] 선물 폴백(정상일 수 있음)'),
    (21, 'c9a_foreign_img', s.c9a_foreign_img::text, '[9a] 후기에 타인 이미지 키(기대 0, 필수 조치)'),
    (22, 'c9b_owner_mismatch', s.c9b_owner_mismatch::text, '[9b] 주문 소유자 불일치 후기(기대 0)'),
    (23, 'c9b_status_only', s.c9b_status_only::text, '[9b] 후기 불가 상태만(환불 등 정상 가능)'),
    (24, 'c9c_limits', s.c9c_limits::text, '[9c] 장수/글자 한도 위반(기대 0)'),
    (25, 'c10_review_upload', s.c10_review_upload::text, '[10] 후기 버킷 직접 업로드(기대 0)'),
    (26, 'c11a_objects', s.c11a_objects::text, '[11a] 사진 버킷 객체 수'),
    (27, 'c11a_with_uploader', s.c11a_with_uploader::text, '[11a] 그중 uploader 채워짐(객체 수에 가까우면 11b 기준 무효)'),
    (28, 'c11b_user_written', s.c11b_user_written::text, '[11b] 사용자 JWT 로 쓴 사진 객체(기대 0)'),
    (29, 'c11c_total', s.c11c_total::text, '[11c] 행↔객체 불일치 전체'),
    (30, 'c11c_suspicious', s.c11c_suspicious::text, '[11c] 그중 의심(행 뒤 덮어씀·uploader·06-24 이후 생성, 기대 0)'),
    (31, 'c11c_newest', s.c11c_newest::text, '[11c] 불일치 행 중 가장 최근 생성 시각(06-23 이전이면 구 기록 방식 오탐)'),
    (32, 'c11d_missing', s.c11d_missing::text, '[11d] 활성 사진인데 객체 없음(기대 0)'),
    (33, 'c11d_with_order', s.c11d_with_order::text, '[11d] 그중 주문 있는 프로젝트(인쇄 원본 유실, 기대 0)')
  ) as v(no, check_name, value, expectation)
 order by v.no;
