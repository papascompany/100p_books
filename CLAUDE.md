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
- 유닛: Vitest
- E2E (편집/주문 플로우): Playwright (모바일 viewport 포함)
- PDF 회귀: 생성된 PDF 페이지 수 + 첫 페이지 해시 비교

## 금지 사항
- `.env`, 서비스 키 커밋 금지
- 클라이언트에서 Supabase `service_role` 키 사용 금지
- Fabric.js를 서버에서 직접 import 금지 (node-canvas 래퍼 사용)
