import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /mypage — 본 단계는 주문 내역으로 즉시 redirect.
 * (M7 에서 프로필/설정 등 추가 시 본 페이지에 메뉴 그리드를 둔다.)
 */
export default function MyPage() {
  redirect("/mypage/orders");
}
