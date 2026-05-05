"use client";

export interface ExifMeta {
  takenAt: Date | null;
  camera: string | null;
  orientation: number;
}

/**
 * EXIF 메타 추출. GPS 는 절대 추출하지 않음 (개인정보 보호).
 * exifr 동적 import 로 초기 번들에서 제외.
 */
export async function extractExifMeta(file: File): Promise<ExifMeta> {
  try {
    const exifr = (await import("exifr")).default;
    const meta = (await exifr.parse(file, {
      gps: false,
      // 필요한 태그만 명시 — exifr 가 다른 섹션을 스킵.
      pick: ["DateTimeOriginal", "CreateDate", "Make", "Model", "Orientation"],
    })) as
      | {
          DateTimeOriginal?: Date;
          CreateDate?: Date;
          Make?: string;
          Model?: string;
          Orientation?: number;
        }
      | undefined;

    const d = meta?.DateTimeOriginal ?? meta?.CreateDate ?? null;
    const takenAt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;

    const makeModel = [meta?.Make?.trim(), meta?.Model?.trim()]
      .filter(Boolean)
      .join(" ");
    const camera = makeModel.length > 0 ? makeModel : null;

    const orientation = typeof meta?.Orientation === "number" ? meta.Orientation : 1;

    return { takenAt, camera, orientation };
  } catch {
    return { takenAt: null, camera: null, orientation: 1 };
  }
}
