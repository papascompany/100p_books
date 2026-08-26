# [100p_books → Storige] 세션 격리 통지 수신 확인 + 우리 실제 사용 경로 공유

> 발신: 100p_books (2026-08-24) · 근거: `lib/storige/client.ts` 실코드 전수 + 레포 전체 grep
> **용도**: Storige 세션에 그대로 붙여넣는 통지문.

## 0. 요약

2026-08-24 자 "Storige 연동 변경 안내"(세션 API 테넌트 격리 확장 · `editor.saved` 의
`EDITOR_BUSY`) 잘 받았습니다. **저희 쪽 무영향을 코드로 확인했고 조치할 것은 없었습니다.**

다만 통지문에 저희 사용 경로로 `/edit-sessions/external` 이 포함돼 있었는데, **저희는 그 경로를
쓰지 않습니다.** 향후 통지 대상 판정이 어긋날 수 있어(불필요한 통지 / 정작 필요한 통지 누락)
저희가 실제로 호출하는 전체 목록을 공유드립니다. 아래가 전부이며, 이보다 넓지 않습니다.

## 1. 저희가 호출하는 Storige 경로 — 전체 (API 7개 + R2 직결 1개)

base: `https://api.papascompany.co.kr/api` · 편집기 키 = `STORIGE_API_KEY`,
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

저희는 유형 1(자체 편집기 + PDF 저장·검증 오프로드)이고, 편집 세션은 100% 자체 DB(PageDoc)에
있습니다. 도입 계획도 현재 없습니다 — 도입하게 되면 먼저 알려드리겠습니다.

## 3. 저희가 깨지면 곧바로 영향받는 계약 — 변경 시 사전 통지 요청

경로/메서드/인증뿐 아니라 **아래 응답 shape·문자열**에 직접 의존합니다.

1. **presign 응답 3키** — `{ fileId, uploadUrl, uploadToken }`. 하나라도 없으면 업로드를
   실패 처리합니다(부분 업로드가 주문에 커밋되는 것 방지).
2. **`complete` 응답 최상위 `id`** — 2xx 인데 `id` 가 없으면 presign `fileId` 로 조용히
   대체하지 않고 실패시킨 뒤 해당 파일을 DELETE 합니다.
3. **`503` 본문의 `STORIGE_NOT_S3` 문자열** — driver=local 판정에 **문자열 매칭**을 씁니다.
   이 코드값이 바뀌면 폴백이 끊겨 >90MB 업로드가 실패합니다.
4. **검증 result 키셋** — `{ isValid, errors, warnings, metadata }`.
5. **검증 파라미터 관행**(2026-07 확정분 유지 확인 요망) — 내지 `orderOptions.pageMultiple: 2`
   전송 / 표지는 `size` 에 **통판 스프레드(블리드 제외)** 를 넣고 `spineWidthMm` **미전송**.
6. ⚠️ **`uploadUrl` 호스트** — SSRF 방어로 `r2.cloudflarestorage.com` · `amazonaws.com`
   suffix 화이트리스트를 강제합니다. **스토리지 백엔드를 다른 호스트로 옮기시면 저희 업로드가
   전면 차단됩니다.** 이 변경만은 반드시 사전 통지 부탁드립니다(저희는 env 로 즉시 확장 가능).

## 4. 요청

- (a) 파트너 통지 대상 목록에서 100p_books 의 사용 범위를 위 8개로 정정 부탁드립니다.
- (b) §3-6(업로드 호스트 변경)은 사전 통지 필수 항목으로 표시 부탁드립니다.
- (c) 2026-07-21 자 통지문(`FROZEN_ROUTES` 등재 · 검증 result 골든 spec 신설)이 아직
      전달 전이었다면 함께 확인 부탁드립니다 — 그 요청은 유효합니다.

## 5. 참고 — 저희 쪽 최근 변경 중 Storige 관련

없습니다. 마지막 계약면 변경은 2026-07 워커 검증 대응(`7c0f5d3`, `4b89aa2`)이고 이후
`lib/storige/client.ts` 의 외부 계약은 그대로입니다.
