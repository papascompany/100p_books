# 인쇄소 자동 발주 연동 — 구현 계획 (계획 전용)

> 작성 2026-11-06 · transition_epoch `2026-11-06-opus55` · 상태: **계획만 있음, 코드 변경 없음**
> 근거: 오너 결정 2026-11-06 "자동발주 연동은 계획으로만 작성". 정본 백로그는 STATUS.md:1320 (#13 "인쇄소 자동 발주 연동 — `in_production` 진입 시")입니다.
> 착수 조건: §11의 오너·Storige 결정이 끝난 뒤, 오너가 "구현 시작"을 지시할 때만 진행합니다.

## 1. 목적·범위·비범위

**목적**: 관리자가 주문을 `in_production`으로 넘길 때, 인쇄소에 넘기는 작업(PDF·사양·배송지 전달)을 시스템이 멱등하게 대신 처리합니다. 결과는 추적할 수 있게 남깁니다.

**범위**
- 발주 레코드(outbox) 모델
- 제출 워커(cron 1개 + 즉시 시도)
- 실패 재시도와 수동 전환
- 환불·취소 연동
- 관리자 UI
- feature flag와 단계별 롤아웃

**비범위**
- 인쇄소 선정
- PDF CMYK/ICC 변환(STATUS.md:1319 #12, 별도 과제)
- 부분 환불 모델
- 배송 추적 자동화(§10 4단계의 선택 항목으로만 둡니다)
- Storige 편집 세션·`/embed` 도입(docs/STORIGE-NOTICE.md:39-45, 계획 없음)

## 2. 현재 흐름 (근거)

| 단계 | 현재 동작 | 근거 |
|---|---|---|
| 상태 머신 | `paid → in_production → shipped → delivered`, 각 단계에서 `refunded` 가능 | lib/orders/state.ts:18-26 |
| 결제 확정 | confirm·webhook·재조정이 `finalizePaidOrder` 하나로 수렴. PDF 잡은 주문당 1회만 enqueue하고 `waitUntil`로 빌드 | lib/orders/finalize-paid.ts:14-31, 425-479 |
| PDF 빌드 | 자체 렌더 → Storige 업로드(`content`/`cover`) → best-effort 검증 | lib/pdf/build-job.ts:240-317 |
| 산출물 기록 | 빌드 성공 시 `orders.storige_cover_file_id`, `storige_interior_file_id`, `storige_validation` 기록 | lib/orders/finalize-paid.ts:453-461, lib/storige/order-fields.ts:28-42 |
| 잡 큐 | `pdf_build_jobs` 영속 큐(attempt/max_attempts, service_role 쓰기, admin SELECT RLS). 고착 잡은 reaper cron이 정리 | supabase/migrations/0011_pdf_build_jobs.sql:25-70, lib/pdf/job-reaper.ts:1-40, vercel.json crons `reap-pdf-jobs` |
| 제작 시작 | 관리자 주문 상세의 "제작 시작" → `POST /api/admin/orders/:id/transition` | app/admin/orders/[id]/OrderActions.tsx:29, app/api/admin/orders/[id]/transition/route.ts:51 |
| 발주 게이트 | 검증 결과가 FIXABLE/FAILED이면 409 `VALIDATION_BLOCKED`. `force`로 강제 진행할 수 있고 감사 로그에 남김. ERROR/PROCESSING/SKIPPED/미검증은 막지 않음 | transition/route.ts:88-109, 198-201, lib/orders/validation-gate.ts:4-16 |
| 게이트의 알려진 한계 | 게이트 SELECT와 조건부 UPDATE 사이의 ms 창(위험도 low로 보고 감수함) | transition/route.ts:91-94 |
| 전이 클레임 | `eq("status", from)` 조건부 UPDATE로 승자 1명만 부수효과 실행 | transition/route.ts:152-171 |
| 부수효과 | 감사 로그 `order.transition` + 상태별 고객 메일 enqueue | transition/route.ts:186-284 |
| 인쇄 파일 전달 | **자동 경로 없음.** 관리자가 주문 상세에서 서버 프록시로 PDF를 내려받음(admin은 상태와 무관하게 받을 수 있음) | app/admin/orders/[id]/page.tsx:116-123, app/api/orders/[id]/download/[kind]/route.ts:20,53-59 |
| 송장 Excel | `paid+in_production+shipped` 주문을 CJ 표준에 가까운 10개 컬럼으로 내보냄(인쇄 사양 컬럼 없음) | app/api/admin/orders/export/route.ts:42,83-84, lib/admin/excel.ts:49-60 |
| 발송 | `in_production → shipped`로 넘길 때 송장번호·배송사가 필수 | transition/route.ts:136-147 |
| 환불 정책 | `paid`는 사유와 무관하게 전액 환불. `in_production` 이후는 force와 사유가 필수 | app/api/admin/orders/[id]/refund/eligibility.ts:4-10, 62 |
| 토스 웹훅 | paid 계열 → refunded(CANCELED) 클레임 처리. `in_production`에서도 환불 상태로 바뀔 수 있음 | app/api/payments/webhook/route.ts:80-82 |
| 재빌드 | `paid`와 `in_production`에서 PDF 재생성을 허용하므로 file id가 바뀔 수 있음 | app/api/admin/orders/[id]/rebuild-pdf/route.ts:17-22 |
| 보존 | `delivered` 후 90일이 지나면 Storige PDF 삭제 | app/api/cron/storige-retention/route.ts:17,59-60, lib/pdf/constants.ts:44 |
| 큐·cron 패턴 | `email_jobs`: INSERT → 즉시 시도 → 5분 cron 재처리, 백오프 5m→30m→2h, Idempotency-Key | lib/email/queue.ts:12-31, app/api/cron/process-emails/route.ts:11-34, lib/email/retry-policy.ts |
| cron 인증 | `Bearer CRON_SECRET`을 SHA-256 다이제스트로 `timingSafeEqual` 비교(fail-closed) | lib/security/cron-auth.ts:9-24, 52-56 |
| Storige 사용 범위 | `/files/*` 업로드·다운로드·삭제와 `/worker-jobs/*` 검증뿐이며 발주·주문 제출 호출은 0건 | lib/storige/client.ts:228,310,375,465,496,601,656, docs/STORIGE-NOTICE.md:20-34 |
| 운영 주문량 | 운영 결제 주문 0건(기록 시점 기준) | STATUS.md:122,328 |

**Storige 측 단서(저장소 근거만)**
- 클라이언트 주석은 Storige를 "인쇄 PDF 저장·검증·**이행**" 단일 백엔드로 설명합니다(lib/storige/client.ts:8-9).
- 통지 기록에 Storige의 "v1 도서 확정" 오퍼레이션과 "웹훅 서명"이 언급되지만 100p는 쓰지 않습니다(STATUS.md:325-326, 338, 354).
- 이 오퍼레이션이 발주(인쇄 제출) 용도인지, 100p 같은 유형 1 파트너도 쓸 수 있는지, 요청·응답 계약이 어떤지는 **Storige 측 확인이 필요합니다.**

## 3. 목표 흐름 — 트리거 시점

| 안 | 트리거 | 장점 | 단점 |
|---|---|---|---|
| A | 결제 완료 후 PDF 빌드 성공 + 검증 COMPLETED이면 자동 | 사람 개입 0 | 검증이 best-effort라 ERROR/PROCESSING도 통과합니다(validation-gate.ts:7-9). 무검증 발주가 될 수 있습니다(STATUS.md:304, 337). `paid`의 무조건 환불 창(eligibility.ts:5)이 사라집니다 |
| **B (권장)** | 관리자 "제작 시작"(`paid → in_production`) 전이 클레임에 성공하면 발주 enqueue | 백로그 정의(STATUS.md:1320)와 같습니다. 기존 게이트·force·감사 로그를 그대로 씁니다. 환불 정책 경계(`paid`/`in_production`)와 일치합니다 | 관리자가 버튼 1회를 눌러야 합니다 |
| C | `in_production`과 별개인 "발주" 버튼 | 상태와 발주가 분리됩니다 | 상태가 2개 축이 되어 "제작 중인데 미발주" 같은 상태가 생깁니다 |

**권장 흐름(B)**
1. 관리자가 "제작 시작"을 누릅니다.
2. 기존 게이트(FIXABLE/FAILED 차단, force 허용)를 통과합니다.
3. 원자적 RPC `start_production(order_id, actor, force)`가 `status=in_production` 조건부 UPDATE와 `print_orders` INSERT(status=`pending`)를 한 트랜잭션으로 처리합니다.
4. 감사 로그와 메일은 기존대로 처리합니다.
5. `waitUntil`로 즉시 1회 제출을 시도합니다.
6. 실패하거나 결과를 모르면 cron이 재처리합니다.

A안은 2단계 이후에 "검증 COMPLETED 한정 자동 제작 시작" 옵션으로만 검토합니다.

## 4. 연동 방식 비교

| 항목 | ① Storige 경유 | ② 인쇄소 직접 API | ③ 이메일·FTP 반자동 |
|---|---|---|---|
| 파일 전달 | Storige가 이미 보관 중인 fileId 참조. 파일 재전송 없음 | 인쇄소로 PDF 전송 또는 다운로드 URL 제공이 필요 | 서명된 단기 다운로드 링크를 메일로 보내거나 FTP에 업로드 |
| 새 외부 계약 | Storige 발주 엔드포인트(존재·계약 **Storige 측 확인 필요**) | 인쇄소별 API·키·SLA | 수신 주소와 양식만 |
| 멱등성 | Storige Idempotency-Key 지원 여부 **확인 필요** | 업체에 따라 다름 | 수신자가 중복을 판별해야 함(제목에 발주키 표기) |
| 상태 회신 | Storige 웹훅(서명 존재 언급 STATUS.md:354, 명세 **확인 필요**) | 업체에 따라 다름 | 없음. 관리자가 수동으로 "접수 확인" |
| 취소 | **확인 필요** | 업체에 따라 다름 | 메일·전화 수동 |
| 재사용 자산 | `lib/storige/client.ts`의 키·에러 체계(:85-122) | 없음 | `email_jobs` 큐·Resend·cron(lib/email/queue.ts) |
| 구축 규모 | M (계약 확정 후) | L | S |
| 위험 | 계약 미정이 일정 위험 | 업체 종속, 대용량 전송 | 사람 의존, 링크 유출, 개인정보 메일 전송 |

**권장**: 목표는 ①이고, ①의 계약이 확정될 때까지 ③을 1단계로 먼저 출시합니다.
- 제출 경계는 `lib/print/vendors/{manual,email,storige}.ts`의 `submit`/`cancel` 두 함수로만 둡니다.
- 일반화된 플러그인 구조는 만들지 않습니다.
- 운영 주문이 0건이라(STATUS.md:328) ③만으로도 초기 물량은 충분합니다.

## 5. 데이터 모델 — 마이그레이션 `0034_print_orders.sql` (가정 번호)

`public.print_orders`
- `id uuid pk`, `order_id uuid not null fk orders on delete restrict`, `generation int not null default 1`
- `idempotency_key text not null unique` — 형식 `100p:print:{order_id}:{generation}`
- `provider text check in ('manual','email','storige','direct')`
- `status text check in ('pending','submitting','submitted','accepted','failed','needs_manual','cancel_requested','cancelled')`
- `cover_file_id text`, `interior_file_id text`, `payload jsonb`, `payload_hash text`: 제출 시점 스냅샷(사양·수량·배송지)
- `external_ref text`, `attempt int default 0`, `max_attempts int default 5`, `next_attempt_at timestamptz`, `locked_until timestamptz`, `last_error text`
- `submitted_at`, `accepted_at`, `cancelled_at`, `created_by uuid`, `created_at`, `updated_at`
- 인덱스
  - `unique (order_id, generation)`
  - 부분 유니크 `(order_id) where status not in ('cancelled','failed')`: 주문당 활성 발주 1건(0028·0033 부분 유니크 관례, supabase/migrations/0033_payment_credit_reservation.sql:69)
  - `(status, next_attempt_at)`

`public.print_order_events` (①·② 웹훅 단계에서만)
- `provider`, `event_id unique`, `print_order_id`, `type`, `received_at`, `raw jsonb`: 재전송 dedupe와 감사용

**RLS**
- `enable row level security`
- admin SELECT만 `using (public.is_admin())` (0011:62-68 패턴)
- 쓰기 정책 없음 + `revoke insert,update,delete on ... from anon, authenticated` (0032 관례, lib/security/migration-0032-guard.test.ts:8-12)
- 고객 노출은 하지 않습니다.

**RPC**
- `start_production(p_order_id, p_actor, p_force)`: security definer, `grant execute to service_role`만
- 0031이 지적한 "선행 revoke 누락"을 반복하지 않도록 `revoke all from public, anon, authenticated`를 먼저 실행합니다(0031_tighten_public_grants.sql:12, 44-48).

`orders` 테이블에는 컬럼을 추가하지 않습니다(발주 상태는 조인으로 조회). 운영 적용은 기존 관례대로 SQL Editor에서 수동으로 하고, `docs/sql/0034-postcheck.sql`로 확인합니다.

## 6. 멱등성·재시도·실패 처리

1. **중복 발주 방지 키**: `idempotency_key`를 DB unique 제약으로 막고, 지원하는 벤더에는 헤더로도 보냅니다. 부분 유니크로 같은 주문의 동시 활성 발주를 차단합니다.
2. **클레임**: 워커는 아래 CAS로 행을 점유합니다(email worker·job-runner와 같은 패턴).
   `update ... set status='submitting', locked_until=now()+2m, attempt=attempt+1 where id=? and status in ('pending','failed') and coalesce(next_attempt_at,now())<=now()`
3. **제출 직전 재검증**
   - `orders.status='in_production'`인지 확인합니다. 환불 경합이면 `cancelled`로 바꾸고 외부 호출을 하지 않습니다.
   - 스냅샷 file id가 현재 `orders.storige_*_file_id`와 같은지 확인합니다.
   - 게이트를 재판정합니다(`getValidationBlocks`, force로 시작한 경우는 예외). §2의 게이트 경합 한계를 제출 단계에서 닫는 효과가 있습니다.
4. **결과 분류**

| 결과 | 처리 |
|---|---|
| 2xx | `submitted` 기록 + `external_ref` 저장 |
| 4xx(계약·데이터 오류) | `needs_manual`. 재시도하지 않습니다 |
| 5xx·네트워크 오류 | `failed` + 백오프(lib/email/retry-policy.ts 재사용) |
| 타임아웃(결과 모름) | 벤더가 멱등 키를 지원하면 같은 키로 재시도합니다. 지원하지 않으면 `needs_manual`로 둡니다. 맹목 재전송은 금지합니다 |

5. **cron** `GET /api/cron/submit-print-orders`
   - 5분 주기, `maxDuration 60`, `verifyCronRequest`
   - `locked_until`이 지난 `submitting` 행을 `failed`로 되돌리는 reaper를 포함합니다(lib/pdf/job-reaper.ts 규칙).
   - `in_production`인데 활성 `print_orders`가 없는 주문(RPC 이전 데이터, 수동 전이)을 찾는 대조 기능도 포함합니다.
6. **attempt 초과**: `needs_manual`로 바꾸고 관리자 대시보드 카운트와 운영 메일(email_jobs) 1회로 알립니다.

## 7. 취소·환불과의 상호작용

- **훅 위치**: `refunded`/`cancelled` 클레임 승자만 `requestPrintCancel(orderId, reason)`을 호출합니다. 해당 지점은 세 곳입니다.
  - transition/route.ts:176 (refunded·cancelled 복원 블록)
  - 환불 라우트 클레임 이후
  - 토스 웹훅 refunded 분기(webhook/route.ts:80)
- **발주 상태별 처리**

| 발주 상태 | 처리 |
|---|---|
| `pending`/`failed`/`submitting` | 즉시 `cancelled`. 워커의 제출 직전 재검증이 이중 안전장치입니다 |
| `submitted`/`accepted` | `cancel_requested`. 벤더 cancel을 지원하면 호출하고, 지원하지 않거나 실패하면 `needs_manual` + 관리자 알림 |

- **환불 비차단(권장안, 오너 확인 필요)**: 인쇄 취소가 실패해도 환불 응답은 막지 않습니다. 결제 처리를 우선하고 인쇄 취소 실패는 화면에 드러냅니다. 제작 이후 환불이 이미 force와 사유를 요구하므로(eligibility.ts:62) 관리자 다이얼로그에 "발주 취소 필요" 경고를 추가합니다.
- **재빌드와 충돌**: 활성 발주가 `submitted` 이상이면 rebuild-pdf(rebuild-pdf/route.ts:17-22)를 409로 막습니다. 계속하려면 "발주 취소 후 재발주(generation+1)"를 명시적으로 선택해야 합니다.
- **보존 기간**: retention 90일(constants.ts:44)은 `delivered` 기준이라 발주 시점과 충돌하지 않습니다. 단, 벤더가 파일을 가져가는 시점(③ 링크 TTL 등)이 보존 기간보다 앞서야 합니다.

## 8. 관리자 UI 변경

- **주문 상세**(app/admin/orders/[id]/page.tsx, OrderActions.tsx)에 "인쇄 발주" 패널을 추가합니다.
  - 표시: provider, status 배지, 발주키, external_ref, attempt/max, 마지막 오류, 제출 시각
  - 버튼: "재시도", "수동 발주 완료로 표시"(manual·③ 모드), "발주 취소 요청", "재발주(generation+1)"
  - 모든 버튼은 `logAdminAction`으로 기록합니다(lib/admin/audit.ts:34).
- **"제작 시작" 확인 문구**: flag가 켜져 있으면 "인쇄소로 자동 발주됩니다"를 덧붙입니다. 기존 force 확인(OrderActions.tsx:120-127)도 유지합니다.
- **대시보드**: 기존 `in_production` 카운트(app/admin/page.tsx:60-64) 옆에 `needs_manual`/`failed` 발주 수를 표시합니다.
- **목록·Excel**: 주문 목록에 발주 상태 필터를 추가합니다. Excel(lib/admin/excel.ts:49-60)에 사양 컬럼(판형·쪽수·수량·발주키)을 넣을지는 ③ 양식 결정에 따릅니다.

## 9. 보안

- **키 관리**
  - `PRINT_VENDOR_API_KEY` 등은 서버 env 전용입니다. `NEXT_PUBLIC_` 접두는 금지하고 `server-only` 모듈에서만 읽습니다(lib/storige/client.ts:1, 16-17, 29-32 패턴).
  - 저장소에는 단일 env 검증 모듈이 없고 모듈별로 `process.env`를 읽습니다. 신규 코드도 `lib/print/config.ts` 한 곳에서만 읽습니다.
  - 런치 체크에 키 존재 여부를 추가합니다(lib/admin/launch-status.ts:64 패턴).
  - ① 경유 시 Storige 키 회전에서 사이트 일치를 확인하는 기존 주의(STATUS.md:302-304, 336-337)가 발주 키에도 적용됩니다.
- **웹훅**(①·②)
  - `POST /api/print/webhook/{provider}`에서 원문 body에 대해 HMAC-SHA256을 검증하고 `timingSafeEqual`로 비교합니다(lib/security/cron-auth.ts:52-56).
  - 타임스탬프 허용 창은 ±5분, `event_id`로 dedupe합니다.
  - 서명이 없는 벤더라면 토스 웹훅처럼 "웹훅은 힌트로만 쓰고 벤더 API를 재조회해 대조"합니다(webhook/route.ts:76, 90-102).
  - rate limit을 적용합니다(lib/security/rate-limit.ts).
- **③ 다운로드 링크**
  - Storige fileId를 노출하지 않습니다.
  - `print_orders.id`에 묶인 HMAC 서명·만료(예: 7일) 토큰으로 기존 프록시(lib/storige/client.ts:599)를 경유하게 합니다.
  - 한 번 쓴 링크를 무효화할지는 선택 사항입니다.
- **개인정보**: 배송지·연락처를 인쇄소로 전달하므로 개인정보 처리위탁 고지(`/privacy`)를 갱신해야 합니다(오너 결정). 로그와 `last_error`에 주소 원문을 남기지 않습니다.

## 10. 테스트·롤아웃

- **flag**: `PRINT_AUTO_ORDER_MODE = off | shadow | on` (기본 `off`)
  - `off`: 현재 동작 그대로. RPC도 쓰지 않습니다.
  - `shadow`: `print_orders`를 만들고 payload를 계산하지만 외부 전송은 하지 않습니다. 관리자가 "보냈을 내용"을 확인하고 기존 수동 발주를 병행합니다.
  - `on`: 실제 제출.
- **테스트**(vitest, 기존 관례)
  - 순수 판정 함수 단위 테스트: 제출 가능 판정, 결과 분류, 취소 판정(validation-gate.ts처럼 순수 함수로 분리)
  - 라우트·워커 테스트: memory-supabase 하네스 재사용(app/api/payments/_test/memory-supabase.ts:446-478)
  - 필수 시나리오: 더블클릭, 환불 경합, 타임아웃 후 재시도, 재빌드 차단
  - 0034 정적 가드 테스트: RLS on, 쓰기 revoke, RPC 선행 revoke(0032 가드 방식)
- **단계**

| 단계 | 내용 |
|---|---|
| 0 | §11 결정 |
| 1 | 0034 적용 + `shadow` + ③ 구현. 실주문 N건(오너 지정)을 수동 발주와 대조 |
| 2 | ③ `on` (반자동) |
| 3 | ① 계약 확정 후 Storige 샌드박스 검증 → provider 전환 |
| 4 | (선택) 웹훅으로 `accepted`, 송장 수신 시 `shipped` 자동 전이 |

- **롤백**: env를 `off`로 바꾸고 재배포합니다. 데이터는 남지만 동작은 현재와 같습니다. 0034는 추가 전용이라 되돌리지 않아도 됩니다.

## 11. 오너·Storige 결정·확인 필요 항목

**오너**
1. 인쇄소 정체와 계약 형태(papascompany 내부 공정인지 외부 업체인지)
2. 트리거 B안 승인 여부(A 자동안 배제 여부)
3. 1단계 연동 방식(③ 우선 여부)과 ③ 수신 주소·양식
4. 제출 payload 사양 목록(판형, 쪽수, 수량, 용지, 제본=perfect, 표지 후가공)과 배송 주체(인쇄소 직배송 여부)
5. 환불 시 인쇄 취소 실패를 비차단으로 둘지
6. 발주 후 취소 마감과 비용 부담
7. 개인정보 처리위탁 고지 문구
8. CMYK 요구 여부(#12 연동)
9. shadow 병행 건수와 `on` 전환 기준

**Storige 측 확인 필요**
1. 유형 1 파트너(자체 편집기 + `/files` 업로드)가 쓸 수 있는 발주·제출 엔드포인트가 있는지, "v1 도서 확정"과 같은 것인지(STATUS.md:325, 338)
2. 요청 스키마(fileId 참조 방식, 사양, 배송지), 인증 키 계열(편집기 키인지 워커 키인지 신규 키인지)
3. Idempotency-Key 지원 여부와 중복 요청 시 응답
4. 취소 API와 취소 가능 시점
5. 상태 웹훅 이벤트 종류와 서명 방식(STATUS.md:354의 "웹훅 서명"), 재전송 정책
6. 샌드박스 환경, rate limit, SLA
7. 발주된 파일에 대한 retention·DELETE 동작(발주 후 100p가 DELETE하면 어떻게 되는지)
8. 이 연동이 추가되면 docs/STORIGE-NOTICE.md §1 "사용 경로 8개" 목록을 갱신해야 하는지와 통지 절차

## 12. 단계별 작업 분해와 규모

| # | 작업 | 산출물(예상 경로) | 규모 | 의존 |
|---|---|---|---|---|
| 1 | 0034 마이그레이션 + postcheck SQL + 정적 가드 테스트 | `supabase/migrations/0034_print_orders.sql`, `docs/sql/0034-postcheck.sql` | S | §11 오너 1·2 |
| 2 | 판정 순수 함수 + 테스트 | `lib/print/decide.ts` | S | 1 |
| 3 | `start_production` RPC 연결(transition 라우트의 `paid → in_production` 분기만) + flag | `app/api/admin/orders/[id]/transition/route.ts`, `lib/print/config.ts` | S | 1·2 |
| 4 | 제출 워커 + cron + reaper·대조 + `vercel.json` 등록 | `lib/print/worker.ts`, `app/api/cron/submit-print-orders/route.ts` | M | 2 |
| 5 | ③ 이메일 벤더 + 서명 다운로드 링크 라우트 + 메일 템플릿 | `lib/print/vendors/email.ts`, `app/api/print/files/[token]/route.ts`, `lib/email/templates.ts` | M | 4, 오너 3·4 |
| 6 | 환불·취소 훅 3곳 + 재빌드 차단 | transition·refund·webhook 라우트, rebuild-pdf 라우트 | M | 1·2 |
| 7 | 관리자 UI(패널, 대시보드 카운트, 확인 문구) | `app/admin/orders/[id]/*`, `app/admin/page.tsx` | M | 3·4 |
| 8 | ① Storige 벤더 + 웹훅 + `print_order_events` | `lib/print/vendors/storige.ts`, `app/api/print/webhook/[provider]/route.ts` | M~L | Storige 1~6 |
| 9 | 문서 갱신(STATUS 백로그 #13, 런북 운영 규칙, STORIGE-NOTICE, privacy) | 문서 | S | 각 단계 |

- 같은 파일을 동시에 수정하지 않도록, 6과 3(transition 라우트)은 직렬로 진행합니다.
- 1단계 출시(1~7, ③ 경로)의 총 규모는 대략 M~L입니다. 8은 Storige 계약이 확정된 뒤 별도로 진행합니다.
