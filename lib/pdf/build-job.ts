import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";
import type { BookSize } from "@/lib/db/types";
import { buildDefaultCoverDoc } from "@/lib/layout/cover";
import { isPageDoc, type PageDoc } from "@/lib/layout/types";

import type { StorigeValidationResult } from "@/lib/db/types";
import { uploadPdf, validatePdf, STORIGE_ENABLED } from "@/lib/storige/client";

import { buildCoverPdf, buildInteriorPdf, type BuildProgress } from "./build";
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
 *   - 렌더 → pdf-lib 합성 (자체 렌더러 — 변경 없음).
 *   - **Storige 인쇄 백엔드에 업로드** (POST /files/upload/external → fileId).
 *   - (권장) Storige 인쇄 검증(CMYK/재단선/해상도) 호출 → 결과 캐시.
 *
 * 저장처는 Supabase `pdfs` 버킷 → Storige 로 일원화됨. 다운로드는 서버 프록시
 * (/api/orders/[id]/download/[kind]) 가 fileId 로 Storige 에서 스트리밍한다.
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
   * 논리 파일명 빌더 (Storige multipart filename + 감사 로그용). key 는
   * "cover.pdf" | "interior.pdf". 기본 — `${userId}/${projectId}/${key}`.
   *
   * Storige 는 저장 경로를 받지 않으므로(파일 식별은 fileId) 이 값은 더 이상
   * 저장 위치를 결정하지 않는다. 호환을 위해 시그니처는 유지한다.
   */
  uploadPath?: (key: "cover.pdf" | "interior.pdf") => string;
  /** (레거시) signedUrl 발급 플래그 — Storige 전환 후 미사용. 호환 위해 유지. */
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
  /** Storige 파일 ID (orders.storige_cover_file_id / pdf_build_jobs 추적용). */
  coverKey?: string;
  interiorKey?: string;
  /** Storige 인쇄 검증 결과 (best-effort). */
  coverValidation?: StorigeValidationResult;
  interiorValidation?: StorigeValidationResult;
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

  // 7) 빌드 + 업로드 (Storige)
  const result: {
    coverKey?: string;
    interiorKey?: string;
    coverValidation?: StorigeValidationResult;
    interiorValidation?: StorigeValidationResult;
  } = {};
  let cumulativeDone = 0;
  const uploadPath =
    args.uploadPath ??
    ((key) => `${args.userId}/${args.projectId}/${key}`);
  const downloadPrefix = args.downloadPrefix ?? slug(project.title ?? "book");
  // STORIGE_VALIDATE=false 로 인쇄 검증 비활성 가능 (기본 활성).
  const doValidate = process.env.STORIGE_VALIDATE !== "false";
  // 검증은 best-effort 캐시일 뿐(주문/생산을 gate 하지 않음)이며 빌드-업로드
  // 임계경로(target='all' 이면 2회 직렬)에서 호출된다. 폴링 예산을 짧게 잡아
  // 미종착 시 빌드 꼬리에 더해지는 시간을 줄인다(기본 15s×2 → 4s×2).
  const validatePoll = { maxMs: 4000 } as const;

  // Storige 미설정이면 빌드 잡을 실패로 남겨(throw) 재시도 가능하게 한다.
  //   - 결제는 이미 살아있고(confirm), pdf_build_jobs 행이 남아 admin 이 재시도.
  //   - fail-open(무시)하면 결제 주문에 PDF 가 영영 없게 되므로 금지.
  if (!STORIGE_ENABLED) {
    updateJob(job.id, {
      status: "failed",
      error: "STORIGE_API_KEY 미설정 — PDF 업로드 불가",
    });
    throw new PdfBuildError("STORIGE_API_KEY 가 설정되지 않았습니다.");
  }

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

      // Storige 업로드 (내지 = content)
      const up = await uploadPdf(interiorBuf, {
        type: "content",
        filename: `${downloadPrefix}-interior.pdf`,
      }).catch((e) => {
        throw new PdfBuildError(
          `interior upload (Storige): ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      result.interiorKey = up.id;
      void uploadPath; // 호환 시그니처 — Storige 는 경로를 받지 않음

      // 인쇄 검증 (best-effort — 실패해도 빌드/주문을 막지 않음)
      if (doValidate) {
        result.interiorValidation = await validatePdf(
          {
            fileId: up.id,
            fileType: "content",
            orderOptions: {
              // 내지 PDF 페이지 = 판형 + 블리드×2 (build.ts) → size+bleed 매칭으로 통과.
              size: { width: bookSize.width_mm, height: bookSize.height_mm },
              pages: pageDocs.length,
              binding: "perfect",
              bleed: 2,
              // DD 페이지규칙: 무선(perfect)=2. 미전송 시 워커 레거시가 4의 배수를
              // 강제해 짝수 페이지수(50 등)도 PAGE_COUNT_INVALID(FIXABLE) 오탐.
              pageMultiple: 2,
            },
          },
          validatePoll,
        );
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

      // Storige 업로드 (표지 = cover)
      const up = await uploadPdf(coverBuf, {
        type: "cover",
        filename: `${downloadPrefix}-cover.pdf`,
      }).catch((e) => {
        throw new PdfBuildError(
          `cover upload (Storige): ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      result.coverKey = up.id;

      if (doValidate) {
        result.coverValidation = await validatePdf(
          {
            fileId: up.id,
            fileType: "cover",
            orderOptions: {
              // 표지 PDF 페이지 = coverDoc(북폭×2+책등, 블리드 제외) + 블리드×2 (build.ts)
              // → size 에 통판 스프레드를 보내야 워커 size 검증(size+bleed 매칭)을 통과.
              //   판형을 보내면 표지 예외가 없는 validatePageSize 가 SIZE_MISMATCH 오탐.
              // ⚠️ spineWidthMm/paperThickness 는 보내지 않는다 — 워커 spine 공식
              //   (size.width×2+spine)과 스프레드 size 가 충돌해 필패. 미전송 시 spine
              //   검증은 생략되며, 책등 정합은 우리 빌더가 자체 검증(cover width assert).
              size: { width: coverDoc.widthMm, height: coverDoc.heightMm },
              pages: interiorPageCount,
              binding: "perfect",
              bleed: coverDoc.bleedMm ?? 2,
            },
          },
          validatePoll,
        );
      }
    }

    updateJob(job.id, {
      status: "done",
      progress: { done: totalSteps, total: totalSteps, phase: "compose" },
    });

    return {
      jobId: job.id,
      coverKey: result.coverKey,
      interiorKey: result.interiorKey,
      coverValidation: result.coverValidation,
      interiorValidation: result.interiorValidation,
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
