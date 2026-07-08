# 100p Books — 개발 현황 및 다음 단계

> 최종 업데이트: 2026-06-22
> 배포 URL: https://100pbooks.vercel.app
> 레포지토리: https://github.com/papascompany/100p_books
> 운영 빌드: `296d02c` (fix(security): 감사 리뷰 fix-forward)
> **정본 로컬 경로**: `/Users/yohan/Developer/claude/100p_books` (Documents 사본은 node_modules 제거됨)

---

## 🆕 최근 작업 (2026-06-13 ~ 06-22)

### 1. Storige 인쇄 백엔드 일원화 (PDF 저장·검증·다운로드) — 라이브
- 인쇄 PDF 저장처를 Supabase `pdfs` 버킷 → **Storige API**(`api.papascompany.co.kr/api`)로 이전.
  자체 렌더러(@napi-rs/canvas + pdf-lib)·에디터는 그대로 유지.
- `lib/storige/client.ts` — 유일한 외부 경계. **키 2종**: `STORIGE_API_KEY`(편집기 → `/files/*`),
  `STORIGE_WORKER_API_KEY`(워커 → `/worker-jobs/*` 인쇄검증). 둘 다 서버 env 전용.
- 업로드 2경로: ≤90MB multipart(`/files/upload/external`), **>90MB presigned 직결**
  (`/files/presigned-upload-public` → R2 PUT → complete, 최대 2GB). uploadUrl SSRF 검증 + Content-Length.
- 다운로드 **서버 프록시**(`/api/orders/[id]/download/[kind]`, `/api/pdf/download/[jobId]/[kind]`) — fileId 비노출.
- 보존정책 cron `/api/cron/storige-retention` (배송완료+N일 → 삭제+컬럼 NULL).
- DB: `orders.storige_cover_file_id / storige_interior_file_id / storige_validation`(마이그레이션 **0026**).
- E2E 실증: 100p(105.9MB) presigned 업로드→다운로드 바이트동일→인쇄검증 **COMPLETED**.

### 2. 100p 대용량 PDF 최적화 — 라이브
- PNG→**JPEG q90 임베드**(`embedJpg`) + 스트리밍 합성으로 100p PDF 578MB→~106MB, 빌드 156s→19s.
- 결제 confirm의 PDF 빌드를 **`waitUntil` 백그라운드**로 분리(응답 비블로킹).

### 3. 전수감사(서브에이전트) 46건 → **전부 수정·배포 + 적대적 검증**
- 발견: critical 4 / high 8 / medium 16 / low 14 / info 4 (거짓양성 0).
- 배포 커밋: critical=`e998870`, high=`81323d7`, medium/low/info=`52e80a6`, 리뷰 fix-forward=`296d02c`.
- 주요 수정: 인증우회(`requireUser`→`getUser` 서명검증), 결제 webhook 위조방지(시크릿 필수+재조회+금액검증),
  결제 멱등(조건부 클레임), 환불 포인트·할인 복원(`lib/orders/refund.ts`), 엑셀 수식인젝션, 탈퇴 admin 차단,
  출석/선물 멱등, 리뷰 PII 제거, RLS 보강 등. 모든 커밋 **Vercel 클린 빌드 SUCCESS**.

### Supabase 마이그레이션 운영 적용 현황 (대시보드 수동 — MCP는 타 계정이라 불가)
- `0026_storige_pdf_storage.sql` — **적용 완료**(사용자 확인).
- `0027_reviews_storage_rls.sql` — reviews 버킷 anon SELECT 차단. **적용 완료(2026-07-04)** — 사용자 확인.
- `0028_concurrency_unique_indexes.sql` — gift/출석보너스 멱등 부분유니크 인덱스.
  **적용 완료(2026-07-04)** — 사전 점검(gift 활성 중복·보너스 중복) 둘 다 0행 확인 후 적용.

### 환경/배포 메모
- **GitHub auto-deploy 정상**(실커밋 push→자동 빌드 확인). 빈 커밋은 Vercel이 스킵하므로 무시.
- 로컬 `pnpm lint/build`는 세션 재개 후 **node v22 ↔ comment-json 툴링 크래시**로 불가(코드 무관).
  → **`tsc --noEmit`은 정상**, **Vercel 클린 빌드가 권위 검증**.
- Supabase MCP/CLI는 다른 계정("storige's Org") → 운영 DB `vprifnztvlduhpuwgdau` 직접 SQL 불가 → 대시보드 수동.

### 보류 (착수 대기)
- **데모 모드**: 인증/RLS 무훼손 + `/login` "데모 둘러보기" 원클릭 로그인(`/api/auth/demo-login`, 전용 데모계정,
  `DEMO_MODE` env 토글). 사용자가 "구현 시작" 시 진행. 운영자 준비물: 데모계정 생성 + DEMO_* env.

---

## 🔗 플랫폼 계정 연동 상태 (2026-05-30 확인)

| 플랫폼 | 연결된 계정/조직 | 식별자 | 상태 |
|---|---|---|---|
| **GitHub (repo)** | `papascompany/100p_books` | git remote origin | ✅ 정상 |
| **GitHub (commit author)** | `storigehub` <storige.yohan@gmail.com> | `git config user` | ✅ 정상 |
| **GitHub CLI (gh)** | `papascompany` (active) + `storigehub` (보조) | keyring 2계정 | ✅ 정상 |
| **Vercel (project)** | team `team_dOpgsAqfLyl4qNlVgSiFVm6B` | `prj_TRSlQDOz5xZpfc5Bg0YlxTxGFasX` | ✅ 링크됨 |
| **Vercel (CLI 토큰)** | — | `vercel whoami` 실패 | ⚠️ **토큰 만료 — 재로그인 필요** |
| **Supabase (project)** | `100p_books` | ref `vprifnztvlduhpuwgdau` (Seoul) | ✅ 링크됨 |
| **Supabase (org)** | `rpgjrckrcrxhrbrimjbv` | linked-project.json | ✅ 정상 |
| **Supabase (CLI 로그인)** | `Storywork` 조직 (타 계정) | `supabase orgs list` | ⚠️ **다른 계정 — 100p 조직 미표시** |

### 계정 연동 주의사항
- **Vercel CLI 토큰 만료**: `vercel whoami` → "token is not valid". `vercel login` 으로 재발급 필요.
  배포는 GitHub auto-deploy 로 정상 동작 중이라 긴급도는 낮으나, 수동 `vercel --prod` / 로그 조회는 불가.
- **Supabase CLI 가 타 계정(Storywork)으로 로그인**: `100p_books`(rpgjrckrcrxhrbrimjbv) 조직이 안 보임.
  → `supabase db push` 직접 적용 불가. 마이그레이션은 SQL Editor 수동 실행으로 진행 중 (0023/0024 완료).
  papascompany 계정 운영 자동화 원하면 `supabase logout && supabase login` 재인증 필요.

---

## 전체 마일스톤 진척도

| 마일스톤 | 상태 | 완료일 | 비고 |
|---|---|---|---|
| M0 Bootstrap | ✅ 완료 | - | DB 스키마 0001~0023, Auth, RLS |
| M1 이미지 파이프라인 | ✅ 완료 | - | EXIF, HEIC→JPEG, 썸네일, 정렬 4종 |
| M2 자동 레이아웃 | ✅ 완료 | - | 폴라로이드/콜라주/커버 템플릿 |
| M3 Fabric.js 에디터 | ✅ 완료 | - | FabricStage, Toolbar, 모바일 제스처 |
| M4 표지 편집기 | ✅ 완료 | - | 3D 프리뷰, 책등 자동 계산 |
| M5 PDF 생성 | ✅ 완료 | - | 300dpi, 2mm bleed, @napi-rs/canvas |
| M6 주문/결제 | ✅ 완료 | - | TossPayments, 주문 상태 머신 |
| M7 관리자 콘솔 | ✅ 완료 | - | 책 사이즈 CRUD, 리소스, 주문, Excel |
| M16 성장 기능 | ✅ 완료 | 2026-05-13 | 공유/선물/할인/추천/후기/출석/포인트/카카오 OAuth |
| M17 모바일 PWA | ✅ 완료 | - | manifest, SW v2 (SWR), 카메라 업로드 |
| M8 QA & 폴리싱 | 🟡 일부 완료 | 2026-05-13 | PDF 런타임·E2E·Lighthouse 측정 완료, WCAG 미측정 |
| M-홈리뉴얼 | ✅ 완료 | 2026-05-14 | §3 특징 / §4 사이즈 카드를 사진 배경 + fade-up 진입 |
| M-내비최적화 | ✅ 완료 | 2026-05-14 | staleTimes / loading 8개 / RPC 단일화 / SW SWR / legal 정적 |
| M5-패치 | ✅ 완료 | 2026-05-13 | PDF borderRadius+shadow 2-pass 분리 |

---

## M8 QA & 측정 결과 (2026-05-13)

### PDF 파이프라인 런타임 검증
- 스크립트: `pnpm verify:pdf` (`scripts/verify-pdf.ts`)
- 결과: 145mm sq · text 2 + rect 1 · **39,996 bytes / 353ms** · PDF 1.7 헤더 정상
- vitest jsdom 환경에서는 `@napi-rs/canvas` toBuffer 가 NaN → tsx 기반 별도 검증으로 우회
- 출력: `tmp/verify-pdf-out.pdf` (gitignored)

### Playwright E2E
- 설정: `playwright.config.ts` (chromium-desktop + mobile-chromium 2 프로젝트)
- 스모크: `e2e/smoke.spec.ts` 6 케이스 × 2 viewport = **12/12 통과** (5.7s)
- 실행: `pnpm e2e` (자동 dev 서버) / `PLAYWRIGHT_BASE_URL=... pnpm e2e` (외부 URL)
- 커버: 홈, /upload(가드), /gallery, /login, /mypage, /mypage/points

### Lighthouse 모바일 (운영 https://100pbooks.vercel.app/)
| 지표 | 값 | 점수 | 목표 |
|---|---|---|---|
| **Performance** | — | **97/100** | — |
| **LCP** | **1.5s** | 1.00 | < 2.5s ✅ |
| FCP | 1.3s | 0.98 | < 1.8s ✅ |
| TBT | 10ms | 1.00 | < 200ms ✅ |
| CLS | 0 | 1.00 | < 0.1 ✅ |
| Speed Index | 4.8s | 0.68 | < 3.4s ⚠ |
| TTI | 7.3s | 0.49 | < 3.8s ⚠ |

Core Web Vitals(LCP/CLS/INP-대용 TBT) 모두 통과. Speed Index/TTI 는 클라이언트 JS
사이즈(fabric chunk 등)의 영향이며 핵심 LCP 에는 영향 없음.
리포트: `tmp/lighthouse/100pbooks.report.html`

---

## M16 성장 기능 세부 현황 — ✅ 전부 완료

| 기능 | DB | API | UI | 상태 |
|---|---|---|---|---|
| 프로젝트 공유 링크 | ✅ | ✅ | ✅ `/share/[token]` | ✅ 완료 |
| 선물하기 | ✅ | ✅ | ✅ `/gift/[token]` | ✅ 완료 |
| 할인 코드 — Admin 관리 | ✅ | ✅ | ✅ `/admin/discounts` | ✅ 완료 |
| 할인 코드 — 결제 시 적용 | ✅ | ✅ `/api/discounts/validate` + `discount_uses` | ✅ `OrderForm` | ✅ 완료 |
| 친구 추천 (referral) | ✅ | ✅ | ✅ | ✅ 완료 |
| 후기 갤러리 — 공개 목록 | ✅ | ✅ | ✅ `/gallery` | ✅ 완료 |
| 후기 — 사용자 작성 | ✅ | ✅ | ✅ `ReviewDialog` (orders 리스트 + 주문 상세) | ✅ 완료 |
| 출석체크 + 포인트 적립 | ✅ | ✅ | ✅ `/attendance` | ✅ 완료 |
| 포인트 내역 전용 페이지 | ✅ | ✅ | ✅ `/mypage/points` (200건) + 인라인 카드 | ✅ 완료 |
| 이메일 발송 (Resend) | ✅ | ✅ | - | ⚠️ API Key 등록 필요 |

---

## M-내비최적화 (2026-05-14) — 페이지 이동 속도 개선

### Phase 1
- `next.config.mjs` `experimental.staleTimes { dynamic: 30, static: 180 }` — Router Cache TTL 활성화
- `loading.tsx` 8개 신규 추가 — 페이지 진입 즉시 pulse 스켈레톤
  - `/mypage/orders/[orderId]`, `/mypage/photos`, `/mypage/trash`, `/mypage/account`, `/mypage/points`, `/order/[projectId]`, `/cover/[projectId]`, `/login`
- `mypage/orders/[orderId]` 의 reviews(id) inline join — 평균 50~100ms 단축

### Phase 2
- `/terms` · `/privacy` · `/refund` 를 `force-static + revalidate=false` — ƒ Dynamic → ○ Static, CDN edge 캐시
- PWA Service Worker v1 → v2 (SWR) — 공개 페이지는 캐시 즉시 + 백그라운드 fetch / 보호 페이지는 network-first
- `/mypage` 카운트 4종을 `get_user_dashboard_counts` 단일 RPC 로 — RTT 2회 → 1회 (마이그레이션 0024)

---

## 현재 배포 상태

```
Next.js:  14.2.35 (2026-05-10 보안 패치 완료)
Supabase: vprifnztvlduhpuwgdau (Seoul / papascompany org)
Vercel:   yohans-projects-de3234df / icn1 리전
DB 마이그레이션: 0001 ~ 0028 운영 적용 (0023·0024: 2026-05-14 / 0026: Storige / 0027·0028: 2026-07-04)
정적 라우트:    /terms, /privacy, /refund, /offline, /robots.txt, /sitemap.xml, /_not-found
PWA Service Worker: v2 (Stale-While-Revalidate 공개 페이지)
Router Cache:   staleTimes { dynamic: 30s, static: 180s }
```

---

## 운영 활성화를 위한 수동 작업 (코드 외)

### 1순위 — 없으면 서비스 불가

| 항목 | 작업 | 상태 |
|---|---|---|
| DB 마이그레이션 0023 적용 | `0023_point_ledger.sql` — 포인트 ledger + 카카오 sync RPC | ✅ 2026-05-14 완료 |
| DB 마이그레이션 0024 적용 | `0024_user_dashboard_counts.sql` — mypage 카운트 RPC | ✅ 2026-05-14 완료 |

### 2순위 — 소셜 로그인

| 항목 | 작업 | 참고 문서 |
|---|---|---|
| Kakao Developers 앱 생성 | REST API Key + Client Secret 발급 | `CLAUDE.local.md` §카카오 |
| Supabase Auth Providers | Kakao Enable + Key 입력 + Callback URL 등록 | `CLAUDE.local.md` §카카오 |

### 3순위 — 이메일

| 항목 | 작업 | 참고 문서 |
|---|---|---|
| Resend 가입 + API Key 발급 | resend.com | `CLAUDE.local.md` §이메일 |
| Vercel 환경변수 등록 | `RESEND_API_KEY`, `EMAIL_FROM` | `CLAUDE.local.md` §이메일 |
| (선택) 도메인 DNS 인증 | SPF/DKIM/DMARC 등록 | Resend 대시보드 |

### 4순위 — 결제

| 항목 | 작업 |
|---|---|
| TossPayments 계정 | 사업자 등록 후 심사 신청 |
| Vercel 환경변수 | `TOSS_SECRET_KEY`, `NEXT_PUBLIC_TOSS_CLIENT_KEY` |

---

## 다음 개발 우선순위 (권고) — 2026-05-30 갱신

### 🔴 운영 활성화 (코드 외 — 사용자 콘솔 작업)

1. ~~**Supabase 운영 DB 마이그레이션 적용** — 0023 + 0024~~ ✅ **완료 (2026-05-14)**
2. **Kakao OAuth 콘솔 등록** — REST API Key + Client Secret → Supabase Provider Enable
3. **Resend API Key + EMAIL_FROM Vercel 환경변수** — 가입/주문 메일 실 발송
4. **TossPayments 운영 키** — 라이브 키 + 웹훅 secret 등록
5. **(선택) Upstash Redis 구독 + env** — Rate limit 활성화 (미설정 시 fail-open, 보안 권장)

### 🔧 로컬 개발 환경 — CLI 재인증 (운영 자동화용, 선택)

| 항목 | 증상 | 조치 |
|---|---|---|
| Vercel CLI 토큰 만료 | `vercel whoami` 실패 | `vercel login` 재발급 — 수동 배포/로그 조회 복구 |
| Supabase CLI 타 계정 로그인 | `Storywork` 조직만 표시, 100p 안 보임 | `supabase logout && supabase login` (papascompany 계정) |

> 두 항목 모두 **운영에는 영향 없음** (배포=GitHub auto-deploy, 마이그레이션=SQL Editor 수동).
> CLI 자동화가 필요할 때만 재인증.

### 🟡 품질 보강

5. **WCAG 2.1 AA 접근성 감사** — Lighthouse a11y 카테고리 + axe-core 자동 감사 + 키보드 only 회귀
6. **Lighthouse Speed Index / TTI 추가 개선** — 현재 LCP 1.5s / Performance 97 (Core Web Vitals OK), SI 4.8s / TTI 7.3s 노란불 잔존. fabric.js 추가 lazy split, 홈 hydration 분리
7. **인증된 사용자 E2E 시나리오 확장** — 현재 스모크는 익명/가드만. 매직링크 mock + 업로드 → 에디터 → 주문 골든 플로우
8. **PDF 100페이지 부하 검증** — Vercel Pro 플랜 가입 후 실측 (현재 1페이지 + photo+shadow 케이스만)
9. **PDF 회귀 테스트 CI 통합** — 결과 PDF 페이지 수 + 첫 페이지 SHA-256 비교 (CLAUDE.md 명시 항목)
10. **mypage 의 photo count RPC 운영 적용 후 실측** — 0024 마이그레이션 활성화 후 실제 단축 측정

### 🟢 장기 / 인프라

11. **Next.js 15/16 마이그레이션** — SECURITY.md 의 잔존 6건 CVE 완전 해소
12. **Fabric.js 7.x 마이그레이션** — SVG Stored XSS CVE 사전 차단 (현재 직접 노출 경로 없음)
13. **PDF SSE 진행률 Redis 전환** — 멀티 인스턴스에서 진행률 라우팅 안정화
14. **PDF CMYK / ICC 프로파일** — 인쇄소 요구 시 sharp ICC pipeline 또는 ghostscript
15. **인쇄소 자동 발주 연동** — 주문 상태 `in_production` 진입 시 자동 발주 API

---

## PDF 파이프라인 운영 메모

- **아키텍처**: 별도 서버 불필요. Vercel Function 단독 처리 (POST `/api/pdf/build`)
- **렌더러**: `@napi-rs/canvas` (Rust 기반, Fabric.js 서버 사용 안 함)
- **Hobby 플랜**: `maxDuration=60s` 제한 → 20~30페이지 한도
- **Pro 플랜**: `maxDuration=300s` → 100페이지 안정 처리 (월 $20)
- **한글 폰트**: 관리자 콘솔에서 Pretendard 등 폰트 파일 업로드 필요 (Supabase Storage `resources` 버킷)
- **현재 폰트 폴백**: 미등록 시 Linux 시스템 기본 CJK 폰트 사용

---

## 기술 스택 버전 현황

| 패키지 | 버전 | 최신 stable | 비고 |
|---|---|---|---|
| next | 14.2.35 | 16.2.6 | 14.x 보안 패치 완료, 15/16 마이그레이션 계획 |
| react | 18.3.1 | 19.x | 안정적 |
| fabric | 6.4.3 | 7.3.1 | 7.x API 변경 큼, 별도 마이그레이션 |
| @napi-rs/canvas | 0.1.55 | 최신 | 빌드 정상 |
| @supabase/ssr | 0.5.2 | 최신 | - |
| pdf-lib | 1.17.1 | 1.17.1 | 최신 |
| resend | 6.12.3 | 최신 | - |
| sharp | 0.33.5 | 최신 | - |

---

## 테스트 현황

```
유닛 테스트 (Vitest):     15 파일 / 153 tests / 1 skipped
E2E 테스트 (Playwright):  desktop+mobile chromium 12/12 통과 (5.7s)
PDF 런타임 검증:          pnpm verify:pdf — 40KB / 353ms / PDF 1.7
Lighthouse 모바일:        Performance 97 · LCP 1.5s · CLS 0
PDF 회귀(페이지수+해시): ❌ 미구성 (다음 작업 후보)
```

테스트 실행:
```bash
pnpm test                   # 유닛 테스트 (단발)
pnpm test:watch             # 와치 모드
pnpm verify:pdf             # PDF 파이프라인 런타임 1페이지 검증
pnpm e2e                    # Playwright E2E (자동 dev 서버)
PLAYWRIGHT_BASE_URL=https://100pbooks.vercel.app pnpm e2e   # 운영 대상 스모크
```

<!-- 2026-06-20: Storige 인쇄 백엔드 일원화 라이브 (PDF 저장/검증/다운로드 프록시/보존정책). -->
