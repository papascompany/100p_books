import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin, requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import type { OrderStatus } from "@/lib/db/types";
import { canDownloadPdfs } from "@/lib/orders/state";
import { PDFS_BUCKET } from "@/lib/pdf/constants";
import { downloadFile } from "@/lib/storige/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/orders/:id/download/:kind   (kind = cover | interior)
 *
 * 표지/내지 PDF 다운로드 **서버 프록시**.
 *   - 소유자 또는 admin 만 허용 (요청마다 서버에서 인증 — signedUrl TTL 불필요).
 *   - 비-admin 은 canDownloadPdfs(status) 통과해야 함.
 *   - 신규 주문: orders.storige_*_file_id 로 Storige 에서 바이트 스트리밍.
 *   - 레거시 주문: orders.cover/interior_pdf_key(Supabase) 도 서버에서 바이트 프록시.
 *
 * fileId·signedUrl 은 클라에 노출하지 않는다 (항상 이 프록시를 경유).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string; kind: string } },
) {
  const kind = params.kind;
  if (kind !== "cover" && kind !== "interior") {
    return new NextResponse("invalid kind", { status: 400 });
  }

  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, user_id, status, storige_cover_file_id, storige_interior_file_id, cover_pdf_key, interior_pdf_key, projects(title)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (error) return new NextResponse("order query failed", { status: 500 });
  if (!order) return new NextResponse("not found", { status: 404 });

  // 인가 — 소유자 또는 admin.
  const isOwner = order.user_id === user.id;
  let isAdmin = false;
  if (!isOwner) {
    try {
      await requireAdmin();
      isAdmin = true;
    } catch {
      return new NextResponse("forbidden", { status: 403 });
    }
  }
  // 비-admin 은 결제 이후 상태에서만 다운로드 가능.
  if (!isAdmin && !canDownloadPdfs(order.status as OrderStatus)) {
    return new NextResponse("not downloadable in current status", {
      status: 403,
    });
  }

  const fileId =
    kind === "cover"
      ? order.storige_cover_file_id
      : order.storige_interior_file_id;
  const legacyKey =
    kind === "cover" ? order.cover_pdf_key : order.interior_pdf_key;
  const project = order.projects as unknown as { title: string | null } | null;
  const filename = `${project?.title ?? "book"}-${kind}.pdf`;

  // 신규: Storige 스트리밍.
  if (fileId) {
    try {
      const resp = await downloadFile(fileId);
      // body 가 비어있으면(2xx + 빈 본문) 빈 200 으로 침묵 실패하지 않도록 차단.
      if (!resp.body) {
        return new NextResponse("storige empty body", { status: 502 });
      }
      return new NextResponse(resp.body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": contentDisposition(filename),
          "cache-control": "private, no-store",
        },
      });
    } catch {
      return new NextResponse("storige download failed", { status: 502 });
    }
  }

  // 레거시: 신규 경로와 동일하게 서버에서 바이트를 프록시 스트리밍.
  // (signedUrl 302 리다이렉트는 TTL 동안 인증 없이 공유/유출 가능해
  //  per-request 인가를 우회하므로 제거.)
  if (legacyKey) {
    const { data: blob, error: dlErr } = await admin.storage
      .from(PDFS_BUCKET)
      .download(legacyKey);
    if (dlErr || !blob) return new NextResponse("not found", { status: 404 });
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": contentDisposition(filename),
        "cache-control": "private, no-store",
      },
    });
  }

  return new NextResponse("PDF not ready", { status: 404 });
}

/** RFC 5987 — 한글 파일명 안전 처리 (ascii fallback + UTF-8). */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    name,
  )}`;
}
