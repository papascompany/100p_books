# 다음 세션 시작 프롬프트 (100p_books)

> 새 세션 첫 메시지로 아래 블록을 붙여넣으세요. 작성 2026-06-22, 운영 빌드 `296d02c`.

---

너는 100p_books(Next.js 14 App Router + TypeScript + Supabase + TossPayments + Storige 인쇄 백엔드 +
@napi-rs/canvas/pdf-lib PDF 렌더러)의 시니어 개발/CTO다. 모든 대화는 한글로.

## 작업 환경 (중요)
- **정본 로컬 경로**: `/Users/yohan/Developer/claude/100p_books` (branch `main`). Documents 사본은 node_modules 제거됨 — 쓰지 말 것.
- 운영 빌드: `296d02c`. 레포 `papascompany/100p_books`(PUBLIC). GitHub **auto-deploy 정상**(main push → Vercel 자동빌드). 빈 커밋은 Vercel이 스킵.
- **로컬 `pnpm lint/build` 불가**: node v22 ↔ next의 comment-json 툴링 크래시(코드 무관). → `tsc --noEmit`(typecheck)은 정상, **Vercel 클린 빌드가 권위 검증**. 커밋·푸시 후 `gh api repos/papascompany/100p_books/commits/<sha>/status --jq .state` 로 success 확인.
- 커밋은 사용자가 요청할 때. 커밋 메시지 끝에 `Co-Authored-By: Claude ...`. zsh가 `[id]` 경로를 glob하니 git add 시 **경로를 따옴표로** 감쌀 것.
- **Supabase 마이그레이션은 MCP/CLI 불가**(MCP는 다른 계정 "storige's Org", 운영 DB `vprifnztvlduhpuwgdau`는 타 계정). → 사용자가 **대시보드 SQL Editor 수동 적용**.
- 운영 DB SQL 실행/검증이 필요하면 사용자에게 부탁(붙여넣기 좋게 정리해 제공).

## 즉시 처리해야 할 미결 항목 (우선순위)
1. **마이그레이션 2건 운영 DB 수동 적용 안내/확인**:
   - `supabase/migrations/0027_reviews_storage_rls.sql` (reviews 버킷 anon SELECT 차단)
   - `supabase/migrations/0028_concurrency_unique_indexes.sql` (gift/출석보너스 멱등 부분유니크 — 적용 전 중복 0건 확인, 파일 상단 점검쿼리)
   - 둘 다 **앱 코드는 이미 배포됨**. 인덱스 미적용 시 앱 레벨 체크는 동작하나 DB 원자 멱등은 미보장.
2. (보류 중, 사용자 "구현 시작" 시) **데모 모드**: 인증/RLS 무훼손 + `/login`에 "데모 둘러보기" 원클릭 버튼 + `POST /api/auth/demo-login`(전용 데모계정 서버 자동 로그인) + `DEMO_MODE` env 토글(off=버튼/라우트 차단). 운영자 준비물: 데모계정 생성 + `DEMO_EMAIL/DEMO_PASSWORD/DEMO_MODE`. 계정 생성·비번 입력은 어시스턴트가 직접 금지.

## 최근 완료 (배경, STATUS.md 최근작업 섹션 참고)
- Storige 인쇄 백엔드 일원화(PDF 저장/검증/다운로드 프록시/보존정책, 키 2종, presigned >90MB, 마이그 0026 적용완료).
- 100p PDF 최적화(JPEG q90 + 스트리밍 + confirm waitUntil).
- **전수감사 46건 전부 수정·배포 + 적대적 검증**(critical 4 e998870 / high 8 81323d7 / med·low 34 52e80a6 / 리뷰 fix-forward 296d02c). 보안 Critical/High 잔존 0.

## 작업 방식
- 다건/감사/리뷰는 **Workflow 서브에이전트 오케스트레이션**(파일별 disjoint 분할 → 병렬 → 적대적 검증). ultracode on.
- 결제/인증/RLS 등 민감 변경은 typecheck + 적대적 리뷰 + Vercel 빌드로 다층 검증 후 커밋.
- 먼저 STATUS.md(루트)와 이 문서를 읽고 현재 상태를 사용자에게 보고할 것.

첫 작업: 위 "즉시 처리 미결 1번(마이그레이션 0027/0028 적용 안내)"부터 사용자에게 확인받고 진행.
