# 100p_books — 포토북 제작 웹앱 개발 계획

## 1. 제품 개요

사용자가 최대 100장의 사진을 업로드하여 폴라로이드 스타일 또는 콜라주 레이아웃의 포토북을 만들고, Fabric.js 기반 에디터로 표지/내지를 편집한 뒤 인쇄용 PDF(300dpi, 2mm 재단선)를 생성·주문하는 웹 서비스.

## 2. 핵심 기능 요구

### 2.1 사용자 플로우
1. **사진 업로드** (최대 100장, 드래그&드롭 + 멀티 셀렉트)
2. **책 사이즈 선택** (A5 / 14.5×14.5cm / 20×20cm — 관리자 확장 가능)
3. **AI 자동 편집**
   - 정렬: EXIF 촬영시각 / 파일명 / 업로드 순 / 랜덤
   - 기본 레이아웃: 폴라로이드 (사진 상단 + 캡션 하단)
4. **내지 편집**
   - 단일 모드(1사진/페이지) → 자동 생성
   - 콜라주 모드 → 상세편집 진입 → 페이지당 다사진 배치
5. **표지 편집** (앞/뒤 + 제목)
6. **최종 컨펌** → 표지 PDF + 내지 PDF 생성 → 주문

### 2.2 레이아웃 시스템
| 모드 | 사진/페이지 | 편집 방식 |
|---|---|---|
| 폴라로이드(기본) | 1 | 자동 생성 |
| 콜라주 | 2~6 | 사용자가 추가 사진 선택 + 수동 배치 |

### 2.3 출력 사양
- **해상도**: 300dpi
- **재단선(bleed)**: 사방 2mm
- **파일**: 표지 PDF + 내지 PDF (분리)
- **최대 페이지**: 100p

### 2.4 관리자 기능
- 책 사이즈 CRUD (표지 사이즈 포함)
- 폰트 / 클립아트 / 배경이미지 업로드·배포
- 주문 내역 조회
- 송장 Excel 다운로드

## 3. 기술 스택

| 레이어 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | Next.js 14 (App Router) + TypeScript | SSR/API 단일화, 이미지 최적화 내장 |
| 스타일 | Tailwind CSS + shadcn/ui | 인스타 감성 디자인 시스템 빠르게 구축 |
| 에디터 | **Fabric.js 6.x** | 캔버스 조작·터치 제스처·직렬화 성숙 |
| 상태관리 | Zustand | 에디터 상태 공유에 가볍고 적합 |
| DB | Supabase (Postgres) | Auth + Storage + DB 일체형 |
| 파일저장 | Supabase Storage / S3 | 원본/고해상도 분리 보관 |
| PDF생성 | `pdf-lib` + `sharp` (서버) | 300dpi + bleed 정밀 제어 |
| EXIF | `exifr` | 촬영시각·회전정보 |
| Excel | `exceljs` | 송장 스타일링 |
| 결제 | TossPayments (토스페이먼츠 SDK) | 국내 최적 |
| 배포 | Vercel + Supabase | 관리 오버헤드 최소 |

## 4. 데이터 모델 (요약)

```
users            (id, email, role)
book_sizes       (id, name, width_mm, height_mm, cover_w_mm, cover_h_mm, spine_formula, active)
projects         (id, user_id, book_size_id, title, status, cover_json, created_at)
photos           (id, project_id, storage_key, exif_taken_at, filename, order_idx, width, height)
pages            (id, project_id, page_no, layout_mode, fabric_json, photo_ids[])
resources        (id, type[font|clipart|background], name, storage_key, active)
orders           (id, project_id, user_id, qty, address_json, status, cover_pdf_key, interior_pdf_key, paid_at)
```

## 5. 디렉토리 구조

```
100p_books/
├── .claude/
│   └── agents/               # 서브에이전트 정의
├── app/
│   ├── (user)/               # 일반 사용자 플로우
│   │   ├── upload/
│   │   ├── editor/[projectId]/
│   │   ├── cover/[projectId]/
│   │   └── order/[projectId]/
│   ├── admin/                # 관리자 콘솔
│   └── api/
│       ├── photos/
│       ├── pdf/
│       ├── orders/
│       └── admin/
├── components/
│   ├── editor/               # Fabric.js 래퍼
│   ├── layout/               # 폴라로이드/콜라주 템플릿
│   └── ui/                   # shadcn
├── lib/
│   ├── fabric/               # Fabric 헬퍼 (touch, snap, undo)
│   ├── pdf/                  # pdf-lib 파이프라인
│   ├── image/                # sharp, exif
│   └── db/                   # supabase 클라이언트
├── CLAUDE.md
├── PLAN.md (this)
└── ARCHITECTURE.md
```

## 6. 개발 단계 (Milestones)

### M0 — 부트스트랩 (1주)
- Next.js + Supabase + Tailwind + shadcn 세팅
- 인증 (Supabase Auth — 이메일/카카오)
- DB 스키마 + RLS 정책

### M1 — 이미지 파이프라인 (1주)
- 업로드 UI (drag/drop/multi-select, iOS Safari 포함)
- EXIF 파싱, 회전 보정, 썸네일/원본 분리 저장
- 정렬 로직 4종 (EXIF/파일명/업로드순/랜덤)

### M2 — 자동 편집 & 폴라로이드 레이아웃 (1.5주)
- 기본 폴라로이드 템플릿
- 100장 → 자동 페이지 생성
- 내지 프리뷰 (썸네일 그리드)

### M3 — Fabric.js 에디터 (2주) ⭐ 핵심
- 공통 캔버스 래퍼 (책 사이즈/DPI 인식)
- 터치 제스처 (pinch-zoom, rotate, multi-select)
- 콜라주 템플릿 프리셋 (2/3/4/6 분할)
- Undo/Redo, 스냅·그리드, 정렬 가이드
- 리소스 팔레트 (폰트/클립아트/배경)

### M4 — 표지 편집기 (1주)
- 앞/뒤/책등 통합 캔버스 (사이즈별 책등 자동 계산)
- 제목 텍스트 + 표지 사진 드래그 편집
- 템플릿 5종

### M5 — PDF 생성 (1.5주)
- 서버 Job: Fabric JSON → 300dpi PNG → PDF 병합
- 2mm bleed + crop mark
- 표지 PDF / 내지 PDF 분리 산출
- 대용량(100p) 진행률 스트림

### M6 — 주문 & 결제 (1주)
- 장바구니/수량/배송지
- TossPayments 연동
- 주문 상태 머신 (pending → paid → in_production → shipped)

### M7 — 관리자 콘솔 (1주)
- 책 사이즈 CRUD
- 리소스(폰트/클립아트/배경) 업로드
- 주문 리스트 + Excel 송장 다운로드 (CJ대한통운 포맷)

### M8 — QA & 폴리싱 (1주)
- 모바일 UX 튜닝 (iOS/Android)
- 접근성 (WCAG AA, 키보드 네비)
- 성능 (에디터 60fps, PDF <60s)
- 인스타그램 감성 UI 폴리싱 (여백·타이포·마이크로 인터랙션)

**총 예상: 10주**

## 7. 성능·품질 기준

| 항목 | 목표 |
|---|---|
| 에디터 프레임 | 60fps (모바일 Safari 포함) |
| 100p PDF 생성 | < 60s (서버) |
| LCP | < 2.5s |
| a11y | WCAG 2.1 AA |
| PDF 해상도 | 300dpi ± 0 |
| Bleed 정밀도 | ± 0.1mm |

## 8. 서브에이전트 운영 전략

**오토파일럿 원칙**:
- `orchestrator` 에이전트가 PLAN.md를 읽고 다음 마일스톤을 선택
- 각 마일스톤은 해당 도메인 에이전트(예: `fabric-editor`)에 위임
- 구현 완료 시 `qa-reviewer`가 자동 점검 → 통과 시 다음 단계
- 각 에이전트는 자신의 범위 외 파일은 수정 금지 (책임 분리)

**에이전트 목록**: `.claude/agents/` 참조
1. `orchestrator` — 마일스톤 조율
2. `frontend-ui` — 페이지·컴포넌트·인스타 감성 스타일링
3. `fabric-editor` — Fabric.js 에디터 (표지/내지/콜라주)
4. `layout-engine` — 자동 레이아웃·정렬 알고리즘
5. `pdf-generator` — 300dpi PDF 파이프라인
6. `image-pipeline` — 업로드·EXIF·썸네일
7. `admin-panel` — 관리자 CRUD·Excel
8. `backend-api` — API 라우트·DB·결제·인증
9. `qa-reviewer` — 코드리뷰·a11y·성능

## 9. 리스크 & 완화

| 리스크 | 완화책 |
|---|---|
| Fabric.js 모바일 제스처 충돌 | pointer events 통일, 자체 제스처 레이어 |
| 100장 일괄 업로드 메모리 | 청크 업로드 + 서버측 sharp 리사이즈 |
| PDF 300dpi 색상 차이 | sRGB→CMYK 변환 옵션(향후), 프린트 프로파일 캘리브 |
| 한글 폰트 라이선스 | 관리자 업로드 시 라이선스 메타 필수 |
| iOS HEIC 업로드 | 클라 `heic2any` → JPEG 변환 |

### M16 — 성장 기능 (2개월)
- **프로젝트 공유 링크**: 비로그인 조회 전용 공개 URL (`/share/[token]`)
- **선물하기**: 수신자 이메일 입력 → 완성된 포토북 직접 발송 플로우
- **할인 코드 시스템**: admin 발급, 유효기간/최대사용횟수/금액 or 비율 할인
- **친구 추천(referral)**: 추천 링크 생성, 추천인/피추천인 보상 적립
- **후기 갤러리**: 주문 완료 후 후기 작성(사진+텍스트), 좋아요 버튼, 공개 갤러리 페이지
- **출석체크**: 매일 출석 버튼, 매월 1일 00시 초기화(월별 이력), 누적 출석수 카운트 + 보상

DB 추가 테이블:
```
share_tokens     (id, project_id, token, expires_at, view_count)
gifts            (id, order_id, sender_id, recipient_email, message, status, claimed_at)
discount_codes   (id, code, type[percent|amount], value, max_uses, used_count, expires_at, active)
discount_uses    (id, code_id, user_id, order_id, used_at)
referrals        (id, referrer_id, referee_id, code, reward_status, created_at)
reviews          (id, order_id, user_id, rating, body, image_keys[], likes_count, created_at)
review_likes     (id, review_id, user_id)
attendances      (id, user_id, checked_at, month_key[YYYY-MM], total_count)
```

### M17 — 모바일 최적화 (1개월)
- **PWA**: `manifest.json` (앱 아이콘·테마색·standalone), Service Worker(오프라인 캐시), iOS Safari "홈 화면 추가" 가이드
- **카메라 직접 업로드**: `<input accept="image/*" capture="environment">` + 갤러리/카메라 선택 UI
- **모바일 한 손 조작 모드**: 에디터 도구바 하단 고정, 핀치 줌 전용 뷰포트, 대형 터치 타겟(44px+)

## 10. 다음 실행 액션

`orchestrator` 에이전트를 호출하여 M0부터 순차 실행하거나,
개별 에이전트를 직접 호출하여 병렬 개발 가능.

예:
```
Agent(subagent_type="backend-api",
  prompt="M0 Supabase 스키마 + RLS 정책을 구현하세요...")
```
