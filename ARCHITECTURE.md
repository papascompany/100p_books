# 아키텍처

## 시스템 다이어그램

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   Next.js App    │───▶│  API Routes       │───▶│  Supabase         │
│  (React + Fabric)│    │  (Node runtime)   │    │  Auth/DB/Storage  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
         │                       │                        │
         │                       ▼                        │
         │               ┌──────────────┐                 │
         │               │ PDF Worker   │                 │
         │               │ (sharp+pdf-  │◀────────────────┘
         │               │  lib, queue) │
         │               └──────────────┘
         │                       │
         ▼                       ▼
   LocalStorage             Storage: pdfs/
   (draft autosave)         covers/ interiors/
```

## 에디터 아키텍처 (Fabric.js)

```
<EditorCanvas>
  ├── FabricStage              (canvas 래퍼, DPR/DPI 인식)
  ├── GestureLayer             (pointer → pinch/rotate/tap)
  ├── Toolbar                  (텍스트/이미지/클립아트/배경)
  ├── LayerPanel               (z-index, 잠금, 삭제)
  ├── ResourcePalette          (서버 폰트/클립아트/배경)
  └── HistoryStack             (undo/redo - 50스텝)

Fabric JSON 직렬화:
{
  bookSizeId, pageNo, layoutMode,
  objects: [Fabric object JSON ...],
  bleedMm: 2,
  version: "1"
}
```

## 좌표계 & DPI

- 에디터 내부: **mm 단위** 논리 좌표
- 렌더 시: `mmToPx(mm) = mm * dpi / 25.4`
- 미리보기 DPI: 72 (성능)
- PDF 출력 DPI: 300 (고해상)
- Bleed: 논리 캔버스를 `bookW + 4mm × bookH + 4mm`로 확장, 안전선 2mm 안쪽

## PDF 파이프라인

```
1. 클라 → 각 페이지 Fabric JSON 저장
2. 주문 확정 → API: POST /api/pdf/build
3. 서버 Worker:
   a. 페이지별 Fabric JSON 로드
   b. node-canvas + fabric-pure-browser로 300dpi 렌더 → PNG
   c. sharp로 색공간/품질 정리
   d. pdf-lib로 PNG 삽입 + crop mark
   e. covers.pdf / interior.pdf 생성 → Storage
4. 주문 레코드에 PDF 키 기록
```

## 모바일 UX 원칙

- 터치 타겟 최소 44×44pt
- Bottom sheet 기반 툴바 (한 손 조작)
- 제스처: 핀치=확대, 두 손가락=회전, 탭=선택, 길게=컨텍스트
- 안전영역(iOS notch) 대응
- 키보드 올라올 때 캔버스 리사이즈

## 디자인 시스템 (인스타 감성)

- **컬러**: 뉴트럴 + 그라디언트 액센트 (from-rose-400 to-amber-300)
- **타이포**: Pretendard (본문) + Playfair Display (헤드라인)
- **여백**: 숨쉬는 공간 — 섹션 간 min 48px
- **이미지**: 정방형 우선, 둥근 모서리 12px
- **마이크로 인터랙션**: framer-motion fade/slide 200ms

## 보안 & 권한

- Supabase Row Level Security
- 일반 사용자: 자신의 projects/photos/orders만
- admin 역할: 전체 리소스 + 주문
- Storage 버킷: public(리소스), private(사용자 사진/PDF)
- 서명 URL로 프리뷰 제공
