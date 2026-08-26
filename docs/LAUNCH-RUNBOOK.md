# 서비스 런치 런북 (2026-08-11 갱신)

> **이 문서가 남은 운영 액션의 전부다.** 상태는 관리자 대시보드(`/admin`)의
> **"서비스 런치 체크"** 카드에 실시간으로 표시된다 — 카드가 "차단 항목 없음"이면
> 서비스 가능 상태다. 아래 섹션 번호(§)는 그 카드의 안내와 1:1 대응.
>
> 코드 작업은 전부 끝났다. 여기 있는 것은 **키 발급·콘솔 클릭·SQL 붙여넣기**뿐이며,
> 각 항목은 서로 독립이라 아무 순서로나 하면 된다.

## 현재 상태 요약 (2026-08-11 실측)

| 항목 | 상태 | 런치 차단? |
|---|---|---|
| 결제(토스)·인쇄(Storige)·DB(Supabase)·CRON 키 | ✅ 설정 완료 | — |
| 인쇄용 한글 폰트 | ✅ **시딩 완료**(Pretendard, 2026-08-09) | — |
| 책 사이즈 3종 | ✅ 활성 | — |
| 전체 테스트/CI/Vercel 빌드 | ✅ green | — |
| 토스 웹훅 URL 등록 | ⬜ §1-b (1분) | 아니오 (취소/환불 자동 반영만 누락) |
| 이메일(Resend) | ⬜ §3 | 아니오 (메일은 큐에 보존 — 키 등록 시 밀린 것까지 발송) |
| Rate limit(Upstash) | ⬜ §4 | 아니오 (fail-open 감수 시) |
| 카카오 로그인 | ⬜ §5 | 아니오 (버튼 자동 숨김 — 이메일 가입은 정상) |
| 마이그레이션 0030 | ✅ **적용 완료**(2026-08-09) | — |
| 마이그레이션 0031 (보안) | ✅ **적용 완료**(2026-08-11, 검증됨) | — |

**→ 이메일 가입 → 업로드 → 편집 → 주문 → 결제 → 인쇄검증 경로는 전부 동작한다.**
⬜ 항목은 품질/편의라 하나도 안 해도 열 수 있다. 오픈 전 필수였던 §0 보안 마이그레이션은
**적용·검증이 끝났다.**

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
```

```bash
pnpm e2e:auth
```

(`e2e:auth` 는 운영 Supabase 로 업로드→편집→표지→주문서까지 실제로 돌린다.
포트 3000 에 옛 dev 서버가 있으면 먼저 `lsof -ti:3000` 으로 정리.)

---

## 운영 규칙 (오픈 후 지켜야 할 것)

- **토스 콘솔 환불은 전액 취소만.** 부분 취소(`PARTIAL_CANCELED`)는 앱이 의도적으로
  무시한다 — 부분 환불 모델이 없어서 받아들이면 주문이 전액 refunded 로 굳고 포인트·
  할인코드가 **전액** 복원되기 때문이다(금전 손실). 부분 환불이 필요하면 콘솔에서 처리한 뒤
  `/admin` 에서 주문 상태를 손으로 맞춘다.
- **오픈 직후 며칠은 `/admin` 런치 체크 카드를 매일 확인.** 차단 항목이 0인지, 그리고
  cron 응답(`/api/cron/process-emails`)의 `queued` 가 계속 쌓이고만 있지 않은지 본다.

## 오너 결정이 필요한 항목 (기능 트레이드오프)

- **선물 수령에 수신자 이메일 대조를 넣을까?** 현재는 `gifts/<token>` 링크를 가진 사람이면
  누구나 수령한다. 0031 로 토큰 덤프 경로는 막았으므로 링크는 이메일 수신자와 발송자만
  알지만, "링크를 전달받은 사람"도 수령할 수 있다는 뜻이기도 하다.
  - 대조를 넣으면: 링크 전달·재전달 수령이 막히고, 카카오 로그인은 이메일 동의가 선택이라
    이메일 없는 계정은 수령 자체가 불가능해진다.
  - 넣지 않으면: 링크가 유출될 경우 제3자 수령이 가능하다.
  - 판단이 서면 `app/api/gifts/[token]/route.ts` 한 곳에 조건 추가로 끝난다.

## 백로그 (결정 기록 — 서비스 개시와 무관, 요청 시에만 착수)

| 항목 | 현재 상태(감수 중) |
|---|---|
| 포인트 홀드/예약 설계 | confirm 캡처 전 잔액 재확인으로 완화됨. 구조적 해소는 ledger hold RPC |
| 100% 할인 코드 | 100원 미만 주문은 `AMOUNT_BELOW_MINIMUM` 차단 — 무료 주문 경로 없음 |
| 인증 E2E 의 CI 편입 | staging Supabase 신설이 선행 조건. 그 전까지 릴리스 전 로컬 1회 |
| 프로젝트 소프트 삭제 | 현재 하드 삭제(스키마 변경 필요) |
| 데모 모드 | "구현 시작" 지시 시: 데모 계정 + `DEMO_*` env + 원클릭 로그인 |
| Storige C-2 배포 통지 시 | PDF 검증 E2E 재실증(로컬 `.env.local`에 STORIGE 키 필요) |
| 성능 추가 개선 | 현재 Performance 88 · LCP 3.6s. 다음 레버는 전송량(이미지/JS) |
