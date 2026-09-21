# 서비스 런치 런북 (2026-09-21 갱신)

> **이 문서가 남은 운영 액션의 전부다.** 상태는 관리자 대시보드(`/admin`)의
> **"서비스 런치 체크"** 카드에 실시간으로 표시된다 — 카드가 "차단 항목 없음"이면
> 서비스 가능 상태다. 아래 섹션 번호(§)는 그 카드의 안내와 1:1 대응.
>
> 여기 있는 것은 **키 발급·콘솔 클릭·SQL 붙여넣기**뿐이다.
> §9~§11 은 2026-09-17 작업에서 새로 생긴 항목이고, **§11(QA-1 피해 조회)은 가능한 한 빨리** 할 것.

## 현재 상태 요약 (2026-09-21)

| 항목 | 상태 | 런치 차단? |
|---|---|---|
| 결제(토스)·인쇄(Storige)·DB(Supabase)·CRON 키 | ✅ 설정 완료 | — |
| 인쇄용 한글 폰트 | ✅ **시딩 완료**(Pretendard, 2026-08-09) | — |
| 책 사이즈 3종 | ✅ 활성 | — |
| 전체 테스트/CI/Vercel 빌드 | ✅ green (main `4346c0b` — Next.js 16.3.5 + React 19.3.0 전환 배포 완료) | — |
| 마이그레이션 0030 · 0031 | ✅ **적용 완료**(2026-08-09 / 08-11) | — |
| **QA-1 피해 조회** | 🔺 **§11 — 읽기 전용 SQL 3개, 먼저 할 것** | 아니오 (이미 발생한 피해 확인) |
| **마이그레이션 0033 (결제 크레딧 선점)** | 🔺 **§9 — 코드가 먼저 배포됐다** | 아니오 (폴백 동작). 단 적용 전까지 **SEC-7 이중 사용 창**이 열려 있다 |
| **마이그레이션 0032 (직접 쓰기 봉쇄·권한 상승 차단)** | ⬜ **§10 — precheck → 적용 → postcheck** | 아니오 (단, `profiles.role` 권한 상승 표면이 열린 채로 남는다) |
| 토스 웹훅 URL 등록 | ⬜ §1-b (1분) | 아니오 (취소/환불 자동 반영만 누락) |
| 이메일(Resend) | ⬜ §3 | 아니오 (메일은 큐에 보존 — 키 등록 시 밀린 것까지 발송) |
| Rate limit(Upstash) | ⬜ §4 | 아니오 (fail-open 감수 시) |
| 카카오 로그인 | ⬜ §5 | 아니오 (버튼 자동 숨김 — 이메일 가입은 정상) |
| Storige 통지 전달 | ⬜ §7 (붙여넣기 1회) | 아니오 |

**→ 이메일 가입 → 업로드 → 편집 → 주문 → 결제 → 인쇄검증 경로는 전부 동작한다.**

> ⚠️ **§9·§10 의 마이그레이션과 짝이 되는 코드는 이미 배포됐다**(`34a5897`, 2026-09-21.
> 그 위의 `4346c0b` Next 16 전환은 이 동작을 바꾸지 않는다).
> 앱은 두 마이그레이션이 없어도 정상 동작한다(`0033` 은 기존 경로로 폴백). 다만
> **`0033` 적용 전까지는 SEC-7 — 한 사용자가 서로 다른 두 주문을 동시에 결제 확정하면
> 같은 포인트·할인코드가 두 번 쓰일 수 있는 창 — 이 열려 있다.** 되도록 빨리 적용할 것.

---

## §0. ✅ 보안 마이그레이션 0031 — 적용 완료 (2026-08-11)

2026-08-09 오픈 전 감사에서 **실측으로 확인된** 두 구멍을 닫는다.

1. **포인트 RPC 가 anon 에게 열려 있었다.** SECURITY DEFINER 함수 대부분이
   `grant execute ... to service_role` 만 하고 선행 `revoke` 를 빠뜨려, Postgres 기본값인
   PUBLIC EXECUTE 가 살아 있었다. 실측: 공개 anon 키로
   `POST /rest/v1/rpc/deduct_user_points_v2` 호출 시 권한 거부가 아니라 `-1` 이 돌아왔다
   (= 함수가 실제로 실행됨). 같은 패턴의 `add_user_points_v2` 로 **누구나 자기 계정에
   포인트를 무한 발급**할 수 있었고, 1P=1원이라 그대로 결제 금액이 깎인다.
2. **토큰 테이블이 전체 공개 SELECT 였다.** `share_tokens`(anon 포함)·`gifts`(로그인 시)에
   `using (true)` 정책이 있어 전체 토큰 덤프가 가능했다. 선물은 토큰 소지자가 수령하므로
   **결제 완료된 포토북을 제3자가 가로챌** 수 있는 구조였다.
   (실측 시점에 두 테이블은 0행이라 실제 유출은 없었다. 공유·선물을 쓰기 시작하면 열린다.)

**2026-08-11 운영 DB 에 적용 완료. 아래는 기록용이다**(스테이징 등 다른 환경에 재적용할 때 사용).
Supabase 대시보드 → SQL Editor, **상단이 `100p_books / PRODUCTION` 인지 먼저 확인** 후
`supabase/migrations/0031_tighten_public_grants.sql` 전체를 붙여넣고 Run.
`locked down: public.xxx(...)` NOTICE 가 함수 수만큼 출력되면 정상이다.

### 적용 후 실측 결과 (2026-08-11)

| 확인 | 결과 |
|---|---|
| anon → `deduct_user_points_v2` | `42501 permission denied` (적용 전에는 `-1` = 실행됨) |
| anon → `add_user_points_v2` | `42501 permission denied` — **포인트 무한 발급 경로 차단** |
| anon → 그 외 SECURITY DEFINER 5종 | `PGRST202` (스키마에서 노출 자체가 사라짐) |
| anon → `is_admin()` | `false` — 제외 대상이라 **정상 동작**(RLS 정책 22곳 안전) |
| anon → `lookup_referral_code()` | `null` — 의도적 공개 유지 |
| service_role → `deduct_user_points_v2` | `-1` — 앱 경로 **정상** |
| 골든 플로우 E2E(운영 DB) | 2 passed — 로그인→업로드→편집→표지→주문서 전 구간 정상 |

재확인용 커맨드 (`<ref>`/`<anon>` 은 프로젝트 값):
```bash
curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/deduct_user_points_v2" \
  -H "apikey: <anon>" -H "Authorization: Bearer <anon>" -H "Content-Type: application/json" \
  -d '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_amount":1,"p_reason":"probe","p_ref_type":null,"p_ref_id":null,"p_memo":"probe"}'
```
`-1` 이 아니라 **권한 거부(42501/PGRST202)** 가 나와야 정상이다.

앱 영향 없음: 모든 RPC 호출이 service_role 이고, 두 토큰 테이블 조회도 전부 service_role 이다.
`is_admin()`(RLS 정책 22곳에서 사용)과 `lookup_referral_code()`(의도적 공개)는 제외했다.

---

## §1. 토스페이먼츠 — 키 확인 + 웹훅 URL 등록

**a) 라이브 키 확인 (1분)** — Vercel env 의 `TOSS_SECRET_KEY` 가 `live_sk_...` 인지 확인.
`test_sk_...` 면 실결제가 안 된다. 토스 상점 심사가 끝났다면 라이브 키로 교체.

**b) 웹훅 URL 등록 (1분)** — 토스 개발자센터 → 웹훅 → 엔드포인트 추가:

```
https://100pbooks.vercel.app/api/payments/webhook
```

헤더/시크릿 설정은 **없다**(코드가 paymentKey 재조회 4겹 검증으로 진위 확인 — `ee261d8`).
등록하지 않으면: 토스 콘솔에서 직접 취소/환불한 건이 앱에 자동 반영되지 않아
관리자 콘솔에서 수동 전이해야 한다(데이터 유실은 아님).

## §2. 콘텐츠 리소스 — 폰트는 완료, 나머지는 선택

- **인쇄용 한글 폰트: 완료.** Pretendard(variable woff2, OFL)가 `resources`에 시딩됐고
  실코드 경로(`registerProjectFonts`)로 다운로드→등록→한글 렌더까지 검증 완료.
- (선택) 폰트 추가·클립아트·배경: `/admin/resources` 에서 업로드.
  현재 클립아트/배경은 0종 — 에디터 팔레트에 "표시할 리소스가 없어요"로 표시될 뿐
  사진+텍스트 편집은 전부 정상이다. 상품성 강화용이지 차단 아님.

## §3. 이메일 발송 (Resend) — 알림 메일 6종 활성화

미설정이어도 기능은 전부 동작한다. 메일만 안 나가는데, **큐는 보존된다** —
잡이 `pending` 으로 쌓여 있다가 키를 등록하는 순간 다음 cron(5분)에
그동안 밀린 주문 확인·배송 알림까지 순서대로 자동 발송된다.
대기량은 `GET /api/cron/process-emails` 응답의 `{ deferred: true, queued: N }` 으로 확인.

1. resend.com → API Keys → **Sending access** 키 발급
2. (권장) 도메인 인증 SPF/DKIM/DMARC — 미인증이면 `onboarding@resend.dev`로 테스트만 가능
3. Vercel env(Production+Preview): `RESEND_API_KEY`, `EMAIL_FROM`(인증 도메인과 일치)
4. 확인: 재배포 후 `/admin` 런치 체크가 "정상"으로 바뀌고,
   `GET /api/cron/process-emails` 호출 시 `{ sent: N }`

상세 절차: `CLAUDE.local.md` §이메일.
예외 하나 — 2026-08-08 이전(큐 보존 도입 전)에 `cancelled` 로 종결된 잡은 되살아나지 않는다.
필요하면 `/admin/emails` 에서 개별 재시도.

## §4. Rate limit (Upstash Redis) — 스팸/남용 방어

미설정 시 가입·업로드·후기·탈퇴 속도 제한이 전면 해제(fail-open) 상태로 동작한다.

1. Vercel 대시보드 → Storage/Marketplace → **Upstash Redis** 구독(무료 티어 있음) → 프로젝트 연결
2. `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` 자동 주입 확인 (수동이면 Prod+Preview 둘 다)
3. 확인: 재배포 후 가입 11회 반복 → 11번째 `429 RATE_LIMITED`

## §5. 카카오 로그인 — 콘솔 설정 후 스위치 켜기

**현재 카카오 버튼은 자동 숨김 상태다**(프로바이더 미설정 → 죽은 버튼 노출 방지,
`NEXT_PUBLIC_KAKAO_ENABLED` 게이트). 이메일 가입/로그인은 정상 동작.

1. Kakao Developers 앱 생성 → REST API 키 + Client Secret 발급 (`CLAUDE.local.md` §카카오 상세)
2. Supabase 대시보드 → Authentication → Providers → Kakao ON + 키 입력
3. Supabase가 보여주는 Callback URL 을 카카오 콘솔 Redirect URI 에 그대로 등록
4. Vercel env: `NEXT_PUBLIC_KAKAO_ENABLED=1` (Production+Preview) → 재배포 시 버튼 노출
5. 확인: 시크릿 창에서 `/login` → 카카오 버튼 → 동의 → 로그인 완료

## §6. 마이그레이션 0030 — ✅ 적용 완료 (2026-08-09)

운영 DB 에 적용됐다. 아래는 기록용 — 다른 환경(스테이징 등)에 재적용할 때만 쓴다.
Supabase 대시보드 → SQL Editor, **상단이 `100p_books / PRODUCTION` 인지 먼저 확인**
(다른 프로젝트면 `42P01 relation does not exist`):

```sql
-- book_completed 프로젝트당 1회 멱등화 (0030)
delete from public.funnel_events dup
 using public.funnel_events keep
 where dup.event = 'book_completed'
   and keep.event = 'book_completed'
   and dup.project_id is not null
   and dup.project_id = keep.project_id
   and (dup.created_at, dup.id) > (keep.created_at, keep.id);

create unique index if not exists uq_funnel_book_completed_once
  on public.funnel_events (project_id, event)
  where event = 'book_completed';
```

적용 전 데이터는 `book_completed` 가 표지 저장마다 중복 기록돼 있으므로,
퍼널 전환율을 읽을 때 적용 시점(2026-08-09) 이전 구간은 분자가 부풀어 있다는 점을 감안할 것.

## §7. Storige측 통지 전달 (붙여넣기 1회)

**보낼 것(미전달) — `docs/STORIGE-NOTICE.md` 하나. 붙여넣기 1회로 끝난다.**

2026-07-21 자 통지(계약 동결 요청)와 2026-08-24 자 통지(사용 경로 공유)를 한 장으로 합쳤다.
담긴 것: 우리가 실제 호출하는 8개 경로(API 7 + R2 직결 PUT) · 쓰지 않는 것(edit-sessions 계열
전부) · **변경 시 사전 통지가 필요한 계약 6가지** · FROZEN_ROUTES 등재와 검증 result 골든 spec
요청(2026-07-21 조사 기준이라 "이미 반영됐으면 넘어가 달라"고 명시) · 우리 쪽 대응 완료 현황.

가장 중요한 한 줄: **presign `uploadUrl` 호스트 화이트리스트**
(`r2.cloudflarestorage.com` / `amazonaws.com`) — Storige 가 스토리지 백엔드를 옮기면 우리
업로드가 전면 차단된다. 이것만은 사전 통지가 꼭 필요하다.

전달 후 이 항목을 지울 것.

**받은 것(조치 불요)** — 2026-08-24 Storige 운영 통지, 2026-08-23 프로덕션 반영:
회원 세션 API(`/api/edit-sessions` 상세·수정·완료·삭제·버전·목록·보관함)에 shop-session JWT
`siteId` ↔ 세션 `siteId` 대조가 확장됐고, 임베드 편집기 `editor.saved` 에 `EDITOR_BUSY` 응답이 추가됐다.
**우리 연동은 무영향 — 코드로 검증했다(2026-08-24)**:
- 우리가 호출하는 Storige 엔드포인트는 7개뿐이고, 전부 `/external` 계열이거나 `@Public` 이다 —
  `files/upload/external` · `files/{id}/complete` · `files/{id}/download/external` ·
  `files/{id}/external`(DELETE) [편집기 키] · `worker-jobs/validate/external` ·
  `worker-jobs/external/{jobId}` [워커 키] · `files/presigned-upload-public` [@Public, 키 없음].
  회원 세션 JWT 라우트는 하나도 없다.
- 레포 전체에서 `edit-sessions` · `shop-session` · `siteId` · `/embed` · `editor.saved` 는 **0건**.
- Storige 가이드 §1.5 도 "게스트 세션 저장·`compose-mixed`·**`/external`(X-API-Key) 경로는
  기존 격리 규칙 그대로이며 이번 확장의 영향이 없다**"고 명시한다.
- 참고: 통지문은 우리가 `/edit-sessions/external` 도 쓴다고 봤지만 실제로는 사용하지 않는다
  (Storige 측이 파악한 연동 범위가 실제보다 넓다 — 무영향 결론에는 영향 없음).
- 향후 임베드 편집기나 shop-session JWT 회원 라우트를 도입할 때만 가이드 §1.5·§3.2 를 볼 것.

## §8. 릴리스 전 최종 확인 (로컬 1회, 5분)

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:pdf && pnpm build
```

```bash
PLAYWRIGHT_BASE_URL=https://100pbooks.vercel.app pnpm e2e
pnpm test:a11y
```

```bash
pnpm e2e:auth
```

**2026-09-21 기준선** (`main` = `4346c0b`, Next 16 전환 후): typecheck 0 ·
lint **0 error / 41 warning**(38건이 `react-hooks` v7 신규 규칙 — 전환 방침상 warn 유지) ·
vitest **78 파일 / 1,371 passed / 1 skipped** · `test:pdf` 4 케이스 · e2e 12 · a11y 25 ·
build 성공(Turbopack) · `e2e:auth` **5 passed**(골든 플로우 2 + 편집 무결성 3 — 운영 URL 실측.
`bacadc1`·`34a5897`·`4346c0b` 세 배포본에서 각각 통과).

(`e2e:auth` 는 **운영 Supabase** 에 임시 계정·프로젝트를 만들어 업로드→편집→표지→주문서까지
실제로 돌리고 `afterAll` 에서 정리한다. CI 에는 넣지 않는다.
포트 3000 에 옛 dev 서버가 있으면 먼저 `lsof -ti:3000` 으로 정리.)

---

## §9. 마이그레이션 `0033` — 결제 크레딧 선점 (미적용)

**무엇을 고치나** — 지금은 포인트·할인 차감이 토스 캡처 **뒤에** 일어난다. 그래서 한 사용자가
서로 다른 두 주문을 동시에 confirm 하면 **같은 포인트·할인코드가 두 번 쓰일 수 있다**(SEC-7).
`0033` 은 캡처 **전에** 선점하고 승인 실패·금액 불일치 시 해제하는 `reserve`/`release` RPC를 만든다
(service_role 전용).

**적용 시점 — 지금 바로.** 짝이 되는 코드는 **이미 배포됐다**(`88163d0`, main `34a5897`).
미적용이어도 코드는 기존 경로(캡처 후 차감)로 폴백하므로 **장애는 없지만**,
그동안 SEC-7 이중 사용 창이 열려 있다.
`0032` 와는 독립이며, 어느 쪽을 먼저 적용해도 최종 결과가 같다는 것을 로컬 하네스에서 확인했다.

**절차**

1. Supabase 대시보드 → SQL Editor. **상단이 `100p_books / PRODUCTION` 인지 먼저 확인**
   (다른 프로젝트면 `42P01 relation does not exist`).
2. `supabase/migrations/0033_payment_credit_reservation.sql` 전체를 붙여넣고 Run.
   재실행 안전하다(같은 파일을 두 번 돌려도 된다).
3. 확인 — 다음이 각각 1행이면 정상이다.

```sql
-- 기대: 2행 (reserve_order_credits / release_order_credits, 둘 다 security_definer = true)
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('reserve_order_credits', 'release_order_credits')
 order by p.proname;

-- anon/authenticated/PUBLIC 에 EXECUTE 가 남아 있지 않아야 한다. 기대: 0 rows.
-- (0031 의 교훈 — SECURITY DEFINER 는 revoke-then-grant. 0033 파일에 이미 들어 있다.)
select p.proname,
       case when acl.grantee = 0 then 'PUBLIC'
            else pg_get_userbyid(acl.grantee) end as grantee
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) as acl
 where n.nspname = 'public'
   and p.proname in ('reserve_order_credits', 'release_order_credits')
   and acl.privilege_type = 'EXECUTE'
   and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'));
```

**로컬 검증 근거** — PGlite(PostgreSQL 18.3) 하네스에서 `0001~0031` + `0033` 적용·재적용 후
`reserve`/`release` 동작 대조 70건을 포함해 **295 PASS / FAIL 0**.
`reserve` 의 금액 비교가 NULL 이면 검사를 건너뛰던 버그는 이 검증에서 발견해 고쳤다(`b47834c`).

---

## §10. 마이그레이션 `0032` — 클라이언트 직접 쓰기 봉쇄 (미적용, precheck 필수)

**무엇을 고치나** — 로그인 사용자는 공개 anon 키 + 자기 JWT 로 PostgREST 를 직접 호출할 수 있다.
0002 의 `profiles_update_self` 는 `auth.uid() = id` 만 보고 **컬럼 제한이 없어서**, 자기
`profiles.role` 을 `'admin'` 으로 바꾸거나(`is_admin()` 이 이 값을 읽는다) `deleted_at` 을
되돌려 탈퇴 가드를 풀 수 있는 구조였다. 같은 부류의 "소유자 전체 쓰기" 표면도 함께 닫는다:
`gifts`(남의 주문으로 gift 생성 후 수령), `attendances`(과거 날짜 삽입으로 보너스 편취),
`review_likes`, `photos` INSERT/UPDATE(`storage_key` 를 타인 경로로), `reviews`,
그리고 사진 버킷의 사용자 직접 storage 쓰기.

> ⚠️ **`0032` 는 앞으로의 직접 쓰기를 막을 뿐, 이미 만들어진 부정 행은 되돌리지 않는다.**
> 그래서 precheck 를 먼저 돌려야 한다.

**절차 — 순서를 지킬 것**

1. **precheck** — `docs/sql/0032-precheck.sql` 을 SQL Editor 에서 **섹션별로** 실행한다.
   전부 SELECT 라 데이터를 바꾸지 않는다.
   - `[1]`~`[2]`: 지금 실제로 열려 있는 쓰기 표면 전수(0032 범위 밖에 더 열린 게 있는지도 본다).
   - `[3]`~`[11]`: **악용 흔적** — 권한 상승(`profiles.role='admin'`) · 탈퇴 가드 우회 ·
     선물 IDOR · 출석 편취 · `likes_count` 불일치 · `photos` 키 바꿔치기 ·
     `reviews` 직접 쓰기 · reviews 버킷 직접 업로드 · 사진 원본 객체 바꿔치기/직접 삭제.
   - **`[3]`~`[11]` 에서 1건이라도 나오면 적용과 별개로 개별 시정이 필요하다.**
     파일 안에 조치 템플릿이 주석으로 들어 있다 — 결과를 검토한 뒤 운영자가 따로 실행한다.
     특히 `[3]`(role 상승)과 `[11]`(사진 원본 바꿔치기)은 적용 **전에** 처리할 것.
2. **적용** — `supabase/migrations/0032_lock_client_writes.sql` 전체를 붙여넣고 Run.
   revoke-then-grant 구조라 재실행 안전하다.
3. **postcheck** — `docs/sql/0032-postcheck.sql` 을 섹션별로 실행하고 각 쿼리 주석의 "기대" 와 대조한다.
   - `[1]` 대상 테이블 쓰기 권한 0 rows(단 `photos` DELETE 는 의도적으로 남긴다)
   - `[3]` `profiles` 민감 컬럼 가드 트리거 존재
   - `[4]` `0031` 이 회귀하지 않았는지
   - `[7]`·`[8]` reviews·photo 버킷의 사용자 세션 storage 정책 제거 확인
   - `[8-스모크]` 적용 직후 **앱 경로 1회 확인** — 사진 업로드 1장이 정상 완료되는지.
4. 적용 후 `/admin` 과 후기 작성·사진 업로드·선물 수령을 한 번씩 눌러 앱 경로가 살아 있는지 본다.

**로컬 검증 근거** — PGlite(PostgreSQL 18.3) 하네스에서 `0001~0031` + `0033` + `0032` 를
적용·재적용하고 동작까지 확인: **295 PASS / FAIL 0**. 포함된 확인 —
사용자 직접 업로드 `42501` 거부 · service_role 업로드 허용 · anon `photos` DELETE `42501` ·
적용 전 공격 재현 10건이 적용 후 전부 차단 · `0032→0033` 과 `0033→0032` 의 최종 카탈로그 동일.

---

## §11. 🔺 QA-1 피해 조회 (읽기 전용) — 되돌리기 후 빈 문서 자동저장

**무슨 일이 있었나** — fabric 6.9.1 의 `canvas.toJSON()` 이 인자를 무시해 히스토리 스냅샷에서
객체 태그가 빠졌고, **되돌리기/다시실행 뒤 자동저장이 페이지·표지를 0객체로 덮어썼다.**
화면에는 그대로 보이고 라벨은 "저장됨"이라 사용자가 알아차리기 어렵다.
노출 구간은 undo 가 실제로 동작하기 시작한 2026-08-08 ~ 수정 배포(2026-09-17) 다.
수정은 운영 반영 완료(`0f2b77d`) + 회귀 E2E 고정(`bacadc1`).

**남은 일은 이미 발생한 피해 확인이다.** 아래는 전부 SELECT 다.
Supabase SQL Editor 상단이 **`100p_books / PRODUCTION`** 인지 먼저 확인할 것.

```sql
-- 1) 객체 0개로 저장된 내지 페이지
--    (같은 프로젝트에 사진이 있는데 빈 페이지인 경우가 의심 대상)
select pg.project_id,
       pg.id          as page_id,
       pg.page_no,
       pg.updated_at,
       (select count(*) from public.photos ph where ph.project_id = pg.project_id) as project_photos
  from public.pages pg
 where pg.updated_at >= '2026-08-08'
   and pg.fabric_json is not null
   and jsonb_array_length(coalesce(pg.fabric_json -> 'objects', '[]'::jsonb)) = 0
 order by pg.updated_at desc;
```

```sql
-- 2) 객체 0개로 저장된 표지
select pr.id as project_id, pr.title, pr.status, pr.updated_at
  from public.projects pr
 where pr.updated_at >= '2026-08-08'
   and pr.cover_json is not null
   and jsonb_array_length(coalesce(pr.cover_json -> 'objects', '[]'::jsonb)) = 0
 order by pr.updated_at desc;
```

```sql
-- 3) 위 프로젝트 중 이미 결제(주문)된 건 — 빈 내지·표지가 인쇄로 넘어갔는지
select o.id as order_id, o.status, o.paid_at, o.project_id
  from public.orders o
 where o.status not in ('pending', 'cancelled')
   and (
     exists (select 1 from public.pages pg
              where pg.project_id = o.project_id
                and pg.fabric_json is not null
                and jsonb_array_length(coalesce(pg.fabric_json -> 'objects', '[]'::jsonb)) = 0)
     or exists (select 1 from public.projects pr
                 where pr.id = o.project_id
                   and pr.cover_json is not null
                   and jsonb_array_length(coalesce(pr.cover_json -> 'objects', '[]'::jsonb)) = 0)
   );
```

**결과를 읽는 법**

- 1)·2) 가 0행이면 피해 없음 — 여기서 끝이다.
- 행이 나오면 해당 사용자에게 알리고 재편집을 안내한다.
  **빈 페이지는 자동으로 복구되지 않는다**(옛 내용이 남아 있지 않다).
- 3) 에 행이 나오면 **이미 인쇄 단계로 넘어간 건**이다. 주문 상태를 확인하고,
  `in_production` 이전이면 재생성·재편집, 이후면 재인쇄 여부를 판단해야 한다.

---

## 운영 규칙 (오픈 후 지켜야 할 것)

- **환불은 `/admin` 주문 상세의 "전액 환불" 버튼을 쓴다.**
  버튼이 토스 취소 API 를 호출하고 → 조건부 `refunded` 전이 → 포인트·할인 복원 → 감사 로그 →
  고객 메일까지 한 번에 처리한다. `TOSS_SECRET_KEY` 가 없으면 503 이다.
- **토스 콘솔에서 직접 환불할 때도 전액 취소만.** 부분 취소(`PARTIAL_CANCELED`)는 앱이 의도적으로
  무시한다 — 부분 환불 모델이 없어서 받아들이면 주문이 전액 refunded 로 굳고 포인트·
  할인코드가 **전액** 복원되기 때문이다(금전 손실). 부분 환불이 필요하면 콘솔에서 처리한 뒤
  `/admin` 에서 주문 상태를 손으로 맞춘다.
- **대기(`pending`) 주문은 손대지 않아도 된다.** 결제 이탈 건은 사용자가 재시도하면 같은 주문을
  재사용하고, 24시간 지난 무결제 건은 만료 cron 이 정리한다.
  결제 키가 바인딩된 pending 은 "캡처됐을 수 있는 주문"이라 취소가 거부된다(409) — 아래 백로그 참조.
- **편집 잠금** — 결제된(paid·in_production·shipped·delivered) 주문이 있는 프로젝트는 인쇄물에
  영향을 주는 편집이 막힌다. 사용자 화면은 안내 1회 후 **읽기 전용**으로 바뀐다(자동저장 중단).
  고객이 "수정하고 싶다"고 문의하면 주문 취소·환불 후 편집하도록 안내한다.
- **오픈 직후 며칠은 `/admin` 런치 체크 카드를 매일 확인.** 차단 항목이 0인지, 그리고
  cron 응답(`/api/cron/process-emails`)의 `queued` 가 계속 쌓이고만 있지 않은지 본다.
- **`CRON_SECRET` 을 지우지 말 것.** cron 인증이 fail-closed 라 키가 없으면 메일 발송·출석 리셋·
  보존 정리 등 모든 cron 이 401 로 막힌다(`/admin` 런치 체크의 차단 항목으로 표시된다).

## 오너 결정이 필요한 항목 (기능 트레이드오프)

- **선물 수령에 수신자 이메일 대조를 넣을까?** 현재는 `gifts/<token>` 링크를 가진 사람이면
  누구나 수령한다. 0031 로 토큰 덤프 경로는 막았으므로 링크는 이메일 수신자와 발송자만
  알지만, "링크를 전달받은 사람"도 수령할 수 있다는 뜻이기도 하다.
  - 대조를 넣으면: 링크 전달·재전달 수령이 막히고, 카카오 로그인은 이메일 동의가 선택이라
    이메일 없는 계정은 수령 자체가 불가능해진다.
  - 넣지 않으면: 링크가 유출될 경우 제3자 수령이 가능하다.
  - 판단이 서면 `app/api/gifts/[token]/route.ts` 한 곳에 조건 추가로 끝난다.
- **법정 고지 + 고객 문의 창구** — `/terms`·`/privacy`·`/refund` 는 있으나 전자상거래법상
  사업자 정보 고지(상호·대표자·사업자등록번호·통신판매업 신고번호·주소·연락처)와
  고객 문의 채널이 없다. **사업자 정보와 대표 연락처(또는 채널)를 주시면 코드 작업은 짧다.**
- **탈퇴 회원의 주문된 제작 자료 보관 범위** — 현재는 거래기록 보존 목적으로 남긴다
  (미주문 프로젝트·사진·공유 링크는 탈퇴 시 파기). 보관 기간·범위는 오너 정책 결정 사항이다.
- **Dependabot PR 머지 정책** — `next` 15.5.24 보안 PR 은 **16.3.5 직행 전환으로 해소**됐다.
  지금 열려 있는 것은 actions 메이저, `@napi-rs/canvas` 1.x, `lucide-react` 1.x, `nanoid` 6,
  `typescript` 6, `postcss` 패치, npm-minor-patch 그룹 등이다. **머지 전에
  `.github/dependabot.yml` 의 메이저 ignore 규칙(14/18 기준으로 작성됨)을 16/19 기준으로
  재검토**해야 한다 — 아래 백로그 참조.
- **출석 20일 보너스 과거 미지급분을 소급 지급할까?** 2026-09-21(`34a5897`) 수정 배포
  **이후부터는 정상 지급**된다. 그 이전에는 중복 판정 버그로 월 보너스(+1,000P)가 사실상
  지급되지 않았다(같은 달 10일 보너스 memo 와 겹쳤다). 수정 자체는 소급 이중 지급을 만들지
  않으므로, **과거분을 채워 줄지는 별도 결정**이다.
  - 대상 조회: `attendances` 에서 월별 20일 이상 출석자 ↔ `point_ledger` 의
    `reason='attendance_bonus'` + `memo = '<YYYY-MM> 월 출석 보너스 (20일+)'` 부재 건.
  - 지급은 `add_user_points_v2(..., 'attendance_bonus', ..., '<YYYY-MM> 월 출석 보너스 (20일+)')`
    로 같은 memo 를 써야 이후 cron 이 중복으로 인식해 두 번 주지 않는다.

## 백로그 (결정 기록 — 서비스 개시와 무관, 요청 시에만 착수)

| 항목 | 현재 상태(감수 중) |
|---|---|
| **결제 키가 남은 오래된 pending 주문** | 사용자 취소·만료 cron 대상에서 제외되고 관리자 취소도 토스가 DONE 이면 409 다. 확정 또는 환불로 수렴시킬 **관리자 도구가 없다** — 현재는 토스 콘솔 + `/admin` 수동 전이 |
| 선물 미리보기 GET 의 쓰기 부작용 | 소유 불일치 판정 시 `gifts.status='expired'` 로 쓰기를 한다. 읽기 요청이 상태를 바꾸는 구조라 **claim 경로로 한정** 권고 (적대 리뷰 비차단 후속) |
| 잠긴 포토북의 TopBar 제목 입력 | 내지 목록 화면에서 잠금인데도 제목 입력만 비활성화되지 않는다. **데이터 위험 없음**(서버가 409 로 거부) — UI 일관성 |
| `thumb_key` 고아 객체 회수 미검증 | 썸네일 키 고아 객체를 `orphan-photos` cron 이 실제로 회수하는지 확인되지 않았다 |
| `photo-originals` SELECT 정책 잔존 | 0032 는 쓰기만 회수했다 |
| `lib/pdf/photos.ts` 원본 재검증 부재 | 0032 로 바꿔치기 경로는 막았으나 PDF 조립 시 재검증은 없다(심층 방어) |
| 관측성 | 에러 추적 SDK 미도입 — 운영 예외를 Vercel 로그 + `digest` 로만 본다 |
| ~~Next 16 전환~~ | ✅ **2026-09-21 완료·운영 배포**(`4346c0b`). 아래 5개가 그 후속이다 |
| Next 16 후속 ① `middleware` → `proxy` 전환 | 이번 웨이브에서 의도적으로 제외했다. **`middleware.ts` 유지 중이고 빌드 deprecation 경고 1건은 정상** |
| Next 16 후속 ② `@supabase/ssr`·`supabase-js` 업그레이드 | 0.5.2 / 2.45.6 고정. 잔존 `ws` 2건 + `@supabase/auth-js` 1건이 여기 묶여 있다(SECURITY.md) |
| Next 16 후속 ③ `react-hooks` v7 경고 38건 | 전환 방침상 warn 유지 중. 규칙별 수정·error 승격 판단 |
| Next 16 후속 ④ AVIF 재활성화 판단 | `GHSA-2xp9-vwfh-vxw4` 는 16.3.5 에서 해소됐지만 `images.formats` 는 webp 유지. 인코딩 비용·품질 회귀 측정 후 결정 |
| Next 16 후속 ⑤ Lighthouse 비교 방법 재정의 | Next 16 이 First Load JS 표를 내지 않아 기준선(2026-08-07 Performance 88 · LCP 3.6s)과 **같은 방식의 비교가 불가능**하다 |
| Vercel Preview 런타임 검증 | Preview 환경변수 0종이라 PDF 네이티브 바이너리·토스 결제·카카오 콜백을 프리뷰에서 실증할 수 없다. 필요하면 Production 값 복제가 선행 |
| Dependabot 메이저 ignore 규칙 재검토 | `.github/dependabot.yml` 의 `next`/`react`/`react-dom`/`@types/react*`/`eslint`/`eslint-config-next` 메이저 ignore 는 14/18 기준으로 쓴 것이다. 16/19 기준으로 다시 볼 것. 열린 PR: actions 메이저 · `@napi-rs/canvas` 1.x · `lucide-react` 1.x · `nanoid` 6 · `typescript` 6 · `postcss` 패치 · npm-minor-patch 그룹 |
| fabric 7.x 전환 | SVG XSS 2건 + 선택적 `canvas` 백엔드가 끌고 오는 `tar` 12건(critical 1 포함)이 여기서 해소된다(SECURITY.md) |
| 포인트 홀드/예약 설계 | `0033` reserve/release 로 구조적 해소 — **§9 적용 대기** |
| 100% 할인 코드 | 100원 미만 주문은 `AMOUNT_BELOW_MINIMUM` 차단 — 무료 주문 경로 없음 |
| 인증 E2E 의 CI 편입 | staging Supabase 신설이 선행 조건. 그 전까지 릴리스 전 로컬 1회 |
| 프로젝트 소프트 삭제 | 현재 하드 삭제(스키마 변경 필요). 주문이 연결된 프로젝트는 409 `HAS_ORDERS` 로 막힌다 |
| 데모 모드 | "구현 시작" 지시 시: 데모 계정 + `DEMO_*` env + 원클릭 로그인 |
| Storige C-2 배포 통지 시 | PDF 검증 E2E 재실증(로컬 `.env.local`에 STORIGE 키 필요) |
| 성능 추가 개선 | 현재 Performance 88 · LCP 3.6s. 다음 레버는 전송량(이미지/JS) |
