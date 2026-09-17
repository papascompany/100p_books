-- =====================================================================
-- 0032-precheck.sql — 0032 적용 "전" 읽기 전용 점검
--
-- 목적:
--   1) 운영 DB 에서 anon/authenticated 가 실제로 어떤 테이블 쓰기 권한을 갖는지,
--      어떤 쓰기 정책이 열려 있는지 **public 스키마 전체**로 확인(0032 가 닫을 표면이
--      실제로 열려 있는가, 0032 범위 밖에 열린 표면이 더 있는가).
--   2) 이미 악용된 흔적이 있는지 조회(권한 상승·탈퇴 가드 우회·보너스/선물 편취·
--      사진 storage_key 바꿔치기·후기 이미지 키 바꿔치기·사진 원본 객체 바꿔치기/직접 삭제).
--
--   ⚠️ 0032 는 **앞으로의** 직접 쓰기를 막을 뿐, 이미 만들어진 부정 행(남의 주문으로
--   발급된 gift, 부풀린 출석 행, 타인 경로를 가리키는 photos/reviews 행, 검증 뒤 덮어쓴
--   사진 원본 객체 등)은 지우거나 되돌리지 않는다. [3]~[11] 에서 1건이라도 나오면 적용과
--   별개로 개별 시정이 필요하다.
--
-- 사용법:
--   Supabase 대시보드 → SQL Editor. 상단 프로젝트가 100p_books/PRODUCTION 인지 확인.
--   섹션별로 실행. 모두 SELECT 뿐이며 데이터를 바꾸지 않는다.
--   (조치 템플릿은 전부 주석이다. 결과를 검토한 뒤 운영자가 따로 실행한다.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- [1] public 스키마 전체 — anon/authenticated(및 PUBLIC) 쓰기성 권한 전수
--     0032 대상 5개 테이블만 보면 범위 밖에 열린 표면을 놓친다. 전 테이블/뷰를 본다.
--     읽는 법: 권한만 있고 RLS 가 켜져 있으며 해당 명령의 정책이 없으면 실제로는 막혀
--     있다(잔여 grant). 실제 표면은 [1-c] 가 권한×RLS×정책을 합쳐 보여 준다.
-- ---------------------------------------------------------------------
-- [1-a] 테이블 수준 grant (카탈로그 ACL 직접 전개 — information_schema 는 grantor 가
--       현재 역할과 무관하면 행을 숨길 수 있다). grantee='PUBLIC' 은 모든 역할에 적용된다.
select c.relname                                  as table_name,
       c.relkind,                                  -- r=table p=partitioned v=view m=matview f=foreign
       case when acl.grantee = 0 then 'PUBLIC'
            else pg_get_userbyid(acl.grantee) end as grantee,
       acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) as acl
 where n.nspname = 'public'
   and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and (acl.grantee = 0
        or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
   and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
 order by c.relname, grantee, acl.privilege_type;

-- [1-b] 컬럼 수준 grant (테이블 grant 가 없어도 컬럼 grant 로 INSERT/UPDATE 가 열린다).
select c.relname                                  as table_name,
       a.attname                                  as column_name,
       case when acl.grantee = 0 then 'PUBLIC'
            else pg_get_userbyid(acl.grantee) end as grantee,
       acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  cross join lateral aclexplode(a.attacl) as acl
 where n.nspname = 'public'
   and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and (acl.grantee = 0
        or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
   and acl.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
 order by c.relname, a.attnum, grantee, acl.privilege_type;

-- [1-c] 실제 쓰기 표면 = (테이블 또는 컬럼 권한) × (RLS 꺼짐 또는 해당 명령의 PERMISSIVE 정책).
--       has_*_privilege 는 역할 상속·PUBLIC grant 까지 반영한다.
--       rls_enabled=false 인 행은 **정책과 무관하게 전 행 쓰기 가능**이므로 최우선 검토.
--       적용 전 기대: profiles/gifts/attendances/review_likes/photos/reviews 가 보인다.
--       projects/pages/share_tokens/photos(DELETE) 는 앱 사용자 세션 경로라 0032 후에도 남는다.
--       그 밖의 테이블이 보이면 0032 범위 밖 표면이다 → 앱 사용 여부를 대조해 별도 판단.
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
 order by relrowsecurity, relname, role_name, cmd;

-- profiles 민감 컬럼의 컬럼 수준 UPDATE 권한(있으면 표면이 열려 있는 것).
select
  c.col as column_name,
  has_column_privilege('authenticated', 'public.profiles', c.col, 'UPDATE') as auth_can_update
from (values ('role'), ('deleted_at'), ('deletion_reason'), ('email'), ('referral_code')) as c(col);

-- ---------------------------------------------------------------------
-- [2] public 스키마 전체 — 쓰기 정책·RLS 상태 전수
-- ---------------------------------------------------------------------
-- [2-a] SELECT 가 아닌 모든 정책(INSERT/UPDATE/DELETE/ALL).
--       적용 전 기대(0032 가 제거/대체): profiles_update_self / gifts_sender_all /
--         attendances_insert_own / review_likes_own_all / photos_insert_own /
--         photos_update_own / reviews_own_all.
--       목록의 나머지는 0032 범위 밖이다. roles 에 anon 또는 {public} 이 있으면 비로그인
--       요청에도 적용되므로 우선 검토한다. qual/with_check 가 true 이거나 auth.uid()
--       비교가 없으면 타인 행 쓰기 가능성이 있다.
select tablename, policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and cmd <> 'SELECT'
 order by tablename, cmd, policyname;

-- [2-b] RLS 가 꺼진 public 테이블. 여기에 나오면서 anon/authenticated 권한이 true 면
--       PostgREST 로 **모든 행**을 읽기/쓰기 할 수 있다. 기대: 0 rows(또는 권한이 모두 false).
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
 order by c.relname;

-- [2-c] public 뷰 — 뷰는 RLS 가 없고 기본적으로 **소유자 권한**으로 기저 테이블에 접근한다
--       (security_invoker 미설정 시 기저 테이블 RLS 우회). anon/authenticated 권한이 있으면 검토.
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
 order by c.relname;

-- [2-d] storage.objects 의 쓰기 정책. 적용 전 기대(0032 가 제거):
--         reviews_storage_owner_all(ALL), photo_originals_user_insert(INSERT),
--         photo_originals_user_update(UPDATE), photo_originals_user_delete(DELETE),
--         photo_thumbs_user_delete(DELETE) — 모두 roles={authenticated}.
--       0032 후에도 남는 것: service_role 정책(photo_buckets_service_all, pdfs_service_all,
--         resources_service_all, reviews_storage_service_all)과 is_admin() 으로 막힌
--         site_assets_admin_write/update/delete.
--       그 밖의 정책이 보이면 0032 범위 밖 표면이다 → 버킷별로 앱이 사용자 세션으로 쓰는지 대조한다
--       (앱의 storage 호출은 전부 admin=service_role 이고, 사진 업로드는 서명 업로드 토큰이다).
select policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and cmd <> 'SELECT'
 order by policyname;

-- ---------------------------------------------------------------------
-- [3] 악용 흔적 — 권한 상승 (profiles.role = 'admin')
--     의도한 관리자 계정만 있어야 한다. 예상 밖 계정/생성일을 검토.
-- ---------------------------------------------------------------------
select p.id, p.email, p.role, p.created_at, p.deleted_at, p.oauth_provider
  from public.profiles p
 where p.role = 'admin'
 order by p.created_at;

-- 관리자 권한 변경 감사 로그(정상적인 승격 경로의 흔적). 여기에 없는 admin 계정이
-- 위 [3] 에 있으면, 콘솔/SQL 이 아닌 경로로 role 이 바뀌었을 가능성을 의심한다.
select created_at, actor_email, target_id, details
  from public.audit_logs
 where action = 'user.role_change'
 order by created_at desc
 limit 100;

-- ---------------------------------------------------------------------
-- [4] 악용 흔적 — 탈퇴 가드 우회 (deleted_at 이 되돌려졌는가)
--     익명화 규약: 탈퇴 시 email=null, display_name='탈퇴회원', deleted_at 채움.
--     "deleted_at IS NULL 인데 익명화 흔적(email null & display_name='탈퇴회원')이
--      남은" 계정은 deleted_at 이 null 로 되돌려졌을 가능성이 있는 잔재다.
-- ---------------------------------------------------------------------
select p.id, p.email, p.display_name, p.deleted_at, p.deletion_reason, p.created_at
  from public.profiles p
 where p.deleted_at is null
   and (p.email is null or p.display_name = '탈퇴회원')
 order by p.created_at desc;

-- 탈퇴 안내 메일이 큐에 있는데(=탈퇴가 진행됐는데) 여전히 활성인 계정도 의심.
select j.related_id as user_id, j.created_at as delete_notice_at,
       p.deleted_at, p.email, p.display_name
  from public.email_jobs j
  join public.profiles p on p.id = j.related_id
 where j.template = 'user.account_deleted'
   and p.deleted_at is null
 order by j.created_at desc;

-- ---------------------------------------------------------------------
-- [5] 악용 흔적 — 선물 IDOR (gift.order_id 의 주문 소유자와 sender_id 불일치)
--     정상 발급은 sender 가 자기 주문으로만 보낸다. 아래가 1건이라도 나오면
--     남의 주문으로 발급된 gift 이며, claimed 라면 콘텐츠가 이미 복제된 것이다.
--
--     **필수 조치(결과가 1건 이상일 때)**: 0032 적용은 이미 발급된 토큰을 무효화하지
--     않는다. 수령 라우트는 service_role 로 동작하므로 revoke 후에도 pending 토큰은
--     그대로 수령 가능하다. 0032 적용 직후(또는 직전) 아래 템플릿으로 pending 부정
--     gift 를 만료시킨다. claimed 건은 복제된 프로젝트(claimed_project_id) 처리가
--     데이터 삭제를 동반하므로 운영자 승인 후 별도로 다룬다.
-- ---------------------------------------------------------------------
select g.id as gift_id, g.status, g.sender_id,
       o.user_id as order_owner_id, g.order_id,
       g.claimed_project_id, g.claimed_at, g.created_at
  from public.gifts g
  join public.orders o on o.id = g.order_id
 where g.sender_id <> o.user_id
 order by g.created_at desc;

-- 조치 템플릿(읽기 전용 점검 파일이므로 주석 처리. 결과 검토 후 수동 실행):
--   update public.gifts g
--      set status = 'expired'
--     from public.orders o
--    where o.id = g.order_id
--      and g.sender_id <> o.user_id
--      and g.status = 'pending';

-- ---------------------------------------------------------------------
-- [6] 악용 흔적 — 출석 편취
--     정상 출석 행은 /api/attendance/check 가 service_role 로 KST 오늘 일자 1건만 넣고,
--     같은 요청에서 point_ledger 에 reason='attendance', memo='일일 출석 (YYYY-MM-DD)'
--     (+100P) 를 남긴다(ledger 는 0023 부터). 직접 INSERT 한 행에는 이 ledger 가 없다.
--     공격 패턴 예: 과거 일자 행을 **요청마다 1건씩**, month_key 를 맞춰 넣고 하루 1회
--     정상 출석 → 월 카운트가 10/20 을 넘겨 보너스 지급. 이 패턴은 (a)(b)(d) 로는 안
--     잡히므로 (e) ledger 대조를 1차 판정으로 쓴다.
--       (a) 미래 일자   (b) 같은 초 대량 삽입   (c) 보너스 대비 출석일 수
--       (d) month_key 불일치   (e) ledger 없는 출석 행   (f) created_at ↔ checked_date 불일치
-- ---------------------------------------------------------------------
-- (a) 미래 일자 (KST 기준 오늘보다 큰 checked_date)
select a.user_id, a.checked_date, a.month_key, a.created_at
  from public.attendances a
 where a.checked_date > ((now() at time zone 'Asia/Seoul')::date)
 order by a.checked_date desc
 limit 200;

-- (b) 같은 user 가 같은 created_at(초 단위)에 대량 삽입한 흔적
select user_id, date_trunc('second', created_at) as created_second, count(*) as rows
  from public.attendances
 group by user_id, date_trunc('second', created_at)
having count(*) > 3
 order by rows desc
 limit 200;

-- (c) 출석 보너스를 받은 (user, month) 의 실제 그 달 출석일 수 대비 기준.
--     두 보너스가 같은 reason='attendance_bonus' 를 쓰므로 memo 로 구분한다:
--       • '<YYYY-MM> 10일 달성 보너스'       (app/api/attendance/check)  기준 10
--       • '<YYYY-MM> 월 출석 보너스 (20일+)' (app/api/cron/attendance-reset) 기준 20
--     • 보너스 ledger 를 (user, memo) 로 **먼저 집계**한 뒤 출석과 조인하고, 출석은
--       count(distinct a.id) 로 센다 — 같은 memo 보너스가 2건 이상이어도 month_days 가
--       배수로 부풀지 않는다(bonus_rows>1 은 그 자체로 중복 지급 의심).
--     • month_days  = 그 달 출석 행 수(앱이 보너스 판정에 쓴 값, 부풀린 행 포함).
--       ledger_days = 그 중 일일 출석 ledger 가 있는 날 수(직접 INSERT 행 제외).
--       month_days 는 기준 이상인데 ledger_days 가 기준 미만이면 부풀린 행으로 받은 보너스다.
--     • threshold 가 null 이면 memo 형식이 예상 밖(수동 지급 등)이라 개별 확인한다.
--     • 한계: 0023 이전 달이거나 일일 적립 RPC 가 실패(best-effort)한 날은 ledger 가 없어
--       ledger_days 가 낮게 보일 수 있다 → (e)(f) 와 함께 판정.
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
 limit 200;

-- (d) month_key 가 checked_date 와 어긋나는 행: 앱은 month_key 를 checked_date 에서
--     파생하므로(YYYY-MM) 정상 흐름에서는 나올 수 없다. 직접 INSERT 흔적이다.
select a.user_id, a.checked_date, a.month_key, a.created_at
  from public.attendances a
 where a.month_key <> to_char(a.checked_date, 'YYYY-MM')
 order by a.created_at desc
 limit 200;

-- (e) ledger 없는 출석 행 — (user, month) 별 집계. 1차 판정.
--     ledger 기록이 시작된 날(첫 'attendance' ledger 의 KST 일자) 이후 출석만 본다.
--     ledger_less_days 가 1 이상이면 직접 INSERT 의심. 보너스를 받은 달이면 편취 확정에 가깝다
--     (got_bonus=true). 일일 적립 실패(best-effort) 로그와 대조해 오탐을 거른다.
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
 limit 200;

-- (f) created_at 의 KST 일자가 checked_date 와 다른 행(보조 판정).
--     정상 행은 KST 오늘 일자를 계산한 직후 INSERT 하므로 created_at 이 그 날 KST 00:00 ~
--     다음 날 00:00 사이다(자정 경계 요청 지연 5분 허용). 과거 일자를 나중에 넣으면 어긋난다.
--     한계: 0032 전에는 authenticated 가 created_at 컬럼도 INSERT 할 수 있었으므로 공격자가
--     created_at 을 맞췄다면 여기서는 안 잡힌다 → (e) 가 1차 판정.
select a.user_id, a.checked_date, a.month_key, a.created_at,
       (a.created_at at time zone 'Asia/Seoul') as created_at_kst
  from public.attendances a
 where a.created_at <  (a.checked_date::timestamp at time zone 'Asia/Seoul')
    or a.created_at >= ((a.checked_date + 1)::timestamp at time zone 'Asia/Seoul')
                       + interval '5 minutes'
 order by a.created_at desc
 limit 500;

-- ---------------------------------------------------------------------
-- [7] review_likes·likes_count 불일치
--     actual_likes > likes_count : RPC 를 거치지 않은 review_likes 직접 INSERT 흔적.
--     likes_count > actual_likes : reviews.likes_count 직접 UPDATE(조작) 흔적(0032 전
--                                  reviews_own_all 은 본인 후기의 모든 컬럼 UPDATE 허용).
-- ---------------------------------------------------------------------
select r.id as review_id, r.user_id, r.likes_count,
       count(rl.id) as actual_likes,
       r.likes_count - count(rl.id) as inflated_by
  from public.reviews r
  left join public.review_likes rl on rl.review_id = r.id
 group by r.id, r.user_id, r.likes_count
having r.likes_count <> count(rl.id)
 order by abs(r.likes_count - count(rl.id)) desc
 limit 200;

-- 조치 템플릿(주석 — 결과 검토 후 수동 실행): 실제 like 행 수로 재계산.
--   update public.reviews r
--      set likes_count = x.cnt
--     from (select r2.id, count(rl.id) as cnt
--             from public.reviews r2
--             left join public.review_likes rl on rl.review_id = r2.id
--            group by r2.id) x
--    where x.id = r.id
--      and r.likes_count <> x.cnt;

-- ---------------------------------------------------------------------
-- [8] 악용 흔적 — photos storage_key/thumb_key 바꿔치기(타인 경로 참조)
--     키 규약: `{user_id}/{project_id}/{photo_id}.{ext}` (photos/sign-upload·complete 가
--     `${user.id}/${projectId}/` prefix 를 강제, copy-to-project·gift 수령 복사도 동일).
--     첫 세그먼트가 프로젝트 소유자와 다르면 의심이다.
--     예외: 선물 수령 시 storage 복사가 실패하면 **원본(발신자) 키를 그대로 참조**하는
--     폴백이 있다(app/api/gifts/[token]/route.ts). via_gift_fallback=true 는 정상일 수
--     있다. 선물의 재선물(2단계)이면 키 소유자가 직전 발신자가 아닐 수 있어 false 로
--     보일 수 있으니, false 행은 gifts 이력과 대조해 판정한다.
-- ---------------------------------------------------------------------
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
 limit 500;

-- ---------------------------------------------------------------------
-- [9] 악용 흔적 — reviews 직접 쓰기(라우트 검증 우회)
--     라우트 규약: 본인 주문 + status in (shipped, delivered), image_keys 첫 세그먼트 =
--     작성자 user_id, 최대 3장, body ≤ 2000자. 이를 어긴 행은 PostgREST 직접 쓰기 흔적이다.
-- ---------------------------------------------------------------------
-- (a) 타인 이미지 키 참조 — **필수 조치 대상**.
--     0032 는 기존 행을 고치지 않는다. 이런 행이 남아 있으면 작성자가 자기 후기를
--     DELETE 할 때 라우트가 service_role 로 그 키들을 storage 에서 remove 하므로
--     **적용 후에도 타인 이미지 삭제가 가능**하고, 공개 갤러리가 타인 이미지를 계속 서명한다.
--     0032 적용 직전/직후 아래 템플릿으로 타인 키를 배열에서 제거한다(이미지 파일 자체는
--     건드리지 않음 — 원 소유자 후기에서 계속 쓰인다).
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
 order by r.updated_at desc;

-- 조치 템플릿(주석 — 결과 검토 후 수동 실행): 작성자 폴더가 아닌 키를 배열에서 제거.
--   update public.reviews r
--      set image_keys = coalesce(
--            (select array_agg(k.image_key order by k.ord)
--               from unnest(r.image_keys) with ordinality as k(image_key, ord)
--              where k.image_key is not null
--                and split_part(k.image_key, '/', 1) = r.user_id::text),
--            '{}'::text[])
--    where exists (
--            select 1 from unnest(r.image_keys) as k(image_key)
--             where k.image_key is null
--                or split_part(k.image_key, '/', 1) <> r.user_id::text);

-- (b) 주문 소유자 불일치 / 후기 불가 상태 주문에 달린 후기.
--     owner_mismatch=true 는 타인 주문 슬롯 선점(order_id UNIQUE 라 피해자가 후기를 못 씀)
--     또는 가짜 후기다 → 운영자 판단(비공개 전환 또는 삭제). 삭제는 데이터 변경이므로 승인 후.
--     status_not_reviewable=true 만 있는 행은 작성 후 환불/취소 등으로 상태가 바뀐 정상
--     후기일 수도 있다 → 작성 시각(created_at)과 주문 상태 변경 이력을 대조.
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
 order by owner_mismatch desc, r.created_at desc;

-- 조치 템플릿(주석 — 비파괴): 소유자 불일치 후기를 갤러리에서 숨긴다.
--   update public.reviews r
--      set public = false
--     from public.orders o
--    where o.id = r.order_id
--      and o.user_id <> r.user_id
--      and r.public;

-- (c) 라우트 한도 위반(장수 > 3, body > 2000자) — 직접 쓰기 흔적(보조).
select r.id as review_id, r.user_id,
       cardinality(r.image_keys)  as image_count,
       char_length(r.body)        as body_chars,
       r.created_at, r.updated_at
  from public.reviews r
 where cardinality(r.image_keys) > 3
    or char_length(r.body) > 2000
 order by r.updated_at desc;

-- ---------------------------------------------------------------------
-- [10] 악용 흔적 — reviews 버킷 사용자 세션 직접 업로드
--     앱은 후기 이미지를 service_role 로만 업로드하므로 업로더(owner)가 비어 있어야 한다.
--     uploader 가 채워진 객체는 reviews_storage_owner_all 로 직접 올린 것(MIME·크기·
--     레이트리밋 검증 우회)이다. storage 스키마 버전에 따라 owner(uuid)/owner_id(text)
--     컬럼명이 달라 to_jsonb 로 둘 다 읽는다.
--     referenced_by_review=true 면 후기에 붙어 갤러리로 배포 중일 수 있다 → 내용 확인.
-- ---------------------------------------------------------------------
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
 limit 500;

-- ---------------------------------------------------------------------
-- [11] 악용 흔적 — photo-originals/photo-thumbs 사용자 세션 직접 쓰기
--     0004 의 photo_originals_user_insert/update/delete, photo_thumbs_user_delete 로 로그인
--     사용자가 anon 키 + JWT 로 본인 폴더 객체를 직접 올리거나, upsert 로 덮어쓰거나, 지울 수 있었다.
--     정상 경로:
--       업로드 — photos/sign-upload 가 service_role 로 서명 업로드 URL 발급(upsert=false 토큰) →
--               브라우저 PUT → photos/complete 가 service_role 로 내려받아 매직 바이트(SEC-1)·sharp
--               검증 후 같은 키에 정규화 원본 재업로드 + 썸네일 업로드 → photos INSERT.
--       복사   — copy-to-project·선물 수령: service_role storage copy, 행 값(mime/size_bytes)은 원본 행 복사.
--       삭제   — purge·abandon·orphan cron·계정 삭제: 전부 service_role.
--     악용 패턴: complete 검증이 끝난 원본을 같은 키로 덮어써 검증되지 않은 바이트를 PDF 빌드
--     (lib/pdf/photos.ts, 재검증 없음)에 넣거나, 결제 후 원본을 지워 편집 잠금·인쇄 원본 보존 우회.
--     **필수 조치(c)(d) 결과가 1건 이상일 때**: 해당 photo 를 쓰는 주문(order_statuses)의 PDF 빌드·
--     출고를 보류하고 원본을 확인한다(복구는 사용자 재업로드 또는 백업). 데이터 변경은 승인 후 별도.
-- ---------------------------------------------------------------------
-- (a) 판정 기준 보정 — 버킷별 uploader(owner) 채움 분포.
--     서명 업로드(토큰 발급자 service_role)·service_role 업로드는 owner 가 비어 있는 것이 기대값이다.
--     with_uploader 가 objects 에 가깝게 크면 이 storage 버전에서는 (b) 기준이 맞지 않는다
--     → (c)(d) 만으로 판정한다.
select o.bucket_id,
       count(*) as objects,
       count(*) filter (
         where coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') is not null
       ) as with_uploader
  from storage.objects o
 where o.bucket_id in ('photo-originals', 'photo-thumbs')
 group by o.bucket_id
 order by o.bucket_id;

-- (b) 사용자 JWT 로 직접 쓴 객체 — uploader 가 채워진 원본·썸네일.
--     referenced=false: photos 가 참조하지 않는 임의 업로드(크기·MIME·레이트리밋 우회). 24h 뒤
--       orphan-photos cron 이 원본 버킷의 {user}/{project}/ 아래만 정리하므로 남아 있을 수 있다.
--     referenced=true : 앱이 쓰는 객체를 사용자가 덮어쓴 것 → (c) 와 대조.
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
 limit 500;

-- (c) 검증 뒤 원본 바꿔치기 — photos 행 기록값과 원본 객체 불일치. **1차 판정.**
--     complete 는 검증·정규화한 버퍼를 올린 뒤 그 버퍼 길이(size_bytes)와 판정 포맷(mime)을 행에
--     기록하고 행을 나중에 INSERT 한다. 복사 경로는 원본 행 값을 옮긴다. 따라서 정상 행은
--     객체 size = size_bytes, 객체 mimetype = mime, 객체 updated_at ≤ 행 created_at 이다.
--       size_mismatch / mime_mismatch : 행 기록 뒤 다른 바이트로 덮어씀.
--       overwritten_after_row         : 행 INSERT 보다 5분 넘게 뒤에 객체가 갱신됨(uploader 와 함께 본다).
--     한계: SEC-1 이전 complete 가 size_bytes/mime 을 클라 값으로 기록한 오래된 행은 mismatch 만으로
--     오탐일 수 있다(overwritten_after_row=false 인 오래된 행) → photo_created_at 으로 걸러 본다.
--     선물 수령 복사 실패 폴백 행은 발신자 객체를 가리키므로 발신자 행과 같은 결과가 함께 나온다.
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
 limit 500;

-- (d) 직접 삭제 흔적 — 활성(deleted_at IS NULL) photos 행이 가리키는 원본·썸네일 객체가 없다.
--     앱은 활성 행의 객체를 지우지 않는다(purge 는 휴지통 행만, 프로젝트 삭제는 행 cascade 뒤
--     orphan cron 이 정리). order_statuses 에 paid/in_production 등이 있으면 인쇄 원본 유실이므로 우선.
--     한계: 선물 수령 폴백 행은 발신자 객체를 가리키므로, 발신자가 그 사진을 영구 삭제하면 정상 흐름에서도
--     original_missing=true 가 될 수 있다 → 키 첫 세그먼트가 project_owner_id 와 다른 행은 gifts 이력과 대조.
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
 limit 500;
