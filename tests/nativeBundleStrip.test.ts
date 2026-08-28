import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  serverArtifactsIn,
  cleanDir,
  stripServerArtifacts,
  formatBytes,
  SERVER_ONLY_ARTIFACTS,
  NATIVE_PUBLIC_DIRS,
} from '../scripts/stripServerFromNativeBundle.mjs';

/**
 * THE NODE SERVER WAS SHIPPING INSIDE THE ANDROID APP (measured 2026-08-28).
 *
 * `npx cap copy android` put 62 MB into the app's web assets, of which `server.cjs` (7.5 MB) and
 * `server.cjs.map` (16 MB) were our Express server — code that cannot execute in a WebView, plus a
 * sourcemap carrying the readable server source onto every user's device.
 *
 * Nobody added it. `npm run build` emits the server into `dist/`, and `webDir: 'dist'` makes Capacitor
 * copy that directory whole. Two correct decisions whose intersection was wrong, which is why no
 * review of either file caught it.
 *
 * These tests exist because the fix is a build-time hook: nothing in the app fails if it silently
 * stops working, so only a test can tell us it still does.
 */

const fakeFs = (files: Record<string, number>, present = true) => ({
  existsSync: () => present,
  readdirSync: () => Object.keys(files),
  statSync: (p: string) => ({ size: files[p.split('/').pop() as string] ?? 0 }),
  rmSync: (p: string) => { delete files[p.split('/').pop() as string]; },
});

describe('serverArtifactsIn — what gets removed, and what must not', () => {
  it('picks exactly the two Node-server build outputs', () => {
    expect(serverArtifactsIn(['index.html', 'server.cjs', 'server.cjs.map', 'sw.js']))
      .toEqual(['server.cjs', 'server.cjs.map']);
  });

  it('leaves every real web asset alone', () => {
    const assets = ['index.html', 'sw.js', 'manifest.json', 'logo.png', 'preview-sandbox.html',
      'assets', 'monaco', 'vendor', 'build_status.json'];
    expect(serverArtifactsIn(assets)).toEqual([]);
  });

  it('does NOT touch build_status.json — src/App.tsx really polls it', () => {
    // 548 bytes, and a live feature depends on it. Sweeping "stray JSON" out of the bundle would
    // have broken the build-progress screen on the native app only, where nobody would look.
    expect(serverArtifactsIn(['build_status.json'])).toEqual([]);
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('/build_status.json');
  });

  it('is an explicit list, never a pattern that could grow onto a real file', () => {
    // A glob like /^server\./ matches these two today and a `server.config.json` some feature needs
    // tomorrow — and that failure would be a missing file on real users' phones with nothing in the
    // build to explain it.
    expect([...SERVER_ONLY_ARTIFACTS]).toEqual(['server.cjs', 'server.cjs.map']);
    expect(serverArtifactsIn(['server.config.json', 'serverInfo.js', 'server.cjs.LICENSE.txt']))
      .toEqual([]);
  });

  it('is case-sensitive, because Android asset paths are', () => {
    expect(serverArtifactsIn(['Server.cjs', 'SERVER.CJS'])).toEqual([]);
  });

  it('survives an empty or missing listing without throwing', () => {
    expect(serverArtifactsIn([])).toEqual([]);
    expect(serverArtifactsIn(undefined as unknown as string[])).toEqual([]);
  });
});

describe('cleanDir', () => {
  it('removes the artifacts and reports the bytes actually freed', () => {
    const files: Record<string, number> = {
      'index.html': 3_000, 'server.cjs': 7_500_000, 'server.cjs.map': 16_000_000,
    };
    const r = cleanDir('android/app/src/main/assets/public', fakeFs(files) as never);
    expect(r.removed).toEqual(['server.cjs', 'server.cjs.map']);
    expect(r.bytes).toBe(23_500_000);
    expect(Object.keys(files)).toEqual(['index.html']);   // the real asset survives
  });

  it('a MISSING directory is not a failure — ios/ is generated on a Mac and is not committed', () => {
    const r = cleanDir('ios/App/App/public', fakeFs({}, false) as never);
    expect(r.present).toBe(false);
    expect(r.removed).toEqual([]);
  });

  it('a FAILED delete throws — silence there would ship the server again', () => {
    // The whole point of this script is that the bundle is clean. A swallowed error would leave the
    // build looking green while 23 MB of server source went out to users.
    const fs = {
      existsSync: () => true,
      readdirSync: () => ['server.cjs'],
      statSync: () => ({ size: 1 }),
      rmSync: () => { throw new Error('EACCES'); },
    };
    expect(() => cleanDir('somewhere', fs as never)).toThrow(/EACCES/);
  });

  it('an unreadable SIZE does not block the delete — the size is only for the log', () => {
    const files: Record<string, number> = { 'server.cjs': 0 };
    const fs = {
      existsSync: () => true,
      readdirSync: () => ['server.cjs'],
      statSync: () => { throw new Error('ENOENT'); },
      rmSync: (p: string) => { delete files[p.split('/').pop() as string]; },
    };
    const r = cleanDir('somewhere', fs as never);
    expect(r.removed).toEqual(['server.cjs']);
    expect(r.bytes).toBe(0);
  });

  it('is idempotent — a second run finds nothing and says so', () => {
    const files: Record<string, number> = { 'server.cjs': 10 };
    const dirFs = fakeFs(files) as never;
    expect(cleanDir('d', dirFs).removed).toEqual(['server.cjs']);
    expect(cleanDir('d', dirFs).removed).toEqual([]);
  });
});

describe('stripServerArtifacts covers both platforms', () => {
  it('names the Android and iOS web-asset roots', () => {
    expect(NATIVE_PUBLIC_DIRS).toContain('android/app/src/main/assets/public');
    expect(NATIVE_PUBLIC_DIRS).toContain('ios/App/App/public');
  });

  it('returns one result per directory', () => {
    const r = stripServerArtifacts(['a', 'b'], fakeFs({}, false) as never);
    expect(r.map((x) => x.dir)).toEqual(['a', 'b']);
  });
});

describe('formatBytes — the log has to say what was saved, not "done"', () => {
  it('reads the way a person would say it', () => {
    expect(formatBytes(23_500_000)).toBe('22 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

// ── The wiring, which is the part that can silently stop working ────────────────────────────────
describe('the hook is actually connected', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

  it('runs as capacitor:copy:after, so no human has to remember it', () => {
    // Verified against @capacitor/cli source, not memory: `sync` calls `copy`, and `copy` runs this
    // hook every time. A CI step or a documented command could be skipped; this cannot.
    expect(pkg.scripts['capacitor:copy:after']).toBe('node scripts/stripServerFromNativeBundle.mjs');
  });

  it('runs AFTER the copy, never before — dist/server.cjs is the PRODUCTION server', () => {
    // A copy:before hook would have to empty dist/, and `npm start`, the Dockerfile and the DAST
    // workflow all run `dist/server.cjs`. Cleaning the platform's copy instead cannot reach the
    // deploy at all.
    expect(pkg.scripts['capacitor:copy:before']).toBeUndefined();
    expect(pkg.scripts.start).toContain('dist/server.cjs');
  });

  it('the build still emits the server into dist/, unchanged', () => {
    expect(pkg.scripts.build).toContain('--outfile=dist/server.cjs');
  });
});
