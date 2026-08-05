# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 **■ 붙여넣기 블록**을 그대로 붙여넣으세요.
>
> 갱신 2026-08-06 · HEAD `ca4db54` · main = origin/main · 작업트리 clean (이 문서 커밋 시점 기준)
> 직전 실코드 커밋은 `d1c17ea`(perf: 이미지 원본 URL 통일). 이후는 문서 커밋뿐.
> 최근 세션: 품질 백로그 1차(CI 신설·PDF 회귀·WCAG AA) + 성능 개선(폰트 분할) 완료·배포.
> 이 문서의 사실 주장은 2026-08-06 서브에이전트 3렌즈로 레포 실물과 대조 검증했다.

---

## ■ 붙여넣기 블록 (여기부터 복사) ─────────────────────────

너는 100p_books(Next.js 14 App Router + TypeScript + Supabase + TossPayments + Storige 인쇄 백엔드 +
@napi-rs/canvas·pdf-lib PDF 렌더러)의 시니어 개발/CTO다. 모든 사고과정과 대화는 한글로.

### 0. 작업 환경

- **정본 로컬**: `/Users/yohan/Developer/claude/100p_books` (branch `main`).
  Documents 사본은 node_modules 제거됨 — 쓰지 말 것.
- 레포 `papascompany/100p_books` (PUBLIC). main push → **Vercel auto-deploy** 정상.
- **로컬에서 전체 검증이 가능하다**(과거 문서의 "node v22 ↔ comment-json 크래시로 lint/build 불가"는
  2026-08-03 실측으로 해소 확인):
  ```
  pnpm typecheck && pnpm lint && pnpm test && pnpm test:pdf && pnpm build
  ```
- **CI 트리거 주의**: `.github/workflows/ci.yml`은 **main push 와 PR 에서만** 돈다
  (`on: push: branches: [main]` / `pull_request`). **피처 브랜치 단독 push 로는 CI 가 돌지 않는다** —
  이때 `gh run list --limit 1`은 직전 main 실행(success)을 그대로 보여주므로 통과로 오독하기 쉽다.
  반드시 SHA/브랜치를 함께 대조할 것:
  ```
  gh run list --limit 3 --json headBranch,headSha,conclusion
  gh api repos/papascompany/100p_books/commits/<sha>/status --jq .state   # Vercel
  ```
- **커밋은 사용자가 요청할 때만.** 커밋 메시지 끝에 `Co-Authored-By: Claude ...`.
  zsh glob 때문에 `git add` 시 `[id]` 포함 경로는 **따옴표**로 감쌀 것.
- **Supabase 운영 DB(`vprifnztvlduhpuwgdau`)는 MCP/CLI 불가**(연결된 MCP는 타 계정 "storige's Org").
  마이그레이션은 사용자가 대시보드 SQL Editor에 수동 적용한다.
  ⚠️ 함정: SQL Editor가 다른 프로젝트에 연결돼 있으면 `42P01 relation does not exist` —
  상단이 `100p_books / PRODUCTION`인지 **먼저 확인시킬 것**. **0001~0029 전부 적용 완료**(0029: 2026-07-31).

**운영 환경변수 실측 (2026-08-06, `vercel env ls` — CLI 는 papas-yohan 으로 정상 로그인)**

설정된 것(Production 11종): `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_APP_URL` / `TOSS_SECRET_KEY` / `TOSS_CLIENT_KEY` /
`NEXT_PUBLIC_TOSS_CLIENT_KEY` / `STORIGE_API_URL` / `STORIGE_API_KEY` / `STORIGE_WORKER_API_KEY` / `CRON_SECRET`

**미설정 3종과 실제 결과** — 코드가 조용히 넘어가지 않고 아래처럼 동작한다:

| 미설정 env | 실제 동작 | 근거 |
|---|---|---|
| `TOSS_WEBHOOK_SECRET` | production 에서 **모든 결제 웹훅을 500 `WEBHOOK_NOT_CONFIGURED` 로 거부**(fail-closed) | `app/api/payments/webhook/route.ts:75-84` |
| `UPSTASH_REDIS_REST_URL`/`TOKEN` | rate limit **전면 fail-open**(가입 라우트 포함) | `lib/security/rate-limit.ts:13,21-23` |
| `RESEND_API_KEY`/`EMAIL_FROM` | 메일 job 을 **cancelled 처리 → 발송 0** | `lib/email/worker.ts:168-172` |

로컬 `.env.local` 에는 Supabase 3종 + TOSS 3종만 있고 **`STORIGE_*` 키가 없다** →
Storige 연동을 로컬에서 실증하려면 키를 먼저 받아야 한다(미설정 시 503/SKIPPED).

- 첫 작업 전 루트 `STATUS.md` + 이 문서를 읽고 현재 상태를 사용자에게 보고할 것.
  ⚠️ **성능 수치 정본은 `STATUS.md` §0-4(2026-08-05)** 다. STATUS.md 안의 "Performance 97 · LCP 1.5s"
  (§M8 QA 표, §테스트 현황)는 **2026-05-13 옛 측정치**이니 baseline 으로 쓰지 말 것.

### 1. 검증 명령 (전부 로컬에서 동작)

| 대상 | 명령 | 현재 기준선 |
|---|---|---|
| 타입 | `pnpm typecheck` | 0 에러 |
| 린트 | `pnpm lint` | 0 경고 |
| 유닛 | `pnpm test` | 169 passed / 1 skipped |
| PDF 회귀 | `pnpm test:pdf` | 4 케이스 OK |
| 접근성 | `pnpm test:a11y` | 25 passed (WCAG 2.1 AA 위반 0) |
| E2E 스모크 | `pnpm e2e` | 12 passed |
| 빌드 | `pnpm build` | 홈 First Load JS 102kB |

⚠️ `pnpm e2e` / `pnpm test:a11y` 는 playwright webServer 로 `pnpm dev --port 3000` 을 띄우는데
`reuseExistingServer: true`(`playwright.config.ts:46-52`)다. **포트 3000 에 옛 dev 서버가 떠 있으면
그 서버를 그대로 재사용해 옛 코드를 테스트한다.** 실행 전 `lsof -ti:3000` 으로 확인할 것.

### 2. 완료된 것 — 재작업 금지 (증거 커밋 포함)

**인쇄·PDF 파이프라인**
1. **Storige 인쇄 백엔드 일원화** + 100p PDF 최적화(578MB→~106MB) + 전수감사 46건 수정.
   보안 Critical/High 0. E2E 실증: 105.9MB presigned 업로드 → 인쇄검증 COMPLETED.
2. **워커 검증 계약 정밀 대응**(`7c0f5d3`, `4b89aa2`): result는 `{isValid, errors, warnings, metadata}`.
   내지에 `pageMultiple: 2` 전송. **표지는 `size`=통판 스프레드(블리드 제외), `spineWidthMm` 전송 금지**가 정답.
   근거 주석이 `lib/storige/client.ts` ValidateOpts(423~457행)에 고정 — **지우거나 "고치지" 말 것.**
3. **2-D 검증 게이팅**(`449cc3f`, `24adaed`): FIXABLE/FAILED 시 paid→in_production 409 `VALIDATION_BLOCKED`,
   `force` 오버라이드+감사로그. 헬퍼 `lib/orders/validation-gate.ts`(테스트 8건).
   알려진 한계(감수·주석화): SELECT↔UPDATE ms TOCTOU 창, 감사로그 best-effort.

**제품 UX**
4. **모바일 UX/QA 일괄 개선**(`e656108`): 로그인 개편(카카오 상단·약관은 가입시만), 업로드 서명 배치화(20개/호출),
   에디터 자동저장 보호, PreviewGrid DnD 재작성, 제스처 2지 팬·더블탭, 드로어 스크림/스크롤락.
5. **포인트 결제 배선 + 미적용 버그 수정**(`88b36d9`): 클라가 `pointsToUse`로 보내고 서버는 `usePoints`를
   기대해 **포인트가 전혀 적용되지 않던** 운영 버그 수정. `clampPointsForMinPayment` 단일 정본으로 양쪽 배선,
   confirm 캡처 전 잔액 재확인, `AMOUNT_BELOW_MINIMUM` 게이트.
6. **UI/UX 전수감사 118건 완결**(`81506b9`): 8영역 감사 → 7샤드 병렬 구현 + 3렌즈 적대 리뷰 9건 반영.
   핵심은 **CV-1 표지 폭 정본화** — `calcCoverDimensions`가 DB 시드 의미(`cover_width_mm` = 펼침 폭,
   책등 제외)를 따르도록 공식 수정 + `orders/create`에 `COVER_FORMAT_OUTDATED` 409 게이트 +
   구규격 표지 감지 배너/재생성. 운영 `book_sizes` 실값도 시드와 일치 확인(2026-08-04) → **완전 종결**.

**품질 인프라 (2026-08-03)**
7. **CI 신설**(`.github/workflows/ci.yml`, 3잡 verify/e2e/a11y) — 그전까지 CI가 아예 없어
   "push → Vercel 실패"로만 회귀를 알 수 있었다. 운영 시크릿 없이 더미 env로 빌드(모든 env 접근이 lazy).
8. **PDF 회귀 테스트**(`scripts/pdf-regression.ts`) — 2계층: ① 구조(페이지 수·크기 pt)는 플랫폼 무관 엄격
   ② 첫 페이지 SHA-256은 `${platform}-${arch}`별. baseline 손상 실험으로 감지 동작 실증.
   `test/fixtures/pdf-baseline.json`에 **darwin-arm64 + linux-x64 둘 다 등록**.
9. **WCAG 2.1 AA 감사**(`e2e/a11y.spec.ts`) — 실측 위반 5종 발견·수정 후 25/25 통과.

**성능 (2026-08-05)**
10. **폰트 분할 + 홈 번들 축소**(`fc5d498`) — 병목은 JS가 아니라 **2MB 폰트**였다(TBT는 이미 낮았음).
    core(라틴·기호·가나 + KS X 1001 한글 2,350자, 533KB, `preload:true`) /
    ext(나머지 8,822자, 1,317KB, `preload:false`)로 분할 — `app/layout.tsx:25-42`.
    `StepsSection`이 framer-motion의 유일한 사용처여서 CSS 애니메이션으로 옮기고 RSC 서버 컴포넌트화,
    의존성 삭제 → 홈 First Load JS 150kB→102kB.
    **운영 3회 중앙값: LCP 12,840→5,184ms(-60%) · TTI 12,878→5,222ms(-59%) · 전송량 2,469→950KB ·
    Performance 73→81 · CLS 0 유지.**
    🔧 **서브셋 재생성**: `python3 scripts/build-font-subsets.py` (fontTools·brotli 필요:
    `pip install fonttools brotli`). 원본은 `assets/fonts/PretendardVariable.woff2`(public 밖 — 배포 제외).
    **산출물은 커밋 대상이고 CI가 자동 생성하지 않는다.**
11. **이미지 원본 URL 통일**(`d1c17ea`) — 이미지는 **이미 최적화 상태**였다(총 150~161KB, Lighthouse 이미지
    진단 전부 통과). 사진 6장을 16개 원본 URL로 참조하던 캐시 파편화만 정리(고유 원본 16→6).
    성능 효과는 6회 측정에서 분포가 겹쳐 **개선으로 주장하지 않음** — 구조적 정리로만 유지.

### 3. 반드시 지켜야 할 함정 5가지

1. **Storige 계약 의존** — 코드에 `FROZEN` 이라는 마커 문자열은 **없다**(grep 하면 0건이니 stale 로 오판 말 것).
   근거 주석 위치: `lib/storige/client.ts` 상단 13~66행(키 2종·90MB 임계)과 ValidateOpts 423~457행.
   깨지 말아야 할 의존: 응답 최상위 `id` 키(:405-412, :476) · `body.includes("STORIGE_NOT_S3")` 폴백(:328) ·
   90MB 라우팅 임계(:69) · presign 응답 3키 fileId/uploadUrl/uploadToken(:340-343).
   계약면 변경 시 `/Users/yohan/Developer/Bookmoa Storige editor/storige/docs/CONTRACT_FREEZE.md` 대조.
2. **PDF baseline 규칙** — 같은 platform-arch 안에서 렌더가 바뀌면 CI가 실패한다. **의도된 변경일 때만**
   `pnpm test:pdf:update`(로컬 darwin) + **CI 로그의 새 linux-x64 해시도 함께 커밋**하고 diff를 리뷰에 포함.
   ⚠️ baseline에 **없는** platform-arch 에서는 실패하지 않고 **기록만 하고 통과**한다
   (`scripts/pdf-regression.ts:290-303, 381-388`) — 러너 이미지가 바뀌면 픽셀 비교가 조용히 꺼진 채 green 이
   되므로 로그의 "신규 플랫폼 기록" 문구를 확인할 것. 또 `--update` 없는 성공 실행도 baseline 파일을 다시 쓰므로
   (:377) 새 머신에서 돌린 뒤 `git diff`를 확인할 것.
3. **Lighthouse는 반드시 3회 이상 중앙값으로 비교할 것.** 편차가 매우 크다(같은 코드가 46~75점).
   지난 세션에 baseline을 1회만 재고(LCP 1,754ms — 이상치) "회귀"로 오판해 좋은 변경을 롤백했다가 되돌렸다.
4. **측정·테스트 전 포트 점유 확인** — 옛 서버가 3000/3100 을 잡고 있으면 그 서버를 재사용하거나
   `pnpm start`가 EADDRINUSE로 죽어 **옛 빌드를 측정**하게 된다. 서빙 중인 CSS 해시가 이번 빌드 산출물인지
   대조하는 것이 확실하다(`lsof -ti:3000`, `curl -s <url> | grep static/css`).
5. **Supabase SQL Editor 프로젝트 확인** — 상단이 `100p_books / PRODUCTION`인지 먼저 확인시킬 것.

### 4. 예정 작업 (우선순위 순)

0. **[먼저 처리] 열린 PR #2 — 퍼널 계측 버그 수정**
   `fix/funnel-signup-email-path` · `fix(analytics): 이메일 가입 경로 signup_completed 누락 수정 (S1-2)`
   (2026-08-04 open, 1파일 +8줄, `app/api/auth/signup/route.ts`)
   - **버그는 main 실코드에서 확인됨**: `signup_completed`는 `app/api/auth/callback/route.ts:87`에만 있고
     이메일+비밀번호 가입 경로(`app/api/auth/signup/route.ts`, admin.createUser)에는 계측이 **전혀 없다**.
     이메일 가입은 callback을 타지 않으므로(클라가 `signInWithPassword`로 세션 생성)
     **현재 `funnel_events.signup_completed`는 카카오/매직링크 가입자만 집계된다.**
   - PR 브랜치가 CI 신설(`5909c4d`) 이전 main 에서 분기해 **GitHub Actions 결과가 없다**(Vercel 체크만 존재).
     → main rebase 후 CI 통과를 확인하고 머지할 것.

1. **[사용자 액션 대기] Storige측 통지 전달** — 통지문 정본 `docs/STORIGE-NOTICE-2026-07-21.md`를
   사용자가 Storige 세션에 붙여넣으면 끝. 요지: (a) validate/external FROZEN_ROUTES 등재
   (b) 검증 result 키셋 골든 spec 신설 (c) 표지 검증 계약 긴장 정리(선택).
   **전달 완료 통보를 받으면 이 항목을 닫을 것.**

2. **[선행 조건 = 사용자 액션] 인증된 사용자 E2E 골든 플로우** (업로드→에디터→주문)
   - 필요한 것 중 하나: ① E2E 전용 테스트 계정 + CI 시크릿(`E2E_EMAIL`/`E2E_PASSWORD`) 등록,
     또는 ② service_role로 테스트 유저를 만드는 시드 스크립트 승인.
   - **계정 생성·비밀번호 입력은 어시스턴트가 직접 하지 않는다.**
   - 정해지면 바로 착수 가능. a11y 감사도 이 픽스처로 로그인 이후 화면까지 확장한다.

3. **[운영 판단 필요] 미설정 env 3종** (§0 표 참조) — 코드는 이미 대비돼 있으나 기능이 꺼져 있다:
   결제 웹훅 전면 거부(`TOSS_WEBHOOK_SECRET`) · rate limit 무력화(Upstash) · 메일 발송 0(Resend).
   특히 **웹훅 fail-closed 는 결제 상태 동기화에 영향**을 줄 수 있으니 사용자에게 현황을 먼저 알릴 것.

4. **품질/성능 잔여** (사용자가 고르면 착수)
   - **렌더링 경로 최적화** — 현재 Performance 81. LCP 분해에서 `elementRenderDelay`가 지배적이고
     실행마다 55~2,044ms로 요동친다(메인스레드 1.1s — Other 387ms / Style·Layout 281ms / Script 260ms).
     **비용 대비 효과를 먼저 재평가**할 것. 이미지·폰트는 이미 정리됐다.
   - 키보드 only 접근성 회귀 시나리오
   - **포인트 홀드/예약 설계** — create 검증 ↔ confirm 차감 사이 이중 사용의 구조적 해소
     (현재는 confirm 캡처 전 재확인으로 완화, ms TOCTOU 감수). pending 주문 합산 검증 또는 ledger hold RPC.
   - **100% 할인 코드 정책** — 현재 100원 미만 주문은 `AMOUNT_BELOW_MINIMUM`으로 차단(무료 주문 경로 없음).
     무료 주문 지원 여부는 **오너 결정 필요**.
   - 프로젝트 삭제 소프트삭제 편입(현재 하드 삭제, 스키마 변경 필요) ·
     `book_completed` 퍼널 이벤트 서버측 dedupe(현재 저장마다 재발화)

5. **[선택] 퍼널 데이터 첫 확인** — `select event, count(*) from public.funnel_events group by 1 order by 2 desc;`
   ⚠️ **PR #2 머지 전 데이터는 이메일 가입자의 `signup_completed`가 통째로 빠져 있다** —
   분모가 과소해 "가입→첫 책" 전환율이 과대 계상되니 그대로 읽지 말 것.

6. **[보류] 데모 모드** — 사용자가 "구현 시작"이라고 할 때만: `/login` "데모 둘러보기" 원클릭 +
   `POST /api/auth/demo-login` + `DEMO_MODE` env 토글. 운영자 준비물: 데모계정 + `DEMO_*` env.

7. **[모니터링] Storige C-2 배포 통지 시** — 100p PDF 검증 E2E 재실증(105.9MB presigned→COMPLETED).
   **선행: 로컬 `.env.local`에 `STORIGE_API_KEY`/`STORIGE_WORKER_API_KEY`를 받아야 실증 가능.**
   `cropMarkEnabled` 미opt-in이라 기본 무영향.

### 5. 작업 방식

- 다건 감사·리뷰는 Workflow 서브에이전트 오케스트레이션(파일별 disjoint 분할 → 병렬 → 적대적 검증).
  단일 파일 수정이나 맥락 의존 작업은 단독 수행이 낫다.
- 결제/인증/RLS/발주 게이트/Storige 계약 등 민감 변경은
  typecheck + vitest + 적대적 리뷰 + CI + Vercel 빌드로 다층 검증 후 커밋.
- **측정이 필요한 주장은 측정으로 뒷받침한다.** 수치를 보고할 때 측정 횟수와 편차를 함께 밝힐 것.
- 세션 종료 시 `STATUS.md`와 이 문서를 갱신한다(완료/미완/다음 단계/새로 발견한 함정).

**첫 작업**: `git status -sb && git log --oneline -5` 로 실제 상태를 확인하고,
`STATUS.md`와 이 문서를 읽어 현재 상태를 보고한 뒤,
예정 0번(PR #2 머지)·1번(Storige 통지)·2번(E2E 계정 준비)·3번(미설정 env)을 사용자에게 확인하고
사용자가 고른 항목부터 진행할 것.

## ─────────────────────────────── (붙여넣기 블록 끝)
