# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 **■ 붙여넣기 블록**을 그대로 붙여넣으세요.
>
> 갱신 **2026-09-24** · `main` = `2d403ae` = `origin/main` · CI 3잡 green · Vercel prod success
> **미병합 브랜치 없음** — `integ/wave2` 는 `bacadc1` 위로 rebase 해 ff 병합했다
> (rebase 이전 SHA 는 더 이상 존재하지 않는다).
> 🆕 **`4346c0b` = Next.js 16.3.5 + React 19.3.0 전환**(운영 배포 완료, STATUS.md §0-12).
> ⚠️ **운영 미적용 마이그레이션 2건: `0032`·`0033`** — 코드가 먼저 배포됐으므로
> `0033` 적용 전까지 SEC-7(주문 간 동시 결제 이중 사용) 창이 열려 있다.
> 남은 운영 액션은 전부 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md),
> 실시간 상태는 `/admin` "서비스 런치 체크" 카드. **"다음 추천" 목록을 새로 만들지 말 것 —
> 운영 액션·백로그의 유일한 정본은 런북이다** (사용자 지시, 2026-08-09).
> 최근 세션(09-17~21): 6렌즈 감사 확정분을 샤드 병렬로 구현 — sharp 하드닝, 오픈 리다이렉트,
> 탈퇴 잔존, 메일 cron·에러 경계·cron 인증, **편집 무결성 QA-1~4(critical)**,
> 결제 무결성(0033), 주문 수명주기, 관리자 환불, **RLS 봉쇄 0032**,
> 편집 잠금 완결·409 읽기 전용 전환·출석 20일 보너스 버그 수정.
> 이어서 **Next 16 + React 19 전환**(`4346c0b`) — `next` advisory 23건이 전부 해소돼
> prod 취약점이 60건 → 36건이 됐다.

---

## ■ 붙여넣기 블록 (여기부터 복사) ─────────────────────────

너는 100p_books(**Next.js 16 App Router + React 19** + TypeScript + Supabase + TossPayments +
Storige 인쇄 백엔드 + @napi-rs/canvas·pdf-lib PDF 렌더러)의 시니어 개발/CTO다.
모든 사고과정과 대화는 한글로.

### 0. 작업 환경

- **정본 로컬**: `/Users/yohan/Developer/claude/100p_books` (branch `main`).
  Documents 사본은 node_modules 제거됨 — 쓰지 말 것.
- 레포 `papascompany/100p_books` (PUBLIC). main push → **Vercel auto-deploy** 정상.
- **브랜치 상태 (2026-09-24)** — `main` = `2d403ae` = `origin/main`. **미병합 브랜치·worktree 없음.**
  `4346c0b`(Next 16) 이후 리뷰 후속 `a41e195`·`c931801`·`2d403ae` 가 올라가 있다(STATUS §0-13).
  `4346c0b` 은 **Next 16.3.5 + React 19.3.0 전환**이고 그 부모가 `34a5897` 이다.
  `integ/wave2` 를 `bacadc1` 위로 rebase 해 ff 병합했으므로 **rebase 이전 SHA
  (`552f6e1`·`c6deee9`·`5161cc9`·`67c8f2f`·`692c888`·`3d4b24e`·`69df5d2`·`f4af049`)는 존재하지 않는다.**
  현재 main 의 해당 커밋은 `31eaabf`·`88163d0`·`488cccb`·`061273a`·`be00e1b`·`b47834c`·`aed8404`·`513ba21`
  이고, 그 위에 INT-ui `34a5897` 이 올라가 있다.
- **main 브랜치 보호가 켜져 있다**(2026-09-17): CI 3잡 필수 체크, force-push·삭제 금지,
  관리자 우회 허용(`enforce_admins=false`). Dependabot alerts·security updates 활성화.
  **`next` 15.5.24 보안 PR 은 16.3.5 직행 전환으로 해소됐다.** 현재 열린 PR 은 actions 메이저,
  `@napi-rs/canvas` 1.x, `lucide-react` 1.x, `nanoid` 6, `typescript` 6, `postcss` 패치,
  npm-minor-patch 그룹 등이다 — **머지 전에 `dependabot.yml` 의 메이저 ignore 규칙(14/18 기준으로
  작성됨)을 16/19 기준으로 재검토할 것.**
- **로컬에서 전체 검증이 가능하다**:
  ```
  pnpm typecheck && pnpm lint && pnpm test && pnpm test:pdf && pnpm build
  ```
- **CI 트리거 주의**: `.github/workflows/ci.yml`은 **main push 와 PR 에서만** 돈다.
  **피처 브랜치 단독 push 로는 CI 가 돌지 않는다** — 이때 `gh run list --limit 1`은 직전 main 실행을
  그대로 보여주므로 통과로 오독하기 쉽다. 반드시 SHA/브랜치를 함께 대조할 것:
  ```
  gh run list --limit 3 --json headBranch,headSha,conclusion
  gh api repos/papascompany/100p_books/commits/<sha>/status --jq .state   # Vercel
  ```
- **커밋은 사용자가 요청할 때만.** 커밋 메시지 끝에 `Co-Authored-By: Claude ...`.
  zsh glob 때문에 `git add` 시 `[id]` 포함 경로는 **따옴표**로 감쌀 것.
- **Supabase 운영 DB(`vprifnztvlduhpuwgdau`)는 MCP/CLI 불가**(연결된 MCP는 타 계정 "storige's Org").
  마이그레이션은 사용자가 대시보드 SQL Editor에 수동 적용한다.
  ⚠️ 함정: SQL Editor가 다른 프로젝트에 연결돼 있으면 `42P01 relation does not exist` —
  상단이 `100p_books / PRODUCTION`인지 **먼저 확인시킬 것**.
  **`0001~0031` 적용 완료 · `0032`·`0033` 미적용**(런북 §9·§10).

**운영 환경변수 (Production 11종, `vercel env ls`)**

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` /
`NEXT_PUBLIC_APP_URL` / `TOSS_SECRET_KEY` / `TOSS_CLIENT_KEY` / `NEXT_PUBLIC_TOSS_CLIENT_KEY` /
`STORIGE_API_URL` / `STORIGE_API_KEY` / `STORIGE_WORKER_API_KEY` / `CRON_SECRET`.
**Preview 환경은 0종** — 프리뷰 배포는 빌드만 통과하고 런타임 동작은 불가하다.

**미설정 2종과 실제 결과** — 코드가 조용히 넘어가지 않고 아래처럼 동작한다:

| 미설정 env | 실제 동작 | 근거 |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`/`TOKEN` | rate limit **전면 fail-open**(가입 라우트 포함) | `lib/security/rate-limit.ts` (`ENABLED = !!url && !!token`) |
| `RESEND_API_KEY`/`EMAIL_FROM` | 메일 워커가 **큐를 건드리지 않고 보류**한다 — `{ deferred: true, queued: N }`. 키를 넣는 순간 밀린 잡까지 순서대로 발송된다 | `lib/email/worker.ts` (`if (!process.env.RESEND_API_KEY)`) |

> ⚠️ 옛 문서의 "메일 job 을 cancelled 처리 → 발송 0" 은 **stale** 이다. 2026-08-08(`e41cfd3`)
> 이후로 큐는 보존된다. 그 이전에 `cancelled` 로 종결된 잡만 예외(`/admin/emails` 개별 재시도).

`TOSS_WEBHOOK_SECRET` 은 **존재하지 않는다**(2026-08-07 `ee261d8` 로 제거). 토스는 개발자 지정
커스텀 헤더를 웹훅에 보낼 수 없어 미설정이면 500·설정하면 401 로 어느 쪽이든 전량 거부였다.
진위는 paymentKey 재조회 검증 + rate limit 으로 대체했다. **다시 도입하지 말 것.**
남은 운영 작업은 토스 콘솔에 웹훅 URL 등록뿐이다.

로컬 `.env.local` 에는 Supabase 3종 + TOSS 3종만 있고 **`STORIGE_*` 키가 없다** →
Storige 연동을 로컬에서 실증하려면 키를 먼저 받아야 한다(미설정 시 503/SKIPPED).

- 첫 작업 전 루트 `STATUS.md`(§0-12·§0-11) + 이 문서를 읽고 현재 상태를 사용자에게 보고할 것.
  ⚠️ **성능 수치 정본은 `STATUS.md` §0-5(2026-08-07, prod 5회 중앙값)** 다.
  STATUS.md 안의 "Performance 97 · LCP 1.5s"(§M8 QA 표)는 **2026-05-13 옛 측정치**이니
  baseline 으로 쓰지 말 것.

### 1. 검증 명령 (전부 로컬에서 동작)

**기준선은 `main`(`4346c0b`, Next 16 전환 후)에서 2026-09-21 실측한 값이다.**

| 대상 | 명령 | 현재 기준선 |
|---|---|---|
| 타입 | `pnpm typecheck` | 0 에러 |
| 린트 | `pnpm lint` | **0 error / 41 warning** — 38건이 `react-hooks` v7 신규 규칙. **전환 방침상 warn 유지**이므로 "경고 0" 을 기준선으로 쓰지 말 것 |
| 유닛 | `pnpm test` | **82 파일 / 1,427 passed / 1 skipped** (`2d403ae`, 2026-09-24) |
| PDF 회귀 | `pnpm test:pdf` | 4 케이스 OK (394ms, darwin-arm64 — baseline 무수정) |
| 접근성 | `pnpm test:a11y` | 25 passed / 1 skipped (WCAG 2.1 AA 위반 0) |
| E2E 스모크 | `pnpm e2e` | 12 passed |
| **인증 + 편집 무결성** | `pnpm e2e:auth` | **5 passed** — 골든 플로우 2 + 편집 무결성 회귀 3(QA-1/QA-4/QA-2). `4346c0b` 배포본 대상 실측 완료 |
| 빌드 | `pnpm build` | 성공 (**Turbopack**, `--webpack` 불요. 라우트 121개 렌더링 모드 변경 0) |

> `pnpm lint` 는 Next 16 에서 `next lint` 가 제거돼 **`eslint` CLI 직접 호출**이다
> (`eslint app components lib hooks`, flat config `eslint.config.mjs`).
> Lighthouse 는 Next 16 이 First Load JS 표를 내지 않아 **기준선(§0-5)과 같은 방식의 비교가 불가**하다.

⚠️ `pnpm e2e` / `pnpm test:a11y` 는 playwright webServer 로 `pnpm dev --port 3000` 을 띄우는데
`reuseExistingServer: true` 다. **포트 3000 에 옛 dev 서버가 떠 있으면 그 서버를 그대로 재사용해
옛 코드를 테스트한다.** 실행 전 `lsof -ti:3000` 으로 확인할 것.

⚠️ **`pnpm e2e:auth` 는 운영 Supabase 를 쓴다.** 임시 계정·프로젝트·스토리지 객체를 실제로 만들고
`afterAll` 에서 지운다. `service_role` 키가 없으면 자동 skip. **CI 에 넣지 말 것.**
`golden-flow` 와 `editor-integrity` 는 계정을 분리해 서로의 정리가 간섭하지 않게 해 두었다 —
새 인증 spec 을 추가할 때도 계정을 분리할 것. 운영 대상으로 돌리려면:
```
PLAYWRIGHT_BASE_URL=https://100pbooks.vercel.app pnpm e2e:auth
```

### 2. 완료된 것 — 재작업 금지 (증거 커밋 포함)

**2026-09-21 (Next 16 + React 19 전환)** — 상세는 `STATUS.md` §0-12

0. **Next.js 16.3.5 · React 19.3.0 전환**(`4346c0b`, 운영 배포 완료) — codemod 2-hop 후 수동 정리.
   `createServerSupabase` async 화(+호출부 41곳 await), 페이지 `params`/`searchParams` await,
   `withAdmin` 이 `ctx.params` 를 바깥에서 await(관리자 라우트 21개 무수정),
   `revalidateTag(..., { expire: 0 })`, ESLint flat config, `serverExternalPackages` 이관,
   `images.minimumCacheTTL: 60` 명시, `agentRules: false`, `sw.js` CACHE_NAME v3, `tsconfig` `jsx: react-jsx`.
   **의도적으로 제외한 것**(되돌리지 말고 후속 웨이브에서 판단): `middleware`→`proxy` 전환,
   `@supabase/ssr`·`supabase-js` 업그레이드, React Compiler, Cache Components, AVIF 재활성화.
   자세한 함정은 아래 19~24 번.

**2026-09-17~18 세션 (보안·결제·편집 무결성)** — 상세는 `STATUS.md` §0-11

1. **sharp 하드닝**(`2d77e6f`) — `/api/photos/complete` 가 취약한 sharp 0.33.5 로 사용자 바이트를
   **포맷 검사 전에** 전부 디코드하고 있었다. sharp `^0.35.4` + `lib/image/sniff.ts`(매직바이트
   사전 판정) + `lib/image/sharp-safe.ts`(libvips 로더 block, `limitInputPixels`).
   **AVIF 는 의도적으로 거부**한다 — 되살리지 말 것.
2. **오픈 리다이렉트 + 탈퇴 잔존**(`55020ab`) — `lib/auth/safe-redirect.ts` 단일 헬퍼(표 175건 + 퍼징).
   탈퇴는 soft delete + global signOut + 단계 멱등화, 돈·정체성 라우트에 `requireActiveUser`.
3. **메일 cron·에러 경계·cron 인증·health**(`f605028`, `205deba`) — cron 을 `*/5` 로 복원(그전엔
   `0 9 * * *` × 배치 10 = 하루 10통 상한), 즉시 발송과 워커가 Idempotency-Key 를 공유,
   실패 백오프 5분→30분→2시간, `sending` 고착 reaper. cron 인증은 `lib/security/cron-auth.ts` 로 일원화.
4. 🚨 **편집 무결성 QA-1~4**(`0f2b77d`) + 회귀 E2E(`bacadc1`) — 아래 함정 11·12 번이 이 작업의 핵심이다.
5. **결제 무결성**(`88163d0`) — `lib/orders/finalize-paid.ts` 단일 멱등 함수를
   confirm·웹훅이 함께 호출. 포인트·할인은 캡처 **전** 선점(0033). 토스 상태 5종 분류로
   CANCELED 결제를 멱등 재생으로 paid 확정하던 경로 차단.
6. **주문 수명주기**(`488cccb`, `513ba21`) — 사용자 취소(토스 probe 로 무결제 확인 후에만),
   만료 cron(매시, 24h), PDF 잡 reaper(10분), 주문 연결 프로젝트 DELETE 는 409 `HAS_ORDERS`.
7. **관리자 전액 환불**(`061273a`) — 토스 취소 API 연동. 전액만(부분 취소 모델 없음).
8. **RLS 봉쇄 0032**(`be00e1b`, `aed8404`) — 함정 14 번.
8-1. **편집 잠금 완결 + 409 읽기 전용 전환**(`34a5897`) — 함정 13 번. `pages/[id]` PATCH·DELETE 와
   `cover` PATCH 에 `requireActiveUser` + `assertProjectsEditable`, 판정 순서는
   **소유권 → 잠금 → `baseVersion`**, 주문 조회 실패는 503 fail-closed.
   클라이언트는 `PROJECT_LOCKED` 를 받으면 안내 1회 후 읽기 전용으로 전환한다.
   함께 들어간 방어: `gifts/[token]` 수령 3중 일치 검증(불일치 404) · `photos/purge`
   storage 키 prefix 검증 + 행 삭제 후 참조 재조회(DB→Storage 순서) ·
   **출석 20일 월 보너스 미지급 버그 수정**(`monthly-bonus.ts` 헬퍼로 memo 정확 일치 —
   기존에는 `memo LIKE '%YYYY-MM%'` 가 같은 달 10일 보너스에 걸려 +1,000P 가 사실상 미지급이었다.
   소급 이중 지급 없음).

**그 이전 세션에서 확정된 것** (요약 — 상세는 `STATUS.md`)

9. **Storige 인쇄 백엔드 일원화** + 100p PDF 최적화(578MB→~106MB) + 전수감사 46건 수정.
   워커 검증 계약: result 는 `{isValid, errors, warnings, metadata}`. 내지에 `pageMultiple: 2`.
   **표지는 `size`=통판 스프레드(블리드 제외), `spineWidthMm` 전송 금지**가 정답 —
   근거 주석이 `lib/storige/client.ts` ValidateOpts 에 고정돼 있다. **지우거나 "고치지" 말 것.**
10. **2-D 검증 게이팅** — FIXABLE/FAILED 시 paid→in_production 409 `VALIDATION_BLOCKED`,
    `force` 오버라이드 + 감사로그(`lib/orders/validation-gate.ts`).
11. **CV-1 표지 폭 정본화** — `calcCoverDimensions` 가 DB 시드 의미(`cover_width_mm` = 펼침 폭,
    책등 제외)를 따르도록 수정 + `orders/create` 의 `COVER_FORMAT_OUTDATED` 409 게이트.
12. **품질 인프라** — CI 3잡, PDF 회귀 2계층(구조 + 플랫폼별 해시), WCAG 2.1 AA 감사 25/25.
13. **폰트 3단 분할**(`1f482c6`) — ui 199KB(preload) / kr 301KB / ext 1,315KB.
    재생성은 `python3 scripts/build-font-subsets.py` — **산출물은 커밋 대상**이고
    ui 서브셋은 소스 스캔 결과에 의존하므로 한글 문구를 크게 추가하면 다시 돌릴 것.
14. **폰트 운영 시딩** — Pretendard 시딩 완료. `lib/pdf/fonts.ts` SYSTEM_FALLBACKS 에서
    "Pretendard" 제거. **다시 넣지 말 것**(Vercel Linux 에 없는 폰트).
15. **마이그레이션 `0030`·`0031` 운영 적용 완료**(2026-08-09 / 08-11).

### 3. 반드시 지켜야 할 함정

1. **Storige 계약 의존** — 코드에 `FROZEN` 이라는 마커 문자열은 **없다**(grep 하면 0건이니 stale 로 오판 말 것).
   근거 주석: `lib/storige/client.ts` 상단(키 2종·90MB 임계)과 ValidateOpts.
   깨지 말아야 할 의존: 응답 최상위 `id` 키 · `body.includes("STORIGE_NOT_S3")` 폴백 ·
   90MB 라우팅 임계 · presign 응답 3키 `fileId`/`uploadUrl`/`uploadToken`.
   계약면 변경 시 `/Users/yohan/Developer/Bookmoa Storige editor/storige/docs/CONTRACT_FREEZE.md` 대조.
2. **PDF baseline 규칙** — 텍스트 렌더는 **레포 폰트를 직접 등록**해서 잰다
   (`scripts/pdf-regression.ts` 의 `registerTestFont`). 예전에는 시스템 폰트에 의존해
   러너 이미지가 바뀌자 코드 변경 없이 CI 가 red 였다. baseline 이 깨지면 먼저
   "코드 변경인가, 러너 이미지 교체인가"를 `gh run view <id> --log | grep "Included Software"` 로 가릴 것.
   같은 platform-arch 안에서 렌더가 바뀌면 CI 실패. **의도된 변경일 때만** `pnpm test:pdf:update`
   (로컬 darwin) + **CI 로그의 새 linux-x64 해시도 함께 커밋**.
   ⚠️ baseline 에 **없는** platform-arch 에서는 실패하지 않고 **기록만 하고 통과**한다 —
   픽셀 비교가 조용히 꺼진 채 green 이 되므로 로그의 "신규 플랫폼 기록" 문구를 확인할 것.
   또 `--update` 없는 성공 실행도 baseline 파일을 다시 쓰므로 `git diff` 를 확인할 것.
3. **Lighthouse는 반드시 3회 이상 중앙값으로 비교할 것.** 편차가 매우 크다(같은 코드가 46~75점).
   과거에 1회만 재고 "회귀"로 오판해 좋은 변경을 롤백했다가 되돌린 적이 있다.
4. **측정·테스트 전 포트 점유 확인** — 옛 서버가 3000/3100 을 잡고 있으면 그 서버를 재사용하거나
   `pnpm start` 가 EADDRINUSE 로 죽어 **옛 빌드를 측정**하게 된다.
   (`lsof -ti:3000`, `curl -s <url> | grep static/css` 로 CSS 해시 대조)
5. **Supabase SQL Editor 프로젝트 확인** — 상단이 `100p_books / PRODUCTION`인지 먼저 확인시킬 것.
6. 🚨 **`next/dynamic` 으로 감싼 컴포넌트에 ref 를 주지 말 것.** Loadable 래퍼는 함수 컴포넌트라
   ref 를 조용히 버린다("Function components cannot be given refs" 경고만 남고 `.current` 는 null).
   이것 때문에 표지·내지 에디터의 저장·객체 추가가 **3개월간 전면 no-op** 이었다(`9250ddf` 수정).
   FabricStage 는 반드시 `components/editor/FabricStageLazy.tsx` 를 통해 쓸 것.
7. **인증 E2E 작성 규칙 3가지**(전부 실측으로 확인한 함정):
   ① 숨은 file input 에 `setInputFiles` 로 주입하면 파일은 들어가는데 React `onChange` 가 안 돈다
   → 드롭존 클릭 → `filechooser` 경로를 쓸 것.
   ② 저장 완료·문서 상태는 버튼 라벨("저장"/"저장됨")이 아니라 **PATCH 요청 본문과 서버 GET** 으로 판정할 것.
   ③ **운영 Supabase 를 쓰므로 spec 마다 계정을 분리**하고 `afterAll` 정리를 반드시 붙일 것.
8. **a11y 측정 전 화면을 시간이 아니라 상태로 안정시킬 것** — `e2e/a11y.spec.ts` 의 `settle()`
   (`document.fonts.ready` + 모든 `animate-*` 의 opacity===1). 고정 대기로 두면 폰트 스왑이 밀릴 때
   axe 가 전환 중에 측정해 **대비 위반이 실행마다 1~4건씩 오락가락**한다.
9. **SECURITY DEFINER 함수를 새로 만들면 `revoke` 를 함께 쓸 것.** Postgres 는 PUBLIC 에
   EXECUTE 를 기본 부여하므로 `grant … to service_role` 만 하면 **anon 도 실행할 수 있다**
   (실측으로 포인트 무한 발급이 가능했다 — `0031`). 단 `is_admin()` 은 RLS 정책 22곳에서
   호출자 권한으로 실행되므로 **절대 잠그지 말 것**, `lookup_referral_code()` 도 의도적 공개다.
10. **문서를 스크립트로 치환 편집한 뒤에는 결과를 반드시 확인할 것.** 여러 세션이 같은 파일을
    건드리면 앵커 문자열이 이미 바뀌어 있어 치환이 조용히 실패한다 — 실제로 감사 기록 한 절이
    커밋 메시지만 남고 본문이 통째로 누락된 적이 있다(`4a18433` → `5b4a547` 로 복구).
    `assert anchor in s` 같은 가드를 두거나 삽입 후 `grep` 으로 확인할 것.

--- 아래는 2026-09-17 세션에서 새로 확인한 함정이다 ---

11. 🚨 **fabric 6.9.1 의 `canvas.toJSON()` 은 인자를 무시한다**(`index.mjs:2939`).
    그래서 `toJSON(EXTRA_PROPS)` 로 커스텀 속성을 담을 수 없다. 이 때문에 히스토리 스냅샷에서
    `oType`·`objectId`·`photoId`·슬롯 태그가 빠졌고, undo/redo 후 직렬화가 태그 없는 객체를
    건너뛰어 **페이지·표지가 0객체로 자동저장**됐다(QA-1, critical).
    **스냅샷의 정본은 `lib/fabric/snapshot.ts`** — `toObject(FABRIC_EXTRA_PROPS)` 기반이다.
    `toJSON()` 으로 "단순화" 하지 말 것. `serializeForSave` 에는 불변식이 있다:
    **chrome 이 아닌 객체에 `oType` 이 없으면 저장을 중단**한다(서버 덮어쓰기 금지).
12. **편집 저장은 `baseVersion` / 409 `EDIT_CONFLICT` 계약을 따른다.**
    `PATCH /api/pages/[id]` 와 `PATCH /api/cover` 는 `baseVersion`(내용 해시 — 제목 변경 등으로
    인한 거짓 충돌이 없다)을 받아 `updated_at` CAS 로 원자 판정하고, 불일치면 409 `EDIT_CONFLICT` 를
    돌려준다. 클라이언트는 409 를 받으면 최신본을 불러오고 사용자에게 알린다.
    `baseVersion` 이 없는 구 클라이언트는 기존 동작으로 폴백한다 — **이 폴백을 제거하지 말 것.**
    재로드 순서도 고정돼 있다(`reloadEditorDoc`: 메타 → 캔버스 → 기준 버전).
    또한 에디터 이동은 반드시 **`push` → `refresh`** 순서다. 반대로 하면 (당시) Next 14.2.35 의
    action-queue 가 refresh 를 폐기해 `staleTimes` 30초 안의 왕복이 옛 RSC 를 재생했다(QA-2/QA-3).
    **Next 16 전환 후에도 이 순서와 `staleTimes` 설정은 그대로 유지한다.**
13. **결제 후 편집 잠금 판정은 `lib/orders/edit-lock.ts` 한 곳에 있다.**
    paid·in_production·shipped·delivered 주문이 있는 프로젝트의 인쇄물 영향 쓰기를
    409 `PROJECT_LOCKED` 로 거부한다. 판정표는 `Record<OrderStatus>` 라 **주문 상태를 추가하면
    타입 에러로 강제**되고, 모르는 상태는 fail-closed 다. 그리고 **반드시 소유권 검증 뒤에 판정**할 것 —
    앞에 두면 남의 프로젝트 결제 여부가 응답으로 새어 나간다.
    (휴지통 영구 삭제는 인쇄 원본에 영향이 없어 의도적으로 허용한다.)
    `34a5897` 에서 판정 순서를 **소유권 → 잠금 → `baseVersion`** 으로 고정했고
    (409/403 차이로 남의 결제 여부가 새지 않게), **주문 조회 실패는 503 fail-closed** 다.
    클라이언트는 `PROJECT_LOCKED` 를 받으면 안내 1회 후 **읽기 전용**으로 전환한다
    (자동저장 중단·이탈 경고 해제·도구 숨김·FabricStage `selection`/`skipTargetFind` 가드).
    실패 토스트를 반복하는 쪽으로 되돌리지 말 것.
14. **`0032` 정적 가드 테스트는 라우트 소스와 결합돼 있다.**
    `lib/security/migration-0032-guard.test.ts` 는 마이그레이션 SQL 의 정책 조건·grant 목록뿐 아니라
    **앱 소스의 `.storage` 수신자가 admin 뿐인지**까지 검사한다. 즉 사용자 세션 supabase 클라이언트로
    storage 를 호출하는 코드를 추가하면 이 테스트가 깨진다 — **테스트를 고치지 말고 호출 경로를 고칠 것**
    (클라이언트 업로드는 서명 URL XHR PUT, 나머지는 service_role).
    또 컬럼 보호 트리거는 **SECURITY INVOKER** 여야 한다. DEFINER 면 `current_user` 가 테이블 소유자가
    되어 트리거 안의 권한 판정이 절대 발동하지 않는다(적대 리뷰에서 실제로 걸린 must_fix).
15. **`0033` reserve/release 는 service_role 전용이고, 미적용 폴백 경로가 살아 있다.**
    `reserve_order_credits` / `release_order_credits` 가 없으면 코드가 기존(캡처 후 차감) 경로로
    폴백한다. **테스트가 두 경로를 모두 덮고 있으니 "죽은 코드"로 보고 지우지 말 것.**
    **2026-09-21 현재 운영 DB 에는 0033 이 적용돼 있지 않다** — 즉 지금 운영은 폴백 경로로
    돌고 있고 SEC-7 창이 열려 있다. 적용 절차·확인 SQL 은 런북 §9.

18. **출석 보너스 memo 는 `monthly-bonus.ts` 헬퍼가 정본이다.**
    20일 월 보너스(+1,000P)의 적립 memo 와 중복 판정 조회를 같은 함수로 묶었고, 조회는
    **memo 정확 일치**다. 예전처럼 `memo LIKE '%YYYY-MM%'` 로 되돌리면 같은 달 10일 보너스
    (+500P, reason 이 같은 `attendance_bonus`)에 걸려 **월 보너스가 사실상 지급되지 않는다**
    (`34a5897` 에서 고친 실제 버그). memo 문구를 바꾸면 과거 지급분이 중복으로 안 잡혀
    이중 지급이 나므로 문구도 바꾸지 말 것.
16. **cron 인증은 fail-closed 다.** 배포 환경에서는 `Authorization: Bearer <CRON_SECRET>` 만 통과하고,
    `CRON_SECRET` 이 없으면 **모든 cron 이 막힌다**(`x-vercel-cron` 은 위조 가능해서 인증 수단이 아니다).
    로컬 `next dev` 에서만 `x-vercel-cron: 1` 수동 호출이 허용된다.
    새 cron 라우트를 만들면 `lib/security/cron-auth.ts` 를 쓸 것 — 판정을 복제하지 말 것.
17. **업로드 경로의 sharp 하드닝을 우회하지 말 것.** sharp 를 직접 import 하지 말고
    `lib/image/sharp-safe.ts` 를 쓰고, 디코드 **전에** `lib/image/sniff.ts` 로 매직바이트를 판정한다.
    통과 포맷은 JPEG/PNG/WebP/HEIC 뿐이고 **AVIF 는 의도적으로 거부**한다.
    `next.config` 의 `images.formats` 도 **webp 단독을 유지**한다 — `GHSA-2xp9-vwfh-vxw4` 자체는
    Next 16.3.5 에서 해소됐지만 재활성화는 인코딩 비용·품질 회귀를 측정한 뒤 판단하기로 했다
    (Next 16 기본값도 webp 단독이다).

--- 아래는 2026-09-21 Next 16 전환에서 새로 생긴 함정이다 ---

19. **`cookies()` 와 `params`/`searchParams` 는 전부 async 다.** 따라서
    **`createServerSupabase()` 는 반드시 `await` 로 부른다**(`await cookies()` 를 내부에서 쓴다).
    `await` 를 빠뜨리면 Promise 객체에 `.from()` 을 호출해 런타임에서 터진다 — typecheck 가 잡지만
    새 라우트를 복붙할 때 자주 놓친다. 서버 페이지도 `const { id } = await params` 형태다.
20. **관리자 라우트 핸들러 시그니처를 바꾸지 말 것.** `withAdmin` 이 `ctx.params` 를 **바깥에서
    await 해서** 핸들러에 평범한 객체로 넘긴다. 그래서 관리자 라우트 21개가 전환에서 무수정으로
    남았다. 핸들러 안에서 다시 `await params` 를 하거나 시그니처를 `Promise<...>` 로 바꾸면 깨진다.
21. **`revalidateTag` 는 Next 16 에서 2번째 인자가 필수다.** 현재 코드는
    `revalidateTag(SITE_CONTENT_TAG, { expire: 0 })` — **`{ expire: 0 }` 이 즉시 무효화**이고
    CMS 콘텐츠 즉시 반영이 여기에 걸려 있다. 값을 늘리면 관리자 콘텐츠 변경이 늦게 반영된다.
22. **`next.config` 의 `images.minimumCacheTTL: 60` 을 지우지 말 것.** Next 16 기본값이
    60초 → **4시간**으로 바뀌었다. 지우면 서명 URL 회전·콘텐츠 교체 반영이 최대 4시간 늦게
    체감된다(기존 동작을 유지하려고 일부러 명시해 둔 값이다).
23. **`middleware.ts` 는 의도적으로 유지 중이다.** Next 16 은 `proxy.ts` 로의 리네임을 권하고
    **빌드에 deprecation 경고 1건이 나오지만 정상**이다. 이번 웨이브에서 동작 변경을 피하려고
    codemod 의 리네임을 되돌렸다 — 경고를 보고 "고장"으로 오판하거나 즉흥적으로 전환하지 말 것.
24. **ESLint 는 flat config(`eslint.config.mjs`)이고 `.eslintrc.json` 은 삭제됐다.**
    Next 16 이 `next lint` 를 제거해 `pnpm lint` 가 `eslint` CLI 를 직접 부른다(검사 범위는
    스크립트의 `app components lib hooks`). **전환으로 새로 생긴 규칙은 warn 유지가 방침**이라
    현재 기준선은 **0 error / 41 warning**(38건이 `react-hooks` v7)이다. 규칙을 error 로 올리거나
    경고 0 을 목표로 일괄 수정하는 것은 별도 웨이브에서 규칙별로 판단한다.

### 4. 남은 운영 액션 — 정본은 LAUNCH-RUNBOOK.md

**여기에 목록을 다시 만들지 말 것.** 키 발급·콘솔 클릭·SQL 등 남은 운영 액션과 백로그는
전부 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md)에 있고, 실시간 상태는
`/admin` "서비스 런치 체크" 카드가 보여준다. 항목이 해소되면 런북에서 지우고,
새 운영 이슈가 생기면 런북에 추가한다.

**2026-09-21 기준 서비스 경로는 전부 동작한다.** 단 사용자에게 먼저 알려야 할 것이 셋 있다:

1. **런북 §9 — `0033` 적용**(결제 크레딧 선점). **코드가 이미 배포됐으므로 적용 전까지
   SEC-7(주문 간 동시 confirm 으로 같은 포인트·할인 이중 사용) 창이 열려 있다.**
2. **런북 §10 — `0032` 적용**(직접 쓰기 봉쇄·권한 상승 차단).
   **precheck → 적용 → postcheck 순서**이고, precheck `[3]`~`[11]` 에서 흔적이 나오면
   적용과 별개로 개별 시정이 필요하다.
3. **런북 §11 — QA-1 피해 조회**(읽기 전용 SQL 3개). 되돌리기 후 0객체로 저장된 내지·표지와
   그중 결제된 건을 찾는다. 이미 발생한 피해라 조회가 먼저다.

**검증 후속(운영 액션 아님, 런북 백로그에도 등재)**

- **Vercel Preview 런타임 검증 불가** — Preview 환경변수가 0종이라 PDF 네이티브 바이너리·
  토스 결제·카카오 콜백을 프리뷰에서 실증할 수 없다. Next 16 전환분도 운영 배포본으로만 검증했다.
- **Lighthouse 비교 보류** — Next 16 이 빌드에서 First Load JS 표를 내지 않아 기준선(§0-5,
  2026-08-07 Performance 88 · LCP 3.6s)과 **같은 방식의 비교가 불가능**하다. 측정 방법을 먼저 정할 것.
- `pnpm e2e:auth` 재실행은 **완료**됐다 — `4346c0b` 배포본에서 5 passed.

운영 규칙: **환불은 전액만**(부분 취소는 앱이 의도적으로 무시), **`CRON_SECRET` 을 지우지 말 것.**

### 5. 작업 방식

- 다건 감사·리뷰는 서브에이전트 오케스트레이션(파일별 disjoint 분할 → 병렬 → 적대적 검증).
  단일 파일 수정이나 맥락 의존 작업은 단독 수행이 낫다.
- 결제/인증/RLS/발주 게이트/Storige 계약 등 민감 변경은
  typecheck + vitest + 적대적 리뷰 + CI + Vercel 빌드로 다층 검증 후 커밋.
  **마이그레이션은 로컬 PGlite 하네스로 적용·재적용·동작까지 실행 검증**한 뒤 병합 조건으로 삼는다
  (0033 의 NULL 비교 버그가 이 방식으로 잡혔다).
- **측정이 필요한 주장은 측정으로 뒷받침한다.** 수치를 보고할 때 측정 횟수와 편차를 함께 밝힐 것.
- 세션 종료 시 `STATUS.md`와 이 문서를 갱신한다(완료/미완/다음 단계/새로 발견한 함정).

**첫 작업**: `git status -sb && git log --oneline -5` 로 실제 상태를 확인하고
(main HEAD 가 `34a5897` 인지), `STATUS.md`(§0-11)와 이 문서를 읽어 현재 상태를
한 문단으로 보고한다. **추천 목록을 만들지 말고**, 사용자가 시킨 작업을 바로 진행한다.
운영 액션이 궁금하면 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md) 를 가리키는 것으로 끝.

## ─────────────────────────────── (붙여넣기 블록 끝)
