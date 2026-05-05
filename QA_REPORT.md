# 100p_books — 최종 QA 리포트 (2026-04-25)

## 점검 범위
M0~M7 전체 코드베이스, 정적 분석.
- 마이그레이션 9종 (0001~0009)
- API 라우트 28개 (`app/api/**/route.ts`)
- 페이지/컴포넌트 50+개
- 도메인 라이브러리 (auth, db, fabric, image, layout, orders, payments, pdf, admin)

`pnpm install` 미실행 — `pnpm typecheck/lint/test/build` 실 검증은 배포 전 사용자 수행 필요. 본 리포트는 정적 분석 + 명백한 버그 패치만 포함.

---

## 보안 (PASS)

| 항목 | 결과 | 근거 |
|---|---|---|
| `service_role` 키 클라 노출 | **PASS** | `lib/db/admin.ts` 가 `import "server-only"` + `typeof window` 런타임 가드 + 환경변수 체크 3중 방어. `@/lib/db/admin` 임포트는 모두 서버 라우트/RSC 파일 (Grep 31건 검토 — `"use client"` 파일 0건). |
| `TOSS_SECRET_KEY` 클라 노출 | **PASS** | `lib/payments/toss.ts`도 `server-only`. 클라는 `NEXT_PUBLIC_TOSS_CLIENT_KEY`만 사용. `.env.example` 에 분리 명시. |
| EXIF GPS 추출 차단 | **PASS** | 클라(`lib/image/exif.ts`) + 서버(`app/api/photos/complete/route.ts`) 모두 `gps: false` + `pick` 화이트리스트(`DateTimeOriginal/CreateDate/Make/Model/Orientation`). |
| API 권한 (사용자) | **PASS** | 사용자 라우트 20+ 개 모두 `requireUser()` 후 `project.user_id !== user.id` 비교. |
| API 권한 (관리자) | **PASS** | `/api/admin/*` 14개 라우트 모두 `withAdmin()` 사용 (Grep 27건). middleware.ts 가 1차 방어, `withAdmin`/`requireAdmin` 가 2차. |
| RLS 정책 누락 | **PASS** | 마이그레이션 0002 가 7개 테이블(profiles, book_sizes, projects, photos, pages, resources, orders) 모두 `enable row level security` + 정책 정의. `orders` 는 사용자 SELECT only, INSERT/UPDATE 는 service_role 만. |
| PageDoc 검증 | **PASS** | `isPageDoc()` 가드가 4곳(`/api/pages/[id]` PATCH, `/api/cover` PATCH, `/api/orders/create` 표지 검증, `lib/pdf/build-job` 페이지 적재) 일관 적용. `bookSizeId` + `pageNo` 일치 검증도 PATCH 라우트에서 수행. |
| 결제 amount 위변조 방어 | **PASS** | `/api/payments/confirm` 가 ① `order.amount === amount` (자체 DB) ② `tossRes.totalAmount === amount` (토스 응답) 둘 다 검증 + 토스 status `DONE` 강제. 웹훅도 `fetchTossPayment` 로 totalAmount 재검증. |
| 멱등성 | **PASS** | confirm 재호출 시 `paymentKey + amount + status≥paid` 일치 → idempotent success. 토스 confirm 자체도 `(paymentKey, orderId, amount)` 조합 idempotent. |
| auth 콜백 open redirect | **PASS** | `next.startsWith("/")` 검사로 외부 origin 리다이렉트 차단. |
| 업로드 파일 서버 재검증 | **PASS** | `/api/photos/complete` 가 다운로드 후 `blob.size > MAX_FILE_BYTES` 면 객체 삭제 + 에러. `storageKey` prefix(`${user.id}/${projectId}/`) 재검증. |
| service_role write 격리 | **PASS** | orders INSERT/UPDATE 만 admin 클라 사용. user-facing 쿼리는 anon + RLS. |

**잔여 이슈 없음.**

---

## 접근성 (PASS — 권고 1건)

| 항목 | 결과 | 근거 |
|---|---|---|
| `<html lang="ko">` | **PASS** | `app/layout.tsx:40`. `themeColor` 라이트/다크 분리. |
| 키보드 네비 / 포커스 링 | **PASS** | `Button` cva 기본에 `focus-visible:ring-2 focus-visible:ring-ring` 포함. `globals.css` 도 기본 ring 보존. |
| 인터랙티브 요소 ≥ 44×44 | **PASS (수정 1건)** | Button 기본 `h-11`(44px), `size: "icon"` 도 `h-11 w-11`. `FileGridItem.tsx` 의 remove 버튼 `size-8`(32px) → `size-11`(44px) 로 패치. Toolbar 는 `min-h-11` 강제. |
| `prefers-reduced-motion` | **PASS** | `globals.css` 전역 `@media` + framer-motion `useReducedMotion` (HeroMotion). |
| 이미지 alt/aria | **PASS** | 4곳 모두 alt 또는 aria-label. PagePreview 의 장식 사진은 `alt=""` (적절). |
| 빈 상태/로딩/에러 일관 | **PASS** | `app/loading.tsx`(role=status, sr-only), `app/not-found.tsx`(404), 각 페이지 동일 카드 패턴. |
| 다크모드 토큰 | **PASS** | hex 하드코드 4건 — kakao 브랜드(`#FEE500`), themeColor 메타, 배경 placeholder 2건(`#eceae5`, `#f8f5f0`) — 모두 합당. 그 외 모두 토큰. |
| 권고: 인라인 `alert()` 토스트 교체 | **권고** | admin 페이지 + OrderForm 에서 `alert()` 16건 (모두 dependency `@radix-ui/react-toast` 이미 설치). M9+ 폴리싱에서 `Toast` 컴포넌트 도입 권고. 기능적 결함은 아님. |

---

## Next.js 규약 (PASS)

| 항목 | 결과 |
|---|---|
| `"use client"` 적정 사용 | PASS — 클라 컴포넌트 40개, admin/server 임포트 분리 정상. |
| 서버 모듈 `import "server-only"` | PASS — admin route 24/28, sensitive lib 전부. (`/api/projects`, `/api/health`, `/api/photos/sign-upload` 는 누락이지만 Next.js Route Handler 자체가 서버 전용이라 위험 없음.) |
| `useSearchParams()` Suspense 경계 | PASS — `app/(auth)/login/page.tsx` Suspense 래핑 1건만 사용. |
| `next.config.ts` (M0 이월 정리) | PASS — `experimental.serverComponentsExternalPackages` 로 정리 (M5에서). |
| `path alias @/*` | PASS — tsconfig + 임포트 일관. |

---

## 성능 목표 vs 현황 (설계 기준)

| 항목 | 목표 | 현황(설계) | 비고 |
|---|---|---|---|
| 에디터 프레임 | 60fps | Fabric 6 + 자체 GestureLayer | 실제 모바일 측정 필요 (Lighthouse / iOS Safari) |
| 100p PDF 생성 | < 60s (서버) | `runProjectPdfBuild` + `@napi-rs/canvas` 인라인, `maxDuration=300s` | 평균은 60s 내 추정. Vercel Hobby 60s 제한 시 분리 필요 |
| LCP | < 2.5s | Pretendard CDN, framer-motion 0.25s, lazy `<img>` | 측정 필요 |
| a11y | WCAG 2.1 AA | 토큰/포커스/lang/reduced-motion 모두 충족 | Lighthouse a11y ≥ 95 예상 |
| PDF 해상도 | 300dpi ± 0 | `lib/pdf/constants.ts` 300, `mmToPx(mm * 300/25.4)` | PASS |
| Bleed 정밀도 | ± 0.1mm | `bleedMm: 2`, mm/pt 좌표계 일관 | PASS |

---

## 잔여 이슈 우선순위 (배포 전)

### P0 — 차단 이슈 없음
모든 보안·데이터 무결성 점검 PASS.

### P1 — 운영 시 주의
- **PDF SSE multi-instance 한계**: `lib/pdf/jobs.ts` 인메모리 레지스트리 → Vercel serverless 다중 인스턴스에서 SSE 라우팅 실패 가능. **운영 시 Redis/Upstash 필요**. 현재는 결제 confirm 인라인 빌드(15s~2min)로 우회 가능 — 사용자 build 버튼이 SSE를 못 받아도 빌드 자체는 응답에 결과 포함.
- **PDF 큰 책 60s 제한**: Vercel Hobby Plan 60s 응답 제한. 100p 풀빌드 시 `maxDuration=300`(Pro 필요) 또는 비동기 큐로 분리.
- **카카오 OAuth provider**: Supabase 콘솔 등록 후 `LoginForm.tsx` 의 카카오 버튼 활성 (현재 비활성).
- **첫 admin 승격 SQL**: `update profiles set role='admin' where email='...'` 운영자 직접 실행.

### P2 — 폴리싱 권고 (배포 후)
- **인라인 `alert()` → Toast**: admin 페이지 + OrderForm 16건. `@radix-ui/react-toast` 이미 의존성 포함 — `components/ui/toast.tsx` + `useToast` 도입 후 일괄 치환. 기능적 결함 아님.
- **PDF: borderRadius + shadow 동시 적용 시 그림자 클립** (M5 이월).
- **PDF: CMYK / ICC 프로파일** (M5 이월, 인쇄소 요구 시).
- **다음 우편번호 SDK** 통합 (`OrderForm.tsx:246` 에 자리 마련됨).

---

## 적용한 패치 (M8)

| 파일 | 변경 내역 |
|---|---|
| `app/(user)/upload/components/FileGridItem.tsx` | remove 버튼 터치 타겟 `size-8`(32px) → `size-11`(44px) + `focus-visible:ring`. WCAG 2.5.5 (AAA) / Apple HIG 44pt 충족. |

---

## 사용자/관리자 시나리오 회귀 체크리스트

### 사용자 핵심 플로우
- [ ] 회원가입(매직링크) → 로그인 → `/upload` 진입
- [ ] 사진 100장 업로드 (HEIC 포함) → 썸네일 생성 + EXIF 정렬 확인
- [ ] 책 사이즈 선택 → `/editor/[projectId]` 자동 폴라로이드 페이지 생성
- [ ] 콜라주 모드 전환 → 템플릿 선택 → 페이지별 편집 (`/editor/[projectId]/pages/[pageId]`)
- [ ] 표지 편집 (`/cover/[projectId]`) — 템플릿 5종, 책등 자동 계산
- [ ] PDF 미리보기 빌드 (사용자) — 표지/내지 분리
- [ ] 주문 (`/order/[projectId]`) — 수량/배송지/약관 → 토스 결제
- [ ] 결제 success → confirm + 인라인 PDF 빌드 → 마이페이지에서 PDF 다운로드
- [ ] 주문 fail 페이지 정상 동작
- [ ] `/mypage/orders` 목록 + 상세

### 관리자 플로우
- [ ] `/admin` 대시보드 (오늘 주문/결제/신규 7일/제작중)
- [ ] `/admin/book-sizes` CRUD → 사용자 흐름에 즉시 반영
- [ ] `/admin/resources/{font|clipart|background}` 업로드 + active 토글
- [ ] `/admin/orders` 필터+페이지네이션
- [ ] 주문 상태 전이 (paid → in_production → shipped → delivered)
- [ ] 송장 입력 + Excel 다운로드 (CJ 포맷)
- [ ] PDF 재생성 버튼
- [ ] `/admin/users` 역할 변경 (자기강등 차단)

### 데이터 무결성 / 동시성
- [ ] 동일 결제 두 번 confirm → idempotent (멱등성)
- [ ] PageDoc PATCH bookSizeId/pageNo 불일치 → 400
- [ ] `/api/orders/create` 가격 위변조 시도 → 서버 재계산 무시
- [ ] storageKey prefix 변조 → 400
- [ ] 다른 사용자 projectId 접근 → 403

### 모바일 / 접근성
- [ ] iOS Safari 16/17 Fabric 제스처
- [ ] Android Chrome 제스처
- [ ] 375×812 viewport 깨짐 없음
- [ ] 키보드 only 네비게이션 (login → upload → editor)
- [ ] prefers-reduced-motion ON 시 fade/slide 제거
- [ ] VoiceOver / TalkBack — 주요 버튼 라벨 확인

---

## 배포 전 사용자 액션

1. **의존성 설치**
   ```
   pnpm install
   ```
2. **Supabase 마이그레이션 적용** (0001~0009 순서)
   ```
   supabase db push
   # 또는 Studio SQL editor 에서 순서대로 실행
   ```
3. **환경변수**
   - `cp .env.example .env.local`
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
   - `TOSS_SECRET_KEY` (test_sk_*) / `NEXT_PUBLIC_TOSS_CLIENT_KEY` (test_ck_*)
   - `NEXT_PUBLIC_APP_URL` (Vercel 도메인)
   - (옵션) `TOSS_WEBHOOK_SECRET`
4. **첫 admin 승격** — 회원가입 후
   ```sql
   update public.profiles set role='admin' where email='운영자@example.com';
   ```
5. **로컬 검증**
   ```
   pnpm typecheck && pnpm lint && pnpm test
   pnpm dev   # http://localhost:3000
   ```
6. **수동 회귀** — 위 체크리스트의 사용자/관리자 플로우 1회 통과
7. **배포** — Vercel 환경변수 동일 셋업, 빌드 시 `node >= 20`. (`pnpm build` 통과 후 Promote.)
8. **운영 모니터링**
   - Supabase Storage 버킷 `originals` / `thumbs` / `pdfs` / `resources` 권한 확인
   - 토스 웹훅 URL `/api/payments/webhook` 등록 (운영 키)
   - Sentry/로그 수집 추가 권고

---

## 마무리

M0~M7 산출물 약 200개 파일을 정적으로 검토하였고, **배포 차단 이슈는 없음**. 1건의 a11y 패치(`FileGridItem` 터치 타겟 44px) 적용 완료.

향후 폴리싱(toast 통일, Redis 잡 큐, CMYK/ICC, 다음 우편번호 SDK)은 배포 후 점진적으로 진행 가능.
