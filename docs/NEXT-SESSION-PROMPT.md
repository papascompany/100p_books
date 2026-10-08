# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 **■ 붙여넣기 블록**을 그대로 붙여넣으세요.
>
> 갱신 **2026-10-05** · `main` = `origin/main` = `2360f3c` · CI 3잡 green · Vercel prod success
> **미병합 브랜치·worktree·열린 PR 없음.** 미커밋 변경 없음.
> ✅ 마이그레이션 `0001~0033` 전부 운영 적용(STATUS §0-14) · QA-1 피해 0 · 고아 사진 0 · `pnpm audit --prod` 0.
> ✅ 09-28~30: Dependabot 정리 · supabase-js 2.117/ssr 0.12 · canvas 1.0.9 · react-hooks 0/0(§0-15) · `proxy.ts` ·
>    **fabric 7.4.0**(§0-16) · Storige DELETE 404 구분(§0-17).
> ✅ 10-05: 운영 브라우저 점검 → UI 결함 5건 + 에디터 레이아웃 4건 · SW 캐시 오염(v4) · Vercel 방화벽 CLI 확인(§0-18) ·
>    **결제 키 pending 수렴 도구**(§0-19) · **PDF 100p 측정 → 사진 슬롯 축소 디코드, collage-6 RSS 약 -45%**(§0-20).
> ✅ Storige 측 Wave 2(P4·JOB_STALLED)·Wave 4·5·6(10-05)·Wave 8 1단계(10-06) 운영 배포 · JOB_LINK_STRICT 플래그 사전 안내(10-08) — 100p 영향 없음 확인(STATUS §0-17·§0-19 기록).
> 남은 운영 액션·오너 결정·백로그는 전부 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md), 실시간 상태는 `/admin` "서비스 런치 체크".
> **"다음 추천" 목록을 새로 만들지 말 것 — 운영 액션·백로그의 유일한 정본은 런북이다** (사용자 지시, 2026-08-09).

---

## ■ 붙여넣기 블록 (여기부터 복사) ─────────────────────────

너는 100p_books(**Next.js 16 App Router + React 19** + TypeScript + Supabase + TossPayments +
Storige 인쇄 백엔드 + @napi-rs/canvas·pdf-lib PDF 렌더러)의 시니어 개발/CTO다.
모든 사고과정과 대화는 한글로.

### 0. 작업 환경

- **정본 로컬**: `/Users/yohan/Developer/claude/100p_books` (branch `main`).
  Documents 사본은 node_modules 제거됨 — 쓰지 말 것.
- 레포 `papascompany/100p_books` (PUBLIC). main push → **Vercel auto-deploy** 정상.
- **브랜치 상태 (2026-10-05)** — `main` = `origin/main` = `2360f3c`. **미병합 브랜치·worktree 없음**,
  원격 브랜치는 `main` 하나뿐. 최근 코드 커밋(새 → 옛): `2360f3c` PDF 회귀 linux 해시 · `8ffb2c8` PDF 사진 슬롯 축소 디코드(§0-20) ·
  `90d2615` 결제 키 pending 수렴 도구(§0-19) · `ea1610e` SW 캐시 v4 · `99f3702`·`7609291`·`e707538`·`b6b3d7c`·`b8783ea` UI·에디터(§0-18) ·
  `e32edc1` Storige DELETE 404(§0-17) · `14f30d9`·`c817726` fabric 7(§0-16).
  `4346c0b` 은 **Next 16.3.5 + React 19.3.0 전환**이고 그 부모가 `34a5897` 이다(현재 next 는 16.3.6).
  `integ/wave2` 를 `bacadc1` 위로 rebase 해 ff 병합했으므로 **rebase 이전 SHA
  (`552f6e1`·`c6deee9`·`5161cc9`·`67c8f2f`·`692c888`·`3d4b24e`·`69df5d2`·`f4af049`)는 존재하지 않는다.**
  현재 main 의 해당 커밋은 `31eaabf`·`88163d0`·`488cccb`·`061273a`·`be00e1b`·`b47834c`·`aed8404`·`513ba21`
  이고, 그 위에 INT-ui `34a5897` 이 올라가 있다.
- **main 브랜치 보호가 켜져 있다**(2026-09-17): CI 3잡 필수 체크, force-push·삭제 금지,
  관리자 우회 허용(`enforce_admins=false`). Dependabot alerts·security updates 활성화.
  **열린 PR 0건**(2026-09-30) — Dependabot PR 은 09-28~30 에 전부 병합·종료했다(§0-15·§0-16).
  `dependabot.yml` 의 ignore 는 버전 번호가 아니라 `next`·`react*`·`fabric`·`eslint*`·`@types/node` 의
  **semver-major 업데이트** 단위라 Next 16/React 19 전환 후에도 그대로 유효하다.
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
- **Supabase 운영 DB(`vprifnztvlduhpuwgdau`, 조직 `rpgjrckrcrxhrbrimjbv`)는 MCP/CLI 불가** — CLI 는 `storige.dev`,
  MCP 는 `storige's Org` 계정이라 그 조직 멤버가 아니다(2026-09-24 실측). 운영 DB 상태는
  `pnpm exec tsx scripts/verify-0033.ts`(읽기 전용, service_role 로 RPC 존재·권한 확인)처럼 앱 경로로 간접 확인한다.
  마이그레이션은 사용자가 대시보드 SQL Editor에 수동 적용한다.
  ⚠️ 함정: SQL Editor가 다른 프로젝트에 연결돼 있으면 `42P01 relation does not exist` —
  상단이 `100p_books / PRODUCTION`인지 **먼저 확인시킬 것**.
  **`0001~0033` 전부 적용 완료**(0032·0033 = 2026-09-28).

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

- 첫 작업 전 루트 `STATUS.md`(§0-20~§0-14) + 이 문서를 읽고 현재 상태를 사용자에게 보고할 것.
  ⚠️ **성능 수치 정본은 `STATUS.md` §0-5(2026-08-07, prod 5회 중앙값)** 다.
  STATUS.md 안의 "Performance 97 · LCP 1.5s"(§M8 QA 표)는 **2026-05-13 옛 측정치**이니
  baseline 으로 쓰지 말 것.

### 1. 검증 명령 (전부 로컬에서 동작)

**기준선은 `main`(`2360f3c`)에서 2026-10-05 실측한 값이다**(루트 `CLAUDE.md` 테스트 절과 동일).

| 대상 | 명령 | 현재 기준선 |
|---|---|---|
| 타입 | `pnpm typecheck` | 0 에러 |
| 린트 | `pnpm lint` | **0 error / 0 warning** — `eslint .`(저장소 전체), react-hooks v7 4규칙은 **error**(§0-15) |
| 유닛 | `pnpm test` | **89 파일 / 1,490 passed / 1 skipped** |
| PDF 회귀 | `pnpm test:pdf` | 5 케이스 OK (약 500ms) — `photo-downscale` 추가(2026-10-05), darwin·linux 해시 모두 등재 |
| 접근성 | `pnpm test:a11y` | 25 passed / 1 skipped (WCAG 2.1 AA 위반 0) |
| E2E 스모크 | `pnpm e2e` | 12 passed |
| **인증 + 편집 무결성** | `pnpm e2e:auth` | **5 passed** — 골든 플로우 2 + 편집 무결성 회귀 3(QA-1/QA-4/QA-2). 최근 실측: 운영 URL(09-28)·fabric 7 로컬 운영 빌드(09-30). **10-05 변경분은 미실행** |
| 빌드 | `pnpm build` | 성공 (**Turbopack**, `--webpack` 불요. 라우트 121개 렌더링 모드 변경 0) |

> `pnpm lint` 는 **`eslint .`(저장소 전체, 0 error / 0 warning)** — react-hooks v7 4규칙은 error.
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

**2026-10-05 (PDF 렌더 메모리)** — 상세는 `STATUS.md` §0-20
- 사진을 슬롯 크기로 줄여 디코드(`lib/pdf/photo-downscale.ts`) — collage-6 RSS 약 -45% · 함정 31 번.

**2026-10-05 (결제 수렴 도구 · PDF 100p 측정)** — 상세는 `STATUS.md` §0-19
- 주문 상세 "결제 상태 확인·수렴"(`lib/orders/reconcile-pending.ts`, `/api/admin/orders/[id]/reconcile-payment`) — 함정 30 번.
- PDF 100p: 폴라로이드 통과 · **collage-6 메모리 93~99%**(런북 백로그 "PDF 렌더 메모리").

**2026-10-05 (운영 브라우저 점검·UI 결함 5건)** — 상세는 `STATUS.md` §0-18
- hydration 날짜 KST 고정(`lib/date/kst.ts`) · 에디터 `min-w-0`/표지 헤더 `flex-wrap` · coral 800~950 · `/admin/emails` 문구(`b8783ea`)
- 후속: md 측면 패널 `w-56`(`b6b3d7c`) · 표지 스프레드 `max-w-full`(`e707538`) · FabricStage 최초 fit 직접 호출(`7609291`) · 우측 속성 패널 `lg:` 부터(`99f3702`) — 배포본 재측정 완료(§0-18).

**2026-09-30 (Storige 삭제 판정)** — 상세는 `STATUS.md` §0-17
- `deleteFile` 404 는 본문 `code:"FILE_NOT_FOUND"` 일 때만 성공(`e32edc1`) — 함정 25 번.

**2026-09-28~30 (의존성·기술 부채·fabric 7)** — 상세는 `STATUS.md` §0-14~§0-16
- 0032·0033 운영 적용·검증(`scripts/verify-003{2,3}.ts`, `docs/sql/0032-{pre,post}check-summary.sql`)
- PDF 조립 전 원본 재검증 `lib/pdf/validate-original.ts`(`40fd966`)
- Dependabot 정리(`eb9d458` `18acb71` `c9d1cb7`) — 열린 PR 0 · vitest 4 + vite 7 · TS 6 · lucide 1 · nanoid 6
- supabase-js 2.117·ssr 0.12(수동 Database 타입 GenericSchema 화, 쿠키 getAll/setAll) · canvas 1.0.9(Chromium 일치 —
  인쇄 그림자 짙어짐은 의도) · react-hooks 경고 0 + 4규칙 error(§0-15, worktree 3병렬)
- 보안 overrides(`3d63ddd`, `1c552cd`) · 그림자 `buildPhotoShadow` nonScaling(`1b27aed`) · `proxy.ts`(`ee054c5`) ·
  eslint . 정상화 · a11y 다크 간헐 실패 제거(`settle()` 이 애니메이션 끔)
- **fabric 7.4.0**(`c817726` `14f30d9`) — `targetAt()`·enliven 개수 가드·클릭 기본값. v6 대비 캔버스 픽셀 diff 0

**2026-09-21 (Next 16 + React 19 전환)** — 상세는 `STATUS.md` §0-12

0. **Next.js 16.3.5 · React 19.3.0 전환**(`4346c0b`, 운영 배포 완료) — codemod 2-hop 후 수동 정리.
   `createServerSupabase` async 화(+호출부 41곳 await), 페이지 `params`/`searchParams` await,
   `withAdmin` 이 `ctx.params` 를 바깥에서 await(관리자 라우트 21개 무수정),
   `revalidateTag(..., { expire: 0 })`, ESLint flat config, `serverExternalPackages` 이관,
   `images.minimumCacheTTL: 60` 명시, `agentRules: false`, `sw.js` CACHE_NAME v3(→ 10-05 v4), `tsconfig` `jsx: react-jsx`.
   **당시 의도적으로 제외한 것**: `middleware`→`proxy` 전환(→ 09-28 `ee054c5` 완료),
   `@supabase/ssr`·`supabase-js` 업그레이드(→ 09-28 §0-15 완료), React Compiler, Cache Components,
   AVIF 재활성화(이 셋은 여전히 미착수 — 되돌리지 말고 후속 웨이브에서 판단).
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

11. 🚨 **fabric 6.9.x·7.x 의 `canvas.toJSON()` 은 인자를 무시한다**(발견 당시 6.9.1 `index.mjs:2939`, 7.4.0 도 동일).
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
    **2026-09-28 운영 적용 확인** — 운영은 선점 경로로 돈다. 폴백은 적용 전 DB·로컬 테스트용으로 남아 있다.

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
23. **요청 전처리는 `proxy.ts` 다**(2026-09-28 `ee054c5` 에서 `middleware.ts` 를 전환, deprecation 경고 해소).
    Next 16 규약상 **Node.js 런타임 고정**이라 `runtime` 설정을 넣을 수 없다. `middleware.ts` 를 되살리지 말 것.
24. **ESLint 는 flat config(`eslint.config.mjs`)이고 `.eslintrc.json` 은 삭제됐다.**
    Next 16 이 `next lint` 를 제거해 `pnpm lint` 가 **`eslint .`(저장소 전체)** 를 부른다.
    기준선은 **0 error / 0 warning** 이고 react-hooks v7 4규칙(set-state-in-effect·immutability·refs·purity)은
    **error** 다(§0-15). 억제는 사유를 적은 3건 + `assignFabricProps` 의도적 우회 1건뿐 — 새 억제는 사유를 함께 적을 것.

--- 아래는 2026-09-30 Storige 교신에서 확정된 함정이다 ---

25. **Storige `DELETE /files/{id}/external` 의 404 는 본문으로 가른다**(`lib/storige/client.ts` `deleteFile`).
    `code:"FILE_NOT_FOUND"` 404 만 "이미 없음"(성공)이고, 그 외 404(라우트 부재·프록시)는 `supported=false` 로
    retention cron 이 fileId 참조를 **지우지 않는다**. "404 는 다 성공"으로 되돌리면 경로 변경 시 참조가 지워져
    Storige 객체가 영구 고아가 된다. Storige 는 이 code 유지·경로 변경 사전 통지를 약속했다(§0-17).
    잔여 위험: 다른 테넌트 파일도 같은 404 라 키↔site 오매핑은 구분 불가.
    Storige 워커 TrimBox 판형 검사(09-30 07:54Z 운영 적용)는 100p PDF(MediaBox 만)·파싱에 영향 없음을 재확인했다.
    PDF 에 `/TrimBox` 를 넣기 시작하면 내지 판정이 달라지고 `TRIMBOX_SIZE_BASIS` 경고가 붙으니 그때 다시 볼 것.
    **Storige P4(대용량 업로드 사이트 귀속)** 는 2026-10-03 04:58Z 운영 적용됐다(§0-17) — 100p 편집기·워커 키가 같은 사이트 행이라
    검증이 통과한다. **키 회전 시 두 키의 사이트 일치를 Storige 와 확인할 것** — 어긋나면 대용량 PDF 검증이 404 → `ERROR` → 무검증 발주.

26. **SSR 로 그려지는 날짜 문자열은 `lib/date/kst.ts` 로 만든다.** `getDate()` 등 로컬 getter 는 서버(UTC)와 브라우저(KST)가
    다른 날짜를 내 hydration #418 이 난다(`/mypage/photos`, 2026-10-05 실측). `relativeTime`(내 포토북 카드)은 `Date.now()` 기반이라
    같은 위험이 있으나 미재현 — 증상이 보이면 같은 방식으로 고친다.
27. **다크 모드 전용 색은 팔레트에 정의돼 있는지 확인한다.** Tailwind 3 는 미정의 shade(`coral-950` 등)를 조용히 버려 클래스가 생성되지 않는다 —
    라이트 배경 위에 다크 글자색만 적용돼 대비가 깨진다. `/order` 결제 요약이 실제 사례였다.

28. **FabricStage 의 fit 은 `observe` 직후 `applyFit()` 1회 직접 호출에 의존한다**(`7609291`). ResizeObserver 초기 콜백만 믿으면
    데스크톱 첫 로드에서 캔버스가 자연 폭(표지 868px)으로 남는다. 표지 스프레드 박스(`inline-block min-w-full`)는 데스크톱에서만
    `max-w-full` — 모바일 면 확대는 inline width 가 박스를 넘어야 하므로 조건을 풀지 말 것.
    **우측 속성 패널은 `lg:` 부터만 렌더**(`99f3702`) — 768~1023px 의 속성 편집은 Toolbar→바텀시트 경로가 맡으므로
    그 시트(`toolSheet`)를 `lg` 미만에서 막지 말 것.
29. **SW 의 `_next/static` 캐시는 2xx + 비-HTML 만**(`ea1610e`, `CACHE_NAME` v4). Vercel 자동 완화가 청크 요청에 403
    "Security Checkpoint" HTML 을 돌려줄 수 있고(`x-vercel-mitigated: challenge`), 그것이 불변 URL 에 캐시되면 앱이 영구히 깨진다.
    `res.ok` 가드를 지우지 말고, 캐시 전략을 바꾸면 `CACHE_NAME` 을 올릴 것. **자동화 브라우저로 운영 성능을 잴 때는 챌린지 여부를 먼저
    확인할 것** — 2026-10-05 의 "에디터 12초 공백"은 이 챌린지였다(일반 사용자 조건 아님).
    **System Mitigations 챌린지는 `firewall/events`·`attack-status` API 와 함수 로그에 남지 않는다**(10-05 실측 0건).
    사용자 신고 시 증거는 그 브라우저 응답의 `x-vercel-mitigated: challenge` 헤더뿐이다. 상태 확인은 읽기 전용 CLI 로:
    `vercel firewall overview` · `vercel firewall rules list` · `vercel firewall system-bypass list`.
    `attack-mode`·관리 규칙·`system-bypass add`·`system-mitigations pause` 는 운영 설정 변경이라 **오너 승인 후에만**
    (pause 는 DDoS 방어 24시간 해제 — 운영 금지).

30. **결제 수렴 도구(`lib/orders/reconcile-pending.ts`)의 404 해제 조건을 풀지 말 것.** 결제 키 조회 404 는
    "아직 승인 전" 일 수 있다(confirm 이 승인 응답 대기 중). 해제는 **바인딩 후 30분(`RELEASE_MIN_BOUND_AGE_MS`) 경과 +
    토스 주문번호 조회도 no_payment** 일 때만이다. 바로 풀면 뒤늦은 DONE 이 키 없는 pending 에 남고 주문서 재사용이
    toss_order_id 를 덮어 이중 과금이 된다(10-05 적대 리뷰 HIGH). 또 POST 는 실행 직전 재조회한 계획이 미리보기와 같을 때만
    실행한다(`PLAN_CHANGED`) — 미리보기 결과로 바로 쓰는 단축을 만들지 말 것. 이 라우트는 finalize 로 PDF 빌드를 돌리므로
    `lib/pdf/job-reaper.test.ts` JOB_ROUTES 와 vercel.json(300s/1769MB)에 함께 등록돼 있다.

31. **PDF 사진은 `lib/pdf/photo-downscale.ts` 로 슬롯 크기까지 줄여 디코드한다**(§0-20). `render-page.ts` `drawPhoto` 에서
    원본을 다시 `loadImage` 로 직접 읽게 되돌리면 collage-6 이 함수 메모리 한도의 93~99% 로 돌아간다. 축소는 배율 < 1 일 때만이고
    업스케일·EXIF orientation≠1·sharp 실패는 기존 경로다 — 이 예외를 없애면 기존 렌더 결과가 바뀐다. sharp 는 하드닝본만(함정 17).
    회귀 `photo-downscale` 케이스가 축소 경로를 고정한다(기존 `photo-shadow` 는 사진이 작아 업스케일 경로만 탄다).

### 4. 남은 운영 액션 — 정본은 LAUNCH-RUNBOOK.md

**런치 차단 항목 없음**(`/admin` 런치 체크 "차단 항목 없음 — 서비스 가능", 2026-10-05 확인). 서비스 경로
(이메일 가입 → 업로드 → 편집 → 주문 → 결제 → 인쇄검증)는 전부 동작한다.

**오너 운영 액션(런북 §1·§3·§4·§5·§7)**: 토스 웹훅 URL 등록 · Resend 키(메일 6종 큐 대기 중) · Upstash(rate limit fail-open) ·
카카오 콘솔 설정 · Storige 통지 전달.
**오너 확인 대기**: ① 카카오 로그인 실제 1회(PKCE 쿠키 키 변경) · ② 실제 iPhone Safari 핀치 후 더블탭 · ③ Supabase 조직 멤버 계정
· ④ 결제 수렴 버튼은 운영 주문 0건이라 실사용 미확인(첫 해당 주문 때).
**오너 결정 대기(런북 "오너 결정")**: 법정 고지·고객 문의 창구(런치 전 필수급) · 랜딩 CMS 수치·후기 문구("5,000+·4.9★" — 실제 0건) ·
선물 수령 이메일 대조 · 탈퇴 회원 제작 자료 보관 · 출석 20일 보너스 소급 · 에러 추적 SDK 서비스 선택.

**여기에 목록을 다시 만들지 말 것.** 항목이 해소되면 런북에서 지우고, 새 운영 이슈는 런북에 추가한다.

**검증 후속(런북 백로그에도 등재)**: Vercel Preview 런타임 검증 불가(Preview env 0종) · Lighthouse 비교 방법 재정의 ·
PDF 측정 x64 확정(collage-6 17p·48MP 원본) · 10-05 변경분 대상 `e2e:auth` 재실행.

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
- **로컬 운영 빌드 서버는 포트 기준으로 종료**: `lsof -nP -iTCP:<port> -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs kill`.
  `pnpm start` 프로세스명은 `next-server` 라 `pkill -f "next start"` 가 안 먹는다 — 옛 서버가 남으면 재빌드 후
  ChunkLoadError·거짓 통과가 난다(2026-09-28 실측). e2e 는 `PLAYWRIGHT_BASE_URL=http://localhost:<port>` 로 새 서버에.
- 병렬 구현은 worktree 격리(포트 분리 3101~3103, e2e:auth 는 통합 후 CTO 1회) → 트랙별 적대 검토 → 통합 게이트.
- 에디터 변경은 객체 수만 보는 e2e 로 부족하다 — 필요 시 main worktree 대비 캔버스 픽셀 diff QA(§0-16 방식).
- **렌더·성능 변경은 A/B 로 잰다**: 직전 커밋을 scratch 의 임시 `git worktree`(node_modules 심볼릭 링크)로 띄워 같은 시점에
  번갈아 측정한다(§0-20). 측정 하네스·사진은 scratch 에만 두고 저장소에 넣지 않는다 — scratch 는 며칠 뒤 비워질 수 있으니
  결과 수치는 STATUS 에 남길 것. 측정 중 머신 부하(`uptime`)를 함께 기록할 것.
- **zsh 에서 `for x in "a b"; set -- $x` 는 단어로 나뉘지 않는다** — 반복 인자는 명시적으로 나열할 것(10-05 A/B 1차 무효의 원인).
- **운영 브라우저 점검은 내장 브라우저 + 관리자 로그인 세션으로 한다**(사용자가 로그인해 둔 경우). 결제 버튼은 누르지 말 것.
  자동화가 빠르게 내비게이션하면 Vercel 챌린지가 걸릴 수 있다(함정 29) — 성능 판단 전에 `x-vercel-mitigated` 를 먼저 볼 것.
- **Storige 세션 교신**: 다른 Claude 세션(Storige 편집기·워커)이 cross-session 메시지로 계약 변경을 통지·질의한다.
  코드 근거(파일:줄)로 사실만 답하고, 계약 변경이 100p 에 영향이 있으면 사용자에게 먼저 알린다. 회신은 메시지의 `from` 주소로.
  100p 가 쓰는 Storige 경로: upload/external(≤90MB)·presigned-upload-public+complete(>90MB)·download/external·
  DELETE /files/:id/external(편집기 키), validate/external·GET worker-jobs/external/:id(워커 키). 편집 세션·합성 API 는 미사용.
  **통지 처리 순서(사용자 지시, 2026-10-07 — 통지마다 따로 묻지 않고 진행)**:
  ① 통지 내용을 위 경로·키·응답 파싱(`lib/storige/client.ts`)과 대조해 100p 영향을 판정한다.
  ② **영향이 있으면** 기록·커밋 전에 사용자에게 먼저 알리고 처리 방향을 묻는다.
  ③ **영향이 없으면** `STATUS.md` §0-17 의 "Storige 이후 배포 통지" 묶음에 Wave·배포 시각(UTC)·변경 요지·영향 없음 근거를 한 항목으로
     추가하고, 이 문서 상단 요약의 Storige 줄도 맞춘 뒤 → `git fetch` 로 다른 세션 변경과 겹치지 않는지 확인 →
     `docs: Storige Wave N … 배포 통지 기록 — 100p 영향 없음` 으로 커밋·푸시 → CI 3잡·Vercel 결과까지 확인해 보고한다.
  ④ 회신 요청이 있으면 코드 근거로 사실만 답한다. 회신이 계약·운영에 영향을 주는 내용(예: 경로 폐기 동의, 키 회전)이면 보내기 전에 사용자에게 먼저 알린다.
- **결제 경로 변경은 적대 리뷰(o5-security-reviewer)를 반드시 거친다** — 10-05 결제 수렴 도구에서 HIGH(이중 과금 경로)를 잡았다.

**첫 작업**: `git status -sb && git log --oneline -5` 로 실제 상태를 확인하고
(main HEAD 가 `2360f3c` 이후인지), `STATUS.md`(§0-20~§0-14)와 이 문서를 읽어 현재 상태를
한 문단으로 보고한다. **추천 목록을 만들지 말고**, 사용자가 시킨 작업을 바로 진행한다.
운영 액션이 궁금하면 [LAUNCH-RUNBOOK.md](LAUNCH-RUNBOOK.md) 를 가리키는 것으로 끝.

## ─────────────────────────────── (붙여넣기 블록 끝)
