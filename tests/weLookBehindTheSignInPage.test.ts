/**
 * AUTHENTICATED EXPLORATION (autopsy 8e124182, admin 2026-09-30: "login ke andar wali jaanch bhi banao").
 *
 * Every browser check stopped at the stock app's `/login`: routes "redirected", journeys "unreachable", the
 * explorer pressed "Show password", and the feature probe called the stock list missing. These tests hold
 * the new subsystem to what it promises: it signs in only with credentials the app itself ships, never
 * prints them, never reads a failed sign-in as success, and the other checks really open the app behind
 * the door with the saved session. The real-browser half runs wherever Chromium exists and is skipped —
 * visibly — in CI, exactly like the click explorer's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  signInCandidates, parseSignInOutput, signInReportLine, signInModule, signInScript, isSignInRoute, newPageOptionsExpr,
  SIGN_IN_RESULT_MARKER, MAX_SIGN_IN_CANDIDATES, SIGNED_IN_STATE_PATH,
} from '../src/server/AgentV3/signInExplore';
import { pageCheckScript } from '../src/server/AgentV3/PageRouteCheck';
import { journeyScript } from '../src/server/AgentV3/journeyDerivation';
import { clickExplorerScript, clickExplorerModule, parseExploreOutput, EXPLORE_RESULT_MARKER, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE } from '../src/server/AgentV3/clickExplorer';

const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('which credentials — only the ones the app ships', () => {
  it('reads a seed account, a pre-filled sign-in form, and a demo hint', () => {
    const got = signInCandidates({
      'src/lib/seed.ts': "export const users = [{ id: 'u1', email: 'admin@stock.test', role: 'admin', password: 'admin123' }];",
      'src/pages/Login.tsx': "const [email, setEmail] = useState('boss@stock.test');\nconst [password, setPassword] = useState('letmein');\nreturn <input type=\"password\" value={password} />;",
      'src/pages/Hint.tsx': '<p>Demo login: viewer@stock.test / password: view123</p>',
    });
    expect(got.map((c) => c.source)).toEqual(['demo account in the source', 'sign-in form default', 'demo hint on the page']);
    expect(got[0]).toMatchObject({ identifier: 'admin@stock.test', password: 'admin123' });
    expect(got[1]).toMatchObject({ identifier: 'boss@stock.test', password: 'letmein' });
  });

  it('never a guess, a placeholder, a key, a test file or more than the cap', () => {
    expect(signInCandidates({ 'src/App.tsx': 'export default function App() { return null; }' })).toEqual([]);
    expect(signInCandidates({ 'src/a.ts': "{ email: 'a@b.co', password: 'Enter your password' }" })).toEqual([]);
    expect(signInCandidates({ 'src/a.ts': "{ email: 'a@b.co', password: 'sk_live_abcdefghijklmnop' }" })).toEqual([]);
    expect(signInCandidates({ 'src/a.test.ts': "{ email: 'a@b.co', password: 'secret1' }" })).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`src/u${i}.ts`, `{ email: 'u${i}@b.co', password: 'pass${i}xx' }`]));
    expect(signInCandidates(many).length).toBe(MAX_SIGN_IN_CANDIDATES);
  });

  it('the report says where the account came from and never what it is', () => {
    const line = signInReportLine({ ran: true, signedIn: true, note: 'demo account in the source', screens: [{ path: '/', html: '' }] });
    expect(line.code).toBe('AUTH_EXPLORE_SIGNED_IN');
    expect(line.message).not.toMatch(/admin123|@stock\.test/);
    expect(signInReportLine(parseSignInOutput('')).code).toBe('AUTH_EXPLORE_NOT_RUN');
    const script = signInScript('http://x/', [{ identifier: 'a@b.co', password: 'pw1234', source: 'demo account in the source' }]);
    expect(script).toContain(SIGN_IN_RESULT_MARKER.trim());
  });
});

describe('the other checks open the app with the saved session', () => {
  it('page check, journey (except the sign-in form itself) and explorer load the session file', () => {
    expect(pageCheckScript('http://x', ['/stock'], { storageState: SIGNED_IN_STATE_PATH })).toContain(`browser.newPage(${newPageOptionsExpr(SIGNED_IN_STATE_PATH)})`);
    // Signed out still carries the shared reduced-motion options (autopsy 0bb437b4).
    expect(pageCheckScript('http://x', ['/stock'])).toContain(`browser.newPage(${newPageOptionsExpr(null)})`);
    const j = journeyScript('http://x', [
      { id: 'a', kind: 'fill', route: '/add-stock', fields: [], submit: null } as never,
      { id: 'b', kind: 'fill', route: '/login', fields: [], submit: null } as never,
    ], 'M ', { storageState: SIGNED_IN_STATE_PATH });
    expect(j).toContain(`pageOpts: ${newPageOptionsExpr(SIGNED_IN_STATE_PATH)}`);
    expect(j).toContain(`pageOpts: ${newPageOptionsExpr(null)}`);
    expect(isSignInRoute('/login')).toBe(true);
    expect(isSignInRoute('/stock')).toBe(false);
    expect(clickExplorerScript('http://x/', { blockWrites: false, storageState: SIGNED_IN_STATE_PATH })).toContain(`"storageState":"${SIGNED_IN_STATE_PATH}"`);
  });

  it('the route signs in when the rendered page is a sign-in wall, and hands the session to every check', () => {
    expect(ROUTE).toMatch(/isSignInWall\(String\(html \?\? ''\)\.toLowerCase\(\)\)[\s\S]{0,200}signInBehindTheDoor\(lastPreviewUrl\)/);
    expect(ROUTE).toMatch(/pageCheckScript\(lastPreviewUrl, pageRoutes, \{ storageState: signedInState\(\) \}\)/);
    expect(ROUTE).toMatch(/journeyScript\(lastPreviewUrl, journeys, marker, \{ storageState: signedInState\(\) \}\)/);
    expect(ROUTE).toMatch(/clickExplorerScript\(lastPreviewUrl, \{ blockWrites: writesToUserDatabase\(exploreFiles\), storageState: signedInState\(\) \}\)/);
  });
});

// ── A REAL BROWSER, where one exists ────────────────────────────────────────────────────────────────
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

/** A tiny single-page app: every path serves the same page; the session lives in localStorage. */
function spa(prefill: boolean): string {
  return `<!doctype html><html><body><div id="root"></div><script>
const root = document.getElementById('root');
function render() {
  const signed = localStorage.getItem('session') === 'ok';
  const path = location.pathname;
  if (!signed) {
    root.innerHTML = '<h1>Stock Inventory</h1><form id="f"><label for="e">Email</label><input id="e" type="email" value="${prefill ? 'admin@stock.test' : ''}">'
      + '<label for="p">Password</label><input id="p" type="password" value="${prefill ? 'admin123' : ''}"><button type="submit">Sign in</button></form>';
    document.getElementById('f').onsubmit = function (ev) {
      ev.preventDefault();
      if (document.getElementById('e').value === 'admin@stock.test' && document.getElementById('p').value === 'admin123') {
        localStorage.setItem('session', 'ok'); history.pushState({}, '', '/dashboard'); render();
      } else { root.insertAdjacentHTML('beforeend', '<p role="alert">Wrong email or password</p>'); }
    };
    return;
  }
  const nav = '<nav><a href="/dashboard">Dashboard</a><a href="/stock">Stock Items</a><a href="/logout">Log out</a></nav>';
  if (path === '/stock') root.innerHTML = nav + '<h1>Stock Items</h1><table><tr><th>Item</th></tr><tr><td>Rice</td></tr></table><button onclick="this.textContent=\\'Sorted\\'">Sort by name</button>';
  else root.innerHTML = nav + '<h1>Dashboard</h1><p>3 items low on stock</p><button onclick="this.textContent=\\'Shown\\'">Show alerts</button>';
}
render();
</script></body></html>`;
}

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let prefilled: http.Server;
  let empty: http.Server;
  let basePrefilled = '';
  let baseEmpty = '';
  const start = async (prefill: boolean) => {
    const s = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(spa(prefill)); });
    await new Promise<void>((res) => s.listen(0, '127.0.0.1', () => res()));
    return { s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}/` };
  };
  beforeAll(async () => {
    ({ s: prefilled, base: basePrefilled } = await start(true));
    ({ s: empty, base: baseEmpty } = await start(false));
  });
  afterAll(async () => {
    await new Promise<void>((res) => prefilled.close(() => res()));
    await new Promise<void>((res) => empty.close(() => res()));
  });

  async function runNode(source: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-signin-real-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, source);
    const { execFile } = await import('node:child_process');
    return new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
  }
  const imp = `import playwright from '${PW}';\nconst { chromium } = playwright;`;
  const signIn = async (base: string, candidates: unknown[], state: string) =>
    parseSignInOutput(await runNode(signInModule({ base, marker: SIGN_IN_RESULT_MARKER, state, maxScreens: 6, budgetMs: 45_000, candidates }, imp)));

  it('signs in through a form the app already filled, and reads the screens behind it', async () => {
    const state = join(mkdtempSync(join(tmpdir(), 'nbai-state-')), 's.json');
    const run = await signIn(basePrefilled, [], state);
    expect(run.signedIn).toBe(true);
    expect(run.note).toBe('sign-in form default');
    expect(run.screens.map((s) => s.path)).toEqual(expect.arrayContaining(['/dashboard', '/stock']));
    expect(run.screens.map((s) => s.path)).not.toContain('/logout');
    expect(run.screens.find((s) => s.path === '/stock')!.html).toContain('Stock Items');
    expect(existsSync(state)).toBe(true);
  }, 120_000);

  it('types an account the app ships when the form is empty — and a wrong one is never success', async () => {
    const state = join(mkdtempSync(join(tmpdir(), 'nbai-state-')), 's.json');
    const ok = await signIn(baseEmpty, [{ identifier: 'nope@stock.test', password: 'wrong1', source: 'demo hint on the page' }, { identifier: 'admin@stock.test', password: 'admin123', source: 'demo account in the source' }], state);
    expect(ok.signedIn).toBe(true);
    expect(ok.note).toBe('demo account in the source');
    const bad = await signIn(baseEmpty, [{ identifier: 'nope@stock.test', password: 'wrong1', source: 'demo hint on the page' }], join(tmpdir(), 'never.json'));
    expect(bad.signedIn).toBe(false);
    expect(bad.note).toMatch(/none of the demo accounts/);
    const none = await signIn(baseEmpty, [], join(tmpdir(), 'never2.json'));
    expect(none.note).toMatch(/ships no demo account/);
  }, 180_000);

  it('the click explorer, given the session, presses the controls BEHIND the door', async () => {
    const state = join(mkdtempSync(join(tmpdir(), 'nbai-state-')), 's.json');
    expect((await signIn(basePrefilled, [], state)).signedIn).toBe(true);
    const cfg = {
      base: basePrefilled, marker: EXPLORE_RESULT_MARKER, maxClicks: 6, maxSecond: 2, perParent: 1, budgetMs: 60_000, loadMs: 10_000,
      blockWrites: false, storageState: state,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
    };
    const inside = parseExploreOutput(await runNode(clickExplorerModule(cfg, imp)));
    const labels = inside.presses.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['Stock Items', 'Show alerts']));
    expect(labels).not.toContain('Log out');
    const outside = parseExploreOutput(await runNode(clickExplorerModule({ ...cfg, storageState: null }, imp)));
    expect(outside.presses.map((p) => p.label)).not.toContain('Stock Items');
  }, 180_000);
});
