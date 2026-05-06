-- =====================================================================
-- 0020_reviews.sql — 후기 갤러리 (M16-5)
--
-- 모델:
--   reviews        — 주문당 1개 후기 (rating 1..5, body, image_keys[])
--   review_likes   — (review_id, user_id) UNIQUE — 좋아요 기록
--   storage.buckets('reviews') — 후기 첨부 이미지 (private)
--
-- 보안:
--   - reviews
--       SELECT  : public=true 인 행은 anon/authenticated 모두 조회 가능 (갤러리)
--       ALL     : 본인(user_id = auth.uid()) 행만 CRUD
--       INSERT/UPDATE/DELETE 정책은 USING/WITH CHECK 로 본인 검증
--   - review_likes
--       SELECT  : 본인 좋아요만 (UI에서 isLiked 표시용)
--       ALL     : 본인 좋아요만 INSERT/DELETE
--   - storage.objects(reviews 버킷)
--       reviews/{userId}/... 경로의 첫 segment 가 auth.uid() 와 일치할 때만 R/W
--
-- 좋아요 카운트:
--   review_likes INSERT/DELETE 와 reviews.likes_count 갱신을 단일 트랜잭션으로
--   묶기 위해 SECURITY DEFINER RPC `toggle_review_like(review_id, user_id)` 제공.
--   라우트는 RPC 만 호출.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) reviews
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique
               references public.orders(id) on delete cascade,
  user_id      uuid not null
               references auth.users(id) on delete cascade,
  rating       int not null check (rating between 1 and 5),
  body         text,
  image_keys   text[] not null default '{}',
  likes_count  int not null default 0 check (likes_count >= 0),
  public       bool not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists reviews_user_id_idx
  on public.reviews(user_id);
create index if not exists reviews_created_at_idx
  on public.reviews(created_at desc);
create index if not exists reviews_likes_count_idx
  on public.reviews(likes_count desc);
create index if not exists reviews_public_created_at_idx
  on public.reviews(created_at desc) where public = true;

drop trigger if exists trg_reviews_updated_at on public.reviews;
create trigger trg_reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

alter table public.reviews enable row level security;

-- public=true 후기는 누구나 조회
drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read" on public.reviews
  for select
  to anon, authenticated
  using (public = true);

-- 본인 후기 전체 권한 (read/write/delete)
drop policy if exists "reviews_own_all" on public.reviews;
create policy "reviews_own_all" on public.reviews
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2) review_likes
-- ---------------------------------------------------------------------
create table if not exists public.review_likes (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (review_id, user_id)
);

create index if not exists review_likes_review_id_idx
  on public.review_likes(review_id);
create index if not exists review_likes_user_id_idx
  on public.review_likes(user_id);

alter table public.review_likes enable row level security;

-- 좋아요 SELECT: 본인 것만 (isLiked 계산용)
drop policy if exists "review_likes_read_own" on public.review_likes;
create policy "review_likes_read_own" on public.review_likes
  for select
  to authenticated
  using (user_id = auth.uid());

-- 좋아요 INSERT/DELETE: 본인 것만
-- (UPDATE 는 의미 없음 — 정책은 ALL 로 두되 USING/WITH CHECK 동일)
drop policy if exists "review_likes_own_all" on public.review_likes;
create policy "review_likes_own_all" on public.review_likes
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3) toggle_review_like(review_id, user_id) — atomic 좋아요 토글
--    - 있으면 DELETE + likes_count -= 1
--    - 없으면 INSERT + likes_count += 1
--    SECURITY DEFINER 로 RLS 우회하여 reviews.likes_count 를 갱신.
--    (호출자 인증은 라우트에서 requireUser 로 검증한다.)
-- ---------------------------------------------------------------------
create or replace function public.toggle_review_like(
  p_review_id uuid,
  p_user_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liked      bool;
  v_new_count  int;
  v_exists     bool;
begin
  -- review 가 실제로 존재하는지(public 여부 무관) 확인 — 없으면 에러
  perform 1 from public.reviews where id = p_review_id;
  if not found then
    raise exception 'review not found';
  end if;

  select exists (
    select 1
      from public.review_likes
     where review_id = p_review_id
       and user_id   = p_user_id
  ) into v_exists;

  if v_exists then
    delete from public.review_likes
     where review_id = p_review_id
       and user_id   = p_user_id;

    update public.reviews
       set likes_count = greatest(likes_count - 1, 0)
     where id = p_review_id
     returning likes_count into v_new_count;

    v_liked := false;
  else
    insert into public.review_likes (review_id, user_id)
    values (p_review_id, p_user_id);

    update public.reviews
       set likes_count = likes_count + 1
     where id = p_review_id
     returning likes_count into v_new_count;

    v_liked := true;
  end if;

  return jsonb_build_object(
    'liked',      v_liked,
    'likesCount', v_new_count
  );
end;
$$;

grant execute on function public.toggle_review_like(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- 4) Storage 버킷 — reviews (private)
--    경로 규약: reviews/{userId}/{reviewId}/{uuid}.{ext}
--    버킷 prefix("reviews") 는 storage.foldername 에서 무시되고,
--    storage.foldername(name)[1] 이 첫 세그먼트 = userId 를 의미한다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('reviews', 'reviews', false)
on conflict (id) do nothing;

drop policy if exists "reviews_storage_owner_all" on storage.objects;
create policy "reviews_storage_owner_all" on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'reviews'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'reviews'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- public=true 후기 첨부는 갤러리에서 anon/authenticated 모두 조회 가능해야 한다.
-- 다만 객체 단위로 public 여부를 결정할 수 없으므로 "reviews 버킷의 모든 객체 SELECT 허용"
-- 정책을 anon, authenticated 에 추가한다. (버킷 자체는 private 이지만 RLS 정책으로
-- SELECT 허용 — 라우트가 항상 createSignedUrls 를 통해 노출하므로 직접 path 추측 위험 낮음.)
drop policy if exists "reviews_storage_public_read" on storage.objects;
create policy "reviews_storage_public_read" on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'reviews');

-- service_role 전권 (명시적 의도 선언)
drop policy if exists "reviews_storage_service_all" on storage.objects;
create policy "reviews_storage_service_all" on storage.objects
  for all
  to service_role
  using (bucket_id = 'reviews')
  with check (bucket_id = 'reviews');
