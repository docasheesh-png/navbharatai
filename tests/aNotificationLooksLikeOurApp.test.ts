// A NOTIFICATION MUST LOOK LIKE OUR APP, NOT LIKE A WHITE SQUARE.
//
// WHY (admin 2026-09-20: "ek dam native app jaise notification mobile me dikhe"). Three Firebase
// presentation settings had never been set, and each fails in a way nothing reports:
//
//   • no `default_notification_icon` -> Firebase falls back to the full-colour launcher icon, and
//     Android renders that in the status bar as a featureless WHITE SQUARE;
//   • no `default_notification_color` -> the system greys the icon and the app-name line;
//   • no `default_notification_channel_id` -> every message lands in Android's fallback
//     "Miscellaneous" channel, which is what the user sees in Settings -> Notifications.
//
// 🔒 THE CHANNEL ID IS THE ONE THAT CAN SILENTLY DRIFT. It exists twice — named in the manifest,
// CREATED in `src/lib/pushNotifications.ts` — and a manifest naming a channel nobody created is NOT
// an error: Android falls back to Miscellaneous again, exactly as if neither had been set. So the
// invariant is asserted in both directions here, because nothing else in the build can see it.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { NOTIFICATION_CHANNEL_ID } from '../src/lib/pushNotifications';

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'src/lib/pushNotifications.ts'), 'utf8');

/** The meta-data value Firebase reads, pulled out of the manifest by name. */
function metaValue(name: string, attr: 'value' | 'resource'): string | null {
  const re = new RegExp(`<meta-data[^>]*android:name="${name}"[^>]*android:${attr}="([^"]+)"`, 's');
  const m = MANIFEST.match(re);
  return m ? m[1] : null;
}

describe('the manifest tells Firebase how to present a notification', () => {
  it('names a notification-specific small icon, not the launcher icon', () => {
    const icon = metaValue('com.google.firebase.messaging.default_notification_icon', 'resource');
    expect(icon).toBe('@drawable/ic_stat_nbai');
    // The launcher icon is precisely the wrong answer — it is what the unset default already does.
    expect(icon).not.toMatch(/ic_launcher/);
  });

  it('names an accent colour, and that colour is defined', () => {
    const colour = metaValue('com.google.firebase.messaging.default_notification_color', 'resource');
    expect(colour).toBe('@color/nbaiNotificationAccent');
    const colours = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/nbai_colors.xml'), 'utf8');
    expect(colours).toMatch(/<color name="nbaiNotificationAccent">#[0-9a-fA-F]{6}<\/color>/);
  });
});

describe('the channel the manifest names is the channel the app creates', () => {
  it('manifest and client agree on the id', () => {
    expect(metaValue('com.google.firebase.messaging.default_notification_channel_id', 'value'))
      .toBe(NOTIFICATION_CHANNEL_ID);
  });

  it('the client really creates it', () => {
    // Source-level, because a channel is created through a native plugin: there is no behaviour a
    // unit test can observe, and "the constant is exported" would pass with the call deleted.
    expect(CLIENT).toMatch(/createChannel\(\{/);
    expect(CLIENT).toMatch(/id:\s*NOTIFICATION_CHANNEL_ID/);
  });

  it('creates it at HIGH importance, which Android will not let us raise later', () => {
    // A channel's importance is fixed at creation and owned by the user afterwards. Shipping the
    // default importance once would make "my notifications do not pop up" permanently unfixable for
    // everyone who had already installed the app.
    expect(CLIENT).toMatch(/importance:\s*4/);
  });

  it('creates the channel BEFORE asking for permission', () => {
    const created = CLIENT.indexOf('await ensureNotificationChannel()');
    const asked = CLIENT.indexOf('checkPermissions()');
    expect(created).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(-1);
    expect(created).toBeLessThan(asked);
  });
});

/** Minimal 8-bit RGBA PNG reader — enough to prove the icon is a silhouette. */
function decodePng(file: string): { w: number; h: number; px: Buffer } {
  const buf = fs.readFileSync(file);
  let off = 8; let w = 0; let h = 0; let depth = 0; let colorType = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  expect(depth).toBe(8);
  expect(colorType).toBe(6);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4; const stride = w * bpp; const px = Buffer.alloc(h * stride);
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
      let out: number;
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

const DENSITIES: Array<[string, number]> = [
  ['drawable-mdpi', 24], ['drawable-hdpi', 36], ['drawable-xhdpi', 48],
  ['drawable-xxhdpi', 72], ['drawable-xxxhdpi', 96],
];

describe('the icon Android will actually draw', () => {
  it.each(DENSITIES)('%s exists at the right size', (dir, size) => {
    const img = decodePng(path.join(ROOT, 'android/app/src/main/res', dir, 'ic_stat_nbai.png'));
    expect(img.w).toBe(size);
    expect(img.h).toBe(size);
  });

  it('is a SILHOUETTE — Android reads only the alpha, and a fully opaque icon is the white square', () => {
    const img = decodePng(path.join(ROOT, 'android/app/src/main/res/drawable-xxxhdpi/ic_stat_nbai.png'));
    let transparent = 0;
    for (let i = 3; i < img.px.length; i += 4) if (img.px[i] === 0) transparent += 1;
    const share = transparent / (img.w * img.h);
    // The mark is an emblem with real negative space. A solid square would score 0 here, which is
    // exactly the bug being fixed, so this assertion is the one that could catch a bad regeneration.
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.95);
  });

  it('fills its slot instead of sitting small inside an adaptive-icon safe zone', () => {
    // The source `ic_launcher_monochrome` is a 108dp adaptive canvas whose mark covers only ~58% of
    // it. Using it directly would be correct and look wrong; scripts/notificationIcon.mjs crops that
    // margin away, and this is the assertion that says the crop actually happened.
    const img = decodePng(path.join(ROOT, 'android/app/src/main/res/drawable-xxxhdpi/ic_stat_nbai.png'));
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
    expect(Math.max(maxX - minX + 1, maxY - minY + 1) / img.w).toBeGreaterThan(0.8);
  });
});
