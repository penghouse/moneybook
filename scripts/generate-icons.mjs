/**
 * Regenerates every PNG icon from scripts/icon-master.svg.
 *
 *   node scripts/generate-icons.mjs
 *
 * The PNGs are committed (a build must not depend on sharp), but they are
 * generated rather than hand-drawn so the master stays the only place the
 * mark is defined. The maskable variant re-renders the glyph smaller
 * inside a full-bleed square: Android crops a maskable icon to whatever
 * shape the launcher uses, and anything outside the inner 80% can be cut.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const master = await readFile(join(here, "icon-master.svg"));

const SAFE_SCALE = 0.72;
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<rect width="512" height="512" fill="#4338CA"/>` +
    `<g transform="translate(${(512 * (1 - SAFE_SCALE)) / 2} ${(512 * (1 - SAFE_SCALE)) / 2}) scale(${SAFE_SCALE})">` +
    master.toString("utf-8").replace(/<\/?svg[^>]*>/g, "") +
    `</g></svg>`,
  "utf-8",
);

const targets = [
  { source: master, size: 192, out: join(root, "public/icon-192.png") },
  { source: master, size: 512, out: join(root, "public/icon-512.png") },
  { source: maskable, size: 512, out: join(root, "public/icon-maskable-512.png") },
  // Apple ignores transparency and does not round the corners itself, so
  // the master's own rounded square is what ships here.
  { source: master, size: 180, out: join(root, "app/apple-icon.png") },
  { source: master, size: 32, out: join(root, "app/icon.png") },
];

for (const { source, size, out } of targets) {
  const png = await sharp(source, { density: 384 }).resize(size, size).png().toBuffer();
  await writeFile(out, png);
  console.log(`${out.replace(root + "/", "")}  ${size}x${size}  ${png.length} bytes`);
}
