/**
 * Q-147: a page whose nav bar painted but whose MAIN area stayed empty — a route that matches no page, a
 * screen that rendered nothing — read as "rendered", because the nav had text. The class: the frame judged
 * as the page. Two halves, because a check that cannot tell "empty" from "not filled yet" accuses working
 * apps: the shared paint wait now gives an empty main a short grace (inside the same deadline), and the
 * verdict names a main region that is still LITERALLY empty in a browser capture that saw the app paint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { analyzePreviewHtml, emptyMainRegion, splitPaintMarker, BROWSE_MAIN_GRACE_MS, BROWSE_PAINT_DEADLINE_MS } from '../src/server/AgentV3/PreviewVerify';
import { browsePageScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { classifyPage, pageCheckScript, parsePageCheck } from '../src/server/AgentV3/PageRouteCheck';
import { playwrightImport } from '../src/server/AgentV3/sandboxBrowserScript';

const page = (main: string) => `<html><body><div id="root"><nav><a href="/">Home</a><a href="/orders">Orders</a></nav>${main}</div></body></html>`;
const BROWSER = { source: 'browser', painted: true } as const;
const FRAME_ONLY = /only the app's frame rendered/;

describe('the verdict: a literally empty main region, seen by a browser that saw the app paint', () => {
  it('an empty main, an empty role=main, a main holding only a comment — the frame alone', () => {
    for (const m of ['<main class="content"></main>', '<main> <!-- outlet --> </main>', '<div role="main"></div>']) {
      const v = analyzePreviewHtml(page(m), BROWSER);
      expect(v.rendered, m).toBe(false);
      expect(v.problems.join(' '), m).toMatch(FRAME_ONLY);
    }
  });

  it('never accused: a canvas game, a spinner, an image, real content, a page with no main', () => {
    for (const m of ['<main><canvas width="300" height="300"></canvas></main>', '<main><div class="spinner"></div></main>',
      '<main><img src="/a.png" alt=""></main>', '<main><h1>Orders</h1><p>No orders yet</p></main>', '<section><h1>Hi</h1></section>']) {
      expect(analyzePreviewHtml(page(m), BROWSER).rendered, m).toBe(true);
    }
  });

  it('never from a capture without the browser\'s word that it painted — a server-rendered empty main is filled later', () => {
    expect(analyzePreviewHtml(page('<main></main>')).rendered).toBe(true);
    expect(analyzePreviewHtml(page('<main></main>'), { source: 'curl' }).rendered).toBe(true);
    expect(analyzePreviewHtml(page('<main></main>'), { source: 'browser', painted: undefined }).rendered).toBe(true);
  });

  it('one region with content outweighs an empty one', () => {
    expect(emptyMainRegion('<main></main><div role="main"><p>x</p></div>')).toBe(false);
  });

  it('the grace fits inside the paint deadline, so no capture can take longer than before', () => {
    expect(BROWSE_MAIN_GRACE_MS).toBeLessThan(BROWSE_PAINT_DEADLINE_MS);
    const src = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    expect(src).toContain('&&i+g<${Math.ceil(BROWSE_PAINT_DEADLINE_MS / BROWSE_PAINT_POLL_MS)};g++){');
  });
});

describe('the sibling: the per-route page check judged a route by body text, which the nav alone supplies', () => {
  it('a route whose main stayed empty is blank, not ok — and a redirect still wins', () => {
    const r = classifyPage({ route: '/orders', status: 200, text: 14, errors: [], finalPath: '/orders', mainEmpty: true });
    expect(r.verdict).toBe('blank');
    expect(r.note).toMatch(/showed only the app's frame/);
    expect(classifyPage({ route: '/orders', status: 200, text: 14, errors: [], finalPath: '/orders', mainEmpty: false }).verdict).toBe('ok');
    expect(classifyPage({ route: '/orders', status: 200, text: 14, errors: [], finalPath: '/login', mainEmpty: true }).verdict).toBe('redirected');
  });

  it('both scripts ask the one shared in-browser question', () => {
    const e2b = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    const prc = readFileSync('src/server/AgentV3/PageRouteCheck.ts', 'utf8');
    expect(e2b).toContain('evaluate(${MAIN_REGION_EMPTY_JS})');
    expect(prc).toContain('evaluate(${MAIN_REGION_EMPTY_JS})');
    expect(e2b + prc).not.toMatch(/querySelector\('main,\[role=main\]'\)/); // no private copy
  });
});

// ── A REAL BROWSER, where one exists: the shared paint wait waits for an empty main ─────────────────────
const PW_DIR = '/opt/node22/lib/node_modules';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(join(PW_DIR, 'playwright')) && existsSync(BROWSERS);

/** Nav paints at once; the page fills `<main>` after `fillMs` (never, when null) — like a fetch on mount. */
function app(fillMs: number | null): string {
  return `<!doctype html><html><body><div id="root"></div><script>
document.getElementById('root').innerHTML = '<nav><a href="/">Home</a><a href="/orders">Orders</a></nav><main id="m"></main>';
${fillMs === null ? '' : `setTimeout(function () { document.getElementById('m').innerHTML = '<h1>Orders</h1><p>3 orders today</p>'; }, ${fillMs});`}
</script></body></html>`;
}

describe.skipIf(!haveBrowser)('in a real browser', () => {
  const servers: http.Server[] = [];
  let slow = '';
  let never = '';
  const start = async (html: string) => {
    const s = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html); });
    await new Promise<void>((res) => s.listen(0, '127.0.0.1', () => res()));
    servers.push(s);
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
  };
  beforeAll(async () => { slow = await start(app(800)); never = await start(app(null)); });
  afterAll(async () => { for (const s of servers) await new Promise<void>((res) => s.close(() => res())); });

  const browse = async (url: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-frame-'));
    const file = join(dir, 'browse.js');
    writeFileSync(file, browsePageScript(url, { recordConsole: false }));
    const { execFile } = await import('node:child_process');
    const out = await new Promise<string>((res, rej) => execFile(process.execPath, [file], {
      env: { ...process.env, NODE_PATH: PW_DIR, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000,
    }, (e, o) => (e ? rej(e) : res(o))));
    const { painted, html } = splitPaintMarker(out.slice(out.indexOf('NBAI_PAINTED:')));
    return analyzePreviewHtml(html, { source: 'browser', painted });
  };

  it('a main that fills 800 ms after the nav is photographed filled — a working app is not accused', async () => {
    const v = await browse(slow);
    expect(v.rendered).toBe(true);
  }, 90_000);

  it('the per-route check: a route that fills late is ok, one that never fills is blank', async () => {
    const module = (url: string) => {
      const sh = pageCheckScript(url, ['/'], {});
      const body = sh.slice(sh.indexOf("<<'NBAI_EOF'\n") + 13, sh.indexOf('\nNBAI_EOF'));
      return body.replace(playwrightImport('/home/user/.e-tools'), `import playwright from '${PW_DIR}/playwright/index.js';\nconst { chromium } = playwright;`);
    };
    const run = async (url: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'nbai-routes-'));
      const file = join(dir, 'check.mjs');
      const src = module(url);
      expect(src).toContain(`${PW_DIR}/playwright/index.js`);
      writeFileSync(file, src);
      const { execFile } = await import('node:child_process');
      const out = await new Promise<string>((res, rej) => execFile(process.execPath, [file], {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000,
      }, (e, o) => (e ? rej(e) : res(o))));
      return parsePageCheck(out)[0];
    };
    expect((await run(slow)).verdict).toBe('ok');
    const blank = await run(never);
    expect(blank.verdict).toBe('blank');
    expect(blank.note).toMatch(/showed only the app's frame/);
  }, 120_000);

  it('a main that never fills is named as the frame alone', async () => {
    const v = await browse(never);
    expect(v.rendered).toBe(false);
    expect(v.problems.join(' ')).toMatch(FRAME_ONLY);
  }, 90_000);
});
