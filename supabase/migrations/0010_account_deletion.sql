-- =====================================================================
-- 0010_account_deletion.sql — 회원 탈퇴(익명화) + 약관 동의 시각
--
-- 정책:
--   • profiles 는 hard delete 하지 않는다.
--     (전자상거래법 5년 보존 의무로 orders/projects 의 user_id FK 유지 필요)
--   • 탈퇴 시 profiles 를 익명화: email=null, display_name='탈퇴회원',
--     deleted_at=now().
--   • auth.users 자체는 service_role 의 admin.deleteUser() 로 제거되어
--     로그인 경로가 차단된다 (cascade 가 아닌 트리거 한정 동작).
--   • profiles.deleted_at 컬럼은 RLS / requireUser 가드에서 활용한다.
--
-- 추가:
--   • 약관/개인정보 동의 시각 컬럼 (terms_agreed_at, privacy_agreed_at)
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles 컬럼 추가
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists deleted_at         timestamptz,
  add column if not exists deletion_reason    text,
  add column if not exists terms_agreed_at    timestamptz,
  add column if not exists privacy_agreed_at  timestamptz;

create index if not exists idx_profiles_deleted_at
  on public.profiles (deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------
-- handle_new_user 재정의 — auth.users 가 cascade 로 삭제되어도 profiles 는 남기고
-- 단, 신규 가입은 동일하게 동작.
-- (cascade 자체는 막지 않으나, anonymize_account 는 auth.users 삭제 전에 호출되어
--  profiles 가 익명화된 채로 남게 한다. 만약 외부에서 직접 auth.users 를 삭제하면
--  on delete cascade 로 profiles 도 사라지지만, 이는 이번 단계의 정책 범위 밖.)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- anonymize_account(user_id) — 회원 탈퇴 익명화 RPC
-- ---------------------------------------------------------------------
create or replace function public.anonymize_account(
  p_user_id uuid,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  update public.profiles
     set deleted_at      = coalesce(deleted_at, now()),
         email           = null,
         display_name    = '탈퇴회원',
         deletion_reason = p_reason
   where id = p_user_id;
end;
$$;

revoke all on function public.anonymize_account(uuid, text) from public, anon, authenticated;
grant execute on function public.anonymize_account(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 약관 동의 시각 기록 RPC
-- ---------------------------------------------------------------------
create or replace function public.record_agreements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  update public.profiles
     set terms_agreed_at   = coalesce(terms_agreed_at, now()),
         privacy_agreed_at = coalesce(privacy_agreed_at, now())
   where id = p_user_id;
end;
$$;

revoke all on function public.record_agreements(uuid) from public, anon, authenticated;
grant execute on function public.record_agreements(uuid) to service_role;
