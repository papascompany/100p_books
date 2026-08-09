# 서비스 런치 런북 (2026-08-09)

> **이 문서가 남은 운영 액션의 전부다.** 상태는 관리자 대시보드(`/admin`)의
> **"서비스 런치 체크"** 카드에 실시간으로 표시된다 — 카드가 "차단 항목 없음"이면
> 서비스 가능 상태다. 아래 섹션 번호(§)는 그 카드의 안내와 1:1 대응.
>
> 코드 작업은 전부 끝났다. 여기 있는 것은 **키 발급·콘솔 클릭·SQL 붙여넣기**뿐이며,
> 각 항목은 서로 독립이라 아무 순서로나 하면 된다.

## 현재 상태 요약 (2026-08-09 실측)

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

**→ 지금 이 순간에도 이메일 가입 → 업로드 → 편집 → 주문 → 결제 → 인쇄검증까지 전부 동작한다.**
위 ⬜ 항목은 품질/편의 항목이며, 하나도 안 해도 서비스는 열 수 있다.

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

`docs/STORIGE-NOTICE-2026-07-21.md` 내용을 Storige 프로젝트 세션에 붙여넣으면 끝.
전달 후 이 항목을 지울 것. (Storige 계약 동결 그물 보강 요청 — 100p 쪽 코드는 대응 완료)

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
