# Lillys ↔ 100p Books — 파트너 연동 명세 (v1 초안)

> **목적**: Lillys 사용자가 자신의 사진을 100p Books 포토북으로 만들 수 있도록,
> 양사 시스템을 자연스럽게 연결한다. 사용자 경험은 "Lillys 에서 한 번 클릭 → 100p Books
> 에디터 자동 진입 → 편집/컨펌 → 결제 → 완료" 의 단일 흐름이어야 한다.
>
> **작성**: 2026-05-14 · **상태**: 협의/구현 전 · **연동 책임자(100p)**: yohan73@gmail.com

---

## 1. 통합 모델 비교

| 모델 | 인증 방식 | 사용자 도메인 체험 | UI 임베드 | 결제 주체 | 권장 |
|---|---|---|---|---|---|
| **A. SSO + Redirect (외부 도메인)** | Partner Token 교환 | `100pbooks.com` 으로 페이지 이동 | 없음 | 100p Books | ✅ **권장 (1차)** |
| B. Embedded iframe | postMessage + token | 같은 Lillys 페이지 안에 iframe | O | 100p Books | 추후 옵션 |
| C. Headless / White-label | API + Server-to-Server | Lillys UI 그대로 | — | Lillys | 장기 (별도 SLA) |

본 문서는 **모델 A** 기준으로 작성한다. iframe·white-label 은 1차 구현 안정화 이후 옵션으로 확장.

### 모델 A 핵심 흐름 (1줄)

```
Lillys 사용자 "포토북 만들기" 클릭
  → Lillys 서버가 100p Books `partner.import` 호출(서버↔서버, HMAC 서명)
  → 100p Books 가 import 결과로 임시 세션 토큰 발급
  → Lillys 가 사용자를 `https://100pbooks.com/p/lillys/start?ticket=…` 으로 redirect
  → 100p Books 가 ticket 으로 자동 로그인 → 에디터 진입
  → 편집/컨펌/결제 완료 시 Lillys 로 webhook 통지
```

---

## 2. 사용자 시나리오 (End-to-End)

| # | 단계 | 주체 | 비고 |
|---|---|---|---|
| 1 | 사용자가 Lillys 앱/웹에서 사진 모음을 선택하고 "포토북 만들기" 클릭 | Lillys | 사진은 Lillys CDN 에 있음 |
| 2 | Lillys 서버가 100p Books `POST /api/partner/import` 호출 (HMAC + ts) | Lillys ↔ 100p | 사진 URL 목록 + 메타데이터 |
| 3 | 100p Books 가 import 검증 → 임시 프로젝트/티켓 발급 | 100p | DB INSERT: import job + ticket(30분 TTL) |
| 4 | 100p Books 가 비동기로 외부 사진 fetch + Storage 적재 + 자동 레이아웃 | 100p | 큰 job 은 백그라운드 처리 |
| 5 | Lillys 가 사용자를 `https://100pbooks.com/p/lillys/start?ticket=…` 로 redirect | Lillys | ticket 사용 1회 + HTTPS only |
| 6 | 100p Books 가 ticket 으로 세션 발급 (또는 기존 Lillys 계정과 연결) | 100p | 동의/약관 처음 1회 |
| 7 | 표지 + 내지 에디터 자동 진입 (이미 자동 레이아웃된 상태) | 100p | 사용자가 자유롭게 편집 |
| 8 | 사용자 컨펌 → 책 사이즈/수량/배송지 선택 → 결제(TossPayments) | 100p | TossPayments confirm |
| 9 | 결제 성공 즉시 PDF 빌드 → 인쇄소 발주 큐 적재 | 100p | 100p 내부 파이프라인 |
| 10 | 100p Books → Lillys `POST {lillys-webhook}` 주문 완료 통지 | 100p ↔ Lillys | 결제/상태 변경 webhook |
| 11 | 배송 단계 변경 시 추가 webhook (paid/in_production/shipped/delivered) | 100p ↔ Lillys | 멱등 처리 |

---

## 3. 인증 / 시크릿

### 3.1 Partner 자격증명

| 항목 | 발급 위치 | 보관 책임 |
|---|---|---|
| `partner_id` | 100p Books 관리자 콘솔 | Lillys = 평문 OK |
| `partner_secret` | 100p Books 관리자 콘솔 (1회 표시) | Lillys = secret store |
| `lillys_webhook_url` | Lillys 가 100p Books 에 등록 | 100p = DB |
| `lillys_webhook_secret` | Lillys 가 1회 발급 → 100p Books 등록 | 100p = env / secret |

### 3.2 요청 서명 (HMAC-SHA256)

모든 서버-서버 호출에 다음 헤더 필수:

```http
X-Partner-Id: lillys
X-Partner-Ts: 1715000000               # epoch seconds
X-Partner-Signature: <hex digest>      # HMAC-SHA256(secret, `${ts}.${body}`)
Content-Type: application/json
Idempotency-Key: <UUID>                # 같은 키 재시도 시 동일 응답
```

#### 서명 계산 (Lillys 측 의사코드)

```ts
const ts = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify(payload);
const sig = crypto
  .createHmac("sha256", partnerSecret)
  .update(`${ts}.${body}`)
  .digest("hex");
```

#### 서명 검증 (100p Books 측)

* `|now - ts| > 300s` → 401 (replay attack 차단)
* `Idempotency-Key` 재사용 → 첫 응답 200/4xx 그대로 재전송 (1시간 캐시)
* `partner_id` 가 active 한 파트너가 아니면 403

---

## 4. API 명세

### 4.1 `POST /api/partner/import` — 사진 묶음 import

**Lillys → 100p Books** : 사진 + 메타데이터를 전달하고 임시 ticket 받기.

#### Request

```json
{
  "partner_user_id": "lillys_user_8f9a...",
  "partner_user_email": "user@example.com",
  "partner_user_name": "홍길동",

  "title": "2026 봄 가족여행",
  "book_size_hint": "square_148",
  "auto_layout": "polaroid",

  "photos": [
    {
      "source_id": "lillys_photo_001",
      "url": "https://cdn.lillys.com/p/abc123.jpg",
      "filename": "IMG_0001.jpg",
      "taken_at": "2026-04-12T14:33:00Z",
      "caption": "벚꽃 핀 한강"
    }
  ],

  "address": {
    "name": "홍길동",
    "phone": "010-1234-5678",
    "zip": "06234",
    "addr1": "서울 강남구 ...",
    "addr2": "101동 1001호"
  },

  "callback_url": "https://lillys.com/photobook/done"
}
```

| 필드 | 필수 | 검증 | 비고 |
|---|---|---|---|
| `partner_user_id` | ✅ | 문자열, 64자 | Lillys 내부 사용자 ID |
| `partner_user_email` | ✅ | email | 100p 계정 매칭/생성 키 |
| `title` | ✅ | 1~80자 | 책 표지 기본 제목 |
| `book_size_hint` | ⛔ | `square_148` `a5` `mini_96` 중 1 | 사용자가 변경 가능 |
| `auto_layout` | ⛔ | `polaroid` `collage_2v` `collage_4` 등 | 자동 레이아웃 프리셋 |
| `photos[]` | ✅ | 1~100 | 100 초과 시 400 |
| `photos[].url` | ✅ | https URL | 100p 가 fetch 가능해야 함 (Public 또는 signed) |
| `photos[].taken_at` | ⛔ | ISO 8601 | 시간순 정렬에 사용 |
| `photos[].caption` | ⛔ | 200자 | 자동 레이아웃에 텍스트로 삽입 |
| `address` | ⛔ | — | 있으면 결제 단계 prefill |
| `callback_url` | ⛔ | https URL · 같은 도메인 | 결제 완료 후 사용자 redirect 대상 |

#### Response (202 Accepted)

```json
{
  "ok": true,
  "data": {
    "import_id": "imp_AKw3...",
    "ticket": "tkt_29Lkj...",
    "ticket_expires_at": "2026-05-14T15:32:00Z",
    "redirect_url": "https://100pbooks.com/p/lillys/start?ticket=tkt_29Lkj...",
    "estimated_ready_seconds": 10
  }
}
```

* `ticket` 은 단 1회 사용 + 30분 TTL.
* import 자체는 비동기. 이미지 fetch + 레이아웃은 사용자가 redirect 페이지에 도착할 즈음에 끝나도록 최적화 (Vercel Functions 병렬).
* 사용자가 너무 빨리 도착하면 100p Books 가 "준비 중..." 진행 UI 표시.

#### 에러 응답 (HTTP 4xx/5xx)

| 코드 | 의미 |
|---|---|
| 400 `INVALID_BODY` | zod 검증 실패. `details` 에 필드별 메시지. |
| 401 `INVALID_SIGNATURE` | HMAC 불일치 또는 ts skew >300s |
| 403 `PARTNER_INACTIVE` | partner_id 비활성 |
| 409 `IDEMPOTENT_CONFLICT` | Idempotency-Key 중복 + payload 변경 |
| 413 `TOO_MANY_PHOTOS` | photos.length > 100 |
| 502 `PHOTO_FETCH_FAILED` | 사진 URL 다운로드 실패 (3회 retry 후) |

---

### 4.2 `GET /api/partner/import/[id]` — 상태 조회

Lillys 가 import 진행도를 폴링하거나, 100p Books 가 같은 데이터로 멱등 응답.

```json
{
  "ok": true,
  "data": {
    "import_id": "imp_AKw3...",
    "status": "ready",           // pending | importing | ready | failed
    "photos_total": 32,
    "photos_imported": 32,
    "project_id": "p_q83Lk...",  // ready 이후만
    "redirect_url": "https://100pbooks.com/p/lillys/start?ticket=..."
  }
}
```

---

### 4.3 `POST /api/partner/webhook` (100p Books → Lillys) — 상태 통지

100p Books 가 Lillys 등록 `lillys_webhook_url` 로 호출. 멱등 처리 + 재시도 (1m/5m/30m/2h/12h).

```json
{
  "event": "order.status_changed",
  "event_id": "evt_8Ks...",
  "occurred_at": "2026-05-14T18:00:00Z",
  "partner_user_id": "lillys_user_8f9a...",
  "data": {
    "order_id": "ord_91Ka...",
    "import_id": "imp_AKw3...",
    "status": "paid",        // pending | paid | in_production | shipped | delivered | cancelled | refunded
    "amount": 28500,
    "currency": "KRW",
    "tracking": {
      "carrier": "CJ대한통운",
      "number": "123456789012",
      "url": "https://trace.cjlogistics.com/?invoice=123456789012"
    }
  }
}
```

| 헤더 | 값 |
|---|---|
| `X-100p-Event-Id` | `evt_…` (Lillys 가 중복 dedupe 키로 사용) |
| `X-100p-Signature` | HMAC-SHA256(`lillys_webhook_secret`, `${ts}.${body}`) |
| `X-100p-Ts` | epoch seconds |

**Lillys 응답 정책**:
* 2xx → 성공으로 간주.
* 4xx/5xx → 위 재시도 스케줄에 따라 최대 5회 시도.
* `event_id` 가 같으면 절대 두 번 처리하지 않도록 Lillys 측 멱등 보장.

---

### 4.4 `POST /api/partner/lookup` — 사용자 ↔ 주문 조회

Lillys 가 CS 화면에서 "현재 진행 중인 주문?" 같은 질의를 할 때 사용. partner_user_id 기준.

```json
// Request
{ "partner_user_id": "lillys_user_8f9a..." }

// Response
{
  "ok": true,
  "data": {
    "orders": [
      { "order_id": "ord_91Ka...", "status": "shipped", "amount": 28500, "created_at": "..." }
    ],
    "projects": [
      { "project_id": "p_q83Lk...", "title": "...", "last_edited_at": "..." }
    ]
  }
}
```

---

## 5. 사용자 페이지 흐름 (100p Books 도메인)

| 경로 | 역할 |
|---|---|
| `/p/lillys/start?ticket=…` | 티켓 검증 → 세션 발급 → 에디터로 redirect. 미진입자는 "준비 중..." 진행 UI. |
| `/editor/[projectId]` | 기존 100p Books 내지 에디터 (Fabric.js). |
| `/cover/[projectId]` | 표지 에디터. |
| `/order/[projectId]` | 사이즈/수량/배송지/결제. address 가 import 에서 들어왔으면 prefill. |
| `/order/[projectId]/success` | 결제 완료 → "Lillys 로 돌아가기" 버튼 (`callback_url`). |

---

## 6. DB 스키마 변경 (제안)

```sql
-- 0025_partner_lillys.sql

create table public.partners (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,          -- 'lillys'
  display_name  text not null,
  active        boolean not null default true,
  partner_secret text not null,                -- HMAC secret (admin 콘솔에서 회전 가능)
  webhook_url   text,                          -- Lillys 의 수신 endpoint
  webhook_secret text,                         -- Lillys 가 제공한 secret (100p 가 서명에 사용)
  created_at    timestamptz not null default now()
);

create table public.partner_imports (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id),
  partner_user_id text not null,
  partner_user_email text,
  status        text not null check (status in ('pending','importing','ready','failed')),
  project_id    uuid references public.projects(id),
  user_id       uuid references auth.users(id),
  payload       jsonb not null,                -- 원본 요청 보관 (감사용)
  ticket_hash   text,                          -- ticket sha256
  ticket_used_at timestamptz,
  ticket_expires_at timestamptz,
  idempotency_key text,                        -- Lillys 가 보낸 키
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index partner_imports_idem
  on public.partner_imports(partner_id, idempotency_key);

create table public.partner_webhook_attempts (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id),
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  attempt       int  not null default 0,
  next_attempt_at timestamptz,
  delivered_at  timestamptz,
  last_response int,
  created_at    timestamptz not null default now()
);
create unique index partner_webhook_event_unique
  on public.partner_webhook_attempts(partner_id, event_id);

-- orders 테이블에 import 추적용 컬럼 추가
alter table public.orders
  add column if not exists partner_import_id uuid references public.partner_imports(id),
  add column if not exists partner_id uuid references public.partners(id);
```

---

## 7. 보안 / 운영

### 7.1 보안

| 위협 | 방어 |
|---|---|
| 페이로드 위조 | HMAC-SHA256 + ts 검증 (±300s) |
| Replay | `Idempotency-Key` UNIQUE + ts 검증 |
| Ticket 탈취 | URL 노출 최소화 + 1회 사용 + 30분 TTL + ticket_hash 저장 (평문 미저장) |
| Webhook 위조 | 100p → Lillys 도 동일 HMAC. Lillys 가 webhook_secret 으로 검증 필수. |
| 외부 사진 SSRF | URL 화이트리스트 (`*.lillys.com` `*.cdn.lillys.com`) — 내부 IP/loopback 차단 |
| 임의 callback redirect | `callback_url` 도메인 화이트리스트 (`*.lillys.com`) |
| Rate limit | 분당 60 import / IP. Lillys partner_id 별 분당 600. |

### 7.2 운영 / SLA

| 지표 | 목표 |
|---|---|
| import API p95 응답 | < 500ms (사진 fetch 는 백그라운드) |
| import → 에디터 진입 가능 (photos_imported = total) | < 30s (사진 100장 기준) |
| webhook 첫 시도 → Lillys 도달 | < 5s (결제/상태 변경 시각 기준) |
| 가동률 | 99.5% |
| 운영 알림 채널 | 양사 PIC 슬랙 / 이메일 |

---

## 8. 단계별 시퀀스

```
┌──────────┐                  ┌──────────────┐                  ┌──────────┐
│  Lillys  │                  │ 100p Books   │                  │  사용자  │
│   서버   │                  │  서버/DB     │                  │ (브라우저)│
└────┬─────┘                  └──────┬───────┘                  └────┬─────┘
     │                               │                               │
     │ ① POST /api/partner/import    │                               │
     │   (HMAC + photos + meta)      │                               │
     │──────────────────────────────►│                               │
     │                               │ ② import 검증 + ticket 발급   │
     │                               │   DB: partner_imports INSERT  │
     │ ◄─────────────────────────────│                               │
     │   202 {ticket, redirect_url}  │ ③ async: 사진 fetch + layout  │
     │                               │   Storage 적재 + projects     │
     │                               │   INSERT + photos INSERT      │
     │                               │                               │
     │ ④ 사용자에게 redirect 전송    │                               │
     │   /p/lillys/start?ticket=…    │                               │
     │──────────────────────────────────────────────────────────────►│
     │                               │ ⑤ ticket 검증 + 세션 발급     │
     │                               │ ◄─────────────────────────────│
     │                               │   GET /p/lillys/start?...     │
     │                               │ ──────────────────────────────►
     │                               │   302 → /editor/[projectId]   │
     │                               │                               │
     │                               │ ⑥ 사용자 편집 (Fabric)        │
     │                               │ ◄──────────────────────────────
     │                               │                               │
     │                               │ ⑦ 컨펌 → /order/[projectId]   │
     │                               │   결제 (TossPayments)         │
     │                               │ ◄──────────────────────────────
     │                               │                               │
     │                               │ ⑧ payments/confirm → paid     │
     │                               │   PDF 빌드 + 인쇄소 큐        │
     │                               │                               │
     │ ⑨ POST {webhook_url}          │                               │
     │   {event: order.paid}         │                               │
     │ ◄─────────────────────────────│                               │
     │   2xx ack                     │                               │
     │ ──────────────────────────────►│                               │
     │                               │ ⑩ 상태 변경 시마다 추가 webhook │
     │ ◄─────────────────────────────│   (in_production, shipped...) │
     │                               │                               │
     │ ⑪ 사용자 redirect            │                               │
     │   callback_url?order_id=…    │                               │
     │ ◄──────────────────────────────────────────────────────────────│
```

---

## 9. 미해결 / 추후 협의 항목

* [ ] **결제 주체** — 현재 안은 100p Books 가 결제. Lillys 가 통합 결제 원하면 별도 settlement API 필요.
* [ ] **계정 매칭 정책** — `partner_user_email` 이 기존 100p 계정과 같으면 연결할지, 항상 별도 sub-account 로 만들지.
* [ ] **사진 만료** — Lillys CDN URL TTL 이 짧으면 import 즉시 다운로드 강제 필요.
* [ ] **편집 데이터 회수** — Lillys 가 최종 PDF 결과를 받고 자체 보관하길 원하는지.
* [ ] **i18n** — Lillys 사용자 한국어 외 언어 지원 여부.
* [ ] **취소/환불 흐름** — Lillys → 100p 취소 요청 API 필요 여부.

---

## 10. 구현 로드맵 (100p 측)

| 단계 | 작업 | 산정 |
|---|---|---|
| 1 | DB 마이그레이션 0025 (partners / partner_imports / webhook_attempts) | 0.5일 |
| 2 | `lib/partner/` — HMAC 서명/검증, idempotency 유틸 | 0.5일 |
| 3 | `POST /api/partner/import` + import job worker | 2일 |
| 4 | `POST /api/partner/webhook` 송출 + 재시도 큐 | 1일 |
| 5 | `/p/lillys/start` 진입 페이지 (ticket → 세션 → editor) | 1일 |
| 6 | Admin 콘솔에 partners CRUD + secret 회전 + 호출 로그 | 1일 |
| 7 | 통합 테스트 (mock Lillys 서버) + Playwright E2E | 1일 |
| 8 | 운영 가이드 + Lillys 측 SDK / curl 예제 | 0.5일 |
| **합계** | | **약 7.5일 (1.5주)** |

---

## 부록 A — Lillys 측 curl 예시

```bash
# import 호출
TS=$(date +%s)
BODY='{"partner_user_id":"lillys_user_8f9a","partner_user_email":"u@example.com","title":"봄 여행","photos":[{"source_id":"p1","url":"https://cdn.lillys.com/p/abc.jpg"}]}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PARTNER_SECRET" -hex | awk '{print $2}')

curl -X POST https://100pbooks.com/api/partner/import \
  -H "Content-Type: application/json" \
  -H "X-Partner-Id: lillys" \
  -H "X-Partner-Ts: $TS" \
  -H "X-Partner-Signature: $SIG" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "$BODY"
```

## 부록 B — 100p 측 webhook 수신 검증 (Lillys 코드)

```ts
import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

app.post("/webhooks/100pbooks", (req, res) => {
  const ts = req.header("X-100p-Ts") ?? "";
  const sig = req.header("X-100p-Signature") ?? "";
  const body = (req as any).rawBody.toString("utf8");

  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    return res.status(401).end("ts skew");
  }
  const expected = crypto
    .createHmac("sha256", process.env.LILLYS_WEBHOOK_SECRET!)
    .update(`${ts}.${body}`)
    .digest("hex");
  if (sig !== expected) return res.status(401).end("bad signature");

  // event_id 멱등 처리 후 비즈니스 로직
  return res.status(200).end("ok");
});
```

---

_Last updated: 2026-05-14 · 작성: 100p Books 팀_
