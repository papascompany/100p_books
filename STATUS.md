# 100p Books — 개발 현황 및 다음 단계

> 최종 업데이트: 2026-05-14
> 배포 URL: https://100pbooks.vercel.app
> 레포지토리: https://github.com/papascompany/100p_books
> 운영 빌드: `ca42720` (perf(nav): 정적 페이지 prerender + SW SWR + mypage 단일 RPC)

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
DB 마이그레이션: 0001 ~ 0024 (운영 DB 적용 완료 — 2026-05-14)
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

## 다음 개발 우선순위 (권고) — 2026-05-14 갱신

### 🔴 운영 활성화 (코드 외 — 사용자 콘솔 작업)

1. ~~**Supabase 운영 DB 마이그레이션 적용** — 0023 + 0024~~ ✅ **완료 (2026-05-14)**
2. **Kakao OAuth 콘솔 등록** — REST API Key + Client Secret → Supabase Provider Enable
3. **Resend API Key + EMAIL_FROM Vercel 환경변수** — 가입/주문 메일 실 발송
4. **TossPayments 운영 키** — 라이브 키 + 웹훅 secret 등록

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
