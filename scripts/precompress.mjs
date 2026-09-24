#!/usr/bin/env node
// Compress the built web app ONCE, at build time, at the highest level (compression audit,
// 2026-09-24).
//
// WHY: the `compression` middleware re-compresses every JS/CSS file on EVERY request, at brotli
// quality 4 — a fast level chosen because it runs per request. Doing it once here lets us use
// quality 11 (the maximum, ~10–15% smaller than 4) and spend ZERO CPU per request; the server
// (`lib/precompressedStatic.ts`) then streams the ready-made `.br` / `.gz` file.
//
// ⚠️ RUN BY THE DOCKERFILE ONLY, never by `npm run build`. Capacitor copies all of `dist/` into the
// Android/iOS app, and a phone app loads its files from its own disk — `.br`/`.gz` copies there would
// only make the download bigger. So the mobile build is byte-identical to before.
//
// Safe by construction: a file whose compressed copy is not at least 5% smaller gets no copy, and a
// missing copy just means the middleware falls back to the old per-request path.

import { brotliCompress, gzip, constants } from 'zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { promisify } from 'util';
import { cpus } from 'os';

// The async zlib calls run on libuv's thread pool, so several files compress at once. Sized to the
// machine (set before the first zlib call, which is when the pool is created).
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(4, cpus().length));
const br = promisify(brotliCompress);
const gz = promisify(gzip);

const DIST = process.argv[2] || 'dist';
/** Exactly the directories whose files are served as static assets (never the server bundle). */
const DIRS = ['assets', 'monaco', 'vendor'];
const EXT = new Set(['.js', '.mjs', '.css', '.svg', '.json', '.ttf', '.wasm', '.map']);
const MIN_BYTES = 1024;

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const targets = [];
for (const d of DIRS) {
  for (const p of walk(join(DIST, d))) {
    if (EXT.has(extname(p)) && statSync(p).size >= MIN_BYTES) targets.push(p);
  }
}

let files = 0, raw = 0, brBytes = 0, gzBytes = 0;
async function one(p) {
  const buf = readFileSync(p);
  const [b, g] = await Promise.all([
    br(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_MODE]: extname(p) === '.wasm' || extname(p) === '.ttf'
          ? constants.BROTLI_MODE_GENERIC : constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }),
    gz(buf, { level: 9 }),
  ]);
  files += 1; raw += buf.length;
  if (b.length < buf.length * 0.95) { writeFileSync(`${p}.br`, b); brBytes += b.length; } else brBytes += buf.length;
  if (g.length < buf.length * 0.95) { writeFileSync(`${p}.gz`, g); gzBytes += g.length; } else gzBytes += buf.length;
}
// Biggest first, so one large file does not start last and hold up the finish.
targets.sort((a, b) => statSync(b).size - statSync(a).size);
const workers = Math.max(2, cpus().length);
let next = 0;
await Promise.all(Array.from({ length: workers }, async () => {
  while (next < targets.length) await one(targets[next++]);
}));
const mb = (n) => (n / 1048576).toFixed(2);
console.log(`[precompress] ${files} files, ${mb(raw)} MB raw → ${mb(brBytes)} MB brotli-11, ${mb(gzBytes)} MB gzip-9`);
