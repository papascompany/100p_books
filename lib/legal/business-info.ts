/**
 * 사업자 정보 정본 — 전자상거래법 제10조 표시 의무(2026-11-07 오너 제공).
 * 푸터·약관·개인정보처리방침·환불정책이 모두 여기서 읽는다. CMS 편집으로 누락되지 않게 코드에 고정한다.
 * 고객센터 전화는 lib/orders/customer-center.ts 가 정본이다.
 */
export const BUSINESS_INFO = {
  name: "더스토리지",
  serviceName: "100p Books",
  ceo: "조요한",
  registrationNo: "274-31-01564",
  mailOrderNo: "제 2025-고양덕양구-2782호",
  address: "경기도 고양시 덕양구 통일로140 삼송테크노밸리 B동 4층 422호",
} as const;

/** 공정위 사업자정보 공개 페이지 — 사업자등록번호로 통신판매업 신고 내용을 조회한다. */
export const BUSINESS_INFO_CHECK_URL = `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${BUSINESS_INFO.registrationNo.replace(/-/g, "")}`;
