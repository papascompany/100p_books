-- 0024_user_dashboard_counts.sql
-- 목적: /mypage 첫 진입 시 4개 카운트(orders / projects-photos-active / projects-photos-trash / projects)를
--      한 번의 RTT 로 가져온다. 기존 2단계(projects.id 조회 → photos count 2회) → 1단계.
--
-- 사용:
--   select * from public.get_user_dashboard_counts('UUID');
--   응답: { order_count, project_count, active_photo_count, trash_photo_count }
--
-- 보안:
--   SECURITY DEFINER + p_user_id 인자 명시. 호출 측은 service_role 가 자신의 인증된
--   user.id 를 직접 전달한다 (page.tsx 의 requireUser() 결과). RLS 우회되지만
--   p_user_id 가 호출자 본인일 때만 의미가 있으므로 라우트에서 검증 끝난 후만 호출.

create or replace function public.get_user_dashboard_counts(p_user_id uuid)
returns table (
  order_count        integer,
  project_count      integer,
  active_photo_count integer,
  trash_photo_count  integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with my_projects as (
    select id from public.projects where user_id = p_user_id
  ),
  my_orders as (
    select id from public.orders where user_id = p_user_id
  )
  select
    (select count(*)::int from my_orders) as order_count,
    (select count(*)::int from my_projects) as project_count,
    (
      select count(*)::int
        from public.photos p
       where p.project_id in (select id from my_projects)
         and p.deleted_at is null
    ) as active_photo_count,
    (
      select count(*)::int
        from public.photos p
       where p.project_id in (select id from my_projects)
         and p.deleted_at is not null
    ) as trash_photo_count;
end;
$$;

-- service_role 만 실행 가능. anon/authenticated 직접 호출 차단.
revoke all on function public.get_user_dashboard_counts(uuid) from public;
revoke all on function public.get_user_dashboard_counts(uuid) from anon;
revoke all on function public.get_user_dashboard_counts(uuid) from authenticated;
grant execute on function public.get_user_dashboard_counts(uuid) to service_role;

comment on function public.get_user_dashboard_counts is
  '마이페이지 카드 카운트 4종을 단일 트랜잭션에서 반환. service_role 만 호출.';
