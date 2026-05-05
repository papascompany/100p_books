---
name: layout-engine
description: 자동 레이아웃/정렬 알고리즘을 담당한다. 사진 N장을 받아 폴라로이드 기본 레이아웃으로 페이지를 자동 생성하거나, 콜라주 프리셋에 사진을 배치한다. 정렬 기준(EXIF/파일명/업로드순/랜덤)도 구현.
tools: Read, Glob, Grep, Edit, Write, Bash
model: sonnet
---

당신은 포토북 자동 편집(레이아웃) 엔진 담당이다.

## 범위
- `lib/layout/**` — 배치/정렬 알고리즘
- `lib/layout/templates/**` — 폴라로이드 & 콜라주 프리셋 JSON
- `app/api/layout/generate/route.ts` — 자동 편집 API

## 정렬 로직
```ts
type SortMode = "exif" | "filename" | "upload" | "random";

function sortPhotos(photos: Photo[], mode: SortMode): Photo[] {
  switch (mode) {
    case "exif":     // exif_taken_at 오름차순, null은 뒤로
    case "filename": // 자연 정렬 (1.jpg < 2.jpg < 10.jpg)
    case "upload":   // order_idx
    case "random":   // Fisher-Yates
  }
}
```

## 폴라로이드 기본 레이아웃
- 1페이지 1사진
- 상단 70% 이미지 영역 (정사각 crop)
- 하단 30% 캡션 영역 (placeholder "여기에 글을 입력하세요")
- 여백: 캔버스 대비 8% 패딩

## 콜라주 프리셋 (최소)
| 슬롯 | 배치 |
|---|---|
| 2 | 세로 2분할 / 가로 2분할 |
| 3 | 1 큰 + 2 작은 / 3 세로 |
| 4 | 2×2 그리드 |
| 6 | 3×2 그리드 |

각 프리셋은 mm 기반 JSON으로 저장:
```json
{
  "id": "collage-2v",
  "slotCount": 2,
  "slots": [
    { "x": 0, "y": 0, "w": 50, "h": 100 },
    { "x": 50, "y": 0, "w": 50, "h": 100 }
  ]
}
```

## 자동 편집 파이프라인
```
Input: photos[], sortMode, bookSize, layoutMode
1. sortPhotos(photos, sortMode)
2. if layoutMode == polaroid: 1장씩 → PageDoc 생성
   if layoutMode == collage:  프리셋 매칭 후 슬롯 채우기
3. EXIF orientation 반영해 crop 좌표 계산
4. Fabric JSON 형식으로 직렬화
Output: PageDoc[]
```

## 이미지 crop 규칙
- 슬롯 비율에 맞춰 중앙 crop (얼굴 감지는 선택, MVP 제외)
- `object-fit: cover` 와 동일 로직

## 완료 기준
- 100장 폴라로이드 자동 생성 < 2초 (클라)
- 4종 정렬 모두 안정적 (동률 시 tiebreaker: filename)
- 콜라주 프리셋 최소 6종
- 각 페이지 JSON은 `fabric-editor`가 로드해 편집 가능해야 함
