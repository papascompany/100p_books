import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";
import type { BookSize } from "@/lib/db/types";
import { buildDefaultCoverDoc } from "@/lib/layout/cover";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";

import { buildCoverPdf, buildInteriorPdf, type BuildProgress } from "./build";
import { PDFS_BUCKET, PDF_SIGNED_TTL_SEC } from "./constants";
import { collectFontFamilies, registerProjectFonts } from "./fonts";
import { createJob, updateJob, type PdfJob } from "./jobs";
import { createPhotoResolver } from "./photos";
import { createResourceResolver } from "./resources";

/**
 * `/api/pdf/build` (사용자가 직접 다운로드용 PDF를 만드는 케이스) 와
 * `/api/payments/confirm` (결제 후 자동으로 PDF 빌드 → orders.cover/interior_pdf_key 기록)
 * 양쪽에서 공유하는 빌드 헬퍼.
 *
 *   - DB 에서 project + book_size + pages + cover_json 을 로드.
 *   - PNG 렌더 → pdf-lib 합성.
 *   - Storage 에 업로드 (key 는 호출자가 결정).
 *   - signed URL 은 옵션 — 결제 confirm 케이스는 굳이 필요 없음.
 *
 * 호출자는 인증/소유권 검사를 미리 끝낸 뒤 본 함수를 호출한다.
 * (RLS 우회 admin client 를 사용하므로 프로젝트 ID 만으로 데이터에 접근.)
 */

export type BuildTarget = "interior" | "cover" | "all";

export interface RunProjectPdfBuildArgs {
  projectId: string;
  /** 인증된 사용자의 id — Storage path prefix 로 쓰이며 photo resolver scope. */
  userId: string;
  target: BuildTarget;
  /**
   * Storage path 빌더. key 는 "cover.pdf" | "interior.pdf" 중 하나.
   * 기본 — `${userId}/${projectId}/${key}`.
   *
   * 결제 confirm 케이스에서는 `pdfs/${userId}/${orderId}/${key}` 로 저장하기 위해
   * 호출자가 path 를 명시한다.
   */
  uploadPath?: (key: "cover.pdf" | "interior.pdf") => string;
  /** signedUrl 발급 여부 (default true). */
  signUrls?: boolean;
  /** 사용자 친화적 다운로드 파일명 prefix. 기본은 project.title 슬러그. */
  downloadPrefix?: string;
  /** PDF 메타. */
  meta?: { title?: string; author?: string };
  /** 진행률 보고용 잡 — 미지정 시 내부 생성. */
  job?: PdfJob;
}

export interface RunProjectPdfBuildResult {
  jobId: string;
  /** Storage 키 (signedUrl 과 별개로 DB 저장용). */
  coverKey?: string;
  interiorKey?: string;
  coverUrl?: string;
  interiorUrl?: string;
  durationMs: number;
}

export class PdfBuildError extends Error {
  status = 500;
  code = "BUILD_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "PdfBuildError";
  }
}

interface PageRow {
  id: string;
  page_no: number;
  fabric_json: Record<string, unknown> | null;
}

export async function runProjectPdfBuild(
  args: RunProjectPdfBuildArgs,
): Promise<RunProjectPdfBuildResult> {
  const start = Date.now();
  const admin = createAdminSupabase();

  // 1) project + book_size 로드 (admin 경로에서도 호출 가능하도록 admin client 사용)
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, user_id, book_size_id, title, cover_json")
    .eq("id", args.projectId)
    .maybeSingle();
  if (projErr || !project) {
    throw new PdfBuildError(
      projErr?.message ?? `프로젝트를 찾을 수 없습니다: ${args.projectId}`,
    );
  }

  const { data: size, error: sizeErr } = await admin
    .from("book_sizes")
    .select(
      "id, name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order, created_at",
    )
    .eq("id", project.book_size_id)
    .maybeSingle();
  if (sizeErr || !size) {
    throw new PdfBuildError(sizeErr?.message ?? "책 사이즈를 찾을 수 없습니다.");
  }
  const bookSize: BookSize = size;

  // 2) pages 로드 (interior / all)
  let pageDocs: PageDoc[] = [];
  if (args.target === "interior" || args.target === "all") {
    const { data: rows, error: pagesErr } = await admin
      .from("pages")
      .select("id, page_no, fabric_json")
      .eq("project_id", args.projectId)
      .order("page_no", { ascending: true });
    if (pagesErr) throw new PdfBuildError(pagesErr.message);

    const validRows = ((rows ?? []) as PageRow[]).filter((r) => {
      const doc = r.fabric_json as PageDoc | null;
      return doc && isPageDoc(doc);
    });
    if (validRows.length === 0) {
      throw new PdfBuildError(
        "내지 페이지가 비어있습니다. 자동 편집을 먼저 진행하세요.",
      );
    }
    pageDocs = validRows.map((r) => r.fabric_json as unknown as PageDoc);
  }

  // 3) cover 로드 (cover / all)
  let coverDoc: PageDoc | null = null;
  let interiorPageCount = pageDocs.length;
  if (args.target === "cover" || args.target === "all") {
    if (interiorPageCount === 0) {
      const { count } = await admin
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("project_id", args.projectId);
      interiorPageCount = count ?? 0;
    }
    const stored = project.cover_json as PageDoc | null;
    if (stored && isPageDoc(stored) && stored.layoutMode === "cover") {
      coverDoc = stored;
    } else {
      coverDoc = buildDefaultCoverDoc({
        bookSize,
        pageCount: interiorPageCount,
        title: project.title ?? "Untitled",
      });
    }
  }

  // 4) 잡 — 외부 주입 또는 새로 생성
  const job =
    args.job ?? createJob({ projectId: args.projectId, userId: args.userId });
  const totalSteps =
    (args.target === "interior" || args.target === "all"
      ? pageDocs.length
      : 0) + (args.target === "cover" || args.target === "all" ? 1 : 0);
  updateJob(job.id, {
    status: "running",
    progress: { done: 0, total: totalSteps, phase: "render" },
  });

  // 5) 폰트
  const families = collectFontFamilies([
    ...pageDocs,
    ...(coverDoc ? [coverDoc] : []),
  ]);
  await registerProjectFonts({ families });

  // 6) photo resolver + resource resolver (clipart / background)
  const { resolve: resolvePhoto } = createPhotoResolver({
    projectId: args.projectId,
  });
  const resourceResolver = createResourceResolver();

  // 7) 빌드 + 업로드
  const result: {
    coverKey?: string;
    interiorKey?: string;
    coverUrl?: string;
    interiorUrl?: string;
  } = {};
  let cumulativeDone = 0;
  const signUrls = args.signUrls ?? true;
  const uploadPath =
    args.uploadPath ??
    ((key) => `${args.userId}/${args.projectId}/${key}`);
  const downloadPrefix = args.downloadPrefix ?? slug(project.title ?? "book");

  const reportProgress = (p: BuildProgress) => {
    if (p.phase !== "render") return;
    const done = cumulativeDone + p.done;
    updateJob(job.id, {
      progress: { done, total: totalSteps, phase: p.phase },
    });
  };

  try {
    if (args.target === "interior" || args.target === "all") {
      const interiorBuf = await buildInteriorPdf({
        pages: pageDocs,
        bookSize,
        resolveImageUrl: resolvePhoto,
        resolveBackgroundUrl: resourceResolver.resolveBackground,
        resolveClipart: resourceResolver.resolveClipart,
        meta: args.meta ?? {
          title: project.title ?? "Untitled",
          author: "100p_books",
        },
        onProgress: reportProgress,
      });
      cumulativeDone += pageDocs.length;

      const interiorKey = uploadPath("interior.pdf");
      const { error: upErr } = await admin.storage
        .from(PDFS_BUCKET)
        .upload(interiorKey, interiorBuf, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new PdfBuildError(`interior upload: ${upErr.message}`);
      result.interiorKey = interiorKey;

      if (signUrls) {
        const { data: signed, error: signErr } = await admin.storage
          .from(PDFS_BUCKET)
          .createSignedUrl(interiorKey, PDF_SIGNED_TTL_SEC, {
            download: `${downloadPrefix}-interior.pdf`,
          });
        if (signErr || !signed?.signedUrl) {
          throw new PdfBuildError(
            `interior sign: ${signErr?.message ?? "no url"}`,
          );
        }
        result.interiorUrl = signed.signedUrl;
      }
    }

    if ((args.target === "cover" || args.target === "all") && coverDoc) {
      const coverBuf = await buildCoverPdf({
        coverDoc,
        bookSize,
        pageCount: interiorPageCount,
        resolveImageUrl: resolvePhoto,
        resolveBackgroundUrl: resourceResolver.resolveBackground,
        resolveClipart: resourceResolver.resolveClipart,
        meta: args.meta ?? {
          title: project.title ?? "Untitled",
          author: "100p_books",
        },
        onProgress: reportProgress,
      });
      cumulativeDone += 1;

      const coverKey = uploadPath("cover.pdf");
      const { error: upErr } = await admin.storage
        .from(PDFS_BUCKET)
        .upload(coverKey, coverBuf, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new PdfBuildError(`cover upload: ${upErr.message}`);
      result.coverKey = coverKey;

      if (signUrls) {
        const { data: signed, error: signErr } = await admin.storage
          .from(PDFS_BUCKET)
          .createSignedUrl(coverKey, PDF_SIGNED_TTL_SEC, {
            download: `${downloadPrefix}-cover.pdf`,
          });
        if (signErr || !signed?.signedUrl) {
          throw new PdfBuildError(
            `cover sign: ${signErr?.message ?? "no url"}`,
          );
        }
        result.coverUrl = signed.signedUrl;
      }
    }

    updateJob(job.id, {
      status: "done",
      progress: { done: totalSteps, total: totalSteps, phase: "compose" },
      result: { coverUrl: result.coverUrl, interiorUrl: result.interiorUrl },
    });

    return {
      jobId: job.id,
      coverKey: result.coverKey,
      interiorKey: result.interiorKey,
      coverUrl: result.coverUrl,
      interiorUrl: result.interiorUrl,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateJob(job.id, { status: "failed", error: msg });
    if (e instanceof PdfBuildError) throw e;
    throw new PdfBuildError(msg);
  }
}

/** 파일명용 안전 문자열. */
export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\-가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "book"
  );
}
