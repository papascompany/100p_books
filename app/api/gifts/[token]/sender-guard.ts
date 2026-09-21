/**
 * 선물 발신자 ↔ 원본 주문 소유 일치 판정 (방어 보강).
 *
 * 선물(gifts)은 "내가 결제한 포토북을 남에게 보낸다" 는 계약이다. 발급 라우트(orders/[id]/gift)는
 * 본인 주문만 허용하지만, 0032(클라이언트 직접 쓰기 봉쇄) 적용 전에는 사용자 JWT 로 PostgREST 에
 * gifts 행을 직접 INSERT 할 수 있었다. 그렇게 만든 부정 gift 는 **남의 결제 주문**을 가리켜, 수령하면
 * 그 사람의 포토북(원본 사진 포함)이 복제된다. 0032 의 revoke 는 이미 생긴 행을 지우지 않는다.
 * → 수령·미리보기 시점에 gift.sender_id 가 주문자(orders.user_id)이자 프로젝트 소유자인지 다시 확인한다.
 */
export interface GiftOwnershipFacts {
  senderId: string;
  orderUserId: string | null | undefined;
  projectUserId: string | null | undefined;
}

export function giftSenderOwnsOrder(facts: GiftOwnershipFacts): boolean {
  return (
    typeof facts.senderId === "string" &&
    facts.senderId.length > 0 &&
    facts.orderUserId === facts.senderId &&
    facts.projectUserId === facts.senderId
  );
}
