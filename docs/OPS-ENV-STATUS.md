# 운영 환경변수 현황과 조치 (2026-08-07 실측)

Production 에 설정된 것 11종, 미설정 3종. 미설정분은 코드가 조용히 넘어가지 않고
각기 다른 방식으로 기능을 끈다. 아래는 실제 코드 경로로 확인한 영향과 조치안이다.

| env | 현재 상태 | 실제 동작 |
|---|---|---|
| `TOSS_WEBHOOK_SECRET` | 미설정 | production 에서 **모든 결제 웹훅을 500 으로 거부** |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | 미설정 | rate limit 4종 전면 fail-open |
| `RESEND_API_KEY` / `EMAIL_FROM` | 미설정 | 메일 job 을 cancelled 처리 → 발송 0 |

---

## 1. 결제 웹훅 — env 등록만으로는 해결되지 않는다 ⚠️

### 발견

지금까지 이 항목은 "값만 넣으면 되는 운영 판단"으로 기록돼 있었으나, **토스페이먼츠는
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

### 조치안

**A안 (권장) — 헤더 게이트를 걷어내고 재조회 검증에 일원화**

현재 라우트는 이미 위조에 견디는 구조다: 우리 DB 에 있는 주문만 처리하고(`:134-137`),
`paymentKey` 없으면 상태를 바꾸지 않으며(`:144-146`), **토스 API 로 직접 재조회해
금액·상태를 확인한 뒤에만**(`:149-160`) `canTransition` 을 거쳐 조건부 클레임으로 전이한다.
공격자가 임의 페이로드를 보내도 유효한 `paymentKey` 를 모르면 아무 일도 일어나지 않고,
안다 해도 **토스의 실제 상태와 같은 전이만** 일어난다.

- 변경: production 미설정 시 500 거부를 제거하고 경고 로그만 남긴다.
- 보완: 웹훅 경로에 rate limit 프리셋을 추가해 무인증 POST 폭주를 막는다.
- 비용: 결제 라우트 수정 1건 + 테스트.

**B안 — URL 쿼리 시크릿**

토스 콘솔에 `…/api/payments/webhook?k=<secret>` 으로 등록하고, 코드가 헤더 **또는** 쿼리를
매칭한다. 심층방어를 유지하지만 시크릿이 URL 에 실려 Vercel 로그에 남는다.

**C안 — 웹훅을 쓰지 않는다고 명시**

토스 콘솔에 웹훅을 등록하지 않고, 취소/환불은 관리자 콘솔 수동 전이로만 처리한다.
코드 변경 0. 대신 위 "잃는 것"을 운영 규칙으로 감수한다.

> 어느 안이든 **오너 결정이 필요**하다. A안을 고르면 곧바로 구현 가능하다.

---

## 2. Rate limit (Upstash) — fail-open

`lib/security/rate-limit.ts:21-23` 에서 URL/TOKEN 이 없으면 `ENABLED=false` 가 되고,
`enforceRateLimit` 이 항상 `success:true, disabled:true` 를 돌려준다(`:92-100`).
현재 무력화된 프리셋 4종(`:116-122`):

| 프리셋 | 의도한 한도 | 무력화 시 위험 |
|---|---|---|
| `signup` | IP 당 시간당 10회 | 스팸 계정 대량 생성 |
| `photo-upload` | 분당 30회 | 서명 발급·스토리지 남용 |
| `review-upload` | 시간당 20회 | 후기 도배 |
| `account-delete` | 시간당 5회 | 잔존 세션 brute force |

### 조치 절차 (사용자 수행)

1. Vercel 대시보드 → Storage(또는 Marketplace) → **Upstash Redis** 구독 후 프로젝트에 연결
2. 연결하면 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 이 자동 주입된다
   (수동 등록 시 Production + Preview 양쪽)
3. 재배포 후 확인: 가입을 11회 반복하면 11번째가 `429 RATE_LIMITED` + `X-RateLimit-*` 헤더

코드 변경은 필요 없다 — env 가 생기는 즉시 활성화된다.

---

## 3. 이메일 (Resend) — 발송 0

`lib/email/worker.ts:168-177` 이 `RESEND_API_KEY` 없으면 job 을 **`cancelled`** 로 종결한다.
재시도 대상이 아니므로 **지금까지 큐에 들어온 메일은 이미 취소 처리됐다.**

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
5. **취소된 과거 job 은 자동 재발송되지 않는다** — 필요하면 관리자 콘솔의
   `POST /api/admin/emails/[id]/retry` 로 개별 재시도

---

## 요약 — 지금 필요한 결정

| 항목 | 사용자 결정 필요 | 결정 후 소요 |
|---|---|---|
| 웹훅 A/B/C안 | ✅ 필수 (env 등록만으로는 해결 안 됨) | A안 기준 코드 1건 |
| Upstash 구독 | ✅ (비용 발생) | env 등록만, 코드 0 |
| Resend 키·도메인 | ✅ | env 등록만, 코드 0 |
