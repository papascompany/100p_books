-- =====================================================================
-- 0002_rls.sql — Row Level Security 정책
-- 규칙 요약:
--   profiles      : 본인 SELECT/UPDATE
--   projects      : user_id = auth.uid() 만 CRUD
--   photos/pages  : 소유 project 를 가진 유저만 CRUD
--   book_sizes    : 누구나 SELECT (active), admin 만 쓰기
--   resources     : 누구나 SELECT (active), admin 만 쓰기
--   orders        : 본인 SELECT, 서버(service_role) 만 INSERT/UPDATE
-- =====================================================================

-- ---------------------------------------------------------------------
-- is_admin() 헬퍼 — profiles.role = 'admin' 여부
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;

-- =====================================================================
-- profiles
-- =====================================================================
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- =====================================================================
-- book_sizes
-- =====================================================================
alter table public.book_sizes enable row level security;

drop policy if exists "book_sizes_select_active" on public.book_sizes;
create policy "book_sizes_select_active" on public.book_sizes
  for select using (active = true or public.is_admin());

drop policy if exists "book_sizes_admin_write" on public.book_sizes;
create policy "book_sizes_admin_write" on public.book_sizes
  for all using (public.is_admin())
  with check (public.is_admin());

-- =====================================================================
-- projects
-- =====================================================================
alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- =====================================================================
-- photos (project 소유권 기반)
-- =====================================================================
alter table public.photos enable row level security;

drop policy if exists "photos_select_own" on public.photos;
create policy "photos_select_own" on public.photos
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = photos.project_id
        and (p.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "photos_insert_own" on public.photos;
create policy "photos_insert_own" on public.photos
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = photos.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "photos_update_own" on public.photos;
create policy "photos_update_own" on public.photos
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = photos.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = photos.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "photos_delete_own" on public.photos;
create policy "photos_delete_own" on public.photos
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = photos.project_id
        and p.user_id = auth.uid()
    )
  );

-- =====================================================================
-- pages (project 소유권 기반)
-- =====================================================================
alter table public.pages enable row level security;

drop policy if exists "pages_select_own" on public.pages;
create policy "pages_select_own" on public.pages
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = pages.project_id
        and (p.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "pages_insert_own" on public.pages;
create policy "pages_insert_own" on public.pages
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = pages.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "pages_update_own" on public.pages;
create policy "pages_update_own" on public.pages
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = pages.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = pages.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "pages_delete_own" on public.pages;
create policy "pages_delete_own" on public.pages
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = pages.project_id
        and p.user_id = auth.uid()
    )
  );

-- =====================================================================
-- resources
-- =====================================================================
alter table public.resources enable row level security;

drop policy if exists "resources_select_active" on public.resources;
create policy "resources_select_active" on public.resources
  for select using (active = true or public.is_admin());

drop policy if exists "resources_admin_write" on public.resources;
create policy "resources_admin_write" on public.resources
  for all using (public.is_admin())
  with check (public.is_admin());

-- =====================================================================
-- orders
--   일반 사용자: 본인 주문만 SELECT
--   INSERT/UPDATE 는 service_role (RLS 우회) 에서만 — 별도 policy 생략
--   admin 은 전체 SELECT 허용
-- =====================================================================
alter table public.orders enable row level security;

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id or public.is_admin());

-- 일반 유저에게 INSERT/UPDATE/DELETE 정책을 의도적으로 부여하지 않음.
-- service_role 키를 사용하는 서버 루트에서만 쓰기 가능.
