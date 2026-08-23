# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 **■ 붙여넣기 블록**을 그대로 붙여넣으세요.
>
> 갱신 2026-08-11 · main = origin/main · CI green · Vercel prod success
> **🚀 서비스 개시 가능 상태.** 남은 운영 액션은 전부 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md),
> 실시간 상태는 `/admin` "서비스 런치 체크" 카드. **"다음 추천" 목록을 새로 만들지 말 것 —
> 운영 액션·백로그의 유일한 정본은 런북이다** (사용자 지시, 2026-08-09).
> 최근 세션(08-09~11): 오픈 전 6렌즈 감사 22건→확정 8건 전부 조치 —
> **보안 마이그레이션 `0031`(포인트 RPC revoke + 토큰 테이블 RLS) 적용·검증 완료**,
> CSP 우편번호 iframe 차단·미들웨어 `?code=` 오인·할인코드 이중사용·부분환불 오매핑·
> 관리자 UUID 검색 수정, 메일 큐 유실 방지. **런치 차단 항목 0건.**

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
| ~~`TOSS_WEBHOOK_SECRET`~~ | **2026-08-07 해소 — 이 키는 이제 존재하지 않는다.** 토스는 개발자 지정 커스텀 헤더를 웹훅에 보낼 수 없어(헤더 4종 고정·서명은 지급대행 전용) 미설정이면 500·설정하면 401 로 어느 쪽이든 전량 거부였다. 헤더 게이트를 제거하고 paymentKey 재조회 검증 + rate limit 으로 대체(`ee261d8`). **남은 운영 작업은 토스 콘솔에 웹훅 URL 등록뿐**(헤더 설정 없음) | `app/api/payments/webhook/route.ts` 상단 주석 |
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
| **인증 골든 플로우** | `pnpm e2e:auth` | 2 passed (업로드→편집→표지→주문). **운영 Supabase 를 쓰므로 CI 미포함**, service_role 키 없으면 자동 skip |
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

**2026-08-09 세션 (서비스 런치 마감)**
17. **폰트 운영 시딩 + 폴백 수정** — `resources` 가 비어 있어 PDF 한글이 폴백 렌더될 상태.
    Pretendard 시딩(실코드 경로로 렌더 검증) + `lib/pdf/fonts.ts` SYSTEM_FALLBACKS 에서
    "Pretendard" 제거. **다시 넣지 말 것**(Vercel Linux 에 없는 폰트).
18. **카카오 버튼 게이트** — 프로바이더 비활성(authorize 400 실측) 상태의 죽은 버튼을
    `NEXT_PUBLIC_KAKAO_ENABLED=1` 게이트로 숨김. 콘솔 설정 후 env 켜면 노출(런북 §5).
19. **런치 체크판 + 런북** — `/admin` "서비스 런치 체크" 카드(`lib/admin/launch-status.ts`),
    운영 액션·백로그 정본을 `docs/LAUNCH-RUNBOOK.md` 로 일원화.

**2026-08-07 세션 (커밋 `9250ddf`~`3529f0d`, CI green · Vercel prod success)**
12. 🚨 **에디터 ref 회귀 수정**(`9250ddf`) — `next/dynamic` 이 ref 를 버려 표지·내지 에디터의
    저장·객체 추가·undo/redo 가 **3개월간(2026-05-07~) 전면 no-op** 이었다. 표지 저장이 안 되면
    `cover_json` 이 없어 **주문 단계 자체가 안 열린다**. `FabricStageLazy` 래퍼로 해소 — 함정 6번 참조.
13. **결제 웹훅 헤더 게이트 제거**(`ee261d8`) — 토스가 못 보내는 헤더를 요구해 전량 거부였다.
    진위는 paymentKey 재조회 4겹 검증에 일원화, 폭주는 rate limit 프리셋으로. **`TOSS_WEBHOOK_SECRET`
    은 더 이상 코드에 없다** — 다시 도입하지 말 것.
14. **인증 골든 플로우 E2E**(`973e453`) — `pnpm e2e:auth`. 업로드→자동편집→표지저장→주문서→
    결제 직전(버튼 enabled)까지. afterAll 정리 실동작 확인. 함정 7번의 두 규칙을 반드시 지킬 것.
15. **폰트 3단 분할**(`1f482c6`) — ui 199KB(preload) / kr 301KB / ext 1,315KB.
    운영 5회 중앙값: **전송 938→605KB · LCP 4,814→3,619ms(−25%) · Performance 83→88 · CLS 0 유지**.
    재생성은 `python3 scripts/build-font-subsets.py`(fontTools·brotli 필요) — **산출물은 커밋 대상**이고
    ui 서브셋은 **소스 스캔 결과에 의존**하므로 한글 문구를 크게 추가하면 다시 돌릴 것.
16. **`book_completed` dedupe**(`9c546d3`) — 마이그레이션 `0030`. **운영 적용 완료**(2026-08-09).
17. **보안 마이그레이션 `0031`**(`8166be4`) — **운영 적용·검증 완료**(2026-08-11).
    SECURITY DEFINER 함수의 PUBLIC EXECUTE 회수(포인트 무한 발급 차단) + `share_tokens`·
    `gifts` 의 `using(true)` SELECT 정책 제거. 적용 후 실측: anon → `add/deduct_user_points_v2`
    = `42501`, `is_admin()` = `false`(정상 유지), service_role = 정상, 골든 플로우 2 passed.
18. **결제·운영 결함 5건**(`3f06ceb`) — CSP 에 `postcode.map.kakao.com` 추가(우편번호 검색
    복구) · 미들웨어가 토스 failUrl 의 `?code=` 를 OAuth 코드로 오인하던 것 예외 처리 ·
    할인코드 재확인을 결제 캡처 **전**으로 이동 · `PARTIAL_CANCELED` 매핑 제거 ·
    관리자 주문 UUID 검색을 범위 비교로 교체.
19. **메일 큐 보존**(`e41cfd3`) — 키 미설정 시 잡을 죽이지 않고 `deferred` 로 대기시킨다.
    키를 넣는 순간 밀린 주문·배송 알림까지 자동 발송된다.

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

### 3. 반드시 지켜야 할 함정 10가지

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
6. 🚨 **`next/dynamic` 으로 감싼 컴포넌트에 ref 를 주지 말 것.** Loadable 래퍼는 함수 컴포넌트라
   ref 를 조용히 버린다("Function components cannot be given refs" 경고만 남고 `.current` 는 null).
   이것 때문에 표지·내지 에디터의 저장·객체 추가가 **3개월간 전면 no-op** 이었다(`9250ddf` 수정).
   FabricStage 는 반드시 `components/editor/FabricStageLazy.tsx`(forwardRef → `forwardedRef` prop
   우회 래퍼)를 통해 쓸 것. **다른 컴포넌트에 lazy + ref 가 필요하면 같은 패턴을 복제**하고,
   "성능 최적화로 dynamic 전환" 같은 변경을 할 때 ref 사용처를 먼저 grep 할 것.
7. **인증 E2E 작성 규칙 2가지**(둘 다 실측으로 확인한 함정):
   ① 숨은 file input 에 `setInputFiles` 로 주입하면 파일은 들어가는데 React `onChange` 가 안 돈다
   → 드롭존 클릭 → `filechooser` 경로를 쓸 것. ② 에디터 저장 완료는 버튼 라벨("저장"/"저장됨")이
   아니라 **PATCH 응답**으로 판정할 것(`save()` 가 캔버스를 갱신하면 dirty 가 되살아난다).
9. **SECURITY DEFINER 함수를 새로 만들면 `revoke` 를 함께 쓸 것.** Postgres 는 PUBLIC 에
   EXECUTE 를 기본 부여하므로 `grant … to service_role` 만 하면 **anon 도 실행할 수 있다**
   (실측으로 포인트 무한 발급이 가능했다 — `0031`). 단 `is_admin()` 은 RLS 정책 22곳에서
   호출자 권한으로 실행되므로 **절대 잠그지 말 것**, `lookup_referral_code()` 도 의도적 공개다.
10. **문서를 스크립트로 치환 편집한 뒤에는 결과를 반드시 확인할 것.** 여러 세션이 같은 파일을
   건드리면 앵커 문자열이 이미 바뀌어 있어 치환이 조용히 실패한다 — 실제로 감사 기록 한 절이
   커밋 메시지만 남고 본문이 통째로 누락된 적이 있다(`4a18433` → `5b4a547` 로 복구).
   `assert anchor in s` 같은 가드를 두거나 삽입 후 `grep` 으로 확인할 것.
8. **a11y 측정 전 화면을 시간이 아니라 상태로 안정시킬 것** — `e2e/a11y.spec.ts` 의 `settle()`
   (`document.fonts.ready` + 모든 `animate-*` 의 opacity===1). 고정 대기로 두면 폰트 스왑이 밀릴 때
   진입 애니메이션 전환 중에 axe 가 측정해 **대비 위반이 실행마다 1~4건씩 오락가락**한다.

### 4. 남은 운영 액션 — 정본은 LAUNCH-RUNBOOK.md

**여기에 목록을 다시 만들지 말 것.** 키 발급·콘솔 클릭·SQL 등 남은 운영 액션과 백로그는
전부 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md)(\x{a7}1 토스 웹훅 \x{b7} \x{a7}3 Resend \x{b7} \x{a7}4 Upstash \x{b7}
\x{a7}5 카카오 \x{b7} \x{a7}6 마이그레이션 0030 \x{b7} \x{a7}7 Storige 통지 \x{b7} 백로그 표)에 있고, 실시간 상태는
`/admin` "서비스 런치 체크" 카드가 보여준다. 항목이 해소되면 런북에서 지우고,
새 운영 이슈가 생기면 런북에 추가한다.

### 5. 작업 방식

- 다건 감사·리뷰는 Workflow 서브에이전트 오케스트레이션(파일별 disjoint 분할 → 병렬 → 적대적 검증).
  단일 파일 수정이나 맥락 의존 작업은 단독 수행이 낫다.
- 결제/인증/RLS/발주 게이트/Storige 계약 등 민감 변경은
  typecheck + vitest + 적대적 리뷰 + CI + Vercel 빌드로 다층 검증 후 커밋.
- **측정이 필요한 주장은 측정으로 뒷받침한다.** 수치를 보고할 때 측정 횟수와 편차를 함께 밝힐 것.
- 세션 종료 시 `STATUS.md`와 이 문서를 갱신한다(완료/미완/다음 단계/새로 발견한 함정).

**첫 작업**: `git status -sb && git log --oneline -5` 로 실제 상태를 확인하고,
`STATUS.md`(§0-7)와 이 문서를 읽어 현재 상태를 한 문단으로 보고한다.
**추천 목록을 만들지 말고**, 사용자가 시킨 작업을 바로 진행한다.
운영 액션이 궁금하면 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md) 를 가리키는 것으로 끝.

## ─────────────────────────────── (붙여넣기 블록 끝)
