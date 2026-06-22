import "server-only";

import { z } from "zod";

import { fail, failFromError, ok } from "@/app/api/_lib/response";
import { requireActiveUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { enqueueAndRunPdfJob } from "@/lib/pdf/job-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  projectId: z.string().uuid(),
  target: z.enum(["interior", "cover", "all"]).default("all"),
});

/**
 * POST /api/pdf/build
 *
 * 에디터의 사용자향 PDF 다운로드. 본인 프로젝트의 표지/내지 PDF 를 생성해
 * Storige 에 업로드하고, 다운로드는 서버 프록시(/api/pdf/download/:jobId/:kind)로 한다.
 *
 *   body: { projectId, target: 'interior'|'cover'|'all' }
 *   → { jobId, coverUrl?, interiorUrl? }   (target 에 맞는 URL 만 포함)
 *
 * 인증: requireActiveUser (getUser 검증 + 탈퇴 가드). 본인 소유 프로젝트만.
 * 빌드는 동기 실행(수십 초) — 응답 시점엔 Storige 업로드까지 완료.
 *   (진행률 SSE 는 인메모리 job 기반이라 본 영속 jobId 와 무관 — 클라가 graceful close.)
 */
export async function POST(req: Request) {
  try {
    const user = await requireActiveUser();

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return fail(
        "INVALID_BODY",
        "요청 본문이 올바르지 않습니다.",
        400,
        parsed.error.flatten(),
      );
    }
    const { projectId, target } = parsed.data;

    const admin = createAdminSupabase();

    // 소유권 검사 — runProjectPdfBuild 는 admin(RLS 우회)이라 라우트에서 직접 확인.
    const { data: project, error: projErr } = await admin
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return fail("PROJECT_QUERY_FAILED", projErr.message, 500);
    if (!project) return fail("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    if (project.user_id !== user.id) {
      return fail("FORBIDDEN", "본인 프로젝트만 빌드할 수 있습니다.", 403);
    }

    // 영속 잡으로 빌드 + Storige 업로드 (order 무관 → orderId 없음).
    const result = await enqueueAndRunPdfJob(
      { projectId, userId: user.id, target },
      { meta: { author: "100p_books" } },
    );
    if (!result.ok) {
      return fail("BUILD_FAILED", result.error ?? "PDF 빌드에 실패했습니다.", 500);
    }

    const base = `/api/pdf/download/${result.jobId}`;
    const wantCover = target === "cover" || target === "all";
    const wantInterior = target === "interior" || target === "all";
    return ok({
      jobId: result.jobId,
      coverUrl: wantCover ? `${base}/cover` : undefined,
      interiorUrl: wantInterior ? `${base}/interior` : undefined,
    });
  } catch (err) {
    return failFromError(err);
  }
}
