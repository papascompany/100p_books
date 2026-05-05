import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import {
  SHIPPING_COLUMNS,
  buildShippingExcel,
  buildShippingExcelFilename,
  toShippingRow,
  type ShippingRow,
} from "./excel";

function makeRow(overrides: Partial<ShippingRow> = {}): ShippingRow {
  return {
    orderId: "ord-001",
    recipient: "홍길동",
    phone: "010-1234-5678",
    zip: "06236",
    address: "서울시 강남구 테헤란로 123 4층",
    qty: 1,
    itemName: "A5 100p",
    memo: "",
    trackingNo: "",
    trackingCarrier: "",
    ...overrides,
  };
}

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (wb.xlsx as any).load(buf);
  const ws = wb.getWorksheet(1);
  if (!ws) throw new Error("워크시트가 없습니다.");
  return ws;
}

describe("buildShippingExcel", () => {
  it("헤더 컬럼 순서 + 회색 배경/볼드", async () => {
    const buf = await buildShippingExcel([makeRow()]);
    const ws = await readBack(buf);
    const header = ws.getRow(1);
    const expectedHeaders = SHIPPING_COLUMNS.map((c) => c.header);
    const actualHeaders = expectedHeaders.map((_, i) => header.getCell(i + 1).value);
    expect(actualHeaders).toEqual(expectedHeaders);
    expect(header.font?.bold).toBe(true);
    // fill 색이 ARGB 회색 계열인지
    const fill = header.fill as ExcelJS.Fill | undefined;
    expect(fill && (fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFE5E7EB");
  });

  it("행 수 = 입력 수 (헤더 제외)", async () => {
    const rows = [
      makeRow({ orderId: "a" }),
      makeRow({ orderId: "b" }),
      makeRow({ orderId: "c" }),
    ];
    const buf = await buildShippingExcel(rows);
    const ws = await readBack(buf);
    // rowCount 는 헤더 포함
    expect(ws.rowCount).toBe(rows.length + 1);
  });

  it("송장번호/배송사가 포함된 행은 셀에 그대로 기록", async () => {
    const buf = await buildShippingExcel([
      makeRow({ trackingNo: "1234567890", trackingCarrier: "cj" }),
    ]);
    const ws = await readBack(buf);
    const row = ws.getRow(2);
    // 컬럼 인덱스 — SHIPPING_COLUMNS 정의 순서.
    const trackingIdx =
      SHIPPING_COLUMNS.findIndex((c) => c.key === "trackingNo") + 1;
    const carrierIdx =
      SHIPPING_COLUMNS.findIndex((c) => c.key === "trackingCarrier") + 1;
    expect(row.getCell(trackingIdx).value).toBe("1234567890");
    expect(row.getCell(carrierIdx).value).toBe("cj");
  });

  it("자동 너비 — 본문 텍스트가 길면 헤더 baseWidth 보다 넓어진다", async () => {
    const longAddr = "서울특별시 강남구 테헤란로 123-456 어떤이름이엄청긴빌딩 999층 9999호";
    const buf = await buildShippingExcel([makeRow({ address: longAddr })]);
    const ws = await readBack(buf);
    // exceljs 가 xlsx 로 직렬화 후 다시 로드하면 column key 가 사라지므로 1-based index 로 조회
    const addrIdx = SHIPPING_COLUMNS.findIndex((c) => c.key === "address") + 1;
    const addrCol = ws.getColumn(addrIdx);
    const baseAddr = SHIPPING_COLUMNS.find((c) => c.key === "address")!.baseWidth;
    expect(addrCol.width).toBeGreaterThan(baseAddr);
  });

  it("toShippingRow — addr1+addr2 가 공백 join, memo 폴백", () => {
    const r = toShippingRow({
      orderId: "ord-x",
      qty: 2,
      address: {
        name: "홍",
        phone: "010-0000-0000",
        zip: "12345",
        addr1: "기본주소",
        addr2: "상세주소",
      },
      bookSizeName: "20×20",
      pageCount: 80,
      trackingNo: null,
      trackingCarrier: null,
    });
    expect(r.address).toBe("기본주소 상세주소");
    expect(r.itemName).toBe("20×20 80p");
    expect(r.memo).toBe("");
    expect(r.trackingNo).toBe("");
  });
});

describe("buildShippingExcelFilename", () => {
  it("invoices_YYYYMMDD_HHmm.xlsx 형식", () => {
    const d = new Date(2026, 3, 25, 9, 5); // 2026-04-25 09:05 (월=3)
    expect(buildShippingExcelFilename(d)).toBe("invoices_20260425_0905.xlsx");
  });
});
