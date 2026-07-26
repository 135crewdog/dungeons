// Regenerates the app icon set in public/icons/ from the evil Eye's first
// sprite frame (public/assets/sprites/eye.png, the Phase-6 boss art). Pure
// Node — hand-rolled PNG decode/encode over node:zlib, no dependencies — so
// it runs before `npm ci` and never adds an image library to the project.
//
//   node scripts/make-icons.js
//
// The five outputs keep the filenames wired into vite.config.js/index.html:
// favicon-64, icon-192, icon-512, apple-touch-icon (180) — dark background,
// rounded border, eye centered — and icon-maskable-512, which is background
// plus a smaller eye so the glyph stays inside the maskable safe zone
// (full-bleed opaque; Android may crop the square to any shape).
//
// Licensing: the outputs are DERIVED from GPLv3 Shattered Pixel Dungeon art —
// see the "App icons" section of CREDITS.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const EYE_SHEET = 'public/assets/sprites/eye.png';
const OUT_DIR = 'public/icons';
const FRAME = { x: 0, y: 0, w: 16, h: 18 }; // eye frame 0, per entitySprites.js

const BG = [0x0b, 0x0d, 0x12, 0xff]; // theme_color, matches the old icons
const BORDER = [0x2b, 0x31, 0x40, 0xff];

// --- minimal PNG decode (indexed-color, as shipped by SPD sheets) -------------

function decodePng(bytes) {
  let off = 8; // signature
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off < bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString('ascii', off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.colorType !== 3 || ihdr.bitDepth !== 8) {
    throw new Error(`expected 8-bit indexed PNG, got colorType ${ihdr.colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width; // 1 byte per pixel at depth 8
  const indexed = Buffer.alloc(width * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = indexed.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? out[x - 1] : 0;
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      out[x] = v;
    }
    prev = out;
  }
  // Palette + tRNS → RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = indexed[i];
    rgba[i * 4] = palette[p * 3];
    rgba[i * 4 + 1] = palette[p * 3 + 1];
    rgba[i * 4 + 2] = palette[p * 3 + 2];
    rgba[i * 4 + 3] = trns && p < trns.length ? trns[p] : 0xff;
  }
  return { width, height, rgba };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// --- minimal PNG encode (RGBA, filter 0) --------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- glyph extraction ----------------------------------------------------------

// Crop the frame to the smallest rect containing visible pixels, so scaling
// centers the eye's ink rather than the frame's empty padding.
function extractGlyph(sheet, frame) {
  let minX = frame.w;
  let minY = frame.h;
  let maxX = -1;
  let maxY = -1;
  const alphaAt = (fx, fy) => sheet.rgba[((frame.y + fy) * sheet.width + frame.x + fx) * 4 + 3];
  for (let fy = 0; fy < frame.h; fy++) {
    for (let fx = 0; fx < frame.w; fx++) {
      if (alphaAt(fx, fy) === 0) continue;
      if (fx < minX) minX = fx;
      if (fy < minY) minY = fy;
      if (fx > maxX) maxX = fx;
      if (fy > maxY) maxY = fy;
    }
  }
  if (maxX < 0) throw new Error('frame is empty');
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const rgba = Buffer.alloc(w * h * 4);
  for (let fy = 0; fy < h; fy++) {
    const srcStart = ((frame.y + minY + fy) * sheet.width + frame.x + minX) * 4;
    sheet.rgba.copy(rgba, fy * w * 4, srcStart, srcStart + w * 4);
  }
  return { w, h, rgba };
}

// --- composition ---------------------------------------------------------------

// Signed "inside" test for a rounded rectangle spanning [inset, size-inset).
function insideRoundRect(x, y, size, inset, radius) {
  const min = inset;
  const max = size - inset - 1;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function composeIcon(glyph, size, { scale, border }) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) Buffer.from(BG).copy(rgba, i * 4);

  if (border) {
    // A rounded ring a few pixels in from the edge, like the old icons.
    const inset = Math.max(2, Math.round(size * 0.02));
    const thickness = Math.max(2, Math.round(size * 0.03));
    const radius = Math.round(size / 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const outer = insideRoundRect(x, y, size, inset, radius);
        const inner = insideRoundRect(
          x,
          y,
          size,
          inset + thickness,
          Math.max(0, radius - thickness),
        );
        if (outer && !inner) Buffer.from(BORDER).copy(rgba, (y * size + x) * 4);
      }
    }
  }

  // Nearest-neighbor integer upscale, centered.
  const gw = glyph.w * scale;
  const gh = glyph.h * scale;
  const ox = Math.floor((size - gw) / 2);
  const oy = Math.floor((size - gh) / 2);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const src = (Math.floor(y / scale) * glyph.w + Math.floor(x / scale)) * 4;
      if (glyph.rgba[src + 3] === 0) continue;
      glyph.rgba.copy(rgba, ((oy + y) * size + ox + x) * 4, src, src + 4);
    }
  }
  return encodePng(size, size, rgba);
}

// --- main ------------------------------------------------------------------------

const sheet = decodePng(readFileSync(EYE_SHEET));
const glyph = extractGlyph(sheet, FRAME); // 16×13 of ink

const icons = [
  { file: 'favicon-64.png', size: 64, scale: 3, border: true },
  { file: 'apple-touch-icon.png', size: 180, scale: 6, border: true },
  { file: 'icon-192.png', size: 192, scale: 6, border: true },
  { file: 'icon-512.png', size: 512, scale: 16, border: true },
  // Maskable: glyph stays well inside the central safe zone; no border,
  // full-bleed opaque background (the OS may crop to any shape).
  { file: 'icon-maskable-512.png', size: 512, scale: 10, border: false },
];

for (const { file, size, scale, border } of icons) {
  const png = composeIcon(glyph, size, { scale, border });
  writeFileSync(`${OUT_DIR}/${file}`, png);
  console.log(`${OUT_DIR}/${file}  ${size}x${size}  eye at ${glyph.w * scale}px (${scale}x)`);
}
