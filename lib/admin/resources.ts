import "server-only";

import type { createAdminSupabase } from "@/lib/db/admin";
import type { Resource, ResourceType } from "@/lib/db/types";
import { UNTRUSTED_INPUT_OPTIONS, loadHardenedSharp } from "@/lib/image/sharp-safe";
import { sniffAllowedImage } from "@/lib/image/sniff";

export const RESOURCES_BUCKET = "resources";

/** 리소스 type 별 허용 확장자 + MIME + size 제한. */
export interface ResourceConstraint {
  /** 허용 확장자 (소문자, 점 미포함). */
  exts: string[];
  /** 허용 MIME (대소 비교 시 toLowerCase). */
  mimes: string[];
  /** 최대 바이트. */
  maxBytes: number;
  /** Storage path prefix. */
  pathPrefix: string;
  /** 표시명 (UI / 에러 메시지). */
  label: string;
}

export const RESOURCE_CONSTRAINTS: Record<ResourceType, ResourceConstraint> = {
  font: {
    exts: ["ttf", "otf", "woff2"],
    mimes: [
      "font/ttf",
      "font/otf",
      "font/woff2",
      "application/font-sfnt",
      "application/x-font-ttf",
      "application/x-font-opentype",
      "application/octet-stream", // 일부 브라우저는 폰트 MIME 누락
    ],
    maxBytes: 5 * 1024 * 1024,
    pathPrefix: "fonts",
    label: "폰트",
  },
  clipart: {
    exts: ["svg", "png"],
    mimes: ["image/svg+xml", "image/png"],
    maxBytes: 2 * 1024 * 1024,
    pathPrefix: "cliparts",
    label: "클립아트",
  },
  background: {
    exts: ["jpg", "jpeg", "png"],
    mimes: ["image/jpeg", "image/png"],
    maxBytes: 10 * 1024 * 1024,
    pathPrefix: "backgrounds",
    label: "배경",
  },
};

/** 파일 확장자 (점 미포함, 소문자). */
export function extOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m && m[1] ? m[1].toLowerCase() : "";
}

export function pathFor(
  type: ResourceType,
  resourceId: string,
  ext: string,
): string {
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${RESOURCE_CONSTRAINTS[type].pathPrefix}/${resourceId}.${cleanExt || "bin"}`;
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export function validateUpload(
  type: ResourceType,
  file: { name: string; size: number; type: string },
): ValidateResult {
  const c = RESOURCE_CONSTRAINTS[type];
  if (file.size > c.maxBytes) {
    return {
      ok: false,
      error: `${c.label} 파일은 ${(c.maxBytes / 1024 / 1024).toFixed(0)}MB 이하여야 합니다.`,
    };
  }
  const ext = extOf(file.name);
  if (!c.exts.includes(ext)) {
    return {
      ok: false,
      error: `허용 확장자: ${c.exts.join(", ")}`,
    };
  }
  // MIME 은 누락되는 경우가 있어 ext 와 둘 중 하나만 통과해도 OK 로 둔다.
  if (file.type && !c.mimes.includes(file.type.toLowerCase())) {
    // 폰트는 MIME 누락이 흔하므로 경고만 — 차단 X. 다른 type 도 ext 로 1차 통과했으니 허용.
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Direct-to-storage 서명 업로드 (Vercel 4.5MB 본문 제한 우회)
// ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isResourceId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * 서명 URL 발급 전 선언값 검증 — 확장자·선언 크기·MIME.
 * 폰트는 브라우저가 MIME 을 비우거나 제각각으로 주므로 MIME 불일치를 차단하지 않는다(기존 동작).
 * 클립아트·배경은 선언 MIME 이 있으면 허용 목록이어야 한다. 최종 판정은 finalize 의 매직 바이트.
 */
export function validateUploadDeclaration(
  type: ResourceType,
  file: { name: string; size: number; type: string },
): ValidateResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "빈 파일은 업로드할 수 없습니다." };
  }
  const base = validateUpload(type, file);
  if (!base.ok) return base;
  const c = RESOURCE_CONSTRAINTS[type];
  if (type !== "font" && file.type && !c.mimes.includes(file.type.toLowerCase())) {
    return { ok: false, error: `허용 MIME: ${c.mimes.join(", ")}` };
  }
  return { ok: true };
}

const hasPrefix = (b: Uint8Array, sig: number[]): boolean =>
  b.length >= sig.length && sig.every((v, i) => b[i] === v);

/**
 * 폰트/클립아트 실제 바이트 판정 (배경은 sniffAllowedImage 사용).
 * ext 와 내용이 일치해야 한다. 순수 함수.
 */
export function sniffResourceBytes(
  type: ResourceType,
  ext: string,
  bytes: Uint8Array,
): ValidateResult {
  const e = ext.toLowerCase();
  if (type === "font") {
    const ok =
      e === "woff2"
        ? hasPrefix(bytes, [0x77, 0x4f, 0x46, 0x32]) // wOF2
        : e === "otf"
          ? hasPrefix(bytes, [0x4f, 0x54, 0x54, 0x4f]) || // OTTO
            hasPrefix(bytes, [0x00, 0x01, 0x00, 0x00])
          : hasPrefix(bytes, [0x00, 0x01, 0x00, 0x00]) || // ttf
            hasPrefix(bytes, [0x74, 0x72, 0x75, 0x65]); // 'true'
    return ok ? { ok: true } : { ok: false, error: "폰트 파일의 실제 형식이 확장자와 일치하지 않습니다." };
  }
  if (type === "clipart") {
    if (e === "png") {
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ? { ok: true }
        : { ok: false, error: "PNG 파일이 아닙니다." };
    }
    const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
    return /<svg[\s>]/i.test(head)
      ? { ok: true }
      : { ok: false, error: "SVG 파일이 아닙니다." };
  }
  return { ok: true };
}

export interface IssuedUploadTarget {
  resourceId: string;
  path: string;
}

/** 서버가 리소스 id 와 storage path 를 만든다. 클라이언트 path 는 신뢰하지 않는다. */
export function issueUploadTarget(
  type: ResourceType,
  filename: string,
  resourceId: string,
): IssuedUploadTarget {
  return { resourceId, path: pathFor(type, resourceId, extOf(filename)) };
}

export interface FinalizeInput {
  type: ResourceType;
  resourceId: string;
  /** 업로드한 원본 파일명 — 확장자만 쓰고 path 는 서버가 재계산한다. */
  filename: string;
  name: string;
  meta: Record<string, unknown> | null;
}

export type FinalizeResult =
  | { ok: true; item: Resource; storageKey: string }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

const ITEM_COLUMNS = "id, type, name, storage_key, meta, active, created_at";

/** type 별 필수 meta 검증 (폰트: family, licenseName). 통과 시 null. */
export function validateResourceMeta(
  type: ResourceType,
  meta: Record<string, unknown> | null,
): string | null {
  if (type !== "font") return null;
  const m = meta ?? {};
  const required = ["family", "licenseName"] as const;
  for (const k of required) {
    if (!m[k] || typeof m[k] !== "string") return `폰트 메타 필수: ${required.join(", ")}`;
  }
  return null;
}

/**
 * 직접 업로드 완료 처리: 객체 존재·실제 크기·매직 바이트(·배경 해상도) 재검증 후 DB INSERT.
 * 검증 실패 시 업로드된 객체를 삭제한다. storage 접근은 service_role(`admin`) 만 사용.
 */
export async function finalizeResourceUpload(
  admin: ReturnType<typeof createAdminSupabase>,
  input: FinalizeInput,
): Promise<FinalizeResult> {
  const { type, resourceId, filename } = input;
  const c = RESOURCE_CONSTRAINTS[type];
  const ext = extOf(filename);
  if (!c.exts.includes(ext)) {
    return { ok: false, status: 400, code: "INVALID_FILE", message: `허용 확장자: ${c.exts.join(", ")}` };
  }
  // 클라이언트가 보낸 path 는 쓰지 않는다 — 발급 시와 동일하게 type+id+ext 로 재계산.
  const storageKey = pathFor(type, resourceId, ext);

  const reject = async (code: string, message: string, details?: unknown): Promise<FinalizeResult> => {
    await admin.storage.from(RESOURCES_BUCKET).remove([storageKey]);
    return { ok: false, status: 400, code, message, details };
  };

  // 이미 등록된 id 면 객체가 기존 리소스 것이므로 검증 실패 삭제 경로에 들어가기 전에 막는다.
  const { data: existing } = await admin
    .from("resources")
    .select("id")
    .eq("id", resourceId)
    .maybeSingle();
  if (existing) {
    return { ok: false, status: 409, code: "ALREADY_REGISTERED", message: "이미 등록된 리소스입니다." };
  }

  const info = await admin.storage.from(RESOURCES_BUCKET).info(storageKey);
  if (info.error || !info.data) {
    return {
      ok: false,
      status: 400,
      code: "UPLOAD_NOT_FOUND",
      message: "업로드된 파일을 찾을 수 없습니다. 다시 업로드하세요.",
    };
  }
  const size = info.data.size ?? 0;
  if (size <= 0 || size > c.maxBytes) {
    return reject(
      "INVALID_FILE",
      `${c.label} 파일은 ${(c.maxBytes / 1024 / 1024).toFixed(0)}MB 이하여야 합니다.`,
      { size },
    );
  }

  const dl = await admin.storage.from(RESOURCES_BUCKET).download(storageKey);
  if (dl.error || !dl.data) {
    return { ok: false, status: 500, code: "DOWNLOAD_FAILED", message: dl.error?.message ?? "파일 검증 실패" };
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  if (buf.length > c.maxBytes) {
    return reject("INVALID_FILE", `${c.label} 파일은 ${(c.maxBytes / 1024 / 1024).toFixed(0)}MB 이하여야 합니다.`);
  }

  if (type === "background") {
    // sharp 디코드 전에 실제 바이트로 형식 확인 (SEC-1).
    const sniffed = sniffAllowedImage(buf, c.mimes);
    if (!sniffed.mime) {
      return reject(
        "INVALID_FILE",
        `배경 파일의 실제 형식이 허용되지 않습니다 (감지: ${sniffed.format}, 허용: ${c.mimes.join(", ")}).`,
      );
    }
    try {
      const sharp = await loadHardenedSharp();
      const m = await sharp(buf, UNTRUSTED_INPUT_OPTIONS).metadata();
      if (!m.width || m.width < 2400) {
        return reject(
          "BACKGROUND_TOO_SMALL",
          `배경 이미지는 가로 2400px 이상이어야 합니다 (현재: ${m.width ?? "?"}px).`,
        );
      }
    } catch (err) {
      // probe 실패는 차단하지 않는다 (기존 동작과 동일).
      console.warn("[admin/resources] sharp probe 실패", err);
    }
  } else {
    const s = sniffResourceBytes(type, ext, buf);
    if (!s.ok) return reject("INVALID_FILE", s.error ?? "파일 검증 실패");
  }

  const { data: inserted, error: insErr } = await admin
    .from("resources")
    .insert({
      id: resourceId,
      type,
      name: input.name,
      storage_key: storageKey,
      meta: input.meta,
      active: true,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (insErr || !inserted) {
    // 23505 = 이미 등록된 id — 기존 row 가 이 객체를 쓰고 있으므로 객체는 지우지 않는다.
    if (insErr?.code === "23505") {
      return { ok: false, status: 409, code: "ALREADY_REGISTERED", message: "이미 등록된 리소스입니다." };
    }
    await admin.storage.from(RESOURCES_BUCKET).remove([storageKey]);
    return { ok: false, status: 500, code: "INSERT_FAILED", message: insErr?.message ?? "DB 등록 실패" };
  }
  return { ok: true, item: inserted as Resource, storageKey };
}
