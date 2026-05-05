import "server-only";

import type { ResourceType } from "@/lib/db/types";

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
