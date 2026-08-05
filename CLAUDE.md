# 프로젝트 규약 — 100p_books

## 프로젝트 개요
사진 최대 100장으로 포토북을 제작·주문하는 웹앱. Fabric.js 기반 표지/내지 에디터, 300dpi PDF 출력, 관리자 콘솔 포함.

자세한 사양은 [PLAN.md](PLAN.md), 기술 아키텍처는 [ARCHITECTURE.md](ARCHITECTURE.md) 참조.

## 기술 스택
Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Fabric.js 6 + Supabase + pdf-lib + sharp.

## 코드 규약
- 파일명: 컴포넌트 `PascalCase.tsx`, 그 외 `kebab-case.ts`
- 경로 별칭: `@/components`, `@/lib`, `@/app`
- 서버 전용 모듈은 `"server-only"` 임포트
- 이미지/PDF 생성은 **서버 API 라우트**에서만 처리 (클라에 노출 금지)
- 좌표·치수는 **mm** 단위 사용, 렌더 시점에 px 변환
- Fabric 객체 직렬화는 반드시 버전 필드 포함 (`version: "1"`)

## 커밋
- Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- 스코프 권장: `feat(editor):`, `fix(pdf):`, `chore(admin):`

## 서브에이전트
`.claude/agents/` 참조. 오토파일럿 시 `orchestrator` 먼저 호출.
각 에이전트는 정의된 범위 외 파일 수정 금지.

## 테스트
| 대상 | 명령 | 비고 |
|---|---|---|
| 유닛 | `pnpm test` | Vitest |
| E2E 스모크 | `pnpm e2e` | Playwright, desktop + mobile 390px |
| 접근성 | `pnpm test:a11y` | axe-core WCAG 2.1 AA, 공개 라우트 + 다크 모드 |
| PDF 회귀 | `pnpm test:pdf` | 페이지 수·페이지 크기 + 첫 페이지 SHA-256 |
| 타입·린트·빌드 | `pnpm typecheck && pnpm lint && pnpm build` | |

- PDF 회귀 baseline: `test/fixtures/pdf-baseline.json`. 구조(페이지 수·크기)는 플랫폼 무관하게
  엄격 비교하고, 픽셀 해시는 `${platform}-${arch}` 키별로 비교한다(래스터라이저·폰트 폴백이 OS마다 다름).
  렌더 변경이 **의도된** 경우에만 `pnpm test:pdf:update` 로 갱신하고 diff 를 리뷰에 포함한다.
- 위 전부는 `.github/workflows/ci.yml` 에서 push/PR 마다 자동 실행된다.

## 금지 사항
- `.env`, 서비스 키 커밋 금지
- 클라이언트에서 Supabase `service_role` 키 사용 금지
- Fabric.js를 서버에서 직접 import 금지 (node-canvas 래퍼 사용)
