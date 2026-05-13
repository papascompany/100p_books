# 100p Books — 개발 현황 및 다음 단계

> 최종 업데이트: 2026-05-10
> 배포 URL: https://100pbooks.vercel.app
> 레포지토리: https://github.com/papascompany/100p_books

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
| M16 성장 기능 | 🟡 일부 완료 | - | 아래 세부 표 참조 |
| M17 모바일 PWA | ✅ 완료 | - | manifest, SW, 카메라 업로드 |
| M8 QA & 폴리싱 | 🟡 일부 완료 | 2026-05-13 | PDF 런타임·E2E·Lighthouse 측정 완료, WCAG 미측정 |

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

## M16 성장 기능 세부 현황

| 기능 | DB | API | UI | 상태 |
|---|---|---|---|---|
| 프로젝트 공유 링크 | ✅ | ✅ | ✅ `/share/[token]` | ✅ 완료 |
| 선물하기 | ✅ | ✅ | ✅ `/gift/[token]` | ✅ 완료 |
| 할인 코드 — Admin 관리 | ✅ | ❌ | ✅ `/admin/discounts` | ⚠️ API 미구현 |
| 할인 코드 — 결제 시 적용 | ✅ | ❌ | ❌ | ❌ 미착수 |
| 친구 추천 (referral) | ✅ | ✅ | ✅ | ✅ 완료 |
| 후기 갤러리 — 공개 목록 | ✅ | ✅ | ✅ `/gallery` | ✅ 완료 |
| 후기 — 사용자 작성 | ✅ | ❌ | ❌ | ❌ 미착수 |
| 출석체크 + 포인트 적립 | ✅ | ✅ | ✅ `/attendance` | ✅ 완료 |
| 포인트 내역 전용 페이지 | ✅ | ✅ | 🟡 컴포넌트만 | ⚠️ 페이지 미생성 |
| 이메일 발송 (Resend) | ✅ | ✅ | - | ⚠️ API Key 등록 필요 |

---

## 현재 배포 상태

```
Next.js:  14.2.35 (2026-05-10 보안 패치 완료)
Supabase: vprifnztvlduhpuwgdau (Seoul / papascompany org)
Vercel:   yohans-projects-de3234df / icn1 리전
DB 마이그레이션: 0001 ~ 0023 (로컬 적용 완료, 운영 DB는 수동 적용 필요)
```

---

## 운영 활성화를 위한 수동 작업 (코드 외)

### 1순위 — 없으면 서비스 불가

| 항목 | 작업 | 참고 문서 |
|---|---|---|
| DB 마이그레이션 적용 | Supabase 대시보드 SQL Editor에서 `0023_point_ledger.sql` 실행 | `supabase/migrations/` |
| Supabase 운영 DB 적용 | `supabase db push` 또는 콘솔 직접 실행 | - |

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

## 다음 개발 우선순위 (권고)

### 높음 — 서비스 완성도

1. **할인 코드 API 구현** (`/api/discount-codes/validate`, `/api/discount-codes/apply`)
   - Admin UI(`/admin/discounts`)는 완성, 결제 시 적용 로직만 추가
   - 관련 파일: `lib/orders/pricing.ts`, `app/api/payments/confirm/route.ts`

2. **후기 작성 플로우** (`/mypage/orders/[id]/review`)
   - DB 테이블(`reviews`) 이미 존재
   - 주문 완료 → 후기 작성 CTA 버튼 추가

3. **포인트 내역 페이지** (`/mypage/points`)
   - `components/mypage/PointHistoryCard.tsx` 이미 존재
   - 마이페이지에 탭/페이지로 연결만 하면 됨

### 중간 — 품질/안정성

4. **PDF 실제 동작 검증**
   - `@napi-rs/canvas` 런타임 테스트 (실제 주문 1건 생성)
   - Vercel Pro 플랜 업그레이드 시 100페이지 부하 테스트

5. **E2E 테스트 (Playwright)**
   - 업로드 → 레이아웃 → 결제 핵심 플로우
   - `pnpm test:e2e` 스크립트 추가

6. **Lighthouse 측정**
   - LCP < 2.5s 목표
   - 에디터 페이지 60fps 모바일 검증

### 낮음 — 장기

7. **Next.js 15/16 마이그레이션** (App Router 변경사항 대응, 보안 완전 패치)
8. **Fabric.js 7.x 마이그레이션** (SVG XSS CVE 완전 해소)
9. **WCAG 2.1 AA 접근성 감사**
10. **인쇄소 자동 발주 연동**

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
유닛 테스트 (Vitest): 15파일 / 153 tests / 1 skipped
E2E 테스트 (Playwright): ❌ 미구성
PDF 회귀 테스트: ❌ 미구성
```

테스트 실행:
```bash
pnpm test          # 유닛 테스트 (단발)
pnpm test:watch    # 와치 모드
```
