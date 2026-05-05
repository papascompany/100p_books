-- =====================================================================
-- 0001_init.sql — 100p_books 초기 스키마
-- 테이블: profiles, book_sizes, projects, photos, pages, resources, orders
-- =====================================================================

-- 확장
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- updated_at 자동 갱신 공용 트리거 함수
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- profiles — auth.users 확장 (role 포함)
-- =====================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'user' check (role in ('user', 'admin')),
  display_name text,
  created_at  timestamptz not null default now()
);

-- auth.users 에 새 유저가 생성되면 profiles 행을 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- book_sizes — 책 사이즈 (관리자 CRUD)
-- =====================================================================
create table if not exists public.book_sizes (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  width_mm                 int  not null,
  height_mm                int  not null,
  cover_width_mm           int  not null,
  cover_height_mm          int  not null,
  spine_formula_per_page   numeric not null default 0.09,
  active                   boolean not null default true,
  display_order            int not null default 0,
  created_at               timestamptz not null default now()
);

create index if not exists idx_book_sizes_active_order
  on public.book_sizes (active, display_order);

-- =====================================================================
-- projects — 사용자 포토북 프로젝트
-- =====================================================================
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  book_size_id  uuid not null references public.book_sizes(id),
  title         text not null default 'Untitled',
  status        text not null default 'draft'
                check (status in ('draft', 'ordered')),
  cover_json    jsonb,
  layout_mode   text not null default 'polaroid'
                check (layout_mode in ('polaroid', 'collage')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_projects_user_id on public.projects (user_id);
create index if not exists idx_projects_user_updated
  on public.projects (user_id, updated_at desc);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- =====================================================================
-- photos — 업로드된 사진 메타
-- =====================================================================
create table if not exists public.photos (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  storage_key    text not null,
  thumb_key      text,
  filename       text,
  mime           text,
  size_bytes     bigint,
  width          int,
  height         int,
  exif_taken_at  timestamptz,
  exif_camera    text,
  order_idx      int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_photos_project_order
  on public.photos (project_id, order_idx);
create index if not exists idx_photos_project_taken
  on public.photos (project_id, exif_taken_at);

-- =====================================================================
-- pages — 내지 페이지 (Fabric JSON)
-- =====================================================================
create table if not exists public.pages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  page_no      int  not null,
  layout_mode  text not null default 'polaroid'
               check (layout_mode in ('polaroid', 'collage')),
  fabric_json  jsonb,
  created_at   timestamptz not null default now(),
  unique (project_id, page_no)
);

create index if not exists idx_pages_project_pageno
  on public.pages (project_id, page_no);

-- =====================================================================
-- resources — 관리자 업로드 폰트/클립아트/배경
-- =====================================================================
create table if not exists public.resources (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('font', 'clipart', 'background')),
  name         text not null,
  storage_key  text not null,
  meta         jsonb,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_resources_type_active
  on public.resources (type, active);

-- =====================================================================
-- orders — 주문
-- =====================================================================
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id),
  user_id            uuid not null references public.profiles(id),
  qty                int  not null default 1,
  amount             int  not null,
  address            jsonb not null,
  status             text not null default 'pending'
                     check (status in (
                       'pending', 'paid', 'in_production',
                       'shipped', 'delivered', 'cancelled', 'refunded'
                     )),
  toss_payment_key   text,
  toss_order_id      text,
  cover_pdf_key      text,
  interior_pdf_key   text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_orders_user_id on public.orders (user_id);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_user_created
  on public.orders (user_id, created_at desc);
create index if not exists idx_orders_toss_payment_key
  on public.orders (toss_payment_key);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
