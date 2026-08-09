# 100p Books — 개발 현황 및 다음 단계

> **🚀 서비스 개시 가능 상태 (2026-08-09).** 코드 작업은 끝났고, 남은 운영 액션(키 발급·
> 콘솔 클릭·SQL)은 전부 [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md) 한 곳에 있다.
> 실시간 상태는 관리자 대시보드(`/admin`)의 "서비스 런치 체크" 카드.
>
> 🔴 **단 하나 예외 — 오픈 전 반드시**: 보안 마이그레이션 `0031` 을 운영 DB 에 적용할 것
> (런북 §0). 적용 전에는 공개 anon 키로 포인트를 무한 발급할 수 있다(§0-7 참조).
>
> 최종 업데이트: 2026-08-09
> 배포 URL: https://100pbooks.vercel.app
> 레포지토리: https://github.com/papascompany/100p_books
> 운영 빌드: `f760357` — CI green(verify·e2e·a11y) · Vercel prod success
> 다음 세션 인계: [docs/NEXT-SESSION-PROMPT.md](docs/NEXT-SESSION-PROMPT.md) (붙여넣기 블록 그대로 사용)
> **정본 로컬 경로**: `/Users/yohan/Developer/claude/100p_books` (Documents 사본은 node_modules 제거됨)
> **성능 수치 정본**: §0-5 (2026-08-07, prod 5회 측정). §0-4 는 그 직전 상태, §M8·테스트 현황의
> "Performance 97 · LCP 1.5s" 는 2026-05-13 옛 측정치이니 baseline 으로 쓰지 말 것.

---

## 🆕 최근 작업 (2026-08-09)

### 0-7. 서비스 런치 마감 — 폰트 시딩 · 카카오 게이트 · 런치 체크판 · 런북 일원화 (2026-08-09)

- **인쇄용 한글 폰트 운영 시딩**: `resources` 가 완전히 비어 있어(감사로 발견) PDF 한글이
  폴백으로 렌더될 상태였다. Pretendard(variable woff2, OFL)를 admin 업로드 API 와 동일한
  3단계 절차로 시딩하고, 실코드 경로(`registerProjectFonts`)로 다운로드→등록→한글 렌더 검증.
  `lib/pdf/fonts.ts` 의 SYSTEM_FALLBACKS 에서 "Pretendard" 제거(Vercel Linux 에 없는 폰트를
  폴백으로 가정해 resources 조회를 건너뛰던 문제).
- **카카오 버튼 게이트**: 운영 Supabase 프로바이더가 비활성(authorize 400 실측)인데 로그인
  페이지 주 버튼으로 노출 중이었다. `NEXT_PUBLIC_KAKAO_ENABLED=1` 게이트로 숨김 —
  콘솔 설정 완료 후 env 만 켜면 노출.
- **관리자 런치 체크판**: `/admin` 대시보드에 "서비스 런치 체크" 카드 신설
  (`lib/admin/launch-status.ts` + `LaunchChecklist`) — 결제/인쇄/폰트/책사이즈(필수)와
  메일/rate limit/카카오(선택)의 on/off 를 실시간 표시, 조치는 런북 섹션 번호로 안내.
- **런북 일원화**: 흩어져 있던 운영 액션·백로그를 [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md)
  로 통합. 이후 세션은 "다음 추천" 목록을 만들지 말고 런북만 갱신할 것.
- 운영 DB 읽기 전용 감사(프로필 3·프로젝트 37·주문 0·리소스 0→1) + 전체 로컬 스위트 green.

### 0-6. 🚨 에디터 ref 회귀 수정 — 저장·캔버스 조작이 3개월간 전면 불가였다 (2026-08-07)

**증상**: 표지/내지 에디터에서 "저장", "글 추가", "사진 추가", undo/redo 등 캔버스를 건드리는
모든 조작이 **아무 일도 하지 않았다**. 네트워크 요청도 캔버스 변화도 없다.

**원인**: `CoverEditor` 와 `PageEditor` 가 `FabricStage` 를 `dynamic(() => import(...))` 로
직접 감쌌는데, **next/dynamic 이 만드는 Loadable 래퍼는 함수 컴포넌트라 ref 를 전달하지
않는다**(React 가 "Function components cannot be given refs" 로 경고하고 ref 를 버린다).
그래서 `stageRef.current` 가 계속 null 이었고, `serializeLive()` 가 null 을 반환해
`save()` 가 fetch 도 없이 조기 반환했다. `handleStageReady` 의 `loadDoc` 도 같은 이유로 no-op.

**언제부터**: `46e8d4e`(2026-05-07, "perf: Bebas Neue self-hosting + fabric.js lazy chunk 분리")
에서 정적 import 를 dynamic 으로 바꾸며 끊겼다. main 에 포함돼 **약 3개월간 운영 배포 상태**.
성능 최적화가 기능을 조용히 죽인 전형적인 회귀다.

**영향**: 표지 저장이 안 되면 `cover_json` 이 없어 주문 페이지 게이트
(`order/[projectId]/page.tsx:70-103`)가 열리지 않는다 — **주문 진행 자체가 막힌다.**
서버 API 기반인 "자동 편집"(`/api/layout/generate`)은 정상이라 내지 페이지는 생성됐다.

**수정**: `components/editor/FabricStageLazy.tsx` 신설 — forwardRef 래퍼가 ref 를 받아
`forwardedRef` **prop 으로** 우회 전달하고, `FabricStage` 가 그것을 `useImperativeHandle` 에
연결한다(핸들은 `useMemo` 로 한 번 만들어 두 경로에 공유). lazy 청크 분리는 유지된다.
두 에디터는 이 래퍼를 import 한다.

**실증**: 골든 플로우 E2E 로 확인 — 수정 전에는 120초 동안 저장을 반복 클릭해도 PATCH 가
한 번도 안 나갔고(dev·프로덕션 빌드 모두), `addText` 클릭 후 캔버스도 그대로였다.
수정 후 **첫 클릭에 PATCH 성공, 업로드→편집→표지→주문 전 구간 통과(2 passed, 22초)**.

> 교훈: 이 회귀는 유닛 테스트·타입체크·빌드·공개 라우트 E2E 를 **전부 통과**한 채 배포됐다.
> 로그인 이후 화면을 실제로 조작하는 E2E 가 없었기 때문이다. 아래 ⑤ 픽스처가 그 공백을 메운다.

### 0-5. 퍼널 계측 완결 · 운영 env 실측 · 렌더링 재평가 · 인증 E2E 픽스처 (2026-08-07)

**① PR #2 머지 — 이메일 가입 퍼널 누락 수정** (`735fb2a`)
- 버그 재확인: `signup_completed` 가 `app/api/auth/callback/route.ts:87` 에만 있어
  이메일+비밀번호 가입자는 퍼널 1단계에서 통째로 빠져 있었다(그 경로는 callback 을 타지 않음).
- CI 신설 이전 브랜치라 GitHub Actions 결과가 없던 문제 → main rebase 후 재실행,
  **verify 1m44s / e2e 1m14s / a11y 2m24s 전건 green** 확인 후 rebase 머지. Vercel prod success.
- ⚠️ 머지 이전 `funnel_events` 데이터는 여전히 이메일 가입자가 빠져 있다 —
  전환율 분모가 과소하니 그대로 읽지 말 것.

**② `book_completed` 서버측 dedupe** — 마이그레이션 `0030` (운영 적용 대기)
- `POST /api/cover` 는 표지 저장마다 이벤트를 기록해, 표지를 10번 손보면 10건이 쌓여
  "책 완성" 분자가 부풀었다.
- `signup_completed` 와 같은 관례로 **DB 부분 유니크 인덱스**(`(project_id, event)`)로 멱등화.
  앱은 그대로 INSERT 하고 23505 를 헬퍼가 정상 무시한다. 키를 project 단위로 잡은 이유는
  한 사용자가 책 두 권을 만들면 2건이 기록돼야 하기 때문.
- 인덱스 생성 전에 기존 중복을 **가장 이른 1건만 남기고** 정리하는 DELETE 를 포함했다.

**③ 미설정 env 3종 실측 — 웹훅은 env 문제가 아니었다** → [docs/OPS-ENV-STATUS.md](docs/OPS-ENV-STATUS.md)
- **핵심 발견**: 토스페이먼츠는 개발자 지정 커스텀 헤더를 웹훅에 실어 보낼 수 없다.
  요청 헤더는 `tosspayments-webhook-*` 4종 고정이고 서명 헤더는 **지급대행 이벤트 전용**이다.
  우리 코드는 `x-webhook-secret` 을 요구하므로 → 미설정이면 500, **설정하면 401**.
  **어느 쪽이든 웹훅이 통과하지 못한다. `TOSS_WEBHOOK_SECRET` 등록은 조치가 아니다.**
- 실제 손실은 결제 승인이 아니라(그건 confirm 이 처리) "앱을 거치지 않은 상태 변화"의 자동 반영 —
  토스 콘솔 직접 취소/환불이 `refunded` 로 안 넘어오고 포인트·할인 복원이 안 돈다.
  대체 경로는 있다: 관리자 콘솔 수동 전이가 같은 `restoreOrderCredits` 를 호출한다.
- 조치 A/B/C 안과 Upstash·Resend 절차는 위 문서에 정리. **오너 결정 대기.**

**④ 렌더링 경로 최적화 재평가 — 결론: 착수 가치 있음, 레버는 폰트 하나뿐**
- prod(`735fb2a`) **5회 측정** 중앙값: Performance **83** · FCP **977ms**(편차 972~984, 매우 안정)
  · LCP **4,814ms** · TBT **0** · CLS **0** · SI 1,732ms(편차 972~4,318 — 신뢰 불가).
- **지난 세션의 "elementRenderDelay 가 지배적" 진단은 상황에 따라 다르다**: LCP breakdown 실측 합은
  run 별로 312ms / 937ms / 2,327ms 인데 보고된 LCP 는 4.5~5.2s 다. 이 격차는 Lighthouse 가
  **Lantern 시뮬레이션**(mobile, 1,474Kbps, RTT 150ms, CPU 4×)으로 재계산하기 때문이다.
- 진짜 원인은 대역폭이다: 총 전송 **938KB** ÷ 184KB/s ≈ **5.1초** — 보고 LCP 와 일치한다.
  그중 **폰트 core 533KB 가 57%**, 2위는 54KB 짜리 스크립트다.
- 다른 레버는 이미 소진: TBT 0 이라 JS·하이드레이션 여지 없음. LCP 요소인 hero `<img>` 는
  `fetchpriority=high` · eager · discoverable 진단을 **전부 통과**(51KB).
- **정량 실험**: 홈이 실제로 쓰는 고유 한글은 **245자**(RSC 페이로드 포함, 가시 텍스트 213자).
  그만 담은 서브셋은 104KB — 현재 core 533KB 대비 429KB 절감.
- **구현 완료 — 3단 분할**(`scripts/build-font-subsets.py` 재작성):
  - `ui` **199KB**(preload) = 라틴·기호 실사용분 + **앱 소스에 리터럴로 등장하는 한글 760자**.
    홈 245자가 아니라 소스 전체를 스캔한 이유: UI 문자열은 코드에 박혀 있어 정적으로 전부
    모을 수 있고, 그러면 앱의 **모든 고정 문구**가 첫 폰트로 커버된다. 사용자 생성 텍스트
    (제목·후기·주소)에서만 다음 단계를 받는다.
  - `kr` 301KB(preload 없음) = KS X 1001 중 ui 에 없는 1,591자
  - `ext` 1,315KB(preload 없음) = 나머지 완성형 8,821자
  - 부수 최적화: 블록별 실사용을 세어(전체 1,864자 중 124자만 사용) **라틴 확장·문자유사·
    도형·가나·전각 블록을 제거**해 267→199KB. 수학·기타기호는 실제 쓰는 10자만 개별 지정.
    통화(₩ 예비)와 한글 자모(사용자 입력 "ㅋㅋ")는 소스에 없어도 남겼다.
  - **크리티컬 경로 폰트 533KB → 199KB (-334KB)**. tailwind 폴백 체인은 ui → kr → ext 3단.
- **운영 실측 (배포 후 5회, 중앙값)** — 같은 방법(워밍업 1회 후 5회)으로 전/후 비교:

  | 지표 | 전(`735fb2a`) | 후(`3529f0d`) | |
  |---|---|---|---|
  | 총 전송 | 938KB | **605KB** | −333KB (−35%) |
  | 폰트 전송 | 533KB | **208KB** | (Bebas 8.6KB 포함) |
  | LCP | 4,814ms | **3,619ms** | −25% |
  | Performance | 83 | **88** | +5 |
  | FCP | 977ms | 974ms | 변화 없음 |
  | TBT | 0 | 0~23 | 낮게 유지 |
  | CLS | 0 | 0 | 유지 |

  전송 감소분(−333KB)이 폰트 절감분과 정확히 일치한다 — 예측대로 대역폭이 LCP 를 정했다.
  다만 예상치(LCP ~2.9s, 점수 90+)에는 못 미쳤다. 남은 605KB(이미지·JS)가 여전히 크다.
- 부수 발견 — **a11y 테스트가 flaky 했다**: 폰트가 3개로 늘자 스왑이 밀리면서 진입
  애니메이션도 함께 밀려, 고정 대기 600ms 뒤 측정하던 axe 가 `animate-fade-up` 의
  opacity 전환 중 텍스트를 재 대비 위반으로 보고했다(실행마다 실패 1~4건으로 요동).
  시간이 아닌 **상태**를 기다리도록 `settle()` 신설(`document.fonts.ready` +
  모든 `animate-*` 의 opacity===1) → **25 passed × 3회 연속 안정**.
  참고: coral(#FF6B5E)+night(#141414) 실제 대비는 6.59:1 로 애초에 기준을 넘는다 —
  색 문제가 아니라 측정 시점 문제였다.

**⑤ 인증 사용자 E2E 골든 플로우 — 픽스처·spec 구현 (실행 검증은 승인 대기)**
- 새 파일: `e2e/fixtures/test-user.ts`(service_role 계정 준비 + 데이터 정리),
  `e2e/fixtures/paths.ts`, `e2e/auth.setup.ts`(storageState), `e2e/golden-flow.spec.ts`,
  `e2e/fixtures/photos/sample-{1,2,3}.jpg`. `playwright.config.ts` 에 `setup` +
  `authenticated-desktop` 프로젝트 추가, `pnpm e2e:auth` 스크립트 신설.
- 설계 결정과 근거:
  - 세션 쿠키 위조는 불가능하다(`requireUser()` 가 `auth.getUser()` 로 GoTrue 왕복 검증)
    → **실제 로그인 폼을 통과**한 뒤 storageState 를 저장한다.
  - 비밀번호는 실행할 때마다 새로 만들어 프로세스 메모리에만 두고, 디스크에는
    세션 쿠키만 남긴다(`e2e/.auth/` 는 gitignore).
  - **결제창은 열지 않는다.** "결제하기" 버튼이 enabled 가 되는 것까지가 마지막 단언 —
    그 버튼을 누르면 `orders` 행이 생기고 곧바로 Toss 로 전체 리다이렉트된다.
  - 운영 Supabase 를 그대로 쓰므로 `afterAll` 에서 프로젝트·사진·스토리지를 지운다.
    `orders.project_id` 에 CASCADE 가 없어 주문 → 프로젝트 순서를 지켜야 한다.
  - 모바일 뷰포트 제외: `Dropzone` 의 `<input type="file">` 이 ≤768px 에서 DOM 에서 빠지고
    바텀시트 안으로 들어간다.
- 실측으로 잡은 함정 두 가지(주석에 근거 고정):
  - **숨은 input 에 `setInputFiles` 주입은 쓰면 안 된다.** 파일은 들어가는데(`input.files=3`)
    React `onChange` 가 실행되지 않아(`e.target.value=""` 리셋조차 안 됨) 큐가 빈 채 남는다.
    드롭존 클릭 → `filechooser` 경로로 바꾸면 "핸들러가 붙었는가"와 파일 선택이 함께 해결된다.
  - **표지 저장 완료는 버튼 라벨이 아니라 PATCH 응답으로 판정한다.** `save()` 가
    `setCurrentDoc` 으로 캔버스를 갱신하면 `onModified` 가 다시 발화해 dirty 가 되살아난다.
- 검증 상태: typecheck 0 · lint 0 · vitest 169p/1s · pdf 4케이스 OK · `pnpm e2e` 12 passed ·
  `pnpm test:a11y` 25 passed ×3회 · build 성공 · **골든 플로우 2 passed(22초)** ·
  cleanup 실동작 확인(프로젝트 1건 + 스토리지 6개 삭제) · CI green · Vercel prod success.
  ⚠️ 운영 Supabase 를 쓰므로 이 테스트는 CI 기본 파이프라인에 넣지 않았다
  (`pnpm e2e:auth` 수동 실행. service_role 키가 없으면 자동 skip).

## 이전 작업 (2026-06-13 ~ 2026-08-05)

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
- **이미지 최적화 후속**(2026-08-05, `d1c17ea`) — 결론: **이미지는 이미 최적화 상태였고
  추가 성능 이득은 측정 한계 안에서 입증되지 않았다.**
  - 실측: 홈 이미지 총 150~161KB(8장), Lighthouse 이미지 진단 전부 통과(절감 0KB),
    `deviceSizes`/AVIF·WebP·lazy 모두 이미 적용돼 있었다.
  - 실제로 고친 것: 이미지 참조 16곳이 사진 6장을 `?w=400/600/900/1200/1920` 로 제각각
    참조 → next/image 는 원본 URL 단위로 캐시하므로 사진마다 변형 세트가 여러 벌 생겨
    캐시가 파편화됐다. 사진당 원본 하나로 통일(고유 원본 **16 → 6**).
  - 효과 판정(6회 vs 3회 중앙값): LCP -4% · TTI -5% · FCP -1% — 전부 **범위가 겹쳐**
    노이즈와 구분 불가. SI 는 중앙값이 4,150→1,577ms 로 낮지만 분포가
    [964~4232] vs [2210~4224] 로 크게 겹쳐 **개선으로 주장하지 않는다.**
  - 유지 근거: 성능 수치와 무관하게 캐시 키 정리는 구조적으로 옳고 부작용이 없다.
  - **남은 병목은 이미지가 아니다**: LCP 분해에서 `elementRenderDelay` 가 지배적이고
    실행마다 55~2,044ms 로 요동친다. 메인스레드 1.1s(Other 387ms / Style·Layout 281ms /
    Script 260ms). 다음 레버는 렌더링 경로이며, 지금의 Performance 81 에서 더 올리려면
    비용 대비 효과를 재평가해야 한다.

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
| **Vercel (CLI 토큰)** | `papas-yohan` | `vercel env ls` 정상 | ✅ 정상 (2026-08-06 재확인 — 과거 '만료' 기록은 stale) |
| **Supabase (project)** | `100p_books` | ref `vprifnztvlduhpuwgdau` (Seoul) | ✅ 링크됨 |
| **Supabase (org)** | `rpgjrckrcrxhrbrimjbv` | linked-project.json | ✅ 정상 |
| **Supabase (CLI 로그인)** | `Storywork` 조직 (타 계정) | `supabase orgs list` | ⚠️ **다른 계정 — 100p 조직 미표시** |

### 계정 연동 주의사항
- ~~Vercel CLI 토큰 만료~~ → **2026-08-06 실측 정상**(`vercel env ls` 동작, papas-yohan 로그인). 이 항목은 해소됨.
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

### Lighthouse 모바일 (운영) — ⚠️ **2026-05-13 옛 측정치. 성능 정본은 위 §0-4(2026-08-05)**
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

## 다음 개발 우선순위 (권고) — 2026-08-06 갱신

### 🔴 운영 활성화 (코드 외 — 사용자 콘솔 작업)

**운영 env 실측 (2026-08-06, `vercel env ls`)** — Production 11종 설정됨:
`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `NEXT_PUBLIC_APP_URL` ·
`TOSS_SECRET_KEY`/`TOSS_CLIENT_KEY`/`NEXT_PUBLIC_TOSS_CLIENT_KEY` ·
`STORIGE_API_URL`/`STORIGE_API_KEY`/`STORIGE_WORKER_API_KEY` · `CRON_SECRET`

**미설정 3종 — 코드는 대비돼 있으나 기능이 꺼져 있다:**

| 미설정 env | 실제 동작 | 근거 |
|---|---|---|
| ~~`TOSS_WEBHOOK_SECRET`~~ | **해소(2026-08-07)** — 토스가 커스텀 헤더를 못 보내 이 키로는 해결이 불가능했다. 헤더 게이트를 제거하고 재조회 검증 + rate limit 으로 대체(§0-5, [docs/OPS-ENV-STATUS.md](docs/OPS-ENV-STATUS.md)) | `app/api/payments/webhook/route.ts` |
| `UPSTASH_REDIS_REST_URL`/`TOKEN` | rate limit **전면 fail-open**(가입 라우트 포함) | `lib/security/rate-limit.ts:13,21-23` |
| `RESEND_API_KEY`/`EMAIL_FROM` | 메일 job **cancelled 처리 → 발송 0** | `lib/email/worker.ts:168-172` |

1. ~~**Supabase 운영 DB 마이그레이션 적용**~~ ✅ **0001~0029 전부 완료**(0029: 2026-07-31)
2. ~~**`TOSS_WEBHOOK_SECRET` 등록**~~ ✅ **불필요로 판명(2026-08-07)** — 등록해도 401 로 거부된다.
   코드 수정으로 해소했고, 남은 것은 **토스 콘솔에 웹훅 URL 등록**뿐이다(헤더 설정 없음)
3. **Kakao OAuth 콘솔 등록** — REST API Key + Client Secret → Supabase Provider Enable
4. **Resend API Key + EMAIL_FROM** — 가입/주문 메일 실 발송(현재 발송 0)
5. **(선택) Upstash Redis 구독 + env** — Rate limit 활성화 (미설정 시 fail-open, 보안 권장)
6. **(로컬) `STORIGE_API_KEY`/`STORIGE_WORKER_API_KEY`** — `.env.local` 에 없어 Storige 연동 로컬 실증 불가

### 🔧 로컬 개발 환경 — CLI 재인증 (운영 자동화용, 선택)

| 항목 | 증상 | 조치 |
|---|---|---|
| ~~Vercel CLI 토큰 만료~~ | 해소됨(2026-08-06 실측) | 조치 불필요 |
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
Lighthouse 모바일:        Performance 81 · LCP 5.2s · TTI 5.2s · CLS 0 (2026-08-05, 3회 중앙값)
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
