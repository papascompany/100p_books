-- =====================================================================
-- 0016_share_tokens.sql — 프로젝트 비로그인 공개 공유 링크 (M16-1)
--
-- 사용 사례:
--   - 소유자가 토큰을 발급해 가족/지인에게 URL 한 줄로 미리보기 공유.
--   - 만료 시각(expires_at) 미설정 시 무기한, 설정 시 만료 후 anon 조회 차단.
--   - 조회 시 view_count 를 atomic 으로 증가 (RPC: public.increment_share_view).
--
-- 보안 모델:
--   - 발급/삭제는 프로젝트 소유자만 (RLS using check 로 projects.user_id = auth.uid()).
--   - 조회(SELECT) 는 anon/authenticated 누구나 가능 (URL 의 token 자체가 capability).
--   - 만료 / 비활성 검증은 anon SELECT 후 라우트 레이어에서 수행.
-- =====================================================================

create table if not exists public.share_tokens (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  token       uuid not null default gen_random_uuid() unique,
  expires_at  timestamptz,
  view_count  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_share_tokens_project
  on public.share_tokens (project_id, created_at desc);

create index if not exists idx_share_tokens_token
  on public.share_tokens (token);

-- ---------------------------------------------------------------------
-- view_count atomic 증가 RPC
-- ---------------------------------------------------------------------
create or replace function public.increment_share_view(token_val uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  update public.share_tokens
     set view_count = view_count + 1
   where token = token_val
   returning view_count into new_count;
  return new_count;
end;
$$;

grant execute on function public.increment_share_view(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.share_tokens enable row level security;

-- 프로젝트 소유자만 토큰 발급/삭제/조회·관리
drop policy if exists "share_tokens_owner_all" on public.share_tokens;
create policy "share_tokens_owner_all" on public.share_tokens
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = share_tokens.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = share_tokens.project_id
        and p.user_id = auth.uid()
    )
  );

-- 누구나 토큰으로 SELECT 가능 (anon 포함)
-- 라우트 레이어에서 expires_at / view_count 검증.
drop policy if exists "share_tokens_public_read" on public.share_tokens;
create policy "share_tokens_public_read" on public.share_tokens
  for select
  to anon, authenticated
  using (true);
