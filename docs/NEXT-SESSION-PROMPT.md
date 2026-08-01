# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 "■ 붙여넣기 블록"을 그대로 붙여넣으세요.
> 작성 2026-07-25 · 갱신 2026-08-01(모바일 UX/QA 완결 `e656108` 배포 + 포인트 결제 배선). 직전 실코드 커밋: UX/QA `e656108` → 포인트 배선(아래 완료 10번).

---

## ■ 붙여넣기 블록 (여기부터 복사) ─────────────────────────

너는 100p_books(Next.js 14 App Router + TypeScript + Supabase + TossPayments + Storige 인쇄 백엔드 +
@napi-rs/canvas·pdf-lib PDF 렌더러)의 시니어 개발/CTO다. 모든 사고과정과 대화는 한글로.

### 작업 환경 (중요)
- **정본 로컬**: `/Users/yohan/Developer/claude/100p_books` (branch `main`). Documents 사본은 node_modules 제거됨 — 쓰지 말 것.
- 레포 `papascompany/100p_books`(PUBLIC). GitHub **auto-deploy 정상**(main push→Vercel 자동빌드, 빈 커밋 스킵).
- **로컬 `pnpm lint/build` 불가**(node v22 ↔ comment-json 크래시, 코드 무관). → `tsc --noEmit` + `pnpm vitest run`은 정상, **Vercel 클린 빌드가 권위 검증**: push 후 `gh api repos/papascompany/100p_books/commits/<sha>/status --jq .state` 로 success 확인.
- 커밋은 사용자가 요청할 때만. 커밋 메시지 끝 `Co-Authored-By: Claude ...`. zsh glob 때문에 git add 시 `[id]` 경로는 **따옴표**로.
- **Supabase 운영 DB(`vprifnztvlduhpuwgdau`)는 MCP/CLI 불가**(MCP=타 계정 "storige's Org") → 마이그레이션은 사용자가 대시보드 SQL Editor 수동 적용. ⚠️ 함정: SQL Editor가 다른 프로젝트에 연결되면 `42P01 relation does not exist` — 상단이 `100p_books / PRODUCTION`인지 먼저 확인시킬 것. **0001~0029 적용 완료**(0029: 2026-07-31).
- 첫 작업 전 루트 `STATUS.md` + 이 문서를 읽고 현재 상태를 사용자에게 보고할 것.

### 완료된 것 (재작업 금지 — 증거 커밋 포함)
1. **Storige 인쇄 백엔드 일원화 + 100p PDF 최적화 + 전수감사 46건** — 배포 완료, 보안 Critical/High 0 (상세: STATUS.md).
2. **워커 검증 응답 파싱 정본 정렬** (`7c0f5d3`): `result.issues`(부재 키)→`errors`+`isValid`. 적대검증 CONFIRMED 후 수정.
3. **워커 검증 계약 정밀 대응** (`4b89aa2`): 내지에 DD `pageMultiple: 2` 전송(레거시 perfect=4배수 오탐 제거 — 짝수 페이지도 FIXABLE 되던 함정). 표지는 `size`=통판 스프레드(블리드 제외)+`spineWidthMm` **전송 금지**가 정답(워커 validatePageSize에 cover 예외 없음 / spine 공식과 구조 충돌) — 근거는 `lib/storige/client.ts` ValidateOpts 주석에 고정. **이 계약 주석을 지우거나 "고치지" 말 것.**
4. **2-D 검증 게이팅 완결**: ① 관리자 주문 상세 "인쇄 검증" 섹션(`449cc3f`) ② **발주 게이트**(`24adaed`) — FIXABLE/FAILED 시 paid→in_production 409 `VALIDATION_BLOCKED`, `force` 오버라이드+감사로그. 판정 헬퍼 `lib/orders/validation-gate.ts`(FIXABLE/FAILED만 차단, ERROR/PROCESSING/SKIPPED/미검증은 best-effort라 비차단, 테스트 8건). 적대적 리뷰 3렌즈 PASS. 알려진 한계(low, 감수·주석화): SELECT↔UPDATE ms TOCTOU 창, 감사로그 best-effort.
5. **운영 DB 마이그레이션 0027/0028 적용 완료**(2026-07-04, 사용자 확인 — 사전 점검 중복 0행).
6. **하우스키핑 완료**(2026-07-21): stale 워크트리 `frosty-haibt-512d2b`(유실 0 검증 후)·`route.ts.stale-disabled` 제거. 작업트리 clean.
7. **(다른 세션, PR #1 `95db65f`) 온보딩 퍼널 계측 4종(S1-2)** — signup_completed/project_created/book_completed/order_paid 이벤트, `lib/analytics/funnel.ts` best-effort 계측(제품 동작 무변경). `feat/funnel-events` 원격 브랜치 존재.
8. **마이그레이션 0029 운영 적용 완료**(2026-07-31, 사용자 확인) — funnel_events 테이블+RLS. 사후 확인 rls_enabled=true/index 3/policy 1 기대값 일치. 계측 데이터 기록 시작됨.
9. **모바일 UX/QA 일괄 개선 완결**(2026-08-01, `e656108`+`2d48ca7`, Vercel success) — 다른 세션이 시작한 27파일 개선(로그인 개편·업로드 서명 배치화·에디터 자동저장 보호·PreviewGrid DnD 재작성·제스처 팬/더블탭·a11y)을 이어서 자식 컴포넌트 3개(`MobileToolbar` 퀵바 / `ResourcePalette` tabs / `PagePreviewDialog` trimGuide)와 `clampPointsForMinPayment` 테스트로 완결. 상세: STATUS.md §최근 작업 0.
10. **포인트 결제 배선 + 미적용 버그 수정**(2026-08-01) — `clampPointsForMinPayment`를 `OrderForm`/`orders/create` 양쪽 배선(단일 정본). **`pointsToUse`→`usePoints` 키 버그 수정**(기존엔 포인트가 전혀 적용 안 됨). 적대 리뷰 대응: 할인 소계 변경 시 자동 재검증, confirm 캡처 전 잔액 재확인(이중 사용 차단), AMOUNT_BELOW_MINIMUM 게이트(서버+클라). 상세: STATUS.md §최근 작업 0-1.

### 예정 작업 (우선순위 순 — 여기서 이어서 진행)
1. **[사용자 액션 대기] Storige측 통지 전달** — 통지문 정본: `docs/STORIGE-NOTICE-2026-07-21.md`. 사용자가 Storige 세션에 붙여넣으면 끝. 요지: (a) validate/external FROZEN_ROUTES 등재 (b) 검증 result 키셋 골든 spec 신설 (c) 표지 검증 계약 긴장 정리(선택). 전달 완료 통보 받으면 이 항목 닫기.
2. **품질 백로그** (사용자가 고르면 착수 — STATUS.md 우선순위 절 참조):
   - PDF 회귀 테스트 CI 통합(페이지 수+첫 페이지 해시 — CLAUDE.md 명시 항목, 미구성)
   - WCAG 2.1 AA 접근성 감사(Lighthouse a11y+axe-core)
   - 인증된 사용자 E2E 골든 플로우(업로드→에디터→주문)
   - Lighthouse SI 4.8s/TTI 7.3s 개선(fabric lazy split)
   - 포인트 홀드/예약 설계 — create 검증↔confirm 차감 사이 이중 사용의 구조적 해소(현재는 confirm 캡처 전 재확인으로 완화, ms TOCTOU 감수). pending 주문 합산 검증 또는 ledger hold RPC.
   - 100% 할인 코드 정책 — 현재 100원 미만 주문은 AMOUNT_BELOW_MINIMUM 으로 차단(무료 주문 경로 없음). 무료 주문 지원 여부 오너 결정.
3. **[선택] 퍼널 데이터 첫 확인** — 0029 적용(2026-07-31) 이후 실사용 이벤트가 쌓이면 `select event, count(*) from funnel_events group by 1;`로 유입 확인. 필요 시 관리자 콘솔 퍼널 대시보드 착수 여부 결정.
4. **[보류] 데모 모드** — 사용자 "구현 시작" 시: `/login` "데모 둘러보기" 원클릭 + `POST /api/auth/demo-login` + `DEMO_MODE` env 토글. 운영자 준비물: 데모계정+`DEMO_EMAIL/DEMO_PASSWORD/DEMO_MODE`. 계정 생성·비번 입력은 어시스턴트 직접 금지.
5. **[모니터링] Storige C-2 배포 통지 시** — 100p PDF 검증 E2E 재실증(105.9MB presigned→COMPLETED 시나리오). `cropMarkEnabled` 미opt-in이라 기본 무영향.

### Storige 연동 계약 요지 (변경 시 반드시 대조)
- 계약면: BASE `https://api.papascompany.co.kr/api` · 키 2종 `STORIGE_API_KEY`(→`/files/*`)/`STORIGE_WORKER_API_KEY`(→`/worker-jobs/*`) · `orders.storige_cover_file_id/interior_file_id/validation`.
- 워커 검증 정본: result=`{isValid, errors, warnings, metadata}` · status=PENDING/PROCESSING/COMPLETED/FIXABLE/FAILED · FIXABLE=에러 전부 autoFixable.
- client.ts의 FROZEN 의존(리팩터링 시 깨지 말 것): 응답 최상위 `id` 키, `body.includes('STORIGE_NOT_S3')` 폴백, 90MB 라우팅 임계, multipart 응답 3키(fileId/uploadUrl/uploadToken).
- Storige 계약 표면 건드리는 변경은 `/Users/yohan/Developer/Bookmoa Storige editor/storige/docs/CONTRACT_FREEZE.md` 대조 후 진행.

### 작업 방식
- 다건/감사/리뷰는 Workflow 서브에이전트 오케스트레이션(파일별 disjoint 분할→병렬→적대적 검증).
- 결제/인증/RLS/발주 게이트/Storige 계약 등 민감 변경은 typecheck + vitest + 적대적 리뷰 + Vercel 빌드 다층 검증 후 커밋.
- 세션 종료 시 이 문서와 STATUS.md 갱신(완료/미완/다음 단계).

첫 작업: STATUS.md와 이 문서를 읽고 상태 보고 → 예정 1번(Storige측 통지 전달 여부) 확인 후 사용자가 고른 항목 진행.

## ─────────────────────────────── (붙여넣기 블록 끝)
