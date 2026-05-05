"use client";

export interface ImageDims {
  width: number;
  height: number;
}

/**
 * 브라우저에서 Image 객체로 실제 픽셀 치수 측정.
 * EXIF orientation 은 무시되고 raw pixel 기준이 반환됨 (서버에서 정규화 후 메타가 갱신됨).
 */
export function probeImage(file: File): Promise<ImageDims> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => URL.revokeObjectURL(url);

    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      cleanup();
      resolve(dims);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("이미지 치수를 읽지 못했습니다."));
    };
    img.src = url;
  });
}
