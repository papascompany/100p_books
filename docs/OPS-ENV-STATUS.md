# 운영 환경변수 현황과 조치 (2026-08-08 실측)

`vercel env ls production` 기준 Production 11종 설정됨:
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` /
`NEXT_PUBLIC_APP_URL` / `TOSS_SECRET_KEY` / `TOSS_CLIENT_KEY` / `NEXT_PUBLIC_TOSS_CLIENT_KEY` /
`STORIGE_API_URL` / `STORIGE_API_KEY` / `STORIGE_WORKER_API_KEY` / `CRON_SECRET`.
**Preview 환경은 0종**(프리뷰 배포는 런타임 동작 불가 — 빌드만 통과).

| env | 현재 상태 | 실제 동작 |
|---|---|---|
| ~~`TOSS_WEBHOOK_SECRET`~~ | **삭제됨(2026-08-07)** | 코드가 더 이상 읽지 않는다 — 아래 §1 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | 미설정 | rate limit 5종 전면 fail-open |
| `RESEND_API_KEY` / `EMAIL_FROM` | 미설정 | 발송 0 — 단 **큐는 보존**된다(키 등록 시 밀린 메일까지 자동 발송) |

---

## 1. 결제 웹훅 — ✅ 코드로 해소됨 (남은 건 콘솔 URL 등록뿐)

> **결론 먼저**: `TOSS_WEBHOOK_SECRET` 은 등록할 필요가 없다(등록하면 오히려 막힌다).
> 코드에서 제거했고(`ee261d8`), 운영자가 할 일은 **토스 콘솔에 웹훅 URL 하나 등록**하는 것뿐이다:
> `https://<도메인>/api/payments/webhook` — 헤더·시크릿 설정 없음.

### 왜 env 로는 해결할 수 없었나

이 항목은 오래 "값만 넣으면 되는 운영 판단"으로 기록돼 있었으나, **토스페이먼츠는
개발자가 지정한 커스텀 헤더를 웹훅에 실어 보낼 수 없다.** 공식 문서 기준 웹훅 요청 헤더는
다음 4종이 전부다:

- `tosspayments-webhook-transmission-time`
- `tosspayments-webhook-transmission-retried-count`
- `tosspayments-webhook-transmission-id`
- `tosspayments-webhook-signature` — **지급대행 이벤트(`payout.changed`, `seller.changed`) 전용**

결제 이벤트에는 서명 헤더가 없고, 진위 검증 수단으로 문서가 제시하는 것은
가상계좌(`DEPOSIT_CALLBACK`)의 **본문** `secret` 필드뿐이다.

우리 코드는 `x-webhook-secret` / `x-toss-webhook-secret` 헤더를 요구한다
([app/api/payments/webhook/route.ts:70-85](../app/api/payments/webhook/route.ts#L70)). 따라서:

- **미설정(현재)** → production 분기에서 500 `WEBHOOK_NOT_CONFIGURED`
- **설정하면** → 토스가 그 헤더를 못 보내므로 401 `WEBHOOK_UNAUTHORIZED`

**어느 쪽으로 두어도 토스 웹훅은 통과하지 못한다.** env 등록은 조치가 아니다.

### 지금 실제로 잃고 있는 것

결제 승인 자체는 웹훅이 아니라 `/api/payments/confirm` 이 처리하므로 **정상 결제는 영향 없다.**
잃는 것은 "우리 앱을 거치지 않은 상태 변화"의 자동 반영이다:

- 토스 콘솔·고객센터에서 직접 취소/환불한 건이 `orders` 에 반영되지 않음
  → `refunded` 전이와 `restoreOrderCredits`(포인트·할인 복원)가 실행되지 않음
- confirm 이 네트워크 실패로 중단된 결제의 마지막 보정 수단이 없어짐

다만 **대체 경로가 존재한다**: 관리자 콘솔의 수동 상태 전이
([app/api/admin/orders/[id]/transition/route.ts:143](../app/api/admin/orders/%5Bid%5D/transition/route.ts#L143))가 동일하게
`restoreOrderCredits` 를 호출한다. 즉 데이터 유실이 아니라 **운영 수작업 + 누락 위험**이다.

### 적용한 조치 (A안, `ee261d8`)

헤더 게이트를 제거하고 진위 검증을 기존 4겹에 일원화했다. 라우트는 원래부터 위조에 견디는
구조였다: 우리 DB 에 있는 주문만 처리 / `paymentKey` 없으면 상태 불변 / **토스 API 재조회로
금액·상태 확인**(페이로드의 status 는 신뢰하지 않음) / `canTransition` + 조건부 클레임.
공격자가 임의 페이로드를 보내도 유효한 `paymentKey` 없이는 아무 일도 없고, 안다 해도
토스의 실제 상태와 같은 전이만 일어난다. 남는 위험인 무인증 POST 폭주는
rate limit 프리셋 `payment-webhook`(분당 60회)으로 막는다.

⚠️ 되돌리지 말 것 — 헤더 시크릿을 다시 도입하면 모든 결제 웹훅이 401 로 거부된다.
근거는 `app/api/payments/webhook/route.ts` 상단 주석에 고정해 두었다.

---

## 2. Rate limit (Upstash) — fail-open

`lib/security/rate-limit.ts:21-23` 에서 URL/TOKEN 이 없으면 `ENABLED=false` 가 되고,
`enforceRateLimit` 이 항상 `success:true, disabled:true` 를 돌려준다(`:92-100`).
현재 무력화된 프리셋 5종:

| 프리셋 | 의도한 한도 | 무력화 시 위험 |
|---|---|---|
| `signup` | IP 당 시간당 10회 | 스팸 계정 대량 생성 |
| `photo-upload` | 분당 30회 | 서명 발급·스토리지 남용 |
| `review-upload` | 시간당 20회 | 후기 도배 |
| `account-delete` | 시간당 5회 | 잔존 세션 brute force |
| `payment-webhook` | 분당 60회 | 무인증 웹훅 엔드포인트 폭주 |

### 조치 절차 (사용자 수행)

1. Vercel 대시보드 → Storage(또는 Marketplace) → **Upstash Redis** 구독 후 프로젝트에 연결
2. 연결하면 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 이 자동 주입된다
   (수동 등록 시 Production + Preview 양쪽)
3. 재배포 후 확인: 가입을 11회 반복하면 11번째가 `429 RATE_LIMITED` + `X-RateLimit-*` 헤더

코드 변경은 필요 없다 — env 가 생기는 즉시 활성화된다.

---

## 3. 이메일 (Resend) — 발송 0

`processEmailQueue` 는 `RESEND_API_KEY` 가 없으면 **큐를 건드리지 않고 보류**한다
(`{ deferred: true, queued: N }`). 잡은 `pending` 으로 남아 있다가 키를 등록하는 순간
다음 cron(5분)에 `scheduled_at` 순서대로 발송된다 — **밀린 주문 확인·배송 알림도 함께 나간다.**

> 2026-08-08 이전 구현은 키가 없으면 잡을 `cancelled` 로 종결시켰다. 그 시기에 생성된
> 잡은 되살아나지 않으므로, 필요하면 관리자 콘솔의 `POST /api/admin/emails/[id]/retry`
> 로 개별 재시도해야 한다. 이후 생성분은 자동으로 복구된다.

발송되지 않고 있는 메일 6종:

| 트리거 | 위치 |
|---|---|
| 주문 결제 완료 | `app/api/payments/confirm/route.ts:396` |
| 약관 동의(가입 안내) | `app/api/auth/agree/route.ts:53` |
| 주문 상태 변경(발송·배송 등) | `app/api/admin/orders/[id]/transition/route.ts:217` |
| 선물 수령 | `app/api/gifts/[token]/route.ts:613` |
| 선물 발송 알림 | `app/api/orders/[id]/gift/route.ts:191` |
| 회원 탈퇴 확인 | `app/api/account/delete/route.ts:148` |

영향 판정: **선물하기는 링크(`shareUrl`)를 API 응답으로 돌려주므로 기능 자체는 동작**하고,
나머지는 고객 알림 누락이다. 가장 체감이 큰 것은 주문 완료·배송 알림이다.

### 조치 절차 (사용자 수행)

`CLAUDE.local.md` 의 "이메일 발송(Resend) 운영 체크리스트" 를 그대로 따르면 된다. 요약:

1. Resend → API Keys → **Sending access** 키 발급
2. 도메인 인증(SPF/DKIM/DMARC) — 미인증이면 `onboarding@resend.dev` 로 테스트만
3. Vercel env 에 `RESEND_API_KEY`, `EMAIL_FROM`(인증 도메인과 일치) 등록
4. 확인: `GET /api/cron/process-emails` 수동 호출 → `{ processed, sent, failed }`
5. 등록 즉시 **대기 중이던 잡이 자동 발송**된다. 다만 2026-08-08 이전에 `cancelled` 로
   종결된 과거 잡은 예외 — `POST /api/admin/emails/[id]/retry` 로 개별 재시도

---

## 요약 — 지금 필요한 결정

| 항목 | 상태 | 남은 일 |
|---|---|---|
| 결제 웹훅 | ✅ 코드 해소 완료 | **토스 콘솔에 웹훅 URL 등록** (헤더 설정 없음) |
| Resend 키·도메인 | ⏳ 미설정 | 키 등록만 하면 **밀린 메일까지 자동 발송** (코드 0) |
| Upstash 구독 | ⏳ 미설정 | 구독 + 연결 시 자동 활성화 (코드 0, 비용 발생) |
| Preview 환경변수 | ⏳ 0종 | 프리뷰에서 런타임 검증이 필요하면 Production 값 복제 |

세 가지 모두 **코드 변경 없이 env·콘솔 설정만으로 켜진다.** 지금 열어도 결제·주문·인쇄
경로는 동작하며, 켜지지 않은 것은 고객 알림 메일과 남용 방지 한도다.
