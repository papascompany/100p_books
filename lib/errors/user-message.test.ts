import { describe, expect, it } from "vitest";

import { CUSTOMER_CENTER_TEL } from "@/lib/orders/customer-center";

import {
  GENERIC_USER_ERROR_MESSAGE,
  isSafeServerMessage,
  userErrorFor,
  userErrorForStatus,
  userErrorFromJson,
  userErrorFromResponse,
  userErrorFromTossFail,
  userMessageFromJson,
} from "./user-message";

describe("userErrorFor", () => {
  it("UNAUTHORIZED 는 로그인 이동 액션을 준다", () => {
    const r = userErrorFor("UNAUTHORIZED");
    expect(r.action).toMatchObject({ kind: "login", href: "/login" });
  });

  it("결제 불일치 계열은 고객센터 번호를 안내한다", () => {
    for (const code of ["AMOUNT_MISMATCH", "PAYMENT_MISMATCH", "TOSS_ORDER_ID_MISMATCH"]) {
      const r = userErrorFor(code);
      expect(r.action?.kind).toBe("support");
      expect(r.action?.label).toContain(CUSTOMER_CENTER_TEL);
      expect(r.action?.href?.startsWith("tel:")).toBe(true);
    }
  });

  it("주요 코드는 해요체 문구가 있고 코드 문자열을 노출하지 않는다", () => {
    for (const code of [
      "PROJECT_LOCKED", "POINTS_INSUFFICIENT", "DISCOUNT_INVALID", "NOT_FOUND", "FORBIDDEN",
      "RATE_LIMITED", "ORDER_CHANGED", "PLAN_CHANGED", "STATE_CHANGED", "TOSS_TIMEOUT",
    ]) {
      const r = userErrorFor(code);
      expect(r.message).not.toContain(code);
      expect(r.message).toMatch(/[가-힣]/);
      expect(r.message).toMatch(/요\.?$/);
    }
  });

  it("내부 오류 계열은 서버 원문 대신 fallback 을 쓴다", () => {
    const r = userErrorFor("PROJECT_QUERY_FAILED", "삭제에 실패했어요.", "relation \"projects\" does not exist");
    expect(r.message).toBe("삭제에 실패했어요.");
    expect(userErrorFor("DB_ERROR").message).toBe(GENERIC_USER_ERROR_MESSAGE);
  });

  it("매핑 없는 코드: 안전한 한국어 서버 문구만 통과, 아니면 fallback", () => {
    expect(userErrorFor("CUSTOM", "실패했어요.", "사진은 최대 100장까지 담을 수 있어요.").message).toBe(
      "사진은 최대 100장까지 담을 수 있어요.",
    );
    expect(userErrorFor("CUSTOM", "실패했어요.", "PG_ERROR_42 at foo (bar.ts:1)").message).toBe("실패했어요.");
    expect(userErrorFor(undefined).message).toBe(GENERIC_USER_ERROR_MESSAGE);
  });
});

describe("isSafeServerMessage", () => {
  it("영문·식별자·스택·긴 문구는 거절", () => {
    expect(isSafeServerMessage("Internal Server Error")).toBe(false);
    expect(isSafeServerMessage("주문 실패: order_items 제약 위반")).toBe(false);
    expect(isSafeServerMessage("가".repeat(200))).toBe(false);
    expect(isSafeServerMessage(undefined)).toBe(false);
    expect(isSafeServerMessage("잠시 후 다시 시도해 주세요.")).toBe(true);
  });
});

describe("envelope helpers", () => {
  it("userErrorFromJson 은 error.code 를 푼다", () => {
    const r = userErrorFromJson({ ok: false, error: { code: "POINTS_INSUFFICIENT", message: "x" } });
    expect(r.message).toContain("포인트");
  });

  it("본문이 없으면 status 로 판정", () => {
    expect(userErrorFromJson(null, "실패", 401).action?.kind).toBe("login");
    expect(userErrorFromJson(null, "실패", 500).message).toBe("실패");
    expect(userErrorFromJson(null, "실패").message).toBe("실패");
    expect(userErrorForStatus(400)).toBeUndefined();
  });

  it("userMessageFromJson 단축형", () => {
    expect(userMessageFromJson({ error: { code: "NOT_FOUND" } }, "x")).toContain("찾을 수 없어요");
  });

  it("userErrorFromResponse 는 Response 본문을 읽는다", async () => {
    const res = new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "m" } }), { status: 429 });
    expect((await userErrorFromResponse(res)).action?.kind).toBe("retry");
    const bad = new Response("<html>", { status: 502 });
    expect((await userErrorFromResponse(bad, "실패했어요.")).message).toBe("실패했어요.");
  });

  it("토스 failUrl code 를 푼다(원문 영문 message 미사용)", () => {
    expect(userErrorFromTossFail("REJECT_CARD_COMPANY").message).toContain("카드사");
    expect(userErrorFromTossFail("SOMETHING_NEW").message).toMatch(/[가-힣]/);
    expect(userErrorFromTossFail("SOMETHING_NEW", "Card declined").message).not.toContain("declined");
    expect(userErrorFromTossFail("SOMETHING_NEW", "카드 정보를 확인해 주세요.").message).toBe("카드 정보를 확인해 주세요.");
  });
});
