-- =====================================================================
-- 0025_site_content.sql — 사이트 콘텐츠 CMS
--
-- 목적:
--   랜딩/공통(헤더·푸터) 등의 이미지·문구·링크를 관리자가 코드 배포 없이
--   직접 수정할 수 있게 한다. key-value(jsonb) 단일 테이블.
--
-- 설계:
--   site_content
--     key   text PK  — 'home.hero' | 'home.stats' | 'home.features' |
--                      'home.sizes' | 'home.gallery' | 'home.cta' |
--                      'footer' | 'header' ...
--     value jsonb    — 섹션별 구조화 콘텐츠 (lib/content/types.ts 참조)
--
-- 보안:
--   - SELECT 공개(anon 포함) — 랜딩이 콘텐츠를 읽어야 함.
--   - INSERT/UPDATE/DELETE 는 admin 만 (public.is_admin()).
--   - 값 자체는 공개 콘텐츠이므로 민감정보 저장 금지.
--
-- Storage:
--   site-assets (public) — 관리자가 업로드한 이미지. 경로 {section}/{uuid}.{ext}
--     읽기 공개(랜딩 <img>), 쓰기 service_role(관리자 라우트).
-- =====================================================================

create table if not exists public.site_content (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

alter table public.site_content enable row level security;

drop policy if exists "site_content_public_read" on public.site_content;
create policy "site_content_public_read" on public.site_content
  for select using (true);

drop policy if exists "site_content_admin_write" on public.site_content;
create policy "site_content_admin_write" on public.site_content
  for all using (public.is_admin()) with check (public.is_admin());

-- updated_at 자동 갱신
create or replace function public.site_content_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_content_touch_trg on public.site_content;
create trigger site_content_touch_trg
  before update on public.site_content
  for each row execute function public.site_content_touch();

-- ---------------------------------------------------------------------
-- Storage 버킷 — site-assets (public read)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

-- 공개 읽기 (이미 public 버킷이지만 명시)
drop policy if exists "site_assets_public_read" on storage.objects;
create policy "site_assets_public_read" on storage.objects
  for select using (bucket_id = 'site-assets');

-- 쓰기는 admin 만 (관리자 라우트는 service_role 로 업로드하지만, 직접 인증 호출 대비)
drop policy if exists "site_assets_admin_write" on storage.objects;
create policy "site_assets_admin_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_admin());

drop policy if exists "site_assets_admin_update" on storage.objects;
create policy "site_assets_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());

drop policy if exists "site_assets_admin_delete" on storage.objects;
create policy "site_assets_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());

comment on table public.site_content is
  '사이트 CMS — 랜딩/공통 섹션 이미지·문구·링크. SELECT 공개, 쓰기 admin.';
