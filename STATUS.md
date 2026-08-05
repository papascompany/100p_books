# 100p Books — 개발 현황 및 다음 단계

> 최종 업데이트: 2026-08-05
> 배포 URL: https://100pbooks.vercel.app
> 레포지토리: https://github.com/papascompany/100p_books
> 운영 빌드: `296d02c` (fix(security): 감사 리뷰 fix-forward)
> **정본 로컬 경로**: `/Users/yohan/Developer/claude/100p_books` (Documents 사본은 node_modules 제거됨)

---

## 🆕 최근 작업 (2026-06-13 ~ 2026-08-05)

### 0-4. Lighthouse SI/TTI 개선 — 폰트 분할 + 홈 번들 축소 (2026-08-05)
- **실측으로 병목을 재정의**: 기존 기록은 원인을 "클라이언트 JS 사이즈(fabric chunk 등)"로
  적어 뒀으나 실측 결과 TBT 는 이미 낮았고(7~80ms), 전송량 1위가
  `PretendardVariable.woff2` **2,011KB(전체의 82%)** 였다. 병목은 JS 가 아니라 폰트였다.
- **폰트 2분할**(`scripts/build-font-subsets.py`): core(라틴·기호·가나 + KS X 1001 한글 2,350자,
  **533KB**, preload) / ext(나머지 완성형 8,822자, 1,317KB, preload 안 함).
  `next/font` 를 두 번 선언하고 tailwind `fontFamily.sans` 에 core → ext 순으로 나열 —
  브라우저가 core 에 없는 글리프를 만날 때만 ext 를 받는다(unicode-range 불필요,
  next/font 의 size-adjust fallback 유지 → CLS 0).
  KS X 1001 판정은 `iso2022_kr` 인코딩 가능 여부(euc_kr·johab 은 CP949 확장까지 통과시켜 못 씀).
  실기 검증: 초기엔 core 만 로드, 희귀 음절(쀍뷁쭭꾧) 삽입 시 ext 자동 로드 확인.
- **홈 번들 축소**: `StepsSection` 이 레포에서 framer-motion 의 **유일한 사용처**였다.
  진입 애니메이션을 CSS(`animate-fade-up`/`line-grow`/`badge-pop`)로 옮겨 RSC 서버 컴포넌트화하고
  `dynamic(ssr:false)` 제거, framer-motion 의존성 삭제.
  → 홈 First Load JS **150kB → 102kB**, 라우트 청크 41.5kB → 190B.
- **부수 발견(실제 결함)**: `ssr:false` 때문에 axe 가 StepsSection 을 검사하지 못하고 있었다.
  SSR 로 바꾸자 CTA 의 `bg-coral text-white`(대비 2.79:1, GL-5 와 동일 유형)가 드러나
  `variant="coral"`(text-night)로 교정. a11y 25/25 통과 회복.
- **운영 실측 (각 3회 중앙값)** — 같은 조건에서 원본 코드와 직접 비교:

  | 지표 | 원본 | 변경본 |
  |---|---|---|
  | Performance | 73 | **81** |
  | LCP | 12,840ms | **5,186ms** |
  | TTI | 12,878ms | **5,223ms** |
  | Speed Index | 4,140ms | **2,209ms** |
  | FCP | 984ms | 959ms |
  | CLS | 0 | 0 |

- ⚠️ **측정 방법론 교훈**: 처음에 운영 baseline 을 **1회만** 재고 그 값(LCP 1,754ms)을 기준 삼아
  "LCP 회귀"로 오판해 한 차례 롤백했다. 롤백본을 3회 재보니 LCP 12,840ms —
  1회 값이 이상치였다. **Lighthouse 는 반드시 3회 이상 중앙값으로 비교할 것.**
  (이 과정에서 시도한 `core preload:false` 는 FCP 959→3,619ms 로 악화해 채택하지 않았다.)
- 검증: typecheck 0 · lint 0 · vitest 169p/1s · pdf 회귀 4케이스 · e2e 12p · a11y 25p ·
  build 성공 · 모바일 실화면(폰트·StepsSection) 확인 · CI green.
- 남은 개선 여지: 홈 Unsplash 원격 이미지 16장(LCP 요소는 히어로 이미지이고
  `elementRenderDelay` 가 여전히 지배적), ext 폰트가 필요한 화면의 체감 확인.

## 이전 작업 (2026-06-13 ~ 2026-08-03)

### 0-3. 품질 백로그 착수 — CI 신설 + PDF 회귀 + WCAG AA (2026-08-03) — **CI 전건 green**
- **CI 파이프라인 신설**(`.github/workflows/ci.yml`) — 그동안 CI 가 아예 없어 "push → Vercel 실패"
  로만 회귀를 알 수 있었다. 3 잡: `verify`(typecheck·lint·test·pdf 회귀·build) / `e2e` / `a11y`.
  운영 시크릿은 넣지 않고 형식만 유효한 더미 env 로 빌드한다(모든 env 접근이 lazy 임을 로컬 실증).
- **PDF 회귀 테스트**(`scripts/pdf-regression.ts`, `pnpm test:pdf`) — CLAUDE.md 명시 부채 해소.
  기존 `verify:pdf` 는 매직 헤더·크기만 봤다. 2계층 검증: ① 구조(페이지 수·페이지 크기 pt)는
  플랫폼 무관 엄격 비교 ② 첫 페이지 SHA-256 은 `${platform}-${arch}` 키별 비교.
  PDF 바이트 전체는 `setCreationDate(new Date())` 탓에 해시 대상이 될 수 없어 렌더 결과를 해싱한다.
  **회귀 감지 실증**: baseline 을 일부러 손상시켜 픽셀·구조 both FAIL 재현 후 복원.
- **WCAG 2.1 AA 감사**(`e2e/a11y.spec.ts`, `pnpm test:a11y`) — axe-core 로 공개 라우트 7종 ×
  desktop/mobile + 인터랙션 3종 + 다크 모드 3종. **실측 위반 5종을 발견해 전건 수정**:
  ① `--mute-fg` 46%→44% (soft-cloud 면 위 4.39:1 → 4.73:1) ② 홈 폴라로이드 캡션이 하드코딩
  `bg-white` 위에 테마 토큰 `text-mute` 를 써 다크에서 2.82:1 (GL-1 과 같은 유형) → 고정색
  ③ 텍스트 노드의 `text-coral` (2.79:1) → `coral-700` + `dark:coral-300` ④⑤ `bg-blue-500`
  흰 텍스트 버튼(3.68:1) → blue-600/700. 수정 후 **25/25 통과·위반 0**.
- 부수 정정: 문서에 오래 기록돼 있던 "로컬 lint/build 불가"가 **실측 결과 해소**됨(아래 환경 메모).
- 검증: typecheck 0 · lint 0 · vitest 169p/1s · pdf 회귀 4케이스 · e2e 12p · a11y 25p · build 성공.
- **CI 실측**(2026-08-03): 첫 실행에서 잡힌 실패 2건을 fix-forward 하고 전건 green.
  ① `pnpm/action-setup` 의 `version: 9` 가 `packageManager: pnpm@9.0.0` 과 충돌(3잡 셋업 실패)
  → action 쪽 지정 제거, node 20→22 로 로컬과 정렬. ② `npx tsx` 가 CI 에서 출력 없이 exit 1
  → `tsx` 를 devDependency 로 고정하고 `pnpm exec` 로 전환(설치 변수 제거).
  최종: verify 1m50s / e2e 1m34s(12p) / a11y 2m2s(25p) 모두 성공.
- **PDF 회귀 설계 실증**: 구조 스냅샷이 darwin-arm64 와 linux-x64 에서 **완전히 동일**(422.36pt·875.91pt)
  → 플랫폼 무관 계층이 의도대로 동작. 픽셀 해시는 두 플랫폼이 서로 달라 키 분리가 필요함도 확인.
  CI 첫 실행 로그의 linux-x64 해시 4종을 baseline 에 커밋해 **CI 에서도 픽셀 비교가 시작**됨.

### 0-2. UI/UX 전수감사 118건 잔여분 완결 (2026-08-03) — 커밋 `81506b9`, **Vercel 빌드 success**
- 배경: 8영역 UI/UX 감사(발견 119→적대검증 확정 118건) 중 `e656108`/`88b36d9`가 선반영한 부분을
  제외한 **잔여 ~75건**을 7샤드(표지/마이페이지/주문/에디터 페이지·그리드/업로드/온보딩)로 병렬 구현.
- 핵심: **CV-1 표지 폭 의미 완결**(`calcCoverDimensions`를 DB 정본 `cover_width_mm`=펼침 폭 기준으로
  공식 수정 — 선행 커밋은 주석만 수정된 모순 상태였음. 테스트 픽스처 시드값化 + 관리자 라벨 명확화 +
  CoverEditor 구규격 감지 배너/재생성 + **orders/create `COVER_FORMAT_OUTDATED` 409 게이트**),
  표지 모바일 면 세그먼트 편집(FabricStage `maxFitScale`로 책등 4× 확대), 배경 저장 소실 수정(CV-2),
  마이페이지 크래시 2건(MY-1/2 에러객체 렌더), 프로젝트 삭제 2단계 확인, 페이지 이동 dirty 저장-후-이동,
  주문서 입력 sessionStorage 복원, 업로드 재진입 복원 UI 배선, 갤러리/휴지통/출석 위젯 다크모드·브랜드 정리.
- 3렌즈 적대 리뷰(major 3·minor 6) 전건 반영: 책등 세그먼트 클램프, 다크모드 대비 2건, safe-area 2건,
  우편번호 레이어 언마운트 클린업, 삭제 다이얼로그 키보드 겹침, 약관 링크 터치 타깃, 레거시 표지 주문 게이트.
- 검증: `tsc --noEmit` 0 에러 · vitest **169 passed**/1 skipped · dev 서버 모바일 375px 실화면
  (로그인 카카오 상단/드로어 불투명+스크림+테마토글/갤러리 CTA·타이틀) 확인 · **Vercel 클린 빌드 success**(`81506b9`, 2026-08-03).
- 감수한 한계: 프로젝트 삭제는 여전히 하드 삭제(휴지통 편입은 스키마 변경 필요 — 백로그),
  `book_completed` 퍼널 이벤트 저장마다 재발화(서버 dedupe 백로그), 구규격 표지는 자동 변환 없이
  배너+주문 게이트로 유도. 운영 `book_sizes.cover_width_mm` 실값이 시드 의미(펼침 폭)인지 배포 전 1회 확인 권장.

### 0-1. 포인트 결제 배선 + 미적용 버그 수정 (2026-08-01)
- `clampPointsForMinPayment`를 클라(`OrderForm`)·서버(`orders/create`) **양쪽에 배선** — 사용 포인트/최종
  금액의 단일 정본(100P 단위 내림 + 토스 최소 100원 확보, 할인 후 기준).
- **버그 수정**: 클라가 `pointsToUse` 키로 전송 → 서버 스키마는 `usePoints` → zod가 버려서
  **포인트가 실제로는 전혀 적용되지 않던** 운영 버그(금액은 서버 재계산이라 과금 사고는 없었음).
- 적대적 리뷰(보안 렌즈) 발견 대응: ① 할인 코드 소계 변경 시 자동 재검증(클라/서버 금액 불일치 방지)
  ② `payments/confirm`에서 결제 캡처 **전** 포인트 잔액 재확인(다중 탭 이중 사용 차단 — 캡처 후
  차감까지 ms TOCTOU 창은 감수) ③ 서버 `AMOUNT_BELOW_MINIMUM` 게이트 + 클라 제출 버튼 게이트.
- 후속 제안(미착수): 포인트 홀드/예약 설계(pending 주문 합산 검증 또는 ledger hold),
  100% 할인 코드 발급 정책(현재는 100원 미만 주문 자체가 차단됨).

### 0. 모바일 UX/QA 일괄 개선 (2026-08-01) — 커밋 `e656108`
- 27+4개 파일, 약 +1.7k줄. 다른 세션이 시작(QA 발견 UP-x/EC-x 일괄 수정)한 것을 이어서 완결.
- 주요 내용: 로그인 개편(카카오 상단·약관은 가입시만·콜백 에러 한국어화), 업로드 서명 **배치화**(20개/호출,
  레이트리밋 회피)+재진입 복원+진행률/취소 시맨틱 정리, 에디터 자동저장 편집 유실 방지·배경 직렬화 보존·
  다이얼로그 단축키 차단, PreviewGrid 드래그앤드롭 재작성(오토스크롤·iOS long-press 충돌 해결),
  제스처 2손가락 팬·더블탭 리셋·핀치 앵커 보정, 모바일 드로어 스크림/스크롤락, a11y 대비·44px 터치 타깃.
- 이 세션에서 완결한 부분: `MobileToolbar` 퀵 바(Undo/Redo 상시+선택 도구), `ResourcePalette` `tabs` 제한,
  `PagePreviewDialog` `trimGuide` 정밀 재단선, `clampPointsForMinPayment` 테스트 8케이스.
- 검증: `tsc --noEmit` 0 에러 · vitest **169 passed**/1 skipped · dev 서버에서 에디터 라우트 컴파일+
  로그인 렌더 확인(콘솔/서버 에러 0) · **Vercel 클린 빌드 success**(`2d48ca7`).
- `clampPointsForMinPayment` 배선은 위 0-1에서 완료.

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
- `0029_funnel_events.sql` — 온보딩 퍼널 계측 테이블(funnel_events)+RLS(admin SELECT only, PR #1).
  **적용 완료(2026-07-31)** — 사후 확인 rls_enabled=true / index 3 / policy 1 기대값 일치(사용자 확인).
  적용 즉시 배포된 계측 4종(signup_completed/project_created/book_completed/order_paid)이 기록 시작.

### 환경/배포 메모
- **GitHub auto-deploy 정상**(실커밋 push→자동 빌드 확인). 빈 커밋은 Vercel이 스킵하므로 무시.
- ~~로컬 `pnpm lint/build` 불가(node v22 ↔ comment-json 크래시)~~ → **2026-08-03 실측 해소**.
  현재 node v22.22.2 에서 `pnpm lint`·`pnpm build` 모두 정상 동작한다(0 경고 / 빌드 성공).
  push 전 로컬 전체 검증이 가능하며, GitHub Actions CI 가 clean 환경에서 한 번 더 검증한다.
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
DB 마이그레이션: 0001 ~ 0029 운영 적용 (0023·0024: 2026-05-14 / 0026: Storige / 0027·0028: 2026-07-04 / 0029: 2026-07-31)
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

5. ~~**WCAG 2.1 AA 접근성 감사**~~ ✅ **완료 (2026-08-03)** — axe-core 자동 감사(`pnpm test:a11y`),
   위반 5종 수정 후 25/25 통과. 잔여: 키보드 only 회귀 시나리오, 로그인 이후 화면(에디터·주문·마이페이지)은
   인증 픽스처가 필요해 7번과 함께 진행.
6. ~~**Lighthouse Speed Index / TTI 개선**~~ ✅ **1차 완료 (2026-08-05)** — 실측 결과 병목은
   JS 가 아니라 2MB 폰트였다(운영 TBT 80ms / TTI 12.4s). 폰트 core/ext 분할 + 홈 번들 48kB 감소로
   로컬 기준 TTI·LCP -54%, 전송량 -60%. 잔여: 배포 후 운영 재측정, 홈 원격 이미지(Unsplash 16장)
   최적화, ext 폰트가 필요한 페이지의 체감 확인.
7. **인증된 사용자 E2E 시나리오 확장** — 현재 스모크는 익명/가드만. 업로드 → 에디터 → 주문 골든 플로우.
   **선행 조건(사용자 액션)**: E2E 전용 테스트 계정 + CI 시크릿(`E2E_EMAIL`/`E2E_PASSWORD`) 등록,
   또는 service_role 로 테스트 유저를 만드는 시드 스크립트 승인. 이게 정해지면 착수 가능.
8. **PDF 100페이지 부하 검증** — Vercel Pro 플랜 가입 후 실측 (현재 1페이지 + photo+shadow 케이스만)
9. ~~**PDF 회귀 테스트 CI 통합**~~ ✅ **완료 (2026-08-03)** — `pnpm test:pdf` + CI 잡.
   darwin-arm64·linux-x64 baseline 모두 등록 완료 — 로컬·CI 양쪽에서 픽셀 회귀가 실제로 비교된다.
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
유닛 테스트 (Vitest):     16 파일 / 170 tests / 1 skipped (2026-08-03)
E2E 스모크 (Playwright):  desktop+mobile chromium 12/12 통과 (22.5s)
접근성 (axe-core):       WCAG 2.1 AA 25/25 통과 · 위반 0 (2026-08-03)
PDF 회귀(페이지수+해시): ✅ pnpm test:pdf — 4 케이스 / ~300ms
PDF 런타임 검증:          pnpm verify:pdf — 40KB / 353ms / PDF 1.7
Lighthouse 모바일:        Performance 97 · LCP 1.5s · CLS 0
CI (GitHub Actions):     ✅ typecheck·lint·test·pdf·build + e2e + a11y (2026-08-03 신설)
```

테스트 실행:
```bash
pnpm test                   # 유닛 테스트 (단발)
pnpm test:watch             # 와치 모드
pnpm test:pdf               # PDF 회귀 (페이지 수·크기 + 첫 페이지 해시)
pnpm test:pdf:update        # ⚠️ 렌더 변경이 의도된 경우에만 baseline 갱신
pnpm test:a11y              # axe-core WCAG 2.1 AA 감사
pnpm verify:pdf             # PDF 파이프라인 런타임 1페이지 검증
pnpm e2e                    # Playwright 스모크 (자동 dev 서버)
PLAYWRIGHT_BASE_URL=https://100pbooks.vercel.app pnpm e2e   # 운영 대상 스모크
```

<!-- 2026-06-20: Storige 인쇄 백엔드 일원화 라이브 (PDF 저장/검증/다운로드 프록시/보존정책). -->
