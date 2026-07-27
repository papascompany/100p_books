# [100p_books → Storige] 워커 검증 계약 대응 완료 공유 + 동결 그물 보강 요청

> 발신: 100p_books 세션 (2026-07-21) · 근거: Storige 실코드 전수 대조(4-에이전트 조사+적대검증) + 워커 검증 파이프라인 리포트(2026-07-09)
> **용도**: Storige 세션에 그대로 붙여넣는 통지문. 전달 여부는 오너 판단.

## 1. 100p측 대응 완료 (참고 — Storige 작업 불필요)

- **검증 result 파싱 정본 정렬**: `result.issues`(부재 키) → `errors`+`isValid` 교정 배포(100p `7c0f5d3`). → CONTRACT_FREEZE.md §1-B :45 "100p=issues 매핑 어댑터 필요 여부 [미확인]" 메모 해소 — 어댑터 불필요 확정, 문구 정리 가능.
- **DD 페이지규칙 전송 시작**: 내지 검증에 `orderOptions.pageMultiple: 2` 전송(100p `4b89aa2`). 100p는 이제 레거시 폴백(perfect=4배수)이 아닌 DD 경로. → DD 계약(`worker-job.dto.ts:67`) 시맨틱 변경 시 100p 즉시 영향.
- **표지 검증 관행 확정**: `orderOptions.size` = 통판 스프레드(블리드 제외) + `spineWidthMm`/`paperThickness` 미전송(→ `validateSpine` 의도적 생략, `pdf-validator.service.ts:1155`). 100p 코드에 계약 주석으로 고정 — 동결 대상으로 인지 바람.

## 2. 동결 그물 보강 요청 (Storige 작업 제안)

**(a) `POST /worker-jobs/validate/external` FROZEN_ROUTES 등재.**
실 라우트 존재(`worker-jobs.controller.ts:62`)하나 `contract-freeze.spec.ts` FROZEN_ROUTES 미등재 — 경로/메서드/인증 변경돼도 CI red 안 됨. 100p 필수 소비자(결제 후 전 PDF 빌드 호출). 폴링 `GET /worker-jobs/external/:id`는 등재됨(:67 ✓). 같은 사각지대 `synthesize/external`·`fix-pagecount/external`·`PATCH external/:id/status`도 등재 검토 권장.

**(b) 검증 result 키셋 골든 spec 신설.**
`{ isValid, errors, warnings, metadata }`는 CONTRACT_FREEZE §1-B(:45) FROZEN 선언·§2(:98) 골든 대상 명시에도 **실제 고정 spec 부재**. `pdf-validator.service.spec.ts`/`validation.processor.spec.ts`는 워커 내부 유닛(HTTP 계약 아님), `worker-jobs.e2e-spec.ts`는 Test 목 컨트롤러. 키 이름 리팩터링 하나에 100p·bookmoa·MD2 파싱이 조용히 깨지는 표면.

**(c) (선택·장기) 표지 검증 계약 구조적 긴장 정리.**
`validatePageSize`에 cover 예외 없음(:834-906) → 통판 표지는 `size`=판형이면 SIZE_MISMATCH 필패, `size`=스프레드면 `validateSpine` 공식(`size.width×2+spine`, :1167)과 충돌 — **두 검증 동시 통과 가능한 size 부재**. bookmoa 실측 "FIXABLE 70%·SIZE 단독 50건"의 구조적 원인 추정. cover 전용 size 시맨틱(예: `coverSpreadSize` ADDITIVE 신설 또는 cover 시 validatePageSize→spine 검증 대체) 정리 시 전 파트너 오탐 감소. 리포트 C안(배선 기반 게이팅)과 묶어 검토 권장.

## 3. 100p측 참고 (역방향 통지)

- 100p는 FIXABLE/FAILED 검증 시 **발주(in_production) 보류 게이트** 도입(100p `24adaed`). 워커 판정 시맨틱(FIXABLE=에러 전부 autoFixable / FAILED=수정불가) 변경 시 100p 발주 플로우 직접 영향.
- C-2(crop marks 실배선·lightweight-synthesis ON) 배포 시 100p에 통지 요청 — 검증 E2E 재실증 예정. `cropMarkEnabled`는 100p 미opt-in이라 기본 무영향.
