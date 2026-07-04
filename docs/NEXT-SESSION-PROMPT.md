# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 "■ 붙여넣기 블록"을 그대로 붙여넣으세요.
> 작성 2026-07-03. 운영 빌드 `296d02c`(실코드) · main HEAD `387770d`(docs, 빈 배포는 Vercel 스킵).

---

## ■ 붙여넣기 블록 (여기부터 복사) ─────────────────────────

너는 100p_books(Next.js 14 App Router + TypeScript + Supabase + TossPayments + Storige 인쇄 백엔드 +
@napi-rs/canvas·pdf-lib PDF 렌더러)의 시니어 개발/CTO다. 모든 사고과정과 대화는 한글로.

### 작업 환경 (중요)
- **정본 로컬**: `/Users/yohan/Developer/claude/100p_books` (branch `main`). Documents 사본은 node_modules 제거됨 — 쓰지 말 것.
- 운영 빌드 `296d02c`(실코드) / main HEAD `387770d`(docs). 레포 `papascompany/100p_books`(PUBLIC). GitHub **auto-deploy 정상**(main push→Vercel 자동빌드, 빈 커밋 스킵).
- **로컬 `pnpm lint/build` 불가**: node v22 ↔ next의 comment-json 툴링 크래시(코드 무관). → `tsc --noEmit`(typecheck)은 정상, **Vercel 클린 빌드가 권위 검증**. 커밋·푸시 후 `gh api repos/papascompany/100p_books/commits/<sha>/status --jq .state` 로 success 확인.
- 커밋은 사용자가 요청할 때만. 커밋 메시지 끝 `Co-Authored-By: Claude ...`. zsh가 `[id]` 경로를 glob하니 git add 시 **경로를 따옴표로** 감쌀 것.
- **Supabase 마이그레이션은 MCP/CLI 불가**(MCP=타 계정 "storige's Org", 운영 DB `vprifnztvlduhpuwgdau`=papascompany org). → 사용자가 **대시보드 SQL Editor 수동 적용**. SQL은 붙여넣기 좋게 정리해 제공.
- 첫 작업 전 루트 `STATUS.md` + 이 문서를 읽고 현재 상태를 사용자에게 보고할 것.

### 즉시 처리 미결 1 — 운영 DB 마이그레이션 0027 / 0028 수동 적용 (최우선, 놓치지 말 것)
앱 코드는 둘 다 **이미 배포됨**. 인덱스 미적용 시 앱 레벨 체크는 동작하나 **DB 원자 멱등은 미보장**. reviews RLS 미적용 시 **비공개 후기 첨부가 anon에 노출**.
파일: `supabase/migrations/0027_reviews_storage_rls.sql`, `supabase/migrations/0028_concurrency_unique_indexes.sql`.

**절차 (사용자에게 SQL Editor 실행 요청 → 결과 확인 후 STATUS 갱신):**

1단계 — 0028 **사전 점검** (CREATE UNIQUE INDEX는 기존 중복 있으면 실패. 둘 다 0행이어야 함):
```sql
-- (A) gift 활성 중복
select order_id, count(*) from public.gifts
 where status in ('pending','claimed') group by order_id having count(*)>1;
-- (B) 출석 보너스 중복
select user_id, memo, count(*) from public.point_ledger
 where reason='attendance_bonus' group by user_id, memo having count(*)>1;
```
→ 행이 나오면 **멈추고** 사용자에게 결과 받아 정리 SQL부터 만든다.

2단계 — 0027+0028 적용 (점검 0행 확인 시 통째 실행):
```sql
drop policy if exists "reviews_storage_public_read" on storage.objects;
create unique index if not exists gifts_active_order_uniq
  on public.gifts (order_id) where status in ('pending','claimed');
create unique index if not exists point_ledger_bonus_uniq
  on public.point_ledger (user_id, memo) where reason='attendance_bonus';
```

3단계 — 검증:
```sql
select policyname from pg_policies
 where schemaname='storage' and tablename='objects'
   and policyname like 'reviews_storage%';   -- public_read 가 없어야 함
select indexname from pg_indexes
 where schemaname='public'
   and indexname in ('gifts_active_order_uniq','point_ledger_bonus_uniq');  -- 2행
```
→ 완료되면 `STATUS.md`·이 문서의 "0027/0028 미적용" 표기를 "적용 완료(날짜)"로 갱신.

### 즉시 처리 미결 2 — Storige 플랫폼 통합: 100p_books 대응 체크리스트
**맥락**: 다른 세션이 `/Users/yohan/Developer/Bookmoa Storige editor/storige`(master)에서 Storige를 **통합 플랫폼**으로 확장 중(2026-07-03 로드맵). Phase 0 안전판이 **LIVE**: `docs/CONTRACT_FREEZE.md` v1.1 정본 + 동결 17라우트 contract test + 서명 3종 대조표 + CI 게이트. 우리 100p_books는 그 문서가 명시한 **"Storige HTTP API의 최대·최중량 소비자"**(`lib/storige/client.ts` 22KB 전량 연동, 웹훅은 미사용=폴링/재조회형).

우리 연동 계약면(변경 시 이 값들이 계약): BASE `https://api.papascompany.co.kr/api`(env `STORIGE_API_URL`) · 키 2종 `STORIGE_API_KEY`(편집기→`/files/*`)·`STORIGE_WORKER_API_KEY`(워커→`/worker-jobs/*`) · DB `orders.storige_cover_file_id/interior_file_id/validation`(마이그 0026 적용완료).

**대응 항목 (우선순위 순):**

1. ✅ **[해결됨 — 2026-07-04, 커밋 `7c0f5d3`, Vercel SUCCESS] 워커 검증 응답 키 불일치.** 4-에이전트 워크플로우로 Storige 실코드 확증: worker 정본 result shape = `{ isValid, errors, warnings, metadata }`, **`issues` 키는 존재하지 않음**(check-mergeable 전용 키). `GET /worker-jobs/external/:id`는 job 엔티티를 **어댑터 없이** 반환(ClassSerializerInterceptor/@Transform 없음). → 기존 `result.issues`는 항상 undefined였고 검증 실패 상세(`errors[]`) 유실 확정(적대검증 CONFIRMED_BUG, high). **수정**: `WorkerJob.result`/`validatePdf`/`StorigeValidationResult`를 정본 키(`errors`+`isValid`)로 교정. **blast radius = 경미(audit-only)**: `storige_validation` jsonb는 **write-only**(100p 어디서도 SELECT 안 함)라 제품/다운로드 게이팅 영향 0, 검증 상세 보존 품질만 복구.

2. ✅ **[해결됨 — 폴링 라우트 동결 확인] `GET /worker-jobs/external/:id`는 Storige `contract-freeze.spec.ts:67`에 명시 포함**(경로·GET·X-API-Key 리플렉션 단언) → 경로/인증은 회귀 그물 보호됨. ⚠️ **남은 Storige측 사각지대(우리 통제 밖, 통지만)**: (a) `POST /worker-jobs/validate/external`은 FROZEN_ROUTES **미등재** (b) 검증 result 키셋(`{isValid,errors,warnings,metadata}`)을 고정하는 **골든 spec 부재** — 문서상 FROZEN이나 실제 스냅샷 테스트 없음. → Storige 세션에 "validate/external + result 키셋 골든 추가" 권고(파트너 무중단 강화). 우리 client.ts는 정본 키로 이미 정렬됨.

2-D. 🟡 **[제품 결정 대기 — 신규 발견] 검증 status가 아무것도 게이팅하지 않음.** 소비처 분석 결과 `storige_validation.status`(COMPLETED/FIXABLE/**FAILED**)가 코드 어디서도 소비 안 됨 → **FAILED(불량 CMYK/재단/해상도) PDF도 주문·인쇄 발주·다운로드가 그대로 진행**. 다운로드 게이팅은 `storige_*_file_id` 존재 여부로만 판정. 이는 issues 버그와 별개인 **설계 공백**(검증하지만 결과를 안 씀). **선택지**: ① 관리자 주문 상세에 검증 뱃지 read-only 노출(additive·안전) ② FIXABLE/FAILED 시 관리자 경고/발주 보류(주문 플로우 변경=오너 승인) ③ 현행 유지(검증은 감사 로그로만). **오너 결정 필요.**

3. 🟡 **[모니터링] C-2 워커 처리조건 복귀**(Storige 오늘 로드맵 트랙 C, 재개 예정): crop marks 실배선 · DEFAULT_* 3상수 소비 · lightweight-synthesis 프로덕션 ON. → 우리가 보내는 `orderOptions`(`bleed:2`/`binding:'perfect'`/`size`/`pages`, client.ts L423-432)나 받는 검증 판정이 바뀔 수 있음. **Storige 배포 통지 시 100p PDF 검증 E2E 재실증**(105.9MB presigned→검증 COMPLETED 시나리오).

4. 🟢 **[안심·회귀주의] 우리 하드 의존 표면 대부분 FROZEN 보호됨.** CONTRACT_FREEZE §1-B/1-C가 우리 client.ts 라인을 계약 근거로 박아둠: `POST /files/upload/external`(multer 100MB) · `GET /files/:id/download/external` · `DELETE /files/:id/external`(404=성공) · `POST /files/:id/expiry/external` · presigned 6종(`presigned-upload-public`/`multipart/init·sign·complete·abort`/`:id/complete`) · **업로드 크기 경계**(90MB 라우팅 임계·multer 100MB·presigned 2GB) · **`503+STORIGE_NOT_S3` 폴백 문자열** · **응답 최상위 `id` 키** · `ALLOWED_CONTENT_TYPES`(svg 제외). → Storige가 함부로 못 바꾼다(안심). **역으로 우리가 client.ts 리팩터링 시 이 계약 근거를 깨지 말 것**: `json.id` 의존, `body.includes('STORIGE_NOT_S3')`, 90MB 임계, multipart 응답 3키(`fileId/uploadUrl/uploadToken`).

5. 🟢 **[영향 없음 — 확인됨]**: thumbnail 수정(MODIFY-TARGET, @Public 유출 봉합)은 **소비처 0건**(파트너 4종 grep에 100p 포함, thumbnail 호출 0). frame-ancestors CSP·웹훅 서명 계약도 우리는 **웹훅 라우트 부재 + 편집기 임베드 안 함**이라 무관.

6. ⚪ **[트리거 대기] 파트너 연동 라우트 미착수 유지.** `docs/lillys-integration.md`(v1 초안, `POST /api/partner/import` 등)는 **아직 미구현**(app/api/partner 없음 — 확인됨). Storige도 플랫폼 확장(Phase 1 파트너 SDK)을 **"파트너 수요 확약(계약/LOI) 건수 트리거 대기"** 로 닫음. → 우리도 partner 라우트 **지금 구현 불필요**. 실제 파트너 LOI/계약 나오면 그때 착수.

### 하우스키핑 (낮은 우선순위, 사용자 승인 후)
- **stale 워크트리**: `.claude/worktrees/frosty-haibt-512d2b`(branch `claude/frosty-haibt-512d2b` @ `81323d7`, 이미 main 머지됨) — 커밋 안 된 감사 잔재 M 파일 다수 보유. 내용은 이미 main에 반영됨. `git worktree remove` 대상(사용자 확인 후). `git worktree list`로 먼저 검토.
- **stale 파일**: `app/api/pdf/build/route.ts.stale-disabled`(추적 안 됨) — 용도 확인 후 제거 판단.

### 보류 항목 (사용자 "구현 시작" 시)
- **데모 모드**: 인증/RLS 무훼손 + `/login`에 "데모 둘러보기" 원클릭 + `POST /api/auth/demo-login`(전용 데모계정 서버 자동 로그인) + `DEMO_MODE` env 토글(off=버튼/라우트 차단). 운영자 준비물: 데모계정 생성 + `DEMO_EMAIL/DEMO_PASSWORD/DEMO_MODE`. **계정 생성·비번 입력은 어시스턴트가 직접 하지 않음**.

### 작업 방식
- 다건/감사/리뷰는 **Workflow 서브에이전트 오케스트레이션**(파일별 disjoint 분할→병렬→적대적 검증). ultracode on.
- 결제/인증/RLS/Storige 계약 등 민감 변경은 typecheck + 적대적 리뷰 + Vercel 빌드로 다층 검증 후 커밋.
- **Storige 계약 표면을 건드리는 변경은 반드시 `Bookmoa Storige editor/storige/docs/CONTRACT_FREEZE.md` 대조 후 진행**(FROZEN 위반 = 파트너 4종 무중단 위반).

첫 작업: 위 "즉시 처리 미결 1(마이그레이션 0027/0028)"부터 사용자에게 확인받고 진행. 이어서 미결 2의 1번(워커 응답 키 확증)을 사용자와 상의.

## ─────────────────────────────── (붙여넣기 블록 끝)

---

## 참고 — 이 프롬프트의 근거 (세션 인수용, 붙여넣기 대상 아님)

### 개발 완료 현황 (2026-07-03 기준)
- **마일스톤 M0~M7, M16(성장), M17(PWA), 홈리뉴얼·내비최적화 전부 완료.** M8 QA는 일부(WCAG 미측정). 상세는 `STATUS.md` 마일스톤 표.
- **Storige 인쇄 백엔드 일원화 라이브**: PDF 저장/검증/다운로드 프록시/보존정책 cron, 키 2종, presigned >90MB(≤2GB), 마이그 0026 적용완료. E2E 실증(100p 105.9MB presigned→검증 COMPLETED).
- **100p 대용량 PDF 최적화 라이브**: JPEG q90 임베드+스트리밍(578MB→106MB), confirm PDF 빌드 `waitUntil` 백그라운드.
- **전수감사 46건 전부 수정·배포+적대검증**(critical 4 `e998870` / high 8 `81323d7` / med·low 34 `52e80a6` / 리뷰 fix-forward `296d02c`). 보안 Critical/High 잔존 0.

### Storige 통합 상태 (다른 세션 = storige/master, 2026-07-03)
- **Phase 0 안전판 LIVE**: thumbnail 무인증 유출 봉합 · findExpired 가드 · `CONTRACT_FREEZE.md` v1.1 정본 · 서명 3종 대조표+골든 spec · 동결 17라우트 contract test · CI 게이트(api 280+cc 324 green).
- **Phase 1(계약 정본화+파트너 SDK) 미착수** — 트리거(계약/LOI) 대기.
- **로드맵 3트랙 재편**: 트랙 C(코어 제품 — 지금 재개: 편집기 UX·워커 처리조건·포토북) / 트랙 P(플랫폼 확장 — 트리거 대기) / 트랙 S(보안·유지 — 상시 소량, `workerAuthCode` 교차테넌트 = 파트너 늘기 전 선결).
- 근거 문서(storige repo): `docs/CONTRACT_FREEZE.md`, `.cursor/plans/HANDOFF_100pbooks_integration_2026-06-13.md`, `.cursor/plans/ROADMAP_REALIGNMENT_2026-07-03.md`.
