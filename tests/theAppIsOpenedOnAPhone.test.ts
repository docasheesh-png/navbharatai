// "mobile friendly game/app bane — mobile first!!!!!!" (admin 2026-09-30).
//
// Every browser check opened the app at a desktop size (1280×720); nothing ever looked at it on a phone.
// mobileLayoutCheck.ts opens it once at 390×844 with touch and measures sideways scroll and tap-target
// size. These hold the verdict rules, the wiring, and — where Chromium exists — the real measurement on
// a page that is broken on a phone and one that is not.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mobileLayoutModule, mobileLayoutScript, parseMobileLayout, mobileLayoutVerdict,
  MOBILE_RESULT_MARKER, MIN_TAP_PX,
} from '../src/server/AgentV3/mobileLayoutCheck';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

describe('the verdict says what a phone user meets, in three outcomes', () => {
  it('a page that scrolls sideways names the element that does it', () => {
    const v = mobileLayoutVerdict({ ok: true, vw: 390, overflow: 310, painted: true, wide: [{ tag: 'table', cls: 'orders', width: 700 }], smallCount: 0, small: [] });
    expect(v.code).toBe('MOBILE_LAYOUT_ISSUES');
    expect(v.severity).toBe('warning');
    expect(v.message).toContain('scrolls SIDEWAYS by 310px');
    expect(v.message).toContain('<table class="orders"> (700px wide)');
  });

  it('three or more tiny controls is a finding; one icon button is not', () => {
    const many = mobileLayoutVerdict({ ok: true, vw: 390, overflow: 0, painted: true, smallCount: 4, small: [{ name: 'x', w: 20, h: 20 }] });
    expect(many.code).toBe('MOBILE_LAYOUT_ISSUES');
    expect(many.message).toContain(`smaller than ${MIN_TAP_PX}px to tap`);
    expect(mobileLayoutVerdict({ ok: true, vw: 390, overflow: 2, painted: true, smallCount: 1, small: [] }).code).toBe('MOBILE_LAYOUT_OK');
  });

  it('a runner that could not look is NOT RUN, never a pass — and a blank page at phone size is not measured', () => {
    expect(mobileLayoutVerdict(parseMobileLayout('')).code).toBe('MOBILE_LAYOUT_NOT_RUN');
    expect(mobileLayoutVerdict({ ok: false, error: 'net::ERR_CONNECTION_REFUSED' }).message).toContain('ERR_CONNECTION_REFUSED');
    expect(mobileLayoutVerdict({ ok: true, painted: false }).code).toBe('MOBILE_LAYOUT_NOT_RUN');
  });

  it('the result line is read back exactly', () => {
    const run = parseMobileLayout(`noise\n${MOBILE_RESULT_MARKER}{"ok":true,"overflow":0,"painted":true,"smallCount":0}\n`);
    expect(run).toMatchObject({ ok: true, overflow: 0, painted: true });
  });
});

describe('wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the route runs it once after the app is proven, before the explorer, and records the verdict', () => {
    const at = route.indexOf('actuator.runCommand(workspaceId, mobileLayoutScript(lastPreviewUrl, { storageState: signedInState() }))');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(route.indexOf('clickExplorerScript(lastPreviewUrl'));
    expect(route).toContain('mobileLayoutCheckEnabled() && result.ok && lastPreviewUrl && actuator.runCommand');
  });

  it('the script runs through the shared runner (browsers path by construction) at a phone viewport', () => {
    const s = mobileLayoutScript('http://localhost:5173');
    expect(s).toContain('PLAYWRIGHT_BROWSERS_PATH=/home/user/.e-tools/.browsers node /tmp/nbai-mobile.mjs');
    expect(s).toContain('"w":390,"h":844');
    expect(s).toContain('isMobile: true, hasTouch: true');
  });

  it('an app behind a login is measured signed in, with the session the sign-in check saved', () => {
    expect(mobileLayoutScript('http://localhost:5173')).toContain('"storageState":null');
    const s = mobileLayoutScript('http://localhost:5173', { storageState: '/tmp/nbai-signed-in.json' });
    expect(s).toContain('"storageState":"/tmp/nbai-signed-in.json"');
    // The session rides in the shared page options (signInExplore.ts newPageOptionsExpr), with reduced motion.
    expect(s).toContain('"pageOpts":{"reducedMotion":"reduce","storageState":"/tmp/nbai-signed-in.json"}');
    expect(s).toContain('browser.newContext({ ...cfg.pageOpts,');
  });

  it('a finding is offered to the user as a one-tap fix; OK and NOT RUN never are', () => {
    const offered = buildFindingSuggestions([{ code: 'MOBILE_LAYOUT_ISSUES', severity: 'warning', autoResolved: false }]);
    expect(offered.map((s) => s.title)).toContain('Make it fit a phone');
    expect(buildFindingSuggestions([{ code: 'MOBILE_LAYOUT_NOT_RUN', severity: 'info' }, { code: 'MOBILE_LAYOUT_OK', severity: 'info' }])).toEqual([]);
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser at phone size', () => {
  let server: http.Server;
  let base = '';
  const pages: Record<string, string> = {
    '/broken': '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root">'
      + '<h1>Orders</h1><div class="grid" style="width:700px;background:#eee">wide</div>'
      + '<button style="width:20px;height:20px;padding:0">a</button><button style="width:20px;height:20px;padding:0">b</button>'
      + '<button style="width:24px;height:18px;padding:0">c</button><p>Read <a href="/x">more</a> here.</p></div></body></html>',
    '/good': '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root">'
      + '<h1>Orders</h1><div style="max-width:100%">fits</div><button style="min-width:44px;min-height:44px">Add</button>'
      + '<p>Read <a href="/x">more</a> here.</p></div></body></html>',
    // Autopsy cc3ef776: a chip inside its own sideways-scrolling row was named, while the page really
    // overflowed because a row of buttons did not wrap.
    '/chips': '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root" style="padding:0 16px">'
      + '<h1>Make a picture</h1><div class="nb-chips" style="display:flex;gap:8px;overflow-x:auto"><button class="nb-chip" style="flex:none;white-space:nowrap;width:493px">A tiger resting under a banyan tree at golden hour</button></div>'
      + '<div class="row" style="display:flex;gap:12px"><span style="flex:none;width:60px">Shape</span><button style="flex:none;width:90px;min-height:44px">Square</button><button style="flex:none;width:90px;min-height:44px">Wide</button><button style="flex:none;width:104px;min-height:44px">Portrait</button></div>'
      + '</div></body></html>',
  };
  beforeAll(async () => {
    server = http.createServer((q, r) => { const b = pages[(q.url ?? '/').split('?')[0]]; r.writeHead(b ? 200 : 404, { 'content-type': 'text/html' }); r.end(b ?? 'no'); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function measure(path: string) {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-mobile-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, mobileLayoutModule({ base: base + path, marker: MOBILE_RESULT_MARKER, w: 390, h: 844, minTap: MIN_TAP_PX, loadMs: 15_000 }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }, (e, o) => (e ? rej(e) : res(o))));
    return parseMobileLayout(stdout);
  }

  it('a page with a 700px box and 20px buttons is caught, naming the box', async () => {
    const run = await measure('/broken');
    const v = mobileLayoutVerdict(run);
    expect(v.code).toBe('MOBILE_LAYOUT_ISSUES');
    expect(run.overflow).toBeGreaterThan(200);
    expect(run.wide?.[0]).toMatchObject({ tag: 'div', cls: 'grid' });
    expect(run.smallCount).toBe(3); // the link inside the paragraph is running text, not a control
  }, 90_000);

  it('content clipped by its own scrolling row is never blamed — the element that sticks out is', async () => {
    const run = await measure('/chips');
    expect(run.overflow).toBeGreaterThan(0);
    expect(run.wide?.[0]).toMatchObject({ tag: 'button', name: 'Portrait' });
    expect((run.wide ?? []).some((w) => w.cls === 'nb-chip')).toBe(false);
    expect(mobileLayoutVerdict(run).message).toMatch(/sticking out: <button> "Portrait"/);
  }, 90_000);

  it('a responsive page passes', async () => {
    expect(mobileLayoutVerdict(await measure('/good')).code).toBe('MOBILE_LAYOUT_OK');
  }, 90_000);
});
