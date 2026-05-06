/**
 * gen-icons.ts
 * PWA 아이콘 생성 스크립트 (sharp 사용)
 * 실행: npx tsx scripts/gen-icons.ts
 */

import sharp from "sharp";
import path from "path";
import fs from "fs";

const OUT_DIR = path.resolve(process.cwd(), "public/icons");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

/**
 * SVG 텍스트 기반 플레이스홀더 아이콘 생성
 */
function makeSvg(size: number, safeZoneRatio = 1): string {
  const bg = "#3B82F6"; // blue-500
  const textColor = "#FFFFFF";
  // maskable 아이콘은 safe zone 80% 기준 — 텍스트 크기를 줄여 여백 확보
  const fontSize = Math.round(size * 0.22 * safeZoneRatio);
  const lineHeight = Math.round(fontSize * 1.25);
  const line1Y = size / 2 - lineHeight * 0.5 + lineHeight * 0.35;
  const line2Y = line1Y + lineHeight;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}" rx="${Math.round(size * 0.15)}"/>
  <text
    x="${size / 2}"
    y="${line1Y}"
    font-family="system-ui, -apple-system, sans-serif"
    font-weight="700"
    font-size="${fontSize}"
    fill="${textColor}"
    text-anchor="middle"
    dominant-baseline="auto"
  >100p</text>
  <text
    x="${size / 2}"
    y="${line2Y}"
    font-family="system-ui, -apple-system, sans-serif"
    font-weight="400"
    font-size="${Math.round(fontSize * 0.65)}"
    fill="${textColor}"
    opacity="0.85"
    text-anchor="middle"
    dominant-baseline="auto"
  >Books</text>
</svg>`;
}

async function generateIcon(
  size: number,
  filename: string,
  safeZoneRatio = 1
): Promise<void> {
  const svg = makeSvg(size, safeZoneRatio);
  const outPath = path.join(OUT_DIR, filename);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`  generated: ${outPath}`);
}

async function main() {
  console.log("Generating PWA icons...");

  await generateIcon(192, "icon-192.png");
  await generateIcon(512, "icon-512.png");
  // maskable: safe zone 80% — safeZoneRatio 0.8 로 텍스트 축소
  await generateIcon(512, "icon-maskable-512.png", 0.8);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
