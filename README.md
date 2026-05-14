# 100p_books — 100페이지 포토북 제작 웹앱

> 사진 최대 100장으로 나만의 포토북을 만들고, 인쇄용 PDF로 주문하는 모바일 친화 웹앱.
> Fabric.js 기반의 캔바 수준 표지·내지 에디터, 300dpi 고해상도 출력, 관리자 콘솔 포함.

[![Built with Next.js 14](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB%20%2B%20Storage-3FCF8E?logo=supabase)](https://supabase.com/)
[![Fabric.js 6](https://img.shields.io/badge/Fabric.js-6.x-FE6E3A)](http://fabricjs.com/)
[![License](https://img.shields.io/badge/license-Private-lightgrey)](#)

---

## ✨ 핵심 기능

### 사용자 플로우
1. **사진 업로드** — 드래그&드롭 / 멀티 셀렉트, iOS HEIC 자동 변환, 동시 6 청크 업로드, 최대 100장
2. **자동 편집** — 4가지 정렬(EXIF 촬영시각 / 파일명 / 업로드순 / 랜덤) × 2가지 레이아웃(폴라로이드 / 콜라주 6종)
3. **상세 편집** — Fabric.js 6 기반 모바일 친화 에디터 (핀치 줌, 회전, 스냅 가이드, Undo/Redo 50스텝)
4. **표지 편집** — 앞표지 + 책등 + 뒤표지 펼친 캔버스, 5종 템플릿, 책등 두께 자동 계산
5. **주문 + 결제** — 토스페이먼츠 통합, 멱등 confirm, amount 3중 검증
6. **PDF 다운로드** — 300dpi · 사방 2mm 재단선(bleed) · 표지/내지 분리 PDF, SSE 진행률

### 관리자 콘솔 (`/admin`)
- 책 사이즈 CRUD (A5 / 14.5×14.5 / 20×20 + 자유 추가)
- 폰트 / 클립아트 / 배경 리소스 업로드 (라이선스 메타 포함)
- 주문 리스트, 상태 머신 전이, 송장 번호 등록
- 송장 Excel 다운로드 (CJ대한통운 호환 컬럼)
- 주문별 PDF 재생성, 사용자 role 관리

---

## 🏗 기술 스택

| 레이어 | 선택 |
|---|---|
| 프레임워크 | **Next.js 14 (App Router)** + TypeScript 5.5 |
| 스타일 | **Tailwind CSS** + shadcn/ui + Pretendard / Playfair Display |
| 상태 | Zustand |
| 에디터 | **Fabric.js 6.x** (직렬화·제스처·히스토리·스냅·폰트 동적 로드) |
| DB / Auth / Storage | **Supabase** (Postgres + RLS + Storage 4 버킷) |
| 결제 | **TossPayments** SDK |
| PDF | **`@napi-rs/canvas` + `pdf-lib` + `@pdf-lib/fontkit`** (자체 렌더러, Fabric 서버 의존 X) |
| 이미지 | sharp (서버) + heic2any/exifr (클라) |
| 송장 | exceljs |
| 이메일 | Resend SDK |
| 테스트 | Vitest 2 + jsdom (유닛) · **Playwright 1.60** (E2E desktop+mobile) |
| 배포 | Vercel + Supabase |

---

## 📁 디렉토리 구조

```
100p_books/
├── .claude/agents/          # 9종 도메인 서브에이전트 (오토파일럿)
├── app/
│   ├── (auth)/login/        # 매직링크 로그인
│   ├── (user)/
│   │   ├── upload/          # M1 사진 업로드
│   │   ├── editor/[projectId]/
│   │   │   ├── pages/[pageId]/  # M3 단일 페이지 편집
│   │   │   └── ...          # M2 자동 편집 + 프리뷰
│   │   ├── cover/[projectId]/   # M4 표지 편집
│   │   ├── order/[projectId]/   # M6 주문/결제
│   │   └── mypage/orders/   # 주문 내역
│   ├── admin/               # M7 관리자 콘솔
│   └── api/                 # 28개 라우트
├── components/
│   ├── editor/              # FabricStage, Toolbar, SelectionPanel, ResourcePalette, …
│   ├── admin/               # StatCard, DataTable, StatusBadge, UploadDropzone
│   ├── layout/              # Header, Footer, MobileBottomSheet
│   └── ui/                  # shadcn primitives (button, input, card)
├── lib/
│   ├── auth/session.ts      # requireUser / requireAdmin
│   ├── db/                  # Supabase 클라이언트 (server/browser/admin)
│   ├── image/               # HEIC 변환, EXIF, 업로드 큐
│   ├── layout/              # PageDoc 스키마, 정렬, 폴라로이드/콜라주/표지 빌더
│   ├── fabric/              # 직렬화, 제스처, 히스토리, 스냅, URL 갱신
│   ├── pdf/                 # 렌더러, 빌더, crop mark, text-wrap
│   ├── orders/              # 가격/상태 머신
│   ├── payments/            # 토스 confirm/조회
│   └── admin/               # excel 송장 빌더
├── supabase/migrations/     # 24개 SQL (스키마 + RLS + 시드 + Storage + RPC + tracking + ledger + dashboard counts)
├── e2e/                     # Playwright E2E (smoke.spec.ts 외)
├── scripts/                 # gen-icons / verify-pdf / server-only stub
├── tests/mocks/             # vitest 환경 alias (server-only stub)
├── PLAN.md                  # 마일스톤·일정
├── ARCHITECTURE.md          # DPI·좌표계·PDF 파이프라인
├── PROGRESS.md              # 진행 상황·이벤트 로그
├── STATUS.md                # 현재 상태 + 다음 우선순위
├── SECURITY.md              # 보안 패치 이력 + 잔존 CVE
└── QA_REPORT.md             # 정적 QA 리포트 (M0~M7)
```

---

## 🔑 데이터 모델

| 테이블 | 핵심 컬럼 |
|---|---|
| `profiles` | id, email, role |
| `book_sizes` | name, width_mm, height_mm, cover_w/h_mm, spine_formula_per_page, active |
| `projects` | user_id, book_size_id, title, status, **cover_json**, layout_mode |
| `photos` | project_id, storage_key, thumb_key, exif_taken_at, order_idx, width, height |
| `pages` | project_id, page_no, layout_mode, **fabric_json** (PageDoc) |
| `resources` | type[font/clipart/background], name, storage_key, meta, active |
| `orders` | project_id, user_id, qty, amount, address, status, toss_payment_key, cover_pdf_key, interior_pdf_key, tracking_no, tracking_carrier |

**RLS**: 사용자 라우트는 `auth.uid()` 기반, admin 라우트는 `is_admin()` 헬퍼로 보호. orders 쓰기는 service_role만.

**Storage 버킷**: `photo-originals`(private) / `photo-thumbs`(private) / `pdfs`(private) / `resources`(인증 사용자 SELECT)

---

## 📐 PageDoc 스키마 (정본)

`lib/layout/types.ts` 기반의 중립 스키마. Fabric.js와 서버 PDF 렌더러 양쪽이 동일 스키마를 다룹니다.

```ts
interface PageDoc {
  version: "1";
  bookSizeId: string;
  pageNo: number;
  layoutMode: "polaroid" | "collage" | "cover";
  widthMm: number;
  heightMm: number;
  bleedMm: 2;
  backgroundColor: string;
  backgroundImage?: { photoId?: string; url?: string; cropMode: "cover" | "contain"; opacity: number };
  objects: Array<PhotoObject | TextObject | RectObject>;
}
```

- 좌표 단위: **mm** (trim 좌상단 원점)
- 폰트: **pt**
- bleed 2mm는 trim 바깥. PDF는 trim + bleed 전체 영역을 렌더하고 4모서리에 crop mark.
- 클라(Fabric) ↔ 서버(`@napi-rs/canvas`) 양방향: `lib/fabric/serialize.ts`

---

## 🖨 PDF 파이프라인

```
1. POST /api/pdf/build  { projectId, target: "cover"|"interior"|"all" }
   → 소유권 검증 + pages/cover_json 로드
2. lib/pdf/render-page.ts (자체 PNG 렌더러)
   → mm→px(300dpi), bleed 적용, photo/text/rect 그리기, sharp orientation 정규화
3. lib/pdf/build.ts
   → pdf-lib 로 PNG 합성, crop mark 8개(+ 표지 책등 마크), 폰트 임베딩
4. Storage 업로드: pdfs/{userId}/{projectId|orderId}/{cover,interior}.pdf
5. 응답: signed URL (1시간)

진행률: GET /api/pdf/progress?jobId=  (SSE)
```

성능 목표: **100p PDF < 60s** (Active CPU)

---

## 🤖 서브에이전트 (오토파일럿 개발)

`.claude/agents/` 에 9종 도메인 에이전트 정의. 각 마일스톤은 담당 에이전트에 위임:

| 에이전트 | 담당 |
|---|---|
| `orchestrator` | 마스터 조율 (PLAN → 위임 → QA) |
| `frontend-ui` | 인스타 감성 페이지·컴포넌트 |
| `fabric-editor` | Fabric.js 캔버스 / 직렬화 / 제스처 |
| `layout-engine` | 자동 편집 / 정렬 / 콜라주 |
| `pdf-generator` | 300dpi PDF 파이프라인 |
| `image-pipeline` | 업로드 / EXIF / HEIC |
| `admin-panel` | 관리자 CRUD / Excel |
| `backend-api` | API / DB / RLS / 결제 |
| `qa-reviewer` | 코드 리뷰 / a11y / 성능 |

---

## 🚀 로컬 실행 가이드

### 1. 의존성 설치
```bash
pnpm install
```
필수: Node.js ≥ 20 (현재 25 LTS 권장), pnpm ≥ 9

### 2. 환경변수
```bash
cp .env.example .env.local
```
`.env.local` 편집 — Supabase URL/키, 토스페이먼츠 테스트 키 입력.

### 3. Supabase 연동
```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push                  # 마이그레이션 9종 일괄 적용
```

### 4. 첫 admin 계정 만들기
가입 후 Supabase SQL Editor에서:
```sql
update public.profiles set role = 'admin' where email = '<your-email>';
```

### 5. 개발 서버
```bash
pnpm dev          # → http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
pnpm test         # vitest
pnpm build        # production 빌드
```

---

## 📊 빌드/품질 현황

| 검증 | 결과 |
|---|---|
| `pnpm typecheck` | ✅ 에러 0건 |
| `pnpm test` | ✅ 15 파일 / 153 통과 / 1 skip |
| `pnpm build` | ✅ 31 라우트 (정적 7 · 동적 24) production 성공 |
| `pnpm verify:pdf` | ✅ 2 페이지 (text+rect / photo+borderRadius+shadow) · 67KB / 834ms · PDF 1.7 |
| `pnpm e2e` (chromium desktop+mobile) | ✅ 12/12 통과 (5.7s) |
| Lighthouse 모바일 (운영) | ✅ Performance 97 · LCP 1.5s · CLS 0 |

상세: [STATUS.md](STATUS.md) · [QA_REPORT.md](QA_REPORT.md)

---

## 🗺 마일스톤

| ID | 이름 | 상태 |
|---|---|---|
| M0 | Next + Supabase + Tailwind + shadcn 부트스트랩 | ✅ |
| M1 | 사진 업로드 파이프라인 (HEIC, EXIF, 100장) | ✅ |
| M2 | 자동 편집 / 폴라로이드 / 콜라주 6종 | ✅ |
| M3 | Fabric.js v6 에디터 (캔바 수준 모바일 UX) | ✅ |
| M4 | 표지 에디터 (5템플릿 + 책등 자동) | ✅ |
| M5 | 300dpi PDF 파이프라인 (bleed + crop mark) | ✅ |
| M6 | 토스 결제 + 주문 + PDF 빌드 잡 | ✅ |
| M7 | 관리자 콘솔 + 송장 Excel | ✅ |
| M8 | 정적 QA · 폴리싱 | ✅ |
| M9 | UX 보강 (Toast / 다크모드 / 우편번호 SDK) | ✅ |
| M10 | 법규 준수 + Vercel 배포 준비 | ✅ |
| M11 | 클립아트 영속화 + PDF 재시도 큐 + 감사 로그 | ✅ |
| M12 | 편집기 UX 보강 (reorder / 추가삭제 / 복붙 / 단축키) | ✅ |
| M15 | 페이지 미리보기 + 이메일 인프라 (큐 / 템플릿 / 워커) | ✅ |
| M16 | 성장 기능 (공유 / 선물 / 할인 / 추천 / 후기 / 출석 / 포인트 / 카카오 OAuth) | ✅ |
| M17 | 모바일 PWA (manifest / SW / 카메라 직접 업로드) | ✅ |
| M8-보강 | PDF 런타임 검증 / E2E Playwright / Lighthouse | ✅ (2026-05-13) |
| M5-패치 | PDF borderRadius + shadow 2-pass 분리 | ✅ (2026-05-13) |
| M-홈리뉴얼 | §3 특징 / §4 사이즈 카드 사진 배경 + fade-up 진입 | ✅ (2026-05-14) |
| M-내비최적화 | staleTimes / loading 8개 / 단일 RPC / SW SWR / legal 정적 | ✅ (2026-05-14) |

상세: [PLAN.md](PLAN.md) · [PROGRESS.md](PROGRESS.md) · [STATUS.md](STATUS.md)

---

## 🚢 Vercel 운영 배포 가이드

### 1. Vercel 프로젝트 연결
```bash
vercel login
vercel link        # 또는 GitHub 연동으로 자동 import
```

### 2. 환경변수 등록
[`.env.production.example`](.env.production.example) 의 키를 Vercel 대시보드에 입력하거나 CLI로 일괄 등록:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add TOSS_SECRET_KEY production
vercel env add NEXT_PUBLIC_TOSS_CLIENT_KEY production
vercel env add TOSS_WEBHOOK_SECRET production
vercel env add NEXT_PUBLIC_APP_URL production
```

### 3. Supabase 운영 프로젝트
1. https://supabase.com/dashboard/projects 에서 프로젝트 생성 (Region: Northeast Asia · Seoul)
2. `supabase link --project-ref <prod-ref>`
3. `supabase db push` — `0001~0010` 마이그레이션 일괄 적용
4. Auth → Providers → Kakao 활성화 후 client id/secret 입력 (선택)
5. SQL Editor 에서 첫 admin 승격:
   ```sql
   update public.profiles set role = 'admin' where email = '<your-email>';
   ```

### 4. TossPayments 운영 키
1. https://app.tosspayments.com/ 가입 후 사업자 심사 통과
2. 라이브 키(`live_sk_...`, `live_ck_...`) 발급
3. 웹훅 등록: `https://<도메인>/api/payments/webhook`
   - `X-Webhook-Secret` 헤더에 `TOSS_WEBHOOK_SECRET` 과 동일 값 등록

### 5. 카카오 OAuth (선택)
1. https://developers.kakao.com/ 에서 앱 생성
2. Redirect URI: `https://<프로젝트-ref>.supabase.co/auth/v1/callback`
3. Supabase Auth Providers → Kakao 에 client id/secret 입력
4. `app/(auth)/login/LoginForm.tsx` 의 카카오 버튼 주석 해제

### 6. 배포
- GitHub 연동: `main` 푸시 시 자동 배포
- 수동: `vercel --prod`
- 함수 런타임: `vercel.json` 의 `functions` 섹션이 PDF 빌드 / 결제 confirm 라우트에 `maxDuration=300`, `memory=1769MB` 적용 (Pro plan 필요)
  > Vercel Knowledge Updates(2026-02-27) 기준 `vercel.ts`(@vercel/config) 도 권장됩니다. 이 저장소는 호환성을 위해 `vercel.json` 으로 시작합니다.

### 7. 도메인 연결 / 헬스체크
- Vercel Domains 에서 사용자 도메인을 추가하고 `NEXT_PUBLIC_APP_URL` 갱신
- 헬스체크: `GET /api/health` — `{ ok, db, env }` 반환. 실패 시 503

### 8. 배포 후 모니터링
- Vercel Analytics / BotID
- PDF 워커 메모리 — Vercel Functions Insights → Active CPU
- 후속: Sentry, Plausible/GA4, Datadog 등 검토

---

## 🔒 법적 페이지 / 회원 탈퇴

| 경로 | 설명 |
|---|---|
| `/terms` | 서비스 이용약관 (전자상거래법 청약철회 예외 명시) |
| `/privacy` | 개인정보 처리방침 (수집·위탁·보유기간·권리 행사) |
| `/refund` | 교환·환불 정책 (제작 시작 전 100% 환불, 이후 불량/사고만 교환) |
| `/mypage/account` | 계정 관리 + 회원 탈퇴 (이메일 재입력 + 익명화 RPC) |

회원 탈퇴 시 `profiles` 는 hard delete 하지 않고 `anonymize_account()` RPC 로 익명화하며, `auth.users` 는 service_role admin client 로 삭제합니다 (전자상거래법 5년 보존 의무 준수).

---

## 🧰 오토파일럿으로 추가 개발하기

```bash
# 1) 기능 단위 위임 — orchestrator 가 PROGRESS.md 의 다음 마일스톤을 식별
Agent(subagent_type="orchestrator",
      prompt="PROGRESS.md 의 미완료 마일스톤을 담당 에이전트에 위임하세요.")

# 2) 도메인 한정 작업 — 직접 위임
Agent(subagent_type="frontend-ui",  prompt="...")
Agent(subagent_type="backend-api",  prompt="...")
Agent(subagent_type="pdf-generator", prompt="...")
```

`.claude/agents/*.md` 의 범위 명세를 준수해야 안전합니다.

---

## 🛡 보안 원칙

- `service_role` / `TOSS_SECRET_KEY` 는 `lib/db/admin.ts` / `lib/payments/toss.ts` 에서만 사용 (`server-only` + 런타임 가드)
- 모든 사용자 API 라우트: `requireUser()` + 소유권 검증 (RLS 1차 + 라우트 2차)
- 관리자 API: 미들웨어 + `requireAdmin()` 이중 보호
- GPS EXIF 절대 저장 금지 (클라+서버 `gps:false` + pick 화이트리스트)
- 결제 amount: 클라 입력 신뢰 X, 서버 재계산 + 토스 응답 amount 이중 검증
- Storage RLS: `{userId}/...` 폴더 스코프

---

## 📜 라이선스 / 저작권

© 2026 papascompany — Private. 외부 배포 전 라이선스 명시 필요.

서드파티 폰트 / 클립아트 / 배경 등 리소스는 관리자 등록 시 라이선스 메타 정보 필수.

---

## 📞 개발 컨텍스트

- 사양: [PLAN.md](PLAN.md)
- 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md)
- 진행 로그: [PROGRESS.md](PROGRESS.md)
- QA 리포트: [QA_REPORT.md](QA_REPORT.md)
- 프로젝트 규약: [CLAUDE.md](CLAUDE.md)

오토파일럿으로 M0~M17 마일스톤을 순차 위임·검수·패치한 결과물입니다. (M8 측정 보강 2026-05-13)
