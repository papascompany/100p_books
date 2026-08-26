# [100p_books → Storige] 연동 현황 통지 — 사용 경로 · 의존 계약 · 요청 사항

> 발신: 100p_books (2026-08-24). 2026-07-21 자 통지(미전달)를 함께 담은 **통합본**입니다.
> 근거: `lib/storige/client.ts` 실코드 전수 + 레포 전체 grep · Storige 실코드 대조 조사(2026-07-21)
> **용도**: Storige 세션에 그대로 붙여넣는 통지문. 이 한 장이면 됩니다.

## 0. 요약

- 2026-08-24 자 "연동 변경 안내"(세션 API 테넌트 격리 확장 · `editor.saved` 의 `EDITOR_BUSY`)
  잘 받았습니다. **저희 무영향을 코드로 확인했고 조치할 것은 없었습니다.**
- 다만 그 통지문에 저희 사용 경로로 `/edit-sessions/external` 이 포함돼 있었는데 **저희는 그
  경로를 쓰지 않습니다.** 통지 대상 판정이 어긋날 수 있어(불필요한 통지 / 정작 필요한 통지
  누락) §1 에 실제 목록을 드립니다. 그게 전부이며 이보다 넓지 않습니다.
- §3 은 **변경 시 사전 통지가 필요한 응답 계약**입니다. 경로만으로는 안 잡히는 것들입니다.
- §4 는 2026-07-21 에 드리려던 계약 동결 요청입니다(전달이 늦었습니다). **한 달 전 조사
  기준이니 이미 반영되었다면 그 항목은 넘어가 주세요.**

---

## 1. 저희가 호출하는 Storige 경로 — 전체 (API 7개 + R2 직결 1개)

base `https://api.papascompany.co.kr/api` · 편집기 키 = `STORIGE_API_KEY`,
워커 키 = `STORIGE_WORKER_API_KEY` (둘 다 서버 전용, 브라우저 비노출)

| # | 메서드 · 경로 | 인증 | 호출 시점 |
|---|---|---|---|
| 1 | `POST /files/upload/external` (multipart) | 편집기 키 | PDF **≤90MB** 업로드 |
| 2 | `POST /files/presigned-upload-public` | **`@Public`(키 없음)** | PDF **>90MB** — presign 1단계 |
| 3 | `PUT <uploadUrl>` | — (**Storige API 미경유**, R2 직결) | presign 2단계 |
| 4 | `POST /files/{fileId}/complete` | 편집기 키 | presign 3단계 |
| 5 | `GET /files/{fileId}/download/external` | 편집기 키 | 주문 PDF 다운로드(항상 서버 프록시) |
| 6 | `DELETE /files/{fileId}/external` | 편집기 키 | 업로드 실패 정리 · 보존정책 만료 |
| 7 | `POST /worker-jobs/validate/external` | 워커 키 | 결제 후 인쇄 검증 요청 |
| 8 | `GET /worker-jobs/external/{jobId}` | 워커 키 | 검증 결과 폴링 |

90MB 임계는 저희 쪽 상수입니다(multer 100MB 캡 아래 마진). 100p 사진북 PDF 는 ~100MB 를
넘길 수 있어 실사용에서 presign 경로가 주 경로입니다.

## 2. 저희가 쓰지 **않는** 것 (레포 전체 grep 0건)

`edit-sessions` 계열 전부(`/external` 포함) · shop-session JWT · `siteId` 를 실은 요청 ·
임베드 편집기 `/embed` · 역명령 `editor.saved` / `EDITOR_BUSY`.

저희는 유형 1(자체 편집기 + PDF 저장·검증 오프로드)이고 편집 세션은 100% 자체 DB(PageDoc)에
있습니다. 도입 계획도 현재 없습니다 — 도입하게 되면 먼저 알려드리겠습니다.

## 3. 변경 시 **사전 통지**를 부탁드리는 계약

경로·메서드·인증뿐 아니라 아래 **응답 shape·문자열**에 직접 의존합니다.

1. **presign 응답 3키** — `{ fileId, uploadUrl, uploadToken }`. 하나라도 없으면 업로드를
   실패 처리합니다(부분 업로드가 주문에 커밋되는 것 방지).
2. **`complete` 응답 최상위 `id`** — 2xx 인데 `id` 가 없으면 presign `fileId` 로 조용히
   대체하지 않고 실패시킨 뒤 해당 파일을 DELETE 합니다.
3. **`503` 본문의 `STORIGE_NOT_S3` 문자열** — driver=local 판정에 **문자열 매칭**을 씁니다.
   이 코드값이 바뀌면 폴백이 끊겨 >90MB 업로드가 실패합니다.
4. **검증 result 키셋** — `{ isValid, errors, warnings, metadata }`. (§4-b 와 같은 표면입니다.)
5. **검증 파라미터 관행**(2026-07 확정분, 유지 여부 확인 요망) — 내지
   `orderOptions.pageMultiple: 2` 전송 / 표지는 `size` 에 **통판 스프레드(블리드 제외)** 를
   넣고 `spineWidthMm` **미전송**.
6. ⚠️ **`uploadUrl` 호스트** — SSRF 방어로 `r2.cloudflarestorage.com` · `amazonaws.com`
   suffix 화이트리스트를 강제합니다. **스토리지 백엔드를 다른 호스트로 옮기시면 저희 업로드가
   전면 차단됩니다.** 이 변경만은 반드시 사전 통지 부탁드립니다(저희는 env 로 즉시 확장 가능).

## 4. 계약 동결 그물 보강 요청 — 2026-07-21 조사 기준

> 한 달 전 Storige 실코드 대조(4-에이전트 조사 + 적대검증) 결과입니다.
> **그 사이 반영되었다면 해당 항목은 넘어가 주세요.**

**(a) `POST /worker-jobs/validate/external` 을 FROZEN_ROUTES 에 등재.**
실 라우트는 존재(`worker-jobs.controller.ts:62`)하나 `contract-freeze.spec.ts` 의
FROZEN_ROUTES 에 없어, 경로·메서드·인증이 바뀌어도 CI 가 red 가 되지 않습니다. 100p 의
필수 소비자입니다(결제 후 전 PDF 빌드가 호출). 폴링 `GET /worker-jobs/external/:id` 는
등재되어 있습니다(:67 ✓). 같은 사각지대인 `synthesize/external` ·
`fix-pagecount/external` · `PATCH external/:id/status` 도 함께 검토 권장드립니다.

**(b) 검증 result 키셋 골든 spec 신설.**
`{ isValid, errors, warnings, metadata }` 는 CONTRACT_FREEZE §1-B(:45) FROZEN 선언과
§2(:98) 골든 대상 명시에도 **실제 고정 spec 이 없습니다.**
`pdf-validator.service.spec.ts` / `validation.processor.spec.ts` 는 워커 내부 유닛(HTTP
계약이 아님), `worker-jobs.e2e-spec.ts` 는 Test 목 컨트롤러입니다. 키 이름 리팩터링 하나에
100p·bookmoa·MD2 의 파싱이 조용히 깨지는 표면입니다.

**(c) (선택·장기) 표지 검증 계약의 구조적 긴장 정리.**
`validatePageSize` 에 cover 예외가 없어(:834-906) 통판 표지는 `size`=판형이면
SIZE_MISMATCH 로 필패하고, `size`=스프레드면 `validateSpine` 공식(`size.width×2+spine`,
:1167)과 충돌합니다 — **두 검증을 동시에 통과시키는 size 가 존재하지 않습니다.** bookmoa
실측 "FIXABLE 70% · SIZE 단독 50건"의 구조적 원인으로 추정합니다. cover 전용 size 시맨틱
(예: `coverSpreadSize` ADDITIVE 신설, 또는 cover 시 validatePageSize 를 spine 검증으로 대체)
정리 시 전 파트너의 오탐이 줄어듭니다. 리포트 C안(배선 기반 게이팅)과 묶어 검토 권장드립니다.

## 5. 100p 측 현황 (Storige 작업 불필요 — 참고용)

**대응 완료**
- **검증 result 파싱 정본 정렬**: `result.issues`(부재 키) → `errors` + `isValid` 로 교정
  배포(100p `7c0f5d3`). → CONTRACT_FREEZE.md §1-B :45 의 "100p=issues 매핑 어댑터 필요 여부
  [미확인]" 메모는 **어댑터 불필요**로 확정 가능합니다.
- **DD 페이지규칙 전송 시작**: 내지 검증에 `orderOptions.pageMultiple: 2` 전송(100p `4b89aa2`).
  이제 레거시 폴백(perfect=4배수)이 아닌 DD 경로입니다 → DD 계약(`worker-job.dto.ts:67`)
  시맨틱 변경 시 100p 가 즉시 영향받습니다.
- **표지 검증 관행 확정**: `orderOptions.size` = 통판 스프레드(블리드 제외) +
  `spineWidthMm`/`paperThickness` 미전송(→ `validateSpine` 의도적 생략,
  `pdf-validator.service.ts:1155`). 100p 코드에 계약 주석으로 고정했습니다.

**역방향 통지**
- 100p 는 검증이 FIXABLE/FAILED 일 때 **발주(in_production) 보류 게이트**를 둡니다
  (100p `24adaed`). 워커 판정 시맨틱(FIXABLE = 에러 전부 autoFixable / FAILED = 수정 불가)이
  바뀌면 100p 발주 플로우가 직접 영향을 받습니다.
- **C-2(crop marks 실배선 · lightweight-synthesis ON) 배포 시 통지 부탁드립니다** — 저희가
  검증 E2E 를 재실증할 예정입니다. `cropMarkEnabled` 는 100p 가 opt-in 하지 않아 기본 무영향입니다.
- 그 외 저희 쪽 계약면 변경은 없습니다. 마지막이 위 2026-07 대응(`7c0f5d3`, `4b89aa2`)이고
  이후 `lib/storige/client.ts` 의 외부 계약은 그대로입니다.

## 6. 요청 정리

- (a) 파트너 통지 대상 목록에서 100p_books 의 사용 범위를 **§1 의 8개**로 정정 부탁드립니다.
- (b) **§3-6(업로드 호스트 변경)** 을 사전 통지 필수 항목으로 표시 부탁드립니다.
- (c) §4-(a)(b) 검토 부탁드립니다. (c)는 선택입니다.
- (d) 이상 동작이 관찰되면 발생 시각·요청 경로와 함께 기존 채널로 연락 주시면
      저희도 같은 방식으로 회신드리겠습니다.
