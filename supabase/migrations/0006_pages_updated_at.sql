-- =====================================================================
-- 0006_pages_updated_at.sql — pages.updated_at + 자동 갱신 트리거
-- M3 fabric-editor 가 페이지를 PATCH 할 때 마지막 편집 시각을 추적할 수 있어야 한다.
-- 단순 컬럼 추가 + set_updated_at() 공용 트리거 부착.
-- =====================================================================

alter table public.pages
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_pages_updated_at on public.pages;
create trigger trg_pages_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();
