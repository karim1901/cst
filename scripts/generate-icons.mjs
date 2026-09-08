/**
 * Regenerates the PWA icons in `public/icons/` from a generated SVG.
 * Run with: `node scripts/generate-icons.mjs`
 * Replace the SVG below with your real brand mark when you have one.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "public", "icons");
await mkdir(OUT, { recursive: true });

const bg = "#0a0a0a";
const fg = "#ffffff";

// `pad` is the fraction of empty space kept around the glyph so maskable
// icons stay inside the platform safe zone.
function svg({ size, pad }) {
  const inset = Math.round(size * pad);
  const inner = size - inset * 2;
  const radius = Math.round(inner * 0.18);
  const fontSize = Math.round(inner * 0.42);
  const stroke = Math.max(2, Math.round(inner * 0.03));
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="${bg}"/>
      <rect x="${inset}" y="${inset}" width="${inner}" height="${inner}" rx="${radius}"
        fill="${bg}" stroke="${fg}" stroke-width="${stroke}"/>
      <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="${fg}">CST</text>
    </svg>`);
}

const targets = [
  { file: "icon-192x192.png", size: 192, pad: 0.06 },
  { file: "icon-512x512.png", size: 512, pad: 0.06 },
  { file: "icon-maskable-512x512.png", size: 512, pad: 0.14 },
  { file: "apple-touch-icon.png", size: 180, pad: 0.04 },
];

for (const target of targets) {
  await sharp(svg(target)).png().toFile(join(OUT, target.file));
  console.log("wrote", join("public", "icons", target.file));
}
