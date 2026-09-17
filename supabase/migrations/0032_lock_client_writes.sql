-- =====================================================================
-- 0032_lock_client_writes.sql — 클라이언트(anon/authenticated) 직접 쓰기 표면 봉쇄 (보안)
--
-- 0031 이 SECURITY DEFINER 함수의 PUBLIC EXECUTE 와 토큰 테이블 전체 공개 SELECT 를
-- 닫았다. 이 마이그레이션은 **테이블 쓰기(INSERT/UPDATE/DELETE)** 표면을 좁힌다.
--
-- 배경 — 왜 필요한가:
--   Supabase 는 public 스키마 테이블에 anon/authenticated/service_role 로 select·
--   insert·update·delete 권한을 **기본 부여**한다(공식: Data API 노출 기본값).
--   그래서 RLS 정책이 "본인 행만"으로 열려 있어도, 정책이 컬럼을 구분하지 않으면
--   로그인 사용자가 공개 anon 키 + 자기 JWT 로 PostgREST 를 직접 호출해
--   자기 행의 민감 컬럼을 바꾸거나, 앱이 service_role 로만 쓰는 테이블에 직접
--   행을 밀어 넣을 수 있다. anon 키는 브라우저 번들의 공개 값이다.
--
--   확인된 악용 표면(코드 근거는 docs/sql/0032-precheck.sql 주석 참조):
--     • profiles   — profiles_update_self 가 컬럼 무제한 UPDATE(auth.uid()=id).
--                    role='admin' 승격 / deleted_at=null 로 탈퇴 가드 해제 가능.
--                    앱은 profiles 를 **사용자 세션으로 쓰지 않는다**(전부 service_role).
--     • gifts      — gifts_sender_all 가 sender_id=auth.uid() 만 검사(order 소유 미검증).
--                    남의 order_id 로 gift 를 직접 INSERT → 토큰 획득 → 다른 계정으로
--                    수령하면 **타인의 결제 완료 포토북이 복제**된다(claim 라우트는
--                    order.user_id 와 sender_id 일치를 검증하지 않는다). 앱의 gift 발급은
--                    order 소유 검증 후 service_role 로만 INSERT 한다.
--     • attendances— attendances_insert_own 로 출석 행을 직접 INSERT 가능. /api/attendance/
--                    check 의 월 보너스(10일 +500P, cron 20일 +1000P)는 attendances COUNT 로
--                    판정하므로, 과거 일자 행을 다수 밀어 넣고 1회 호출하면 **보너스 편취**.
--                    앱은 출석 행을 service_role 로만 INSERT 한다.
--     • review_likes— review_likes_own_all 로 직접 INSERT 가능. 앱은 좋아요를 SECURITY
--                    DEFINER RPC(toggle_review_like)로만 처리한다. 직접 INSERT 는 카운트에
--                    반영되지 않아 영향은 경미하나, 사용되지 않는 쓰기 표면이라 함께 닫는다.
--     • photos     — photos_insert_own/photos_update_own 이 컬럼 무제한. storage_key/thumb_key
--                    를 **타인의 객체 경로**로 바꾸면(또는 그런 행을 INSERT 하면) 서버가
--                    service_role 로 서명 URL 발급·원본 다운로드(PDF)할 때 소유 prefix 를
--                    검증하지 않아 타인 사진에 접근할 수 있다. 앱의 photos INSERT/UPDATE 는
--                    전부 service_role 이고(complete/copy-to-project/trash/restore/gifts),
--                    사용자 세션은 DELETE(projects/[id] 삭제)만 쓴다 → INSERT/UPDATE 만 닫는다.
--     • reviews    — reviews_own_all 이 user_id=auth.uid() 만 검사(컬럼·키·주문 무제한).
--                    image_keys 를 **타인의 후기 이미지 키**(갤러리 서명 URL 경로에 노출)로
--                    바꾸면, 갤러리가 service_role 로 서명해 비공개 전환된 타인 이미지를
--                    읽고, 자기 후기를 DELETE 하면 라우트가 service_role 로 그 키를 remove 해
--                    **타인 이미지를 삭제**한다. 그 밖에 남의/미배송 주문에 후기 INSERT
--                    (타인 후기 슬롯 선점), likes_count·created_at 직접 조작이 가능했다.
--                    앱은 reviews 를 **사용자 세션으로 쓴다**(POST/PATCH/DELETE) → 회수 대신
--                    컬럼 grant + WITH CHECK 로 라우트 검증과 같은 조건만 허용한다.
--     • storage.objects(reviews 버킷) — reviews_storage_owner_all 로 본인 폴더에 직접
--                    업로드/삭제 가능(업로드 라우트의 MIME·크기·레이트리밋 우회). 앱의
--                    후기 이미지 업로드·삭제·서명은 전부 service_role 이다 → 정책 제거.
--     • storage.objects(photo-originals/photo-thumbs 버킷) — 0004 의 photo_originals_user_
--                    insert/update/delete, photo_thumbs_user_delete 로 로그인 사용자가 anon 키 +
--                    JWT 로 본인 폴더 객체를 직접 쓸 수 있었다. photos/complete 가 매직 바이트
--                    (SEC-1)·sharp 로 검증하고 정규화 원본을 재업로드한 **뒤에** 같은 키로
--                    upsert 하면 검증되지 않은 바이트(AVIF·GIF·초대형 파일 등)로 원본을 바꿔치기
--                    할 수 있고, PDF 빌드(lib/pdf/photos.ts)와 서명 URL 발급은 원본을 재검증 없이
--                    service_role 로 내려받는다. 결제 후 원본·썸네일 직접 삭제로 편집 잠금
--                    (DEBT-2)과 인쇄 원본 보존도 우회된다. 앱의 사진 업로드는 서명 업로드 URL
--                    (service_role 발급, storage-api 가 토큰 검증 후 RLS 없이 기록)이고, 다운로드·
--                    재업로드·복사·삭제는 전부 service_role 이다 → 사용자 세션 쓰기 정책 제거.
--
--   profiles/gifts/attendances/review_likes/photos(INSERT·UPDATE)/reviews·photo 버킷 객체는
--   해당 쓰기를 **앱이 사용자 세션으로 하지 않으므로**(admin=service_role, SECURITY DEFINER
--   RPC 또는 서명 업로드 토큰 경유), 사용자 세션 권한을 회수하고 쓰기 정책을 제거해도 앱
--   경로가 깨지지 않는다.
--   SELECT 권한은 건드리지 않는다.
--
--   projects/pages/share_tokens 와 photos 의 DELETE 는 앱이 사용자 세션으로 실제 쓰므로
--   여기서 회수하지 않는다(깨짐 방지). 이들의 잔여 위험(예: projects.status 직접 변경,
--   결제 후 pages 편집)은 컬럼 수준 grant 또는 라우트 이관이 필요하며, 앱 코드 수정을
--   동반하므로 별도로 다룬다.
--
-- 안전/멱등:
--   • 0031 의 revoke-then-grant 관례를 따른다(선 revoke, 후 필요한 role 에만 재부여).
--     회수 목록에는 PostgREST 로는 못 쓰지만 기본 grant 에 포함되는 TRUNCATE/REFERENCES/
--     TRIGGER 도 넣는다. SELECT 는 회수하지 않으므로 재부여할 것도 없다.
--   • drop policy if exists / create or replace / drop trigger if exists 로 재실행 안전.
--   • service_role 의 권한은 절대 회수하지 않는다(앱 admin 경로 보존).
--   • is_admin(), lookup_referral_code() 의 EXECUTE 와 모든 SELECT 정책은 건드리지 않는다.
-- =====================================================================

-- =====================================================================
-- (A) profiles — 사용자 세션 쓰기 전면 차단 + 민감 컬럼 트리거 이중 방어
-- =====================================================================
-- 앱은 profiles 를 service_role(createAdminSupabase) 로만 쓴다:
--   record_agreements / sync_oauth_profile / anonymize_account(모두 SECURITY DEFINER),
--   admin.from("profiles").update({role})(admin/users), ensureReferralCode(admin),
--   account-content-store.clearProfileIdentityFields(admin).
-- 사용자 세션(createServerSupabase)은 profiles 를 SELECT 만 한다
--   (requireActiveUser/requireAdmin/middleware/mypage). → 쓰기 회수는 무해하다.

-- 1) 사용자 세션 UPDATE 경로(정책) 제거.
drop policy if exists "profiles_update_self" on public.profiles;

-- 2) 테이블 권한 회수 — anon/authenticated 의 쓰기 권한 자체를 없앤다.
--    (컬럼 권한이 있으면 함께 회수된다. SELECT 는 유지.)
revoke insert, update, delete, truncate, references, trigger
  on table public.profiles from anon, authenticated;

-- 3) 이중 방어 — 설령 어떤 경로로 UPDATE 권한이 다시 열리더라도(기본 권한 재부여,
--    향후 정책 추가 등) 민감 컬럼 변경을 service_role 외에는 거부하는 트리거.
--    request 역할이 anon/authenticated 일 때만 검사한다. service_role 직접 쓰기
--    (current_user='service_role')와 SECURITY DEFINER RPC(current_user=함수 소유자
--    =postgres)는 그대로 통과하므로 앱 경로에 영향이 없다.
--
--    ⚠️ 트리거 함수 자신은 반드시 SECURITY INVOKER 여야 한다. PostgreSQL 에서
--    current_user 는 SECURITY DEFINER 함수 실행 중 함수 소유자로 바뀌므로, 이 함수를
--    definer 로 만들면 안의 current_user 가 항상 postgres 가 되어 검사가 절대 발동하지
--    않는다. invoker 면 PostgREST 요청(SET ROLE authenticated/anon)의 역할이 그대로 보인다.
--    트리거 발화 시에는 EXECUTE 권한 검사가 없고, 0031 의 DO 블록은 prosecdef 함수만
--    대상으로 하므로 이 함수에 영향이 없다. 본문은 테이블을 참조하지 않는다.
create or replace function public.guard_profiles_sensitive_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.role            is distinct from old.role
       or new.deleted_at      is distinct from old.deleted_at
       or new.deletion_reason is distinct from old.deletion_reason
       or new.email           is distinct from old.email
       or new.referral_code   is distinct from old.referral_code then
      raise exception
        'profiles 의 role/deleted_at/deletion_reason/email/referral_code 는 서버(service_role)만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_sensitive on public.profiles;
create trigger trg_profiles_guard_sensitive
  before update on public.profiles
  for each row execute function public.guard_profiles_sensitive_columns();

-- =====================================================================
-- (B) gifts — 사용자 세션 쓰기 차단 (order 소유 미검증 IDOR 봉쇄)
-- =====================================================================
-- 앱은 gift 를 orders 소유 검증(orders_select_own) 후 service_role 로만 INSERT 하고
--   (app/api/orders/[id]/gift/route.ts), 수령·만료도 service_role 로만 UPDATE 한다
--   (app/api/gifts/[token]/route.ts). 사용자 세션이 gifts 를 직접 쓰는 코드는 없다.
-- gifts_sender_all(for all) 은 sender_id=auth.uid() 만 검사해 남의 order_id INSERT 를
--   허용했다. 쓰기 정책을 제거하고 테이블 쓰기 권한을 회수한다.
-- '내가 보낸 선물' 조회 여지는 SELECT 전용 정책으로 보존한다(앱 현재 미사용이나 안전).
drop policy if exists "gifts_sender_all" on public.gifts;

drop policy if exists "gifts_sender_select" on public.gifts;
create policy "gifts_sender_select" on public.gifts
  for select
  to authenticated
  using (sender_id = auth.uid());

revoke insert, update, delete, truncate, references, trigger
  on table public.gifts from anon, authenticated;

-- =====================================================================
-- (C) attendances — 사용자 세션 INSERT 차단 (보너스 포인트 편취 봉쇄)
-- =====================================================================
-- 앱은 출석 행을 service_role 로만 INSERT 한다(app/api/attendance/check/route.ts).
--   월 보너스 판정은 attendances 행 COUNT 에 기반하므로, 직접 INSERT 로 카운트를
--   부풀리면 보너스를 편취할 수 있었다. INSERT 정책 제거 + 쓰기 권한 회수.
-- 본인/관리자 SELECT 정책은 유지한다.
drop policy if exists "attendances_insert_own" on public.attendances;

revoke insert, update, delete, truncate, references, trigger
  on table public.attendances from anon, authenticated;

-- =====================================================================
-- (D) review_likes — 사용자 세션 쓰기 차단 (미사용 표면 정리)
-- =====================================================================
-- 앱은 좋아요를 SECURITY DEFINER RPC(toggle_review_like)로만 토글한다
--   (app/api/reviews/[id]/like/route.ts). 사용자 세션이 review_likes 를 직접 쓰는
--   코드는 없다. 직접 INSERT 는 reviews.likes_count 에 반영되지 않아 영향은 경미하나,
--   사용되지 않는 쓰기 표면이라 닫는다. 본인 SELECT 정책(review_likes_read_own)은 유지.
drop policy if exists "review_likes_own_all" on public.review_likes;

revoke insert, update, delete, truncate, references, trigger
  on table public.review_likes from anon, authenticated;

-- =====================================================================
-- (E) photos — 사용자 세션 INSERT/UPDATE 차단 (storage_key 바꿔치기 봉쇄), DELETE 유지
-- =====================================================================
-- 앱의 photos 쓰기 경로:
--   INSERT — photos/complete(admin upsert, storageKey 가 `${user.id}/${projectId}/` prefix 인지
--            라우트가 검증), photos/copy-to-project(admin), gifts/[token] 수령 클론(admin).
--   UPDATE — photos/trash, photos/restore(둘 다 admin, deleted_at 만 변경).
--   DELETE — projects/[id] DELETE 가 **사용자 세션**으로 photos 를 지운다(photos_delete_own).
-- 사용자 세션이 photos 를 INSERT/UPDATE 하는 코드는 없다.
--
-- 반면 서명 URL 발급(photos/list, share/[token], mypage 등)과 PDF 원본 다운로드
-- (lib/pdf/photos.ts)는 행의 storage_key/thumb_key 를 service_role 로 그대로 해석하고
-- 키의 소유 prefix 를 검증하지 않는다. 그래서 사용자가 자기 photos 행의 키를 타인
-- 경로로 바꾸거나 그런 행을 직접 INSERT 하면(예: 만료·회수된 공유 링크에서 본 경로)
-- 타인 사진 접근을 유지할 수 있었다. 부수적으로 photos_update_own 로 deleted_at=null
-- 을 직접 되돌려 restore 라우트의 100장 한도 검사를 우회할 수도 있었다.
-- → INSERT/UPDATE 정책 제거 + 권한 회수. DELETE 정책/권한과 SELECT 는 유지한다.
drop policy if exists "photos_insert_own" on public.photos;
drop policy if exists "photos_update_own" on public.photos;

revoke insert, update, truncate, references, trigger
  on table public.photos from anon, authenticated;
-- anon 은 photos 를 지울 이유가 없다(photos_delete_own 이 소유자를 요구해 실제 삭제 가능 행은 0 이지만
-- 잔여 grant 를 남기지 않는다 — PGlite 실행 검증에서 발견). authenticated DELETE 는 유지.
revoke delete on table public.photos from anon;

-- =====================================================================
-- (F) reviews — 사용자 세션 쓰기를 라우트 검증과 같은 조건으로 축소
-- =====================================================================
-- 앱의 reviews 쓰기 경로(모두 **사용자 세션** createServerSupabase):
--   INSERT — POST /api/reviews: 주문 소유 + status in (shipped, delivered) 검증,
--            image_keys 첫 세그먼트 = user.id 검증 후
--            insert { order_id, user_id, rating, body, image_keys, public }.
--   UPDATE — PATCH /api/reviews/[id]: 본인 후기 확인, image_keys 첫 세그먼트 검증 후
--            rating/body/image_keys/public 중 일부만 update.
--   DELETE — DELETE /api/reviews/[id]: 본인 후기 삭제 후 image_keys 를 service_role 로
--            storage remove.
-- 좋아요 카운트(likes_count)는 toggle_review_like RPC(service_role) 만 바꾼다.
--
-- 라우트 검증은 PostgREST 직접 호출로 우회된다. 그래서 같은 조건을 DB 에서 강제한다.
--   • 컬럼 grant — INSERT 는 라우트가 보내는 6개 컬럼, UPDATE 는 4개 컬럼만.
--     id/likes_count/created_at/updated_at 은 기본값·트리거·RPC 만 채운다.
--     order_id/user_id 는 UPDATE 불가(후기 이전·주문 바꿔치기 차단).
--   • WITH CHECK — user_id=auth.uid(), (INSERT) 주문 소유 + 후기 가능 상태,
--     image_keys 모든 원소의 첫 세그먼트 = auth.uid()(라우트의 k.split("/")[0] 과 동일),
--     개수 ≤ 3, body ≤ 2000자(라우트 zod 와 동일 한도).
--   ⚠️ 후기 가능 주문 상태를 라우트(REVIEWABLE_ORDER_STATUSES)에서 바꾸면 이 정책도 함께
--     바꿔야 한다. 어긋나면 INSERT 가 RLS 위반(42501)으로 실패한다.
--   • 기존 행은 WITH CHECK 로 소급 검사되지 않는다 → docs/sql/0032-precheck.sql [9] 로 점검.
-- SELECT 는 reviews_public_read(공개 후기) + reviews_select_own(본인 비공개 후기 포함)으로
-- 기존 reviews_own_all 의 조회 범위를 그대로 유지한다.
drop policy if exists "reviews_own_all" on public.reviews;

drop policy if exists "reviews_select_own" on public.reviews;
create policy "reviews_select_own" on public.reviews
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.orders o
       where o.id = reviews.order_id
         and o.user_id = auth.uid()
         and o.status in ('shipped', 'delivered')
    )
    and cardinality(reviews.image_keys) <= 3
    and not exists (
      select 1
        from unnest(reviews.image_keys) as k(image_key)
       where k.image_key is null
          or split_part(k.image_key, '/', 1) <> auth.uid()::text
    )
    and (reviews.body is null or char_length(reviews.body) <= 2000)
  );

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and cardinality(reviews.image_keys) <= 3
    and not exists (
      select 1
        from unnest(reviews.image_keys) as k(image_key)
       where k.image_key is null
          or split_part(k.image_key, '/', 1) <> auth.uid()::text
    )
    and (reviews.body is null or char_length(reviews.body) <= 2000)
  );

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete
  to authenticated
  using (user_id = auth.uid());

-- 권한: 선 revoke(테이블 권한과 함께 컬럼 권한도 회수됨) → 필요한 것만 authenticated 에 재부여.
-- anon 에는 아무 쓰기 권한도 돌려주지 않는다.
revoke insert, update, delete, truncate, references, trigger
  on table public.reviews from anon, authenticated;

grant insert (order_id, user_id, rating, body, image_keys, public)
  on table public.reviews to authenticated;
grant update (rating, body, image_keys, public)
  on table public.reviews to authenticated;
grant delete
  on table public.reviews to authenticated;

-- =====================================================================
-- (G) storage.objects — reviews 버킷 사용자 세션 정책 제거
-- =====================================================================
-- 후기 이미지 업로드(app/api/reviews/upload)는 **서명 업로드가 아니라** 라우트가 파일을
-- 받아 service_role 로 직접 upload 한다(MIME·크기·레이트리밋 검증 후). 삭제(reviews/[id]
-- DELETE)와 서명 URL 발급(갤러리·상세)도 service_role 이다. 브라우저 Supabase 클라이언트는
-- 인증에만 쓰이고 storage 를 호출하지 않는다. → 사용자 세션 정책은 쓰이지 않는 표면이다.
-- 남겨 두면 로그인 사용자가 anon 키 + JWT 로 본인 폴더에 검증 없이 임의 파일을 올리고,
-- 그 키를 후기에 붙여(첫 세그먼트 검사 통과) 갤러리에서 배포할 수 있다.
-- reviews_storage_service_all(service_role) 은 유지한다(0027 과 같은 방식의 정책 drop).
drop policy if exists "reviews_storage_owner_all" on storage.objects;

-- =====================================================================
-- (H) storage.objects — photo-originals/photo-thumbs 버킷 사용자 세션 쓰기 정책 제거
-- =====================================================================
-- 앱의 사진 storage 경로(전부 service_role 또는 서명 토큰 — 사용자 JWT 로 storage 를 쓰지 않는다):
--   업로드   — photos/sign-upload 가 service_role 로 createSignedUploadUrl(키 `${user.id}/
--              ${projectId}/${photoId}.${ext}`, upsert 미지정=false) 발급 → 브라우저가
--              lib/image/upload-queue.ts 에서 서명 URL 로 XHR PUT(Authorization 헤더 없음).
--              storage-api 는 PUT /object/upload/sign/* 를 JWT 없는 공개 라우트로 두고 토큰
--              서명을 검증한 뒤 asSuperUser() 로 기록한다 — storage.objects RLS 를 거치지 않는다.
--              (Supabase 문서: uploadToSignedUrl 의 필요 RLS 권한 objects=none,
--               createSignedUploadUrl 은 objects insert — 발급 주체가 service_role 이라 무관.)
--   검증·재업로드 — photos/complete: admin download → 매직 바이트(SEC-1)·sharp 검증 →
--              admin upload(upsert) 원본 + 썸네일.
--   복사     — photos/copy-to-project, gifts/[token] 수령: admin.storage.copy.
--   삭제     — photos/abandon·purge, cron/orphan-photos, 계정 삭제(account-content-store): admin.
--   조회     — 서명 URL 발급·PDF 원본 다운로드: admin.
-- 브라우저 Supabase 클라이언트(lib/db/browser.ts)는 auth 에만 쓰이고 storage 를 호출하지 않는다.
--
-- 남겨 두면: complete 검증 뒤 사용자가 JWT 로 같은 키에 upsert(x-upsert: true, update+insert
-- 정책 통과)해 원본을 검증되지 않은 바이트로 바꿔치기 → PDF 빌드가 재검증 없이 디코드한다.
-- 또 본인 폴더 임의 업로드(크기·MIME·레이트리밋 우회)와 결제 후 원본·썸네일 직접 삭제가 가능하다.
-- 서명 토큰은 upsert=false 로 발급되므로 이미 존재하는 객체를 덮어쓰지 못한다.
--
-- 제거: 사용자 세션 쓰기 4개. 유지: photo_originals_user_select / photo_thumbs_user_select
-- (본인 폴더 읽기 전용 — 쓰기 표면 아님), photo_buckets_service_all(service_role).
-- 0027·(G) 와 같은 방식의 정책 drop 이며 새 정책은 만들지 않는다.
drop policy if exists "photo_originals_user_insert" on storage.objects;
drop policy if exists "photo_originals_user_update" on storage.objects;
drop policy if exists "photo_originals_user_delete" on storage.objects;
drop policy if exists "photo_thumbs_user_delete" on storage.objects;

-- =====================================================================
-- 참고 — 여기서 **의도적으로 건드리지 않은** 것:
--   • SELECT 권한 전부와 기존 SELECT 정책(profiles_select_self, attendances_*_select,
--     review_likes_read_own, photos_select_own, reviews_public_read 등) — 앱 조회 경로 보존.
--     (gifts_sender_select, reviews_select_own 은 쓰기 정책 분리 과정에서 SELECT 전용으로
--     새로 만든 것이다.)
--   • projects/pages/share_tokens 쓰기와 photos DELETE(photos_delete_own)
--     — 앱이 사용자 세션으로 실제 쓴다.
--     (이들의 잔여 위험은 앱 코드 이관/컬럼 grant 가 필요해 별도 처리.)
--   • PostgreSQL 17 의 MAINTAIN 권한 — 버전 의존이라 여기서 회수하지 않는다. 데이터를
--     바꾸지 않고 PostgREST 로 호출할 수도 없다.
--   • is_admin(), lookup_referral_code() 의 EXECUTE 권한.
--   • storage.objects 의 SELECT 정책(photo_originals_user_select, photo_thumbs_user_select,
--     pdfs_user_select, resources_user_select, site_assets_public_read)과 service_role 정책
--     (photo_buckets_service_all, reviews_storage_service_all 등).
--   • site-assets 버킷의 site_assets_admin_* 쓰기 정책 — is_admin() 으로 관리자만 통과한다.
--   • service_role 의 모든 권한.
-- =====================================================================
