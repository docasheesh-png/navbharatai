#!/usr/bin/env node
// THE NOTIFICATION STATUS-BAR ICON — derived from the app's own mark, never drawn anew.
//
// WHY THIS EXISTS (2026-09-20, admin: "ek dam native app jaise notification mobile me dikhe").
// Android renders a notification's small icon from its ALPHA channel alone and tints the result. Give
// it a full-colour launcher icon — which is what Firebase falls back to when
// `default_notification_icon` is unset — and every notification shows a featureless WHITE SQUARE.
//
// The app already carries a true silhouette: `mipmap/ic_launcher_monochrome`, added for Android 13
// themed icons, whose shape lives entirely in its alpha (verified: 93% fully transparent, and the
// visible pixels are pure black, i.e. the colour is irrelevant and only the shape is real). It cannot
// be used directly, because an adaptive icon reserves a large safe-zone margin: the mark occupies only
// the middle ~58% of its canvas, so as a notification icon it would sit small inside the slot.
//
// So this script CROPS that margin away, squares the crop around the mark with a 12% breathing margin,
// box-filters the alpha down to the five standard 24dp densities, and writes white RGB (conventional;
// Android ignores it). The output is the same mark, filling the slot the way a purpose-drawn icon does.
//
// It is committed rather than run in CI on purpose: these are five small binary assets that change
// only when the launcher mark changes, and a build step that silently regenerates committed art is how
// a wrong icon ships unnoticed. Re-run it by hand after changing ic_launcher_monochrome:
//
//   node scripts/notificationIcon.mjs
//
// PNG encode/decode are inline (8-bit RGBA only) because this repo has no image dependency and adding
// one for five icons would be a standing supply-chain cost for a once-a-year task.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SOURCE = 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.png';
const RES = 'android/app/src/main/res';
const NAME = 'ic_stat_nbai.png';
/** Density -> the icon's pixel size. 24dp at each scale, which is the slot Android gives a small icon. */
const SIZES = { 'drawable-mdpi': 24, 'drawable-hdpi': 36, 'drawable-xhdpi': 48, 'drawable-xxhdpi': 72, 'drawable-xxxhdpi': 96 };
/** How much empty space to leave around the mark, as a multiple of its longest side. */
const BREATHING = 1.12;

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let off = 8; let w = 0; let h = 0; let depth = 0; let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || colorType !== 6) throw new Error(`${file}: expected 8-bit RGBA (got depth ${depth}, colour type ${colorType})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p]; p += 1;
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      let out;
      if (filter === 0) out = v;
      else if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = out & 0xff;
    }
  }
  return { w, h, px };
}

const crc32 = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (bytes) => {
    let c = -1;
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none — these are tiny, and no filter keeps this reproducible
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The tightest box containing every pixel the mark actually paints. */
function alphaBounds(img) {
  let minX = img.w; let minY = img.h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < img.h; y += 1) {
    for (let x = 0; x < img.w; x += 1) {
      if (img.px[(y * img.w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${SOURCE}: every pixel is transparent — this is not a silhouette`);
  return { minX, minY, maxX, maxY };
}

const source = decodePng(SOURCE);
const box = alphaBounds(source);
const centreX = (box.minX + box.maxX) / 2;
const centreY = (box.minY + box.maxY) / 2;
const side = Math.max(box.maxX - box.minX + 1, box.maxY - box.minY + 1) * BREATHING;
const originX = centreX - side / 2;
const originY = centreY - side / 2;

console.log(`source ${source.w}x${source.h}; mark ${box.maxX - box.minX + 1}x${box.maxY - box.minY + 1} at (${box.minX},${box.minY}); crop ${side.toFixed(1)}px square`);

for (const [dir, size] of Object.entries(SIZES)) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx0 = originX + (x * side) / size;
      const sx1 = originX + ((x + 1) * side) / size;
      const sy0 = originY + (y * side) / size;
      const sy1 = originY + ((y + 1) * side) / size;
      let sum = 0; let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
          n += 1; // pixels outside the source count as transparent, so the margin stays empty
          if (sx < 0 || sy < 0 || sx >= source.w || sy >= source.h) continue;
          sum += source.px[(sy * source.w + sx) * 4 + 3];
        }
      }
      const i = (y * size + x) * 4;
      out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
      out[i + 3] = n ? Math.round(sum / n) : 0;
    }
  }
  const dest = path.join(RES, dir, NAME);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, encodePng(size, size, out));
  console.log(`wrote ${dest} (${size}x${size}, ${fs.statSync(dest).size} bytes)`);
}
