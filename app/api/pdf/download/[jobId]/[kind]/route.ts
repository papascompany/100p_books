import "server-only";

import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { getPdfJob } from "@/lib/pdf/job-runner";
import { downloadFile } from "@/lib/storige/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pdf/download/:jobId/:kind   (kind = cover | interior)
 *
 * 에디터 PDF 빌드(/api/pdf/build) 산출물 다운로드 서버 프록시.
 *   - jobId(pdf_build_jobs) 의 소유자만 허용(job.user_id === 로그인 사용자).
 *   - cover_pdf_key / interior_pdf_key 에 담긴 Storige fileId 로 바이트 스트리밍.
 *   - fileId 는 클라에 노출하지 않는다(항상 프록시 경유).
 */
export async function GET(
  _req: Request,
  { params }: { params: { jobId: string; kind: string } },
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

  const job = await getPdfJob(params.jobId);
  if (!job) return new NextResponse("not found", { status: 404 });
  if (job.user_id !== user.id) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const fileId = kind === "cover" ? job.cover_pdf_key : job.interior_pdf_key;
  if (!fileId) return new NextResponse("PDF not ready", { status: 404 });

  // 파일명 — 프로젝트 제목(best-effort).
  let title = "photobook";
  try {
    const admin = createAdminSupabase();
    const { data: project } = await admin
      .from("projects")
      .select("title")
      .eq("id", job.project_id)
      .maybeSingle();
    if (project?.title) title = project.title;
  } catch {
    // ignore
  }
  const filename = `${title}-${kind}.pdf`;

  try {
    const resp = await downloadFile(fileId);
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

/** RFC 5987 — 한글 파일명 안전 처리. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    name,
  )}`;
}
