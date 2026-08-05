/**
 * PDF 회귀 테스트 — 페이지 수 + 첫 페이지 해시 비교 (CLAUDE.md §테스트 명시 항목).
 *
 *   pnpm test:pdf          # 검증 (baseline 대조)
 *   pnpm test:pdf:update   # baseline 갱신 (렌더 변경을 의도한 경우에만)
 *
 * 검증 2계층:
 *
 *   1) 구조 (플랫폼 무관 — 항상 엄격 비교)
 *      내지/표지 PDF 의 페이지 수와 페이지 크기(pt)를 baseline 과 대조한다.
 *      PDF 바이트 전체는 setCreationDate(new Date()) 때문에 매 실행 달라지므로
 *      해시 대상이 될 수 없다 → pdf-lib 으로 로드해 구조만 읽는다.
 *
 *   2) 픽셀 (플랫폼별 — 같은 OS/arch 안에서 엄격 비교)
 *      각 케이스 첫 페이지를 renderPageToJpeg 로 렌더한 SHA-256.
 *      @napi-rs/canvas 래스터라이저와 폰트 폴백이 OS/arch 마다 달라
 *      baseline 을 `${platform}-${arch}` 키로 분리 저장한다.
 *      해당 키가 없으면 "새 플랫폼"으로 보고 기록 후 통과(첫 실행/새 CI 러너).
 *
 * 불일치 시: tmp/pdf-regression/ 에 실제 렌더를 덤프하고 exit 1.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PDFDocument } from "pdf-lib";

import type { BookSize } from "@/lib/db/types";
import { calcCoverDimensions } from "@/lib/layout/cover";
import { PAGEDOC_VERSION, type PageDoc } from "@/lib/layout/types";
import { buildCoverPdf, buildInteriorPdf } from "@/lib/pdf/build";
import { renderPageToJpeg } from "@/lib/pdf/render-page";

const BASELINE_PATH = resolve(process.cwd(), "test/fixtures/pdf-baseline.json");
const DUMP_DIR = resolve(process.cwd(), "tmp/pdf-regression");
const UPDATE =
  process.argv.includes("--update") || process.env.UPDATE_PDF_BASELINE === "1";

/** 플랫폼 키 — 픽셀 해시는 이 키 아래에만 유효하다. */
const PLATFORM_KEY = `${process.platform}-${process.arch}`;

/** 32×32 단색 PNG — 외부 의존 없이 photo 렌더 경로를 태우기 위한 더미. */
const DUMMY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJklEQVR4nO3OMQEAAAjDMMC/56" +
    "EBznSgvW0lQghtEELYIYSwQwhhh17/AmHsErl/AAAAAElFTkSuQmCC",
  "base64",
);

const BOOK_SIZE: BookSize = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "regression-145sq",
  width_mm: 145,
  height_mm: 145,
  // 0003_seed.sql 규약: cover_width_mm 은 펼침(앞+뒤) 폭 — 책등 제외.
  cover_width_mm: 296,
  cover_height_mm: 149,
  spine_formula_per_page: 0.09,
  active: true,
  display_order: 0,
  created_at: "2026-01-01T00:00:00.000Z",
};

const basePage = {
  version: PAGEDOC_VERSION,
  bookSizeId: BOOK_SIZE.id,
  layoutMode: "polaroid",
  widthMm: 145,
  heightMm: 145,
  bleedMm: 2,
  backgroundColor: "#fafafa",
} as const;

/** 케이스 1 — 도형만. 폰트 폴백에 의존하지 않아 가장 안정적인 회귀 신호. */
const shapesDoc: PageDoc = {
  ...basePage,
  pageNo: 1,
  objects: [
    {
      type: "rect",
      objectId: "r1",
      leftMm: 10,
      topMm: 10,
      widthMm: 125,
      heightMm: 125,
      fill: "#ffffff",
      borderRadiusMm: 2,
    },
    {
      type: "rect",
      objectId: "r2",
      leftMm: 40,
      topMm: 40,
      widthMm: 65,
      heightMm: 65,
      fill: "#ff6b5e",
      borderRadiusMm: 12,
    },
  ],
};

/** 케이스 2 — 사진 + borderRadius + shadow (render-page 의 2-pass 클립 경로). */
const photoDoc: PageDoc = {
  ...basePage,
  pageNo: 2,
  objects: [
    {
      type: "photo",
      objectId: "p1",
      photoId: "dummy-photo-1",
      leftMm: 30,
      topMm: 30,
      widthMm: 85,
      heightMm: 85,
      rotation: 0,
      cropMode: "cover",
      borderRadiusMm: 8,
      shadow: { blurMm: 3, offsetYMm: 1.5, color: "rgba(0,0,0,0.35)" },
    },
  ],
};

/** 케이스 3 — 텍스트(줄바꿈·CJK 혼용). 폰트 폴백 변화까지 감지한다. */
const textDoc: PageDoc = {
  ...basePage,
  pageNo: 3,
  objects: [
    {
      type: "text",
      objectId: "t1",
      leftMm: 20,
      topMm: 50,
      widthMm: 105,
      heightMm: 20,
      text: "100p Books PDF 회귀",
      fontFamily: "Pretendard",
      fontSizePt: 20,
      fill: "#111111",
      align: "center",
      lineHeight: 1.4,
    },
    {
      type: "text",
      objectId: "t2",
      leftMm: 20,
      topMm: 80,
      widthMm: 105,
      heightMm: 30,
      text: "Hello, World!\n안녕, 세계.",
      fontFamily: "Pretendard",
      fontSizePt: 14,
      fill: "#444444",
      align: "center",
      lineHeight: 1.6,
    },
  ],
};

const INTERIOR_CASES: Array<{ name: string; doc: PageDoc }> = [
  { name: "shapes", doc: shapesDoc },
  { name: "photo-shadow", doc: photoDoc },
  { name: "text", doc: textDoc },
];

const COVER_PAGE_COUNT = 100;

/** 표지 — 펼침(뒤+책등+앞) 한 장. calcCoverDimensions 가 폭 정본. */
function buildCoverDoc(): PageDoc {
  const dims = calcCoverDimensions({
    bookSize: BOOK_SIZE,
    pageCount: COVER_PAGE_COUNT,
  });
  return {
    version: PAGEDOC_VERSION,
    bookSizeId: BOOK_SIZE.id,
    pageNo: 0,
    layoutMode: "cover",
    widthMm: dims.totalWidthMm,
    heightMm: dims.totalHeightMm,
    bleedMm: 2,
    backgroundColor: "#f8f5f0",
    objects: [
      {
        type: "rect",
        objectId: "cover-bg",
        leftMm: dims.bookWidthMm + dims.spineMm,
        topMm: 0,
        widthMm: dims.bookWidthMm,
        heightMm: dims.totalHeightMm,
        fill: "#ffffff",
      },
    ],
  };
}

interface StructureSnapshot {
  pageCount: number;
  /** 페이지별 [width, height] (pt, 소수 2자리 반올림). */
  pageSizesPt: Array<[number, number]>;
}

interface Baseline {
  /** 구조 — 플랫폼 무관. */
  structure: Record<string, StructureSnapshot>;
  /** 픽셀 해시 — `${platform}-${arch}` → 케이스명 → sha256. */
  pixels: Record<string, Record<string, string>>;
}

const sha256 = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function snapshotStructure(pdfBytes: Buffer): Promise<StructureSnapshot> {
  const doc = await PDFDocument.load(pdfBytes);
  return {
    pageCount: doc.getPageCount(),
    pageSizesPt: doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return [round2(width), round2(height)] as [number, number];
    }),
  };
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return { structure: {}, pixels: {} };
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
    return {
      structure: parsed.structure ?? {},
      pixels: parsed.pixels ?? {},
    };
  } catch (e) {
    throw new Error(
      `[pdf-regression] baseline 파싱 실패 (${BASELINE_PATH}): ${String(e)}`,
    );
  }
}

function saveBaseline(baseline: Baseline): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

const failures: string[] = [];
const notes: string[] = [];
/** 이번 실행에서 이 플랫폼의 픽셀 baseline 이 처음 기록됐는지. */
let newPlatform = false;

function dump(name: string, buf: Buffer, ext: string): string {
  mkdirSync(DUMP_DIR, { recursive: true });
  const p = resolve(DUMP_DIR, `${name}.${ext}`);
  writeFileSync(p, buf);
  return p;
}

/** 구조 비교 — 항상 엄격. */
function checkStructure(
  key: string,
  actual: StructureSnapshot,
  baseline: Baseline,
): void {
  const expected = baseline.structure[key];
  if (UPDATE || !expected) {
    baseline.structure[key] = actual;
    notes.push(
      `structure/${key}: ${expected ? "갱신" : "신규 기록"} — pages=${actual.pageCount}`,
    );
    return;
  }
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures.push(
      `structure/${key} 불일치\n    baseline: ${b}\n    actual  : ${a}`,
    );
    return;
  }
  notes.push(
    `structure/${key}: OK — pages=${actual.pageCount}, size=${actual.pageSizesPt[0]?.join("×")}pt`,
  );
}

/** 픽셀 해시 비교 — 플랫폼 키 단위. */
function checkPixels(
  name: string,
  jpeg: Buffer,
  baseline: Baseline,
): void {
  const hash = sha256(jpeg);
  const table = (baseline.pixels[PLATFORM_KEY] ??= {});
  const expected = table[name];

  if (UPDATE || !expected) {
    table[name] = hash;
    // 신규 플랫폼(예: CI 러너)에서는 전체 해시를 남긴다 —
    // 로그에서 그대로 baseline 에 옮겨 적어 다음 실행부터 실제 비교가 되도록.
    notes.push(
      expected
        ? `pixels/${name}@${PLATFORM_KEY}: 갱신 — ${hash.slice(0, 16)}…`
        : `pixels/${name}@${PLATFORM_KEY}: 신규 플랫폼 기록 — ${hash}`,
    );
    newPlatform = true;
    return;
  }
  if (expected !== hash) {
    const p = dump(`${name}-actual`, jpeg, "jpg");
    failures.push(
      `pixels/${name}@${PLATFORM_KEY} 불일치\n` +
        `    baseline: ${expected}\n` +
        `    actual  : ${hash}\n` +
        `    실제 렌더: ${p}\n` +
        `    렌더 변경이 의도된 것이면: pnpm test:pdf:update`,
    );
    return;
  }
  notes.push(`pixels/${name}@${PLATFORM_KEY}: OK — ${hash.slice(0, 16)}…`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  // 시작 로그 — CI 에서 어느 단계까지 갔는지(모듈 로드/렌더/구조) 구분하기 위해.
  console.log(
    `[pdf-regression] start platform=${PLATFORM_KEY} node=${process.version} update=${UPDATE}`,
  );
  const baseline = loadBaseline();

  const renderCtx = {
    resolveImageUrl: async (photoId: string): Promise<Buffer> => {
      if (photoId === "dummy-photo-1") return DUMMY_PNG;
      throw new Error(`[pdf-regression] 예상치 못한 photoId: ${photoId}`);
    },
  };

  // ── 1) 케이스별 첫 페이지 픽셀 해시 ──────────────────────────────
  for (const c of INTERIOR_CASES) {
    const jpeg = await renderPageToJpeg(c.doc, renderCtx);
    checkPixels(c.name, jpeg, baseline);
  }
  const coverDoc = buildCoverDoc();
  checkPixels("cover", await renderPageToJpeg(coverDoc, renderCtx), baseline);

  // ── 2) 내지 PDF 구조 (3페이지) ──────────────────────────────────
  const interiorPdf = await buildInteriorPdf({
    pages: INTERIOR_CASES.map((c) => c.doc),
    bookSize: BOOK_SIZE,
    resolveImageUrl: renderCtx.resolveImageUrl,
    meta: { title: "pdf-regression interior", author: "scripts/pdf-regression" },
  });
  if (interiorPdf.subarray(0, 4).toString() !== "%PDF") {
    failures.push("interior PDF 매직 헤더 불일치");
  }
  checkStructure("interior", await snapshotStructure(interiorPdf), baseline);

  // ── 3) 표지 PDF 구조 (1페이지, 펼침 사이즈) ──────────────────────
  const coverPdf = await buildCoverPdf({
    coverDoc,
    bookSize: BOOK_SIZE,
    pageCount: COVER_PAGE_COUNT,
    resolveImageUrl: renderCtx.resolveImageUrl,
    meta: { title: "pdf-regression cover", author: "scripts/pdf-regression" },
  });
  if (coverPdf.subarray(0, 4).toString() !== "%PDF") {
    failures.push("cover PDF 매직 헤더 불일치");
  }
  checkStructure("cover", await snapshotStructure(coverPdf), baseline);

  // ── 리포트 ────────────────────────────────────────────────────
  const elapsed = Date.now() - t0;
  for (const n of notes) console.log(`  ${n}`);

  if (failures.length > 0) {
    console.error(`\n[pdf-regression] FAIL — ${failures.length}건`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  saveBaseline(baseline);
  console.log(
    `\n[pdf-regression] OK — ${INTERIOR_CASES.length + 1} 케이스 / ${elapsed}ms (platform=${PLATFORM_KEY})`,
  );
  if (newPlatform) {
    console.log(
      `[pdf-regression] 주의: ${PLATFORM_KEY} 픽셀 baseline 이 이번에 처음 기록됐습니다.\n` +
        `  이 실행에서는 픽셀 회귀를 비교하지 못했습니다(구조 검증은 정상 수행).\n` +
        `  위 해시를 test/fixtures/pdf-baseline.json 의 pixels["${PLATFORM_KEY}"] 에 커밋하면\n` +
        `  다음 실행부터 이 플랫폼에서도 실제 비교가 이뤄집니다.`,
    );
  }
}

main().catch((err) => {
  console.error("[pdf-regression] ERROR:", err);
  process.exit(1);
});
