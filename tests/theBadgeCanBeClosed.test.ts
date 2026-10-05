// "X (CLOSE) BUTTON BANA — JO HAR REFRESH PAR WAPAS AA JAYE" (admin 2026-09-30).
//
// The "made by NavBharatAI" badge is fixed bottom-right, so it could sit over an app's own footer or cart
// bar and nobody could move it. Now it carries a ×. Locked here:
//   1. the × works with NO JavaScript (an app with a strict Content-Security-Policy still gets a working ×);
//   2. nothing is stored, and the browser is told not to restore the ticked state — so a refresh brings it back;
//   3. a badge written before this change is upgraded in place on the next build, never doubled;
//   4. the post-build button-presser leaves our badge alone.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  appSignatureHtml, injectAppSignature, hasAppSignature, hasCurrentAppSignature,
  APP_SIGNATURE_MARKER, APP_SIGNATURE_VERSION, APP_SIGNATURE_CLOSE_LABEL,
} from '../src/server/AgentV3/appSignature';
import { makeTempDir } from './helpers/tempDir';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const DOC = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>`;

// The version-1 badge exactly as `appSignatureHtml` wrote it before 2026-09-30 — what apps built earlier carry.
const V1 = `<a href="https://navbharatai.com" target="_blank" rel="noopener noreferrer" data-nbai-signature="1" ` +
  `aria-label="made by NavBharatAI — open navbharatai.com" ` +
  `style="position:fixed;right:12px;bottom:12px;z-index:2147483647;display:inline-flex;align-items:center;` +
  `gap:6px;padding:6px 11px;background:#161b22;color:#ffffff;` +
  `font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none;` +
  `border-radius:9999px;box-shadow:0 2px 10px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14)">` +
  `<span style="display:inline-block;width:7px;height:7px;border-radius:9999px;background:#6366f1"></span>` +
  `made by NavBharatAI</a>`;

const count = (html: string) => html.split(`${APP_SIGNATURE_MARKER}=`).length - 1;

describe('1 · the × needs no JavaScript and is announced', () => {
  const b = appSignatureHtml();
  it('is a checkbox with a readable name, and there is no script or click handler anywhere in the badge', () => {
    expect(b).toMatch(/<input type="checkbox"/);
    expect(b).toContain(`aria-label="${APP_SIGNATURE_CLOSE_LABEL}"`);
    expect(b).not.toMatch(/<script|\bon[a-z]+=/i);
  });
  it('the checked state hides the link and the × itself, by CSS scoped to the badge', () => {
    expect(b).toContain(`[${APP_SIGNATURE_MARKER}]>input:checked,[${APP_SIGNATURE_MARKER}]>input:checked~a{display:none!important}`);
    // CSS can only hide what FOLLOWS the checkbox, so it must come before the link in the markup.
    expect(b.indexOf('<input')).toBeLessThan(b.indexOf('<a '));
  });
});

describe('2 · a refresh brings it back', () => {
  it('stores nothing and tells the browser not to restore the ticked state', () => {
    const b = appSignatureHtml();
    expect(b).toContain('autocomplete="off"');
    expect(b).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe('3 · an older badge is upgraded, never doubled', () => {
  it('replaces the version-1 badge in place with the current one', () => {
    const old = DOC.replace('</body>', `${V1}\n</body>`);
    expect(hasAppSignature(old)).toBe(true);
    expect(hasCurrentAppSignature(old)).toBe(false);
    const out = injectAppSignature(old);
    expect(hasCurrentAppSignature(out)).toBe(true);
    expect(count(out)).toBe(1);
    expect(out).not.toContain(`${APP_SIGNATURE_MARKER}="1"`);
  });
  it('is idempotent on the current badge', () => {
    const once = injectAppSignature(DOC);
    expect(injectAppSignature(once)).toBe(once);
    expect(once).toContain(`${APP_SIGNATURE_MARKER}="${APP_SIGNATURE_VERSION}"`);
  });
  it('leaves a badge it cannot recognise alone rather than adding a second one', () => {
    const edited = DOC.replace('</body>', `<p ${APP_SIGNATURE_MARKER}="1">edited by the user</p></body>`);
    expect(injectAppSignature(edited)).toBe(edited);
  });
  it('the build skips only a CURRENT badge, so an older one reaches the upgrade', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    const fn = src.slice(src.indexOf('private async injectAppSignatureIntoIndexHtml'));
    expect(fn.slice(0, 1500)).toContain('hasCurrentAppSignature(html)');
    expect(fn.slice(0, 1500)).not.toMatch(/\bhasAppSignature\(html\)/);
  });
});

describe('4 · the button-presser leaves our badge alone', () => {
  it('skips anything inside the badge', () => {
    expect(read('src/server/AgentV3/clickExplorer.ts')).toContain(`el.closest('[${APP_SIGNATURE_MARKER}]')`);
  });
});

// A REAL BROWSER, where one exists (CI has none and skips it visibly).
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  it('pressing × hides the badge, a reload brings it back — even when the page forbids every script', () => {
    const dir = makeTempDir('nbai-badge-');
    // The strictest policy an app could set: no script at all. Inline styles stay allowed, as they must
    // for the badge to be drawn in the first place.
    const page = injectAppSignature(`<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="script-src 'none'">
      <style>input[type=checkbox]{width:200px;height:200px;accent-color:red}</style></head>
      <body><footer style="position:fixed;bottom:0;left:0;right:0;height:48px">Footer</footer></body></html>`);
    writeFileSync(join(dir, 'page.html'), page);
    const script = join(dir, 'run.mjs');
    writeFileSync(script, `import playwright from '${PW}';
      const b = await playwright.chromium.launch();
      const p = await b.newPage({ viewport: { width: 390, height: 780 } });
      await p.goto('file://${join(dir, 'page.html')}');
      const state = () => p.evaluate(() => {
        const a = document.querySelector('[data-nbai-signature] > a');
        const x = document.querySelector('[data-nbai-signature] > input');
        const xr = x.getBoundingClientRect(), ar = a.getBoundingClientRect();
        return { link: getComputedStyle(a).display, x: getComputedStyle(x).display, xw: xr.width, xRight: xr.left > ar.left };
      });
      const before = await state();
      await p.getByRole('checkbox', { name: '${APP_SIGNATURE_CLOSE_LABEL}' }).click();
      const after = await state();
      await p.reload();
      const reloaded = await state();
      console.log(JSON.stringify({ before, after, reloaded }));
      await b.close();`);
    const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }).toString().trim().split('\n').pop()!);
    expect(out.before.link).not.toBe('none'); // a flex child's inline-flex reads back as flex
    expect(out.before.xw).toBe(32);          // the app's own checkbox rule did not resize our ×
    expect(out.before.xRight).toBe(true);    // drawn to the right of the link
    expect(out.after.link).toBe('none');
    expect(out.after.x).toBe('none');
    expect(out.reloaded.link).not.toBe('none');
    expect(out.reloaded.x).not.toBe('none');
  }, 90_000);
});
