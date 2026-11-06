// A GAME IN A BROWSER WITH NO GPU STILL GETS PLAYED (Q-2334 + Q-2338 — autopsy 61279465, 2026-11-04).
//
// "game-playtest timed out after 80000ms", and the explorer "could not press II … Timeout 4000ms". One root cause,
// reproduced on the reported scene rebuilt from the kit's own builders (rail line, terrain, trees, mountains, houses,
// a 20 m locomotive + coaches, 'real' detail): the build sandbox's browser renders in SOFTWARE, and the 'real' tier's
// per-pixel textured materials drew 2.5 frames a second. At that rate every screenshot is slow (the playtest ran out
// of time while driving) and Playwright's "two stable frames" wait before a click outlasted 4 s (the pause button).
// Measured: shadows, trees and houses barely moved it; the tier did. The kit now detects a software renderer and
// draws its lite tier at half the pixel ratio without MSAA: 17.6 fps desktop, 22.5 phone, and the playtest PLAYED it
// (30 s, it answered up/W, left, right, Space and a drag). A real GPU is unaffected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-no-gpu-${process.pid}`);
const kit = () => { for (const r of [generateGameRuntime(), generateGame3D()]) for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); } };

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeGl(renderer: string) {
  return { getContext: () => ({ getParameter: (k: number) => (k === 0x9246 ? renderer : 'WebGL'), getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : n === 'WEBGL_lose_context' ? { loseContext() {} } : null), RENDERER: 0x1f01 }) };
}

describe('the kit picks its tier from the device it runs on', () => {
  beforeAll(() => kit());
  afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; });
  it.each([
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'lite'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'lite'],
    ['ANGLE (Qualcomm, Adreno (TM) 610, OpenGL ES 3.2)', 'real'],
    ['Apple GPU', 'real'],
  ])('%s → %s', async (name, want) => {
    (globalThis as any).document = { createElement: () => fakeGl(name) };
    const S = await import(join(DIR, `src/game/three/surfaces.ts?${encodeURIComponent(name)}`));
    S.setDetailLevel('real');
    expect(S.getDetailLevel()).toBe(want);
    expect(S.resolveDetail('lite')).toBe('lite');
  });
  it('no document at all (a test, a worker) is never called software', async () => {
    delete (globalThis as any).document;
    const S = await import(join(DIR, 'src/game/three/surfaces.ts?nodoc'));
    S.setDetailLevel('real');
    expect(S.getDetailLevel()).toBe('real');
  });
  it('🔒 every tier reader resolves through the device: objects, world, the default, and the renderer', () => {
    const r = generateGame3D().files;
    expect(r['src/game/three/objects.ts']).toContain('const tier = (o?: BaseOpts): Detail => resolveDetail(o?.detail ?? getDetailLevel());');
    expect(r['src/game/three/world.ts']).toContain('const detail = resolveDetail(options.detail ?? getDetailLevel());');
    expect(r['src/game/three/renderer.ts']).toMatch(/renderer\.setPixelRatio\(software \? SOFTWARE_PIXEL_RATIO :/);
    expect(r['src/game/three/renderer.ts']).toMatch(/antialias: software \? false :/);
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const haveBrowser = existsSync(PW) && existsSync('/opt/pw-browsers') && existsSync('node_modules/.bin/esbuild');
const BDIR = join(__dirname, `.tmp-no-gpu-browser-${process.pid}`);

describe.skipIf(!haveBrowser)('in the real headless browser the playtest uses', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    for (const r of [generateGameRuntime(), generateGame3D()]) for (const [p, c] of Object.entries(r.files)) { const f = join(BDIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
    try { symlinkSync(join(process.cwd(), 'node_modules'), join(BDIR, 'node_modules')); } catch { /* exists */ }
    writeFileSync(join(BDIR, 'main.ts'), "import { setDetailLevel, getDetailLevel } from './src/game/three/surfaces';\nimport { createRenderer } from './src/game/three/renderer';\nsetDetailLevel('real');\nconst r = createRenderer();\n(window as any).__probe = { tier: getDetailLevel(), ratio: r.getPixelRatio(), aa: r.getContextAttributes()?.antialias };\n");
    execFileSync(join(process.cwd(), 'node_modules/.bin/esbuild'), ['main.ts', '--bundle', '--format=esm', '--outfile=out.js', '--log-level=error'], { cwd: BDIR });
    const js = readFileSync(join(BDIR, 'out.js'));
    server = http.createServer((q, r) => { if (q.url === '/out.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(js); return; } r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><body><script type="module" src="/out.js"></script></body>'); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }, 120_000);
  afterAll(async () => { await new Promise<void>((res) => server?.close(() => res())); rmSync(BDIR, { recursive: true, force: true }); });
  it("is detected as software: 'real' becomes lite, half pixel ratio, no MSAA", async () => {
    const { default: pw } = await import(PW);
    const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      const page = await browser.newPage();
      await page.goto(base);
      await page.waitForFunction(() => (window as any).__probe, null, { timeout: 20_000 });
      expect(await page.evaluate(() => (window as any).__probe)).toEqual({ tier: 'lite', ratio: 0.5, aa: false });
    } finally { await browser.close(); }
  }, 120_000);
});
