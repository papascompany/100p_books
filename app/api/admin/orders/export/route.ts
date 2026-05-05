import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { fail } from "@/app/api/_lib/response";
import { withAdmin } from "@/lib/admin/auth";
import {
  buildShippingExcel,
  buildShippingExcelFilename,
  toShippingRow,
} from "@/lib/admin/excel";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderAddress } from "@/lib/db/types";
import { ALL_ORDER_STATUSES } from "@/lib/orders/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  status: z.enum(ALL_ORDER_STATUSES as [string, ...string[]]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** 미리보기 모드 — 카운트만 반환. */
  count: z.coerce.boolean().optional(),
});

interface OrderForExcel {
  id: string;
  qty: number;
  address: OrderAddress;
  status: string;
  tracking_no: string | null;
  tracking_carrier: string | null;
  project_id: string;
  projects: { book_sizes: { name: string } | null } | null;
}

/**
 * GET /api/admin/orders/export
 *
 *   ?status=&from=ISO&to=ISO  (전부 선택, 모두 비우면 paid+in_production+shipped)
 *   ?count=1  → 미리보기. JSON { count } 만 반환.
 *
 * Excel 생성 시 응답:
 *   Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *   Content-Disposition: attachment; filename="invoices_YYYYMMDD_HHmm.xlsx"
 *
 * 주의: 페이지수 (`pages` 테이블 count) 는 주문별로 조회 — 주문 수가 많을 경우
 * N+1 발생. 운영 단계에서 RPC 또는 view 로 최적화 (현재 ≤500건 가정).
 */
export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    count: url.searchParams.get("count") ?? undefined,
  });
  if (!parsed.success) {
    return fail(
      "INVALID_QUERY",
      "쿼리 파라미터가 올바르지 않습니다.",
      400,
      parsed.error.flatten(),
    );
  }
  const { status, from, to, count } = parsed.data;

  const admin = createAdminSupabase();

  let query = admin
    .from("orders")
    .select(
      "id, qty, address, status, tracking_no, tracking_carrier, project_id, projects(book_sizes(name))",
      { count: "exact" },
    )
    .order("created_at", { ascending: true });

  if (status) {
    query = query.eq("status", status);
  } else {
    // 기본 — 송장이 의미 있는 상태 (paid + in_production + shipped)
    query = query.in("status", ["paid", "in_production", "shipped"]);
  }
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  // 카운트 미리보기
  if (count) {
    const headRes = await query.range(0, 0); // count 만 필요
    return NextResponse.json({
      ok: true,
      data: { count: headRes.count ?? 0 },
    });
  }

  // 최대 1000건 (가드)
  const { data: rows, error } = await query.range(0, 999);
  if (error) return fail("ORDERS_QUERY_FAILED", error.message, 500);
  const orders = (rows ?? []) as unknown as OrderForExcel[];

  if (orders.length === 0) {
    return fail("EMPTY", "내보낼 주문이 없습니다.", 404);
  }

  // 페이지수는 별도 쿼리. project_id 단위 카운트.
  const projectIds = Array.from(new Set(orders.map((o) => o.project_id)));
  const pageCountMap = new Map<string, number>();
  if (projectIds.length > 0) {
    // Supabase 는 group-by count 를 직접 지원하지 않으므로 N 회 head:exact 호출.
    // (≤500 가정. 운영 단계에서 RPC/view 로 최적화.)
    await Promise.all(
      projectIds.map(async (pid) => {
        const { count: c } = await admin
          .from("pages")
          .select("id", { count: "exact", head: true })
          .eq("project_id", pid);
        pageCountMap.set(pid, c ?? 0);
      }),
    );
  }

  const shippingRows = orders.map((o) =>
    toShippingRow({
      orderId: o.id,
      qty: o.qty,
      address: o.address,
      bookSizeName: o.projects?.book_sizes?.name ?? "?",
      pageCount: pageCountMap.get(o.project_id) ?? 0,
      trackingNo: o.tracking_no,
      trackingCarrier: o.tracking_carrier,
    }),
  );

  const buf = await buildShippingExcel(shippingRows);
  const filename = buildShippingExcelFilename();

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(buf.byteLength),
    },
  });
});
