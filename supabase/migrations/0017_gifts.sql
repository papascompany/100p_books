-- =====================================================================
-- 0017_gifts.sql — 선물하기 (M16-2)
--
-- 사용 사례:
--   결제 완료된 주문(또는 이미 발송된 책)을 다른 사용자에게 "선물" 한다.
--   gift_token (uuid) 자체가 capability 로, 발신자가 수신자에게 URL 을 전달.
--   수신자가 로그인 후 토큰 페이지에 접근하면 프로젝트(+pages, +cover_json) 가
--   자기 계정으로 클론된다.
--
-- 보안 모델:
--   - 발신자(sender_id = auth.uid())는 자기 선물 INSERT/SELECT/UPDATE 가능.
--   - 수령(claim) 처리는 service_role 키를 사용하는 라우트(`POST /api/gifts/[token]`)
--     에서만 수행 — 토큰 검증 후 새 project 를 INSERT 하고 status='claimed' 마킹.
--   - SELECT 정책은 authenticated 전체 허용 (라우트에서 토큰 일치 검증).
--     anon 차단 — 로그인 후에만 수령 가능하도록 강제.
--
-- 만료:
--   기본 30일. 만료 후 라우트에서 status='expired' 마킹 + 410 응답.
--
-- 사진 처리:
--   photos 는 클론하지 않고 동일 storage_key 를 참조하는 새 행을 INSERT 한다
--   (storage 객체는 발신자 폴더에 그대로) — 발신자가 원본을 삭제하면 깨짐.
--   M16-2 는 단순 공유 정책으로 시작하고, 후속 마이그레이션에서 참조 카운트로
--   확장 가능. (route 단에서 admin storage.copy 를 도입할 수도 있음.)
-- =====================================================================

create type gift_status as enum ('pending', 'claimed', 'expired');

create table if not exists public.gifts (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  sender_id        uuid not null references auth.users(id) on delete cascade,
  recipient_email  text not null,
  message          text,
  gift_token       uuid not null default gen_random_uuid() unique,
  status           gift_status not null default 'pending',
  /** 수령(claim) 시 생성된 새 프로젝트 id — 멱등 응답 + 발신자 진행 상황 추적 */
  claimed_project_id uuid references public.projects(id) on delete set null,
  claimed_at       timestamptz,
  expires_at       timestamptz not null default (now() + interval '30 days'),
  created_at       timestamptz not null default now()
);

create index if not exists gifts_sender_id_idx on public.gifts(sender_id);
create index if not exists gifts_gift_token_idx on public.gifts(gift_token);
create index if not exists gifts_order_id_idx on public.gifts(order_id);
create index if not exists gifts_recipient_email_idx on public.gifts(recipient_email);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.gifts enable row level security;

-- 발신자: 자기 선물 전부 (CRUD) — claim 시점에는 service_role 가 처리하므로
-- 일반 UPDATE 는 허용해도 거의 사용되지 않음.
drop policy if exists "gifts_sender_all" on public.gifts;
create policy "gifts_sender_all" on public.gifts
  for all
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- 인증 사용자 SELECT — 라우트에서 토큰을 직접 검증한다.
-- (anon 은 차단; 수령은 반드시 로그인 후 가능.)
drop policy if exists "gifts_recipient_select" on public.gifts;
create policy "gifts_recipient_select" on public.gifts
  for select
  to authenticated
  using (true);
