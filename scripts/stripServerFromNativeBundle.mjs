#!/usr/bin/env node
/**
 * THE NODE SERVER WAS SHIPPING INSIDE THE ANDROID APP. This removes it.
 *
 * MEASURED, not suspected (2026-08-28). Running `npx cap copy android` and measuring the result:
 *
 *     62M  android/app/src/main/assets/public
 *     ├── 24M  monaco/            ← the code editor, genuinely used
 *     ├── 16M  server.cjs.map     ← ✗
 *     ├── 12M  assets/            ← the actual app
 *     ├── 7.5M server.cjs         ← ✗
 *     └── 3.1M vendor/
 *
 * `server.cjs` is our Express server, bundled by esbuild for Node. It cannot execute in a WebView —
 * there is no `require`, no `http.createServer`, no filesystem. It is 7.5 MB of code that can never
 * run on the device it is installed on.
 *
 * `server.cjs.map` is worse than dead weight. A sourcemap carries the ORIGINAL SOURCE, so every user
 * who installs NavBharatAI receives a readable copy of our entire server implementation — routes,
 * prompts, billing logic, internal endpoint names — extractable from the APK with a zip tool. That is
 * an information-disclosure issue, not a size one, and it is why this is a P0 rather than a cleanup.
 *
 * ── HOW THE BUG HAPPENED, so the fix addresses the cause ─────────────────────────────────────────
 *
 * Nobody added the server to the app. Two independently reasonable decisions met:
 *
 *   1. `npm run build` emits BOTH the client (Vite → dist/) and the server (esbuild → dist/server.cjs).
 *   2. `capacitor.config.ts` sets `webDir: 'dist'`, and Capacitor copies that directory WHOLE.
 *
 * Each is correct alone. Their intersection ships a Node server to a phone, and no single file
 * contains the mistake — which is exactly why it survived every review of both.
 *
 * ── WHY THIS RUNS AS A CAPACITOR HOOK, AND WHY *AFTER* ───────────────────────────────────────────
 *
 * Wired as `capacitor:copy:after` in package.json. Verified by reading the CLI source rather than
 * from memory (`@capacitor/cli/dist/tasks/copy.js`, `.../sync.js`): `sync` calls `copy`, and `copy`
 * runs this hook on EVERY invocation. So it cannot be forgotten by whoever runs the build — a CI
 * step or a documented manual command could be, and CLAUDE.md's rule about rules-that-must-be-
 * remembered says a gate you have to remember is a gate that will eventually be missed.
 *
 * AFTER rather than BEFORE, deliberately. A `copy:before` hook would have to delete the files from
 * `dist/` — but `dist/server.cjs` is what `npm start`, the Dockerfile and the DAST workflow all run
 * in PRODUCTION. Emptying it to fix a mobile bundle would mean a local `npm run mobile:sync` quietly
 * breaks the developer's own server, and a mistake in the ordering could reach Cloud Run. Cleaning
 * the platform's copy instead touches nothing outside the native project, so this can never affect
 * the deploy.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH ──────────────────────────────────────────────────────────
 *
 * • `monaco/` (24 MB) — a product decision, not a defect. Removing it makes Code Studio require a
 *   network connection. That is the admin's call, not this script's.
 * • `build_status.json` — 548 bytes, and `src/App.tsx` really polls it.
 * • Anything not on the explicit list below. This removes named server artifacts, never a pattern
 *   that could grow to match a real asset.
 */

import { readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Files that belong to the Node server build and can never be useful on a device.
 *
 * An EXPLICIT LIST, not a glob. A pattern like /^server\./ would today match exactly these two and
 * tomorrow match a `server.config.json` some feature genuinely needs — and the failure would be a
 * missing file at runtime on real users' phones, with nothing in the build to explain it.
 */
export const SERVER_ONLY_ARTIFACTS = Object.freeze(['server.cjs', 'server.cjs.map']);

/** Native web-asset roots. iOS is absent from the repo (it is generated on a Mac), which is normal. */
export const NATIVE_PUBLIC_DIRS = Object.freeze([
  'android/app/src/main/assets/public',
  'ios/App/App/public',
]);

/**
 * Which of these names must go. Pure, so the decision is testable without a filesystem.
 *
 * Case-sensitive on purpose: Android assets are served from a case-sensitive path, so `Server.cjs`
 * would be a different file, and treating it as the same one would be a guess.
 */
export function serverArtifactsIn(names) {
  const wanted = new Set(SERVER_ONLY_ARTIFACTS);
  return (names || []).filter((n) => wanted.has(n));
}

/** Human-readable size, so the log says what was actually saved rather than "done". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/**
 * Clean one directory. Returns what it removed so the caller can report a real total.
 *
 * A MISSING DIRECTORY IS NOT A FAILURE — `ios/` is not committed, and `cap copy android` never
 * creates it. A FAILED DELETE IS: staying silent there would ship the server bundle again while the
 * build looked clean, which is the failure this whole file exists to make impossible.
 */
export function cleanDir(dir, fs = { readdirSync, statSync, rmSync, existsSync }) {
  if (!fs.existsSync(dir)) return { dir, present: false, removed: [], bytes: 0 };

  const targets = serverArtifactsIn(fs.readdirSync(dir));
  const removed = [];
  let bytes = 0;

  for (const name of targets) {
    const path = join(dir, name);
    let size = 0;
    try { size = fs.statSync(path).size; } catch { /* size is for the log only; never block on it */ }
    fs.rmSync(path, { force: true });      // throws on a real failure — deliberately not caught
    removed.push(name);
    bytes += size;
  }

  return { dir, present: true, removed, bytes };
}

export function stripServerArtifacts(dirs = NATIVE_PUBLIC_DIRS, fs) {
  return dirs.map((d) => cleanDir(d, fs));
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
// Guarded so importing this file in a test never deletes anything.
if (process.argv[1] && process.argv[1].endsWith('stripServerFromNativeBundle.mjs')) {
  const results = stripServerArtifacts();
  const total = results.reduce((sum, r) => sum + r.bytes, 0);
  const touched = results.filter((r) => r.removed.length > 0);

  if (touched.length === 0) {
    // Not an error: a native platform may simply not be present, or a previous run already cleaned it.
    console.log('[native-bundle] no server artifacts found in the native web assets — nothing to strip.');
  } else {
    for (const r of touched) {
      console.log(`[native-bundle] ${r.dir}: removed ${r.removed.join(', ')} (${formatBytes(r.bytes)})`);
    }
    console.log(`[native-bundle] ✅ ${formatBytes(total)} of Node-server build kept out of the app bundle.`);
  }
}
