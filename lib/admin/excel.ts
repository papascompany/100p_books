// 서버 전용 (관리자 라우트 외 사용 금지). exceljs 는 노드 환경 의존.
import ExcelJS from "exceljs";

import type { OrderAddress, OrderStatus } from "@/lib/db/types";

/**
 * 송장 Excel 빌더 (CJ대한통운 표준에 가까운 컬럼).
 *
 * 컬럼:
 *   주문번호 / 수령인 / 연락처 / 우편번호 / 주소 / 수량 /
 *   품목(책사이즈+페이지수) / 메모 / 송장번호 / 배송사
 *
 * 헤더는 굵게 + 회색 배경, 자동 너비 (라이브러리 미지원이므로 헤더+본문
 * 텍스트 길이 기준 수동 계산).
 *
 * 호출 측은 `runtime = "nodejs"` 인 라우트에서 `Buffer` 를 그대로 응답으로 보낸다.
 */

export interface ShippingRow {
  /** 주문 식별자 (UUID 또는 short id). 컬럼명 "주문번호". */
  orderId: string;
  /** 받는 사람. */
  recipient: string;
  /** 연락처. */
  phone: string;
  /** 우편번호. */
  zip: string;
  /** 전체 주소 (addr1 + addr2). */
  address: string;
  /** 수량. */
  qty: number;
  /** 품목명 — `${bookSizeName} ${pageCount}p`. */
  itemName: string;
  /** 배송 메모 (선택). */
  memo?: string;
  /** 송장 번호 (선택, 미발송 건은 빈칸). */
  trackingNo?: string;
  /** 배송사 식별자 (예: 'cj', 'hanjin'). */
  trackingCarrier?: string;
}

interface Column {
  key: keyof ShippingRow;
  header: string;
  /** 폴백 문자 너비. 헤더/본문 길이 max 와 비교해 큰 값 채택. */
  baseWidth: number;
}

export const SHIPPING_COLUMNS: Column[] = [
  { key: "orderId", header: "주문번호", baseWidth: 14 },
  { key: "recipient", header: "수령인", baseWidth: 10 },
  { key: "phone", header: "연락처", baseWidth: 14 },
  { key: "zip", header: "우편번호", baseWidth: 10 },
  { key: "address", header: "주소", baseWidth: 40 },
  { key: "qty", header: "수량", baseWidth: 6 },
  { key: "itemName", header: "품목", baseWidth: 22 },
  { key: "memo", header: "메모", baseWidth: 20 },
  { key: "trackingNo", header: "송장번호", baseWidth: 14 },
  { key: "trackingCarrier", header: "배송사", baseWidth: 10 },
];

/**
 * 입력 헬퍼 — DB 의 orders + projects + book_sizes 조회 결과를 ShippingRow 로 매핑.
 */
export function toShippingRow(args: {
  orderId: string;
  qty: number;
  address: OrderAddress;
  bookSizeName: string;
  pageCount: number;
  trackingNo: string | null;
  trackingCarrier: string | null;
}): ShippingRow {
  const fullAddress = [args.address.addr1, args.address.addr2 ?? ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    orderId: args.orderId,
    recipient: args.address.name,
    phone: args.address.phone,
    zip: args.address.zip,
    address: fullAddress,
    qty: args.qty,
    itemName: `${args.bookSizeName} ${args.pageCount}p`,
    memo: args.address.memo ?? "",
    trackingNo: args.trackingNo ?? "",
    trackingCarrier: args.trackingCarrier ?? "",
  };
}

/**
 * 송장 엑셀 빌드. 결과 Buffer 는 .xlsx (zipped XML).
 */
export async function buildShippingExcel(
  rows: ShippingRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "100p_books admin";
  wb.created = new Date();

  const ws = wb.addWorksheet("송장", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // 헤더
  ws.columns = SHIPPING_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.baseWidth,
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF1F2937" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };
  headerRow.height = 22;
  headerRow.border = {
    top: { style: "thin", color: { argb: "FF9CA3AF" } },
    bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
  };

  // 본문
  for (const r of rows) {
    ws.addRow(r as unknown as Record<string, string | number>);
  }

  // 자동 너비 — 헤더/본문 글자수(전각 보정) 최댓값 기반으로 재계산
  for (const col of SHIPPING_COLUMNS) {
    const colObj = ws.getColumn(col.key);
    let max = textWidth(col.header);
    for (const r of rows) {
      const v = r[col.key];
      if (v == null) continue;
      const w = textWidth(String(v));
      if (w > max) max = w;
    }
    // exceljs 의 width 는 캐릭터 단위 (대략 1자 = 1.0). 한글은 ~1.7 로 가중.
    colObj.width = Math.min(60, Math.max(col.baseWidth, max + 2));
  }

  // 본문 셀 정렬
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/**
 * 한글/영문 혼합 텍스트의 표시 너비 추정.
 *   ASCII = 1.0, 그 외(한글/이모지) = 1.7
 */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += ch.charCodeAt(0) < 128 ? 1.0 : 1.7;
  }
  return w;
}

/**
 * 파일명 — invoices_YYYYMMDD_HHmm.xlsx.
 */
export function buildShippingExcelFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `invoices_${yyyy}${mm}${dd}_${hh}${mi}.xlsx`;
}

/** 진행중/배송중인 주문 상태만 송장 후보. (주문 export 기본 필터에서 사용) */
export const SHIPPABLE_STATUSES: OrderStatus[] = [
  "paid",
  "in_production",
  "shipped",
];
