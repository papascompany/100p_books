"use client";

/**
 * iOS Safari/Chrome 등에서 .heic 파일을 JPEG 로 변환.
 * heic2any 는 brotli 압축된 libheif 를 동적으로 가져오므로 첫 변환 시 수백KB 정도 가중.
 * 동적 import 로 초기 번들에서 제외.
 */
export async function convertHeicIfNeeded(file: File): Promise<File> {
  const mime = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  const looksHeic =
    mime === "image/heic" ||
    mime === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif");

  if (!looksHeic) return file;

  const heic2any = (await import("heic2any")).default;

  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.92,
  });

  // heic2any 는 단일 페이지면 Blob, 멀티페이지면 Blob[] 반환
  const blob = Array.isArray(converted) ? converted[0]! : converted;
  const baseName = file.name.replace(/\.[^.]+$/i, "");
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
