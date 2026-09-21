# 보안 패치 이력 및 관리 가이드

> 프로젝트 보안 취약점 대응 기록. 신규 이슈 발견 시 이 파일을 업데이트한다.
> 최종 갱신: **2026-09-21** (기준 커밋: main `4346c0b` — Next.js 16.3.5 + React 19.3.0 전환 배포 완료,
> 미병합 브랜치 없음)

---

## 적용된 패치 이력

### 2026-09-21 — Next.js 14.2.35 → **16.3.5** (React 18.3.1 → 19.3.0), main `4346c0b`

14.x 에는 패치가 나오지 않는 advisory 23건을 **메이저 전환으로 일괄 해소**했다.
전환 내용·검증 수치는 [STATUS.md](STATUS.md) §0-12.

| 항목 | 내용 |
|---|---|
| 해소 | `pnpm audit --prod` 의 **`next` advisory 23건 → 0건**. AVIF RCE(`GHSA-2xp9-vwfh-vxw4`, critical)와 Windows RCE(`GHSA-p293-qw3h-jr36`, critical)를 포함한다 |
| 전체 영향 | prod 의존 취약점 **60건 → 36건**(critical 3 → 1, high 32 → 24, moderate 20 → 8, low 5 → 3) |
| 보안 관련 설정 유지 | `poweredByHeader: false` · `remotePatterns` 축소 · `images.formats` **webp 유지**(AVIF 는 advisory 해소 후에도 비용·품질 측정 전까지 재활성화하지 않는다) · `images.minimumCacheTTL: 60` 명시 |
| 새로 추가 | `agentRules: false` — `next dev` 가 저장소의 `AGENTS.md`·`CLAUDE.md` 를 자동 생성/수정하지 못하게 한다 |
| 운영 검증 | 공개 경로 7종 200 · CSP·`X-Frame-Options` 유지 · `x-powered-by` 없음 · `/api/health` 비인증 최소 응답 · cron 무인증 401 · `/_next/image` 최적화 200 · 오픈 리다이렉트 차단 · Vercel 런타임 오류 0건·5xx 0건(배포 후 40분) |
| 제외(후속) | `middleware.ts` → `proxy.ts` 전환(현행 유지, 빌드 deprecation 경고 1건은 정상) · `@supabase/ssr`·`supabase-js` 업그레이드 · React Compiler · Cache Components · AVIF 재활성화 |

### 2026-09-17 — 6렌즈 감사 확정분 (SEC-1 / SEC-3 / SEC-13 / SEC-14 / SEC-19 / SEC-4 / DEBT-3)

운영 반영 완료(main). 상세 경위는 [STATUS.md](STATUS.md) §0-11 A.

| ID | 심각도 | 내용 | 조치 | 커밋 |
|---|---|---|---|---|
| SEC-1 | 🔴 | `/api/photos/complete` 가 사용자 업로드 바이트를 **포맷 검사 전에** sharp 0.33.5 로 전부 디코드했다(heif 로더로 AVIF 까지 통과). 해당 advisory: `GHSA-rgj7-g3m4-5g8c`(`<0.35.4`), `GHSA-f88m-g3jw-g9cj`(`<0.35.0`) | sharp `^0.35.4`(vips 8.18.6 / heif 1.23.2) 승격 + `lib/image/sniff.ts` 매직바이트 사전 판정(JPEG/PNG/WebP/HEIC 만 통과, AVIF 거부) + `lib/image/sharp-safe.ts` 로 불필요한 libvips 로더 `sharp.block`·`limitInputPixels` 명시. 관리자 리소스 업로드에도 동일 적용 | `2d77e6f` |
| SEC-3 | 🟠 | **오픈 리다이렉트** — auth callback 과 `LoginForm` 이 `startsWith("/") && !startsWith("//")` 만 봐서 `/\evil.example`, `/%09/evil.example` 가 외부 오리진으로 해석됐다 | `lib/auth/safe-redirect.ts` 단일 헬퍼(서버·클라 공용 순수 함수): 백슬래시·제어문자·공백·다중 인코딩·dot segment 우회 거부, same-origin 경로로 정규화, 멱등. 표 기반 175건 + 퍼징 | `55020ab` |
| DEBT-3 | 🟠 | **탈퇴 계정 잔존** — 주문 이력이 있으면 auth hard delete 가 FK 로 실패하는데 200 을 반환했고, `requireUser` 가 `deleted_at` 을 보지 않아 **탈퇴 후에도 로그인·주문이 가능**했다 | soft delete + global signOut, 단계 멱등화(`lib/auth/account-deletion.ts`), 미주문 콘텐츠 파기, 돈·정체성 변경 라우트에 `requireActiveUser` | `55020ab` |
| SEC-13 | 🟡 | 비밀번호 재설정 마커가 실제 재설정 흐름 밖에서도 발급됐다 | 재설정 흐름에서만 발급 | `55020ab` |
| SEC-14 | 🟠 | **cron 인증** — 위조 가능한 `x-vercel-cron` 헤더를 신뢰했고 판정이 4곳에 복제돼 있었다 | `lib/security/cron-auth.ts` 로 일원화. 배포 환경은 `Authorization: Bearer <CRON_SECRET>` 만 인정하고 **미설정이면 fail-closed**(로컬 `next dev` 에서만 수동 헤더 허용). 비교는 SHA-256 다이제스트 `timingSafeEqual` | `f605028` |
| SEC-19 | 🟡 | `/api/health` 가 비인증 응답에 env 구성·DB 오류 원문을 노출했다 | 비인증은 `{ ok, status, service, ts }` 만. 상세는 Bearer `CRON_SECRET`(또는 로컬 dev). 상태 코드 200/503 은 유지 | `f605028` |
| SEC-4 | 🟡 | `next.config` `remotePatterns` 가 과도하게 넓었다 | 자기 Supabase 호스트 + unsplash `/photo-*` 로 축소. `poweredByHeader:false`. **`images.formats` 에서 avif 제외 — `GHSA-2xp9-vwfh-vxw4`(critical, AVIF 경로 RCE) 완화** | `f605028` |

### 2026-09-17~21 — 결제·RLS·편집 잠금 (main `34a5897` 반영 완료)

> SHA 는 `bacadc1` 위로 rebase 한 **현재 main 기준**이다. rebase 이전 SHA 는 존재하지 않는다.

| ID | 심각도 | 내용 | 조치 | 커밋 |
|---|---|---|---|---|
| — | 🔴 | **`profiles` 권한 상승** — 0002 의 `profiles_update_self` 가 `auth.uid() = id` 만 보고 **컬럼 제한이 없어**, 로그인 사용자가 공개 anon 키 + 자기 JWT 로 PostgREST 를 직접 호출해 자기 `role` 을 `'admin'` 으로 바꾸거나(`is_admin()` 이 이 값을 읽는다) `deleted_at` 을 되돌려 탈퇴 가드를 풀 수 있었다 | 마이그레이션 `0032_lock_client_writes.sql` — 민감 컬럼은 **SECURITY INVOKER** BEFORE UPDATE 트리거로 거부(DEFINER 면 `current_user` 가 소유자라 발동하지 않는다). 같은 부류의 "소유자 전체 쓰기" 표면(gifts·attendances·review_likes·photos INSERT/UPDATE)도 회수하고, reviews 는 명령별 정책 + 컬럼 grant + `WITH CHECK` 로 라우트 검증을 DB 에서 강제 | `be00e1b` |
| — | 🟠 | **사진 원본 바꿔치기** — 0004 의 `photo_originals_user_insert/update/delete`·`photo_thumbs_user_delete` 로 사용자가 anon 키 + JWT(x-upsert)로 본인 폴더 원본을 직접 덮어쓸 수 있었다. 검증된 원본을 바꿔치기하면 `lib/pdf/photos.ts` 가 **재검증 없이** PDF 로 가져간다 | 0032 에 해당 storage 정책 drop 추가. anon 의 `photos` DELETE 잔여 grant 회수. SELECT·service_role 정책은 유지 | `aed8404` |
| SEC-7 | 🟠 | 주문 간 동시 confirm 으로 **같은 포인트·할인 이중 사용** | 캡처 **전** 선점(0033 `reserve`/`release` RPC, service_role 전용) — 승인 실패·불일치 시 해제. 0033 미적용 환경은 기존 경로로 폴백 | `88163d0` |
| SEC-8 | 🟠 | 웹훅 재조회 응답의 `orderId`·`paymentKey` 를 대조하지 않았다 | 대조 추가. `pending`+`CANCELED` 시 선점 해제 | `88163d0` |
| DEBT-1 | 🟠 | 웹훅 `paid` 전이가 확정 부수효과(포인트 차감 확정·할인 기록·PDF 잡·메일)를 건너뛰었다 | `lib/orders/finalize-paid.ts` 단일 멱등 함수를 confirm·웹훅이 함께 호출. 미완료면 웹훅 503 으로 토스 재전송 유도 | `88163d0` |
| DEBT-2 | 🟠 | **결제 후 인쇄물 변조** — 결제된 주문의 프로젝트를 계속 편집할 수 있었다 | `lib/orders/edit-lock.ts` — paid·in_production·shipped·delivered 주문이 있으면 인쇄물 영향 쓰기를 409 `PROJECT_LOCKED`. 판정표는 `Record<OrderStatus>`(모르는 상태는 fail-closed)이고 **소유권 검증 뒤에만** 판정해 남의 결제 여부를 노출하지 않는다 | `31eaabf`, `513ba21`, `34a5897` |
| — | 🟡 | 탈퇴 회원의 공유 링크가 살아 있었다 | `share/[token]` 은 소유자가 탈퇴했으면 404(토큰 없음과 같은 응답) | `31eaabf` |
| — | 🟠 | **선물 IDOR 잔여** — 0032 이전에 남의 주문으로 생성된 gift 가 있으면 그대로 수령될 수 있었다 | `gifts/[token]` 수령 시 `gift.sender_id = order.user_id = project.user_id` **3중 일치** 검증. 불일치는 토큰 없음과 같은 404 | `34a5897` |
| — | 🟠 | **`photos/purge` 키 소유 미검증** — 삭제 대상 storage 키의 소유(prefix)를 확인하지 않았고, 선물로 공유된 키를 지울 수 있었다 | prefix 검증 + 행 삭제 후 참조 재조회로 공유 키 보호, DB→Storage 순서로 교정 | `34a5897` |
| — | 🟡 | **출석 20일 월 보너스 미지급** — 중복 판정이 `memo LIKE '%YYYY-MM%'` 라 같은 달 10일 보너스(같은 reason)에 걸려 +1,000P 가 사실상 지급되지 않았다 | 적립 memo 와 조회를 `monthly-bonus.ts` 헬퍼로 묶고 **memo 정확 일치**로 변경. 과거 지급분도 같은 문구라 **소급 이중 지급 없음** | `34a5897` |

### 2026-08-11 — 마이그레이션 `0031` (운영 적용·검증 완료)

- SECURITY DEFINER 함수 대부분이 `grant execute … to service_role` 만 하고 선행 `revoke` 를 빠뜨려
  Postgres 기본값인 **PUBLIC EXECUTE** 가 살아 있었다. 실측으로 anon 키가
  `add_user_points_v2` 를 실행할 수 있었다(1P=1원 → 결제 금액 직접 차감).
- `share_tokens`·`gifts` 의 `using (true)` SELECT 정책으로 전체 토큰 덤프가 가능했다.
- 적용 후 실측: anon → `42501 permission denied`, `is_admin()` 은 `false`(정상 유지),
  service_role 경로 정상. 절차·재확인 커맨드는 [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md) §0.

### 2026-05-10 — Next.js 14.2.15 → 14.2.35

| 심각도 | 내용 | 패치 버전 |
|---|---|---|
| 🔴 CRITICAL | Middleware Authorization Bypass — `/admin` 등 보호 경로 우회 | 14.2.25+ |
| 🟠 HIGH | Server Components DoS | 14.2.34+ |
| 🟠 HIGH | HTTP 역직렬화 DoS | 14.2.35+ |

**영향 프로젝트**: `100p_books` (14.2.15 → 14.2.35), `mystory` (14.2.15 → 14.2.35)

---

## 잔존 취약점 (2026-09-21 `pnpm audit --prod` 실측 — main `4346c0b`)

Next 16 전환 후 **36건 — low 3 / moderate 8 / high 24 / critical 1.**
전환 직전(`34a5897`)은 60건(low 5 / moderate 20 / high 32 / critical 3)이었다.
**`next` 23건이 전부 해소**됐고, 전체(dev 포함) `pnpm audit` 은 43건이다
(low 3 / moderate 13 / high 25 / critical 2 — 늘어난 critical 1건은 dev 전용 경로).

| 패키지 | 건수 | 유입 경로 | 패치 | 현재 앱 노출 |
|---|---|---|---|---|
| `tar` | **12** (critical 1 · high 8 · moderate 3) | `fabric@6.9.1 > canvas@2.11.2`(fabric 의 **optionalDependencies**) `> @mapbox/node-pre-gyp > tar@6.2.1` | `>=7.5.19` | 전부 **아카이브 추출** 취약점이다(경로 탈출·심링크·압축 DoS). `tar` 는 node-pre-gyp 가 **설치 시점에** 네이티브 바이너리를 풀 때 쓰고, 앱은 **fabric 을 서버에서 import 하지 않으며**(CLAUDE.md 금지 규약) PDF 렌더러는 `@napi-rs/canvas` 다 → **앱 런타임 경로 없음**. 해소는 fabric 7.x 전환 |
| `brace-expansion` | 6 (high) | `exceljs@4.4.0 > archiver > glob/minimatch` | `>=2.1.2` | glob 패턴 ReDoS/OOM. 앱은 `lib/admin/excel.ts` 의 **송장 Excel 생성**에서만 exceljs 를 쓰고 사용자 입력이 glob 패턴으로 들어가는 경로가 없다 |
| `nanoid` | 3 (high) | 직접 의존 `nanoid@5.1.11` 1건 + `tailwindcss > postcss > nanoid@3` 2건 | `>=5.1.16` | "size 가 음수/0 일 때 무한 루프". 앱의 호출은 전부 **리터럴 양수**(`nanoid(8/10/12/16)`)라 사용자 입력이 size 로 들어가지 않는다. tailwind 경로는 빌드 타임 |
| `ws` | 2 (high 1 · moderate 1) | `@supabase/ssr > supabase-js > @supabase/realtime-js > ws@8.20.0` | `>=8.21.0` | **앱은 Supabase Realtime 채널을 쓰지 않는다**(`.channel(` 사용처 0건) → 연결 자체가 생기지 않는다. supabase-js 업그레이드로 해소 |
| `postcss` | 2 (high 1 · moderate 1) | `tailwindcss-animate > tailwindcss > postcss` | `>=8.5.23` | sourceMappingURL 경로 탈출 — **빌드 타임 도구 체인**이고 CSS 소스는 저장소 것뿐이다 |
| `browserslist` | 2 (high) | `next@16.3.5 > styled-jsx > @babel/core` | `>=4.28.7` | 메모리 증가·`browserslist-stats.json` 프로토타입 오염 — **빌드 타임**, 커스텀 stats 미사용 |
| `fabric` | 2 (high 1 · moderate 1) | 직접 의존 `fabric@6.9.1` | `>=7.2.0` / `>=7.4.0` | 아래 별도 절 — SVG 내보내기·로드 경로가 없어 **직접 노출 없음** |
| `@supabase/auth-js` | 1 (low) | `supabase-js@2.45.6 > auth-js@2.65.1` | `>=2.70.0` | malformed 입력의 경로 라우팅. supabase-js 업그레이드(후속 웨이브)로 해소 |
| `tmp` · `uuid` · `form-data` · `@tootallnate/once` · `postcss-selector-parser` · `baseline-browser-mapping` | 각 1 | exceljs / fabric(jsdom) / tailwind / next 전이 | 각 상위 버전 | 전부 전이 의존이고 앱 코드가 직접 호출하지 않는다 |

> **노출 판정의 근거**는 저장소 grep(호출처 유무)과 의존 경로다.
> "런타임 경로 없음"은 **앱 코드가 그 패키지에 도달하지 않는다**는 뜻이지 패키지가
> `node_modules` 에서 사라졌다는 뜻이 아니다. 해소 경로는 **fabric 7.x**(tar 12건 동반 해소)와
> **`@supabase/ssr`·`supabase-js` 업그레이드**(ws 2 + auth-js 1) 두 갈래다.

### Next.js — 16.3.5 에서 잔존 advisory 0건

14.2.35 시절의 `next` advisory 23건은 patched 범위가 전부 `>=15.x` 여서 14.x 안에서는
해결할 수 없었다. 2026-09-21 **16.3.5 직행 전환**(`4346c0b`)으로 전부 해소됐다.

- `GHSA-2xp9-vwfh-vxw4` (critical — Image Optimization API 의 AVIF 무인증 RCE): **해소.**
  다만 `images.formats` 는 계속 **webp 단독**이다 — AVIF 재활성화는 인코딩 비용·품질 회귀를
  측정한 뒤 후속 웨이브에서 판단한다(Next 16 기본값도 webp 단독).
- `GHSA-p293-qw3h-jr36` (critical — Windows 호스팅 RCE): 해소. 애초에 운영은 Vercel(Linux)이라 미해당이었다.
- 나머지 SSRF·DoS·캐시 포이즈닝·CSP nonce 계열 21건도 16.3.5 에 포함된다.

> `middleware.ts` 는 의도적으로 유지 중이다(빌드 deprecation 경고 1건은 정상).
> Pages Router + i18n 우회 advisory(`GHSA-36qx-fr4f-26g5`)는 App Router 전용 앱이라 원래 미해당이었다.

### Fabric.js 6.9.1 → 7.x (현재 앱에서 직접 노출 없음)

| 심각도 | advisory | 내용 | 패치 |
|---|---|---|---|
| 🟠 HIGH | `GHSA-hfvx-25r5-qc3w` | Stored XSS via SVG Export | `>=7.2.0` |
| 🟡 MODERATE | `GHSA-w22m-hvvm-xmwx` | `fabric.Gradient` colorStops 이스케이프 누락 → SVG 직렬화 XSS | `>=7.4.0` |

**현재 앱 상황**: 사용자가 SVG 를 Fabric 에 직접 로드하는 경로가 없고 SVG 내보내기도 쓰지 않는다 →
**직접 노출 없음**. 7.x 는 API 변경이 커서 별도 에디터 마이그레이션 마일스톤으로 처리한다.
다만 fabric 6.9.1 이 선택적 `canvas` 백엔드를 통해 **`tar` advisory 12건(critical 1 포함)을 함께
끌고 온다** — 잔존 36건 중 가장 큰 덩어리이므로 7.x 전환의 동기에 이 점을 포함한다.

### 아직 조치하지 않은 것

- 🔺 **`0032`·`0033` 운영 미적용** — **짝이 되는 코드는 이미 배포됐다**(`34a5897`).
  `0033` 적용 전까지 **SEC-7(주문 간 동시 confirm 이중 사용) 창이 열려 있고**,
  `0032` 적용 전까지 `profiles.role` 권한 상승 표면이 남아 있다.
  절차: [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md) §9·§10.
- **선물 미리보기 GET 의 쓰기 부작용** — 소유 불일치 판정 시 `gifts.status='expired'` 로 쓰기를
  한다. 읽기 요청이 상태를 바꾸는 구조라 claim 경로로 한정하는 것이 권고안(적대 리뷰 비차단 후속).
- **`thumb_key` 고아 객체 회수 미검증** — `orphan-photos` cron 이 썸네일 키 고아 객체를 실제로
  회수하는지 확인되지 않았다.
- **`lib/pdf/photos.ts` 원본 재검증 부재** — storage 에서 받은 원본을 sniff·sharp 재검증 없이
  PDF 로 가져간다. 0032 로 바꿔치기 경로는 막았으나 검증은 업로드 시점 1회뿐이다.
- **`photo-originals` SELECT 정책 잔존** — 0032 는 쓰기만 회수했다.
- **Upstash 미설정 → rate limit 전면 fail-open** (`lib/security/rate-limit.ts`,
  [docs/OPS-ENV-STATUS.md](docs/OPS-ENV-STATUS.md) §2).
- **관측성 부재** — 에러 추적 SDK 가 없어 운영 예외를 Vercel 로그로만 본다.
- **`@supabase/ssr` 0.5.2 · `supabase-js` 2.45.6 업그레이드** — Next 16 웨이브에서 의도적으로
  제외했다. 잔존 `ws` 2건 + `@supabase/auth-js` 1건이 여기에 묶여 있다.
- **Vercel Preview 런타임 검증 불가** — Preview 환경변수 0종이라 프리뷰에서는 PDF 네이티브
  바이너리·토스 결제·카카오 콜백을 실증할 수 없다(Next 16 전환분도 운영 배포본으로만 검증했다).

---

## 정기 점검 절차

```bash
# 100p_books (정본 경로)
cd /Users/yohan/Developer/claude/100p_books
pnpm audit --prod     # 런타임 의존만 — 빌드 도구 노이즈 제외

# mystory
cd /Users/yohan/Developer/claude/mystory
npm audit
```

Dependabot alerts 와 weekly npm 업데이트(minor/patch 그룹, 프레임워크 메이저는 ignore)가
`.github/dependabot.yml` 에 설정돼 있고, CI 에 **비차단** audit 요약 단계가 있다.

> ⚠️ `dependabot.yml` 의 `next`/`react`/`react-dom`/`@types/react*`/`eslint`/`eslint-config-next`
> 메이저 ignore 는 **14/18 기준으로 쓴 것**이다. 2026-09-21 에 16/19 로 올라갔으므로 규칙을
> 그대로 둘지 재검토가 필요하다(백로그 — [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md)).
> 현재 열려 있는 Dependabot PR 은 actions 메이저, `@napi-rs/canvas` 1.x, `lucide-react` 1.x,
> `nanoid` 6, `typescript` 6, `postcss` 패치, npm-minor-patch 그룹 등이다.

### 판단 기준

| 심각도 | 대응 기한 |
|---|---|
| CRITICAL | 즉시 (24시간 내) |
| HIGH | 1주일 내 |
| MODERATE | 다음 배포 사이클에 포함 |
| LOW | 분기별 점검 시 처리 |

> 단, **패치 버전이 현재 메이저에 없으면** 기한이 아니라 완화책 + 전환 계획으로 관리한다.
> Next 14 가 그 경우였고 2026-09-21 16.3.5 전환으로 해소됐다. 지금 같은 상태인 것은
> **fabric 6.x**(패치가 7.x 에만 있다 — 본인 2건 + 전이 `tar` 12건)다.

---

## 환경변수 보안 체크리스트

배포 전 반드시 확인:

- [ ] `.env.local` 가 `.gitignore`에 포함되어 있음
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 가 서버 코드에서만 사용됨 (`"use client"` 파일에 없음)
- [ ] `NEXT_PUBLIC_` prefix 변수에 시크릿 없음 (anon key, 공개 client key만 허용)
- [ ] `TOSS_SECRET_KEY` 가 API Route 전용임
- [ ] `RESEND_API_KEY` 가 server-only 모듈에서만 사용됨
- [ ] **`CRON_SECRET` 이 배포 환경에 설정돼 있음** — 없으면 모든 cron 이 fail-closed 로 막힌다

---

## DB 보안 규칙 (반복 사고 방지)

- **SECURITY DEFINER 함수를 새로 만들면 `revoke` 를 함께 쓴다.** Postgres 는 PUBLIC 에 EXECUTE 를
  기본 부여하므로 `grant … to service_role` 만 하면 anon 도 실행할 수 있다(`0031` 의 실제 사고).
  단 `is_admin()` 은 RLS 정책 22곳에서 호출자 권한으로 실행되므로 **잠그지 말 것**,
  `lookup_referral_code()` 도 의도적 공개다.
- **"소유자 전체 쓰기" 정책(`using (auth.uid() = id)` 만)은 권한 상승 표면이다.** 앱이 사용자 세션으로
  쓰지 않는 테이블은 아예 회수하고, 쓰는 테이블은 명령별 정책 + 컬럼 grant + `WITH CHECK` 로 좁힌다(`0032`).
- **컬럼 보호 트리거는 SECURITY INVOKER 로 만든다.** DEFINER 면 `current_user` 가 테이블 소유자가 되어
  트리거 안의 권한 판정이 절대 발동하지 않는다.

---

## 관련 리소스

- [Next.js Security Advisories](https://github.com/vercel/next.js/security/advisories)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
