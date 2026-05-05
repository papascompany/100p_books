/**
 * 이메일 템플릿 — 100p Books 알림 (한국어).
 *
 * 각 템플릿은 (subject, text, html) 을 반환한다.
 * - text: 평문 본문 (필수)
 * - html: 간단한 인라인 스타일 본문 (옵션) — Pretendard fallback
 *
 * 컨텍스트 변수는 OrderContext / UserContext 디스크리미네이트 유니온으로 전달.
 * 누락된 필드는 안전하게 fallback 한다 — 운영 누락 시에도 발송이 멈추지 않도록.
 */

export type EmailTemplate =
  | "order.paid"
  | "order.in_production"
  | "order.shipped"
  | "order.delivered"
  | "order.cancelled"
  | "order.refunded"
  | "user.welcome"
  | "user.account_deleted";

export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
}

export interface OrderContext {
  kind: "order";
  orderId: string;
  tossOrderId?: string;
  customerName: string;
  bookSizeName: string;
  pageCount: number;
  qty: number;
  amount: number;
  trackingNo?: string;
  trackingCarrier?: string;
  shippedAt?: string;
  /** 취소/환불 사유 (선택) */
  reason?: string;
}

export interface UserContext {
  kind: "user";
  email: string;
  displayName: string;
}

export type TemplateContext = OrderContext | UserContext;

/** 천 단위 콤마 + "원" */
function formatKRW(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0원";
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 택배 추적 URL — 알려진 캐리어만, 모르는 회사면 빈 문자열. */
function trackingUrl(carrier: string | undefined, no: string | undefined): string {
  if (!carrier || !no) return "";
  const c = carrier.trim();
  // 대표 운송사 — 신규 추가는 /admin/orders/[id] 의 select 와 맞춰서.
  if (c.includes("CJ") || c.includes("대한통운")) {
    return `https://trace.cjlogistics.com/web/detail.jsp?slipno=${encodeURIComponent(no)}`;
  }
  if (c.includes("롯데")) {
    return `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${encodeURIComponent(no)}`;
  }
  if (c.includes("한진")) {
    return `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?wblnumText=${encodeURIComponent(no)}`;
  }
  if (c.toLowerCase().includes("post") || c.includes("우체국")) {
    return `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${encodeURIComponent(no)}`;
  }
  return "";
}

const BRAND = {
  name: "100p Books",
  signature: "고객 문의: support@100pbooks.example.com",
  footerNote:
    "본 메일은 발신 전용입니다. 회신 시 답변이 어려우니 위 이메일로 문의 부탁드려요.",
};

/** 공통 HTML 셸 — 인라인 스타일만 사용 (이메일 클라이언트 호환성). */
function htmlShell(opts: {
  preheader?: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
}): string {
  const cta = opts.ctaLabel && opts.ctaHref
    ? `<p style="margin:24px 0;"><a href="${opts.ctaHref}" style="display:inline-block;padding:12px 22px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">${escapeHtml(opts.ctaLabel)}</a></p>`
    : "";
  return [
    `<!doctype html><html lang="ko"><head><meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width,initial-scale=1" />`,
    `<title>${escapeHtml(opts.heading)}</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:#f6f5f2;font-family:'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#2b2b2b;">`,
    opts.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;color:#f6f5f2;">${escapeHtml(opts.preheader)}</div>`
      : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:32px 12px;"><tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #ece8e0;box-shadow:0 4px 24px rgba(0,0,0,0.04);"><tr><td style="padding:28px 28px 8px 28px;">`,
    `<div style="font-family:'Playfair Display',serif;font-weight:700;font-size:20px;letter-spacing:-0.01em;">${BRAND.name}</div>`,
    `</td></tr><tr><td style="padding:8px 28px 0 28px;">`,
    `<h1 style="font-size:20px;line-height:1.4;margin:0 0 16px 0;font-weight:700;">${escapeHtml(opts.heading)}</h1>`,
    `<div style="font-size:15px;line-height:1.7;color:#2b2b2b;">${opts.bodyHtml}</div>`,
    cta,
    `</td></tr><tr><td style="padding:8px 28px 28px 28px;">`,
    `<hr style="border:none;border-top:1px solid #ece8e0;margin:24px 0 16px 0;" />`,
    `<p style="margin:0;font-size:12px;color:#9a948a;">${escapeHtml(BRAND.signature)}</p>`,
    `<p style="margin:6px 0 0 0;font-size:11px;color:#b6b1a8;">${escapeHtml(BRAND.footerNote)}</p>`,
    `</td></tr></table></td></tr></table></body></html>`,
  ].join("");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 주문 요약 라인 — 평문/HTML 양쪽에서 재사용. */
function orderSummaryLines(o: OrderContext): string[] {
  return [
    `· 주문 번호: ${o.tossOrderId ?? o.orderId}`,
    `· 책 사이즈: ${o.bookSizeName}`,
    `· 페이지 수: ${o.pageCount}p`,
    `· 수량: ${o.qty}권`,
    `· 결제 금액: ${formatKRW(o.amount)}`,
  ];
}

function orderSummaryHtml(o: OrderContext): string {
  const rows = [
    ["주문 번호", o.tossOrderId ?? o.orderId],
    ["책 사이즈", o.bookSizeName],
    ["페이지 수", `${o.pageCount}p`],
    ["수량", `${o.qty}권`],
    ["결제 금액", formatKRW(o.amount)],
  ];
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;background:#faf9f5;border-radius:8px;">`,
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 14px;color:#7d7666;font-size:13px;width:120px;">${escapeHtml(k!)}</td><td style="padding:8px 14px;font-size:14px;font-weight:500;color:#2b2b2b;">${escapeHtml(String(v))}</td></tr>`,
      )
      .join(""),
    `</table>`,
  ].join("");
}

// =====================================================================
// 템플릿 본체
// =====================================================================

function tplOrderPaid(c: OrderContext): EmailContent {
  const subject = `[100p Books] 주문해주셔서 감사합니다 — 결제가 완료됐어요`;
  const text = [
    `${c.customerName}님, 안녕하세요. 100p Books 입니다.`,
    ``,
    `주문해주신 포토북의 결제가 정상적으로 완료됐어요.`,
    `이제 인쇄용 PDF가 자동으로 만들어지고, 검수가 끝나면 인쇄를 시작할게요.`,
    ``,
    `[주문 정보]`,
    ...orderSummaryLines(c),
    ``,
    `진행 상황은 마이페이지 > 내 주문에서 확인할 수 있어요.`,
    ``,
    `감사합니다.`,
  ].join("\n");
  const html = htmlShell({
    preheader: "결제가 완료됐어요. 곧 인쇄 준비를 시작할게요.",
    heading: "주문해주셔서 감사합니다",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.customerName)}</b>님, 안녕하세요.</p>`,
      `<p style="margin:0 0 12px 0;">주문해주신 포토북의 결제가 정상적으로 완료됐어요. 곧 인쇄용 PDF가 자동으로 만들어지고, 검수가 끝나는 대로 인쇄를 시작합니다.</p>`,
      orderSummaryHtml(c),
      `<p style="margin:8px 0 0 0;color:#7d7666;font-size:13px;">진행 상황은 마이페이지 &gt; 내 주문에서 확인할 수 있어요.</p>`,
    ].join(""),
    ctaLabel: "내 주문 보기",
    ctaHref: appUrl(`/mypage/orders/${c.orderId}`),
  });
  return { subject, text, html };
}

function tplOrderInProduction(c: OrderContext): EmailContent {
  const subject = `[100p Books] 포토북이 인쇄에 들어갔어요`;
  const text = [
    `${c.customerName}님, 100p Books 입니다.`,
    ``,
    `주문하신 포토북이 인쇄소에 도착해서 본격적인 제작이 시작됐어요.`,
    `평균 영업일 기준 3–5일 정도 소요되며, 제작이 끝나는 대로 출고 안내를 드릴게요.`,
    ``,
    `[주문 정보]`,
    ...orderSummaryLines(c),
    ``,
    `조금만 기다려주세요!`,
  ].join("\n");
  const html = htmlShell({
    preheader: "주문하신 포토북이 인쇄에 들어갔어요.",
    heading: "포토북이 인쇄에 들어갔어요",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.customerName)}</b>님, 안녕하세요.</p>`,
      `<p style="margin:0 0 12px 0;">주문하신 포토북이 인쇄소에 도착해서 본격적인 제작이 시작됐어요. 평균 영업일 기준 <b>3–5일</b> 정도 소요되며, 제작이 끝나는 대로 출고 안내를 드릴게요.</p>`,
      orderSummaryHtml(c),
    ].join(""),
    ctaLabel: "내 주문 보기",
    ctaHref: appUrl(`/mypage/orders/${c.orderId}`),
  });
  return { subject, text, html };
}

function tplOrderShipped(c: OrderContext): EmailContent {
  const url = trackingUrl(c.trackingCarrier, c.trackingNo);
  const tracking = c.trackingNo
    ? `${c.trackingCarrier ?? "택배"} ${c.trackingNo}`
    : "송장번호는 곧 등록될 예정이에요";
  const subject = `[100p Books] 포토북이 출고됐어요`;
  const text = [
    `${c.customerName}님, 100p Books 입니다.`,
    ``,
    `주문하신 포토북이 방금 출고됐어요!`,
    ``,
    `[배송 정보]`,
    `· 택배사: ${c.trackingCarrier ?? "-"}`,
    `· 송장번호: ${c.trackingNo ?? "-"}`,
    url ? `· 추적: ${url}` : "",
    ``,
    `[주문 정보]`,
    ...orderSummaryLines(c),
    ``,
    `안전하게 받아보실 수 있도록 신경 썼어요. 도착하면 알려주세요!`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = htmlShell({
    preheader: tracking,
    heading: "포토북이 출고됐어요",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.customerName)}</b>님, 주문하신 포토북이 방금 출고됐어요!</p>`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;background:#faf9f5;border-radius:8px;">`,
      `<tr><td style="padding:8px 14px;color:#7d7666;font-size:13px;width:120px;">택배사</td><td style="padding:8px 14px;font-size:14px;font-weight:500;">${escapeHtml(c.trackingCarrier ?? "-")}</td></tr>`,
      `<tr><td style="padding:8px 14px;color:#7d7666;font-size:13px;">송장번호</td><td style="padding:8px 14px;font-size:14px;font-weight:600;">${escapeHtml(c.trackingNo ?? "-")}</td></tr>`,
      `</table>`,
      orderSummaryHtml(c),
    ].join(""),
    ctaLabel: url ? "배송 조회" : "내 주문 보기",
    ctaHref: url || appUrl(`/mypage/orders/${c.orderId}`),
  });
  return { subject, text, html };
}

function tplOrderDelivered(c: OrderContext): EmailContent {
  const subject = `[100p Books] 포토북이 도착했어요. 어땠나요?`;
  const text = [
    `${c.customerName}님, 100p Books 입니다.`,
    ``,
    `주문하신 포토북이 안전하게 도착했어요. 받으신 후 어떠셨나요?`,
    `잠깐의 후기는 100p Books 의 큰 힘이 됩니다.`,
    ``,
    `[주문 정보]`,
    ...orderSummaryLines(c),
    ``,
    `또 만나요!`,
  ].join("\n");
  const html = htmlShell({
    preheader: "포토북 잘 받으셨나요?",
    heading: "포토북이 도착했어요. 어땠나요?",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.customerName)}</b>님, 주문하신 포토북이 안전하게 도착했어요.</p>`,
      `<p style="margin:0 0 12px 0;">받으신 후 어떠셨나요? 잠깐의 후기는 100p Books 의 큰 힘이 됩니다.</p>`,
      orderSummaryHtml(c),
    ].join(""),
    ctaLabel: "내 주문 보기",
    ctaHref: appUrl(`/mypage/orders/${c.orderId}`),
  });
  return { subject, text, html };
}

function tplOrderCancelled(c: OrderContext): EmailContent {
  const subject = `[100p Books] 주문이 취소됐어요`;
  const text = [
    `${c.customerName}님, 100p Books 입니다.`,
    ``,
    `요청하신 주문이 취소 처리됐어요.`,
    c.reason ? `사유: ${c.reason}` : "",
    ``,
    `결제가 이미 진행된 경우 영업일 기준 3–5일 내에 환불이 완료돼요.`,
    `(카드 결제는 카드사 정책에 따라 시간이 더 걸릴 수 있어요.)`,
    ``,
    `[주문 정보]`,
    ...orderSummaryLines(c),
    ``,
    `다시 만날 날을 기다릴게요.`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = htmlShell({
    preheader: "주문이 취소 처리됐어요.",
    heading: "주문이 취소됐어요",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.customerName)}</b>님, 요청하신 주문이 취소 처리됐어요.</p>`,
      c.reason
        ? `<p style="margin:0 0 12px 0;color:#7d7666;font-size:13px;">사유: ${escapeHtml(c.reason)}</p>`
        : "",
      `<p style="margin:0 0 12px 0;">결제가 이미 진행된 경우 영업일 기준 <b>3–5일</b> 내에 환불이 완료돼요. (카드 결제는 카드사 정책에 따라 시간이 더 걸릴 수 있어요.)</p>`,
      orderSummaryHtml(c),
    ].join(""),
    ctaLabel: "내 주문 보기",
    ctaHref: appUrl(`/mypage/orders/${c.orderId}`),
  });
  return { subject, text, html };
}

function tplOrderRefunded(c: OrderContext): EmailContent {
  const subject = `[100p Books] 환불이 완료됐어요`;
  const text = [
    `${c.customerName}님, 100p Books 입니다.`,
    ``,
    `요청하신 주문에 대한 환불이 완료됐어요.`,
    c.reason ? `사유: ${c.reason}` : "",
    ``,
    `환불 금액은 결제하신 수단으로 입금되며, 카드 결제는 카드사 정책에 따라`,
    `최대 7영업일이 소요될 수 있어요.`,
    ``,
    `[주문 정보]`,
    ...orderSummaryLines(c),
    ``,
    `이용해주셔서 감사했습니다.`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = htmlShell({
    preheader: "환불이 완료됐어요.",
    heading: "환불이 완료됐어요",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.customerName)}</b>님, 요청하신 주문에 대한 환불이 완료됐어요.</p>`,
      c.reason
        ? `<p style="margin:0 0 12px 0;color:#7d7666;font-size:13px;">사유: ${escapeHtml(c.reason)}</p>`
        : "",
      `<p style="margin:0 0 12px 0;">환불 금액은 결제하신 수단으로 입금되며, 카드 결제는 카드사 정책에 따라 최대 <b>7영업일</b>이 소요될 수 있어요.</p>`,
      orderSummaryHtml(c),
    ].join(""),
  });
  return { subject, text, html };
}

function tplUserWelcome(c: UserContext): EmailContent {
  const subject = `[100p Books] 100p Books 에 오신 걸 환영해요`;
  const text = [
    `${c.displayName}님, 환영해요!`,
    ``,
    `100p Books 는 사진 100장으로 만드는 작은 포토북 서비스예요.`,
    `자동 편집으로 빠르게 시작하거나, 폴라로이드/콜라주 템플릿으로 자유롭게 꾸며보세요.`,
    ``,
    `시작하기: ${appUrl("/")}`,
    ``,
    `궁금한 점은 언제든 답장하지 마시고 ${BRAND.signature.replace("고객 문의: ", "")} 로 알려주세요.`,
  ].join("\n");
  const html = htmlShell({
    preheader: "100p Books 에 오신 걸 환영해요.",
    heading: "환영해요",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.displayName)}</b>님, 100p Books 에 오신 걸 환영해요.</p>`,
      `<p style="margin:0 0 12px 0;">100p Books 는 사진 <b>100장</b>으로 만드는 작은 포토북 서비스예요. 자동 편집으로 빠르게 시작하거나, 폴라로이드/콜라주 템플릿으로 자유롭게 꾸며보세요.</p>`,
    ].join(""),
    ctaLabel: "포토북 만들기",
    ctaHref: appUrl("/"),
  });
  return { subject, text, html };
}

function tplUserAccountDeleted(c: UserContext): EmailContent {
  const subject = `[100p Books] 탈퇴 처리가 완료됐어요`;
  const text = [
    `${c.displayName}님, 100p Books 입니다.`,
    ``,
    `요청하신 회원 탈퇴 처리가 완료됐어요.`,
    `계정 정보는 익명화되었으며, 진행 중이던 주문이 없어 즉시 탈퇴가 적용됐습니다.`,
    ``,
    `이용해주셔서 감사했어요. 또 만나요.`,
  ].join("\n");
  const html = htmlShell({
    preheader: "탈퇴 처리가 완료됐어요.",
    heading: "탈퇴 처리가 완료됐어요",
    bodyHtml: [
      `<p style="margin:0 0 12px 0;"><b>${escapeHtml(c.displayName)}</b>님, 100p Books 입니다.</p>`,
      `<p style="margin:0 0 12px 0;">요청하신 회원 탈퇴 처리가 완료됐어요. 계정 정보는 익명화되었으며, 진행 중이던 주문이 없어 즉시 탈퇴가 적용됐습니다.</p>`,
      `<p style="margin:0 0 12px 0;color:#7d7666;font-size:13px;">이용해주셔서 감사했어요. 또 만나요.</p>`,
    ].join(""),
  });
  return { subject, text, html };
}

/** App URL helper. NEXT_PUBLIC_APP_URL 미설정 시 빈 path 만 반환. */
function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!base) return path;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

// =====================================================================
// 디스패처
// =====================================================================

export function renderEmailTemplate(
  template: EmailTemplate,
  context: TemplateContext,
): EmailContent {
  switch (template) {
    case "order.paid":
      return tplOrderPaid(asOrder(context));
    case "order.in_production":
      return tplOrderInProduction(asOrder(context));
    case "order.shipped":
      return tplOrderShipped(asOrder(context));
    case "order.delivered":
      return tplOrderDelivered(asOrder(context));
    case "order.cancelled":
      return tplOrderCancelled(asOrder(context));
    case "order.refunded":
      return tplOrderRefunded(asOrder(context));
    case "user.welcome":
      return tplUserWelcome(asUser(context));
    case "user.account_deleted":
      return tplUserAccountDeleted(asUser(context));
    default: {
      // unreachable — TS exhaustiveness
      const _x: never = template;
      throw new Error(`알 수 없는 템플릿: ${String(_x)}`);
    }
  }
}

function asOrder(c: TemplateContext): OrderContext {
  if (c.kind !== "order") {
    throw new Error(
      `이 템플릿은 OrderContext 가 필요합니다 (받은 kind: ${c.kind}).`,
    );
  }
  return c;
}

function asUser(c: TemplateContext): UserContext {
  if (c.kind !== "user") {
    throw new Error(
      `이 템플릿은 UserContext 가 필요합니다 (받은 kind: ${c.kind}).`,
    );
  }
  return c;
}

/** 템플릿 키와 OrderStatus 매핑 — 관리자 상태 전이에서 enqueue 시 활용. */
export const TEMPLATE_BY_ORDER_STATUS: Record<string, EmailTemplate | null> = {
  pending: null, // 결제 전 단계 — 메일 안 보냄
  paid: "order.paid",
  in_production: "order.in_production",
  shipped: "order.shipped",
  delivered: "order.delivered",
  cancelled: "order.cancelled",
  refunded: "order.refunded",
};
