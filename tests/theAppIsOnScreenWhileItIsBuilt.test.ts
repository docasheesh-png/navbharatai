// ADMIN 2026-10-01, on the calendar report (120eb52f / b4901ce5): "preview jitna jaldi ayega, user utna
// rukega.... banao". Nine minutes over two builds and the user never saw their app: the first build wrote
// five screens and never src/App.tsx, the second rewrote it at minute three and was stopped a second
// before it finished. Locked here:
//   1. the builder (and the specialists that write the UI) is told to write the entry right after the types;
//   2. a fast lane that stopped before its entry hands that over BY NAME;
//   3. while a build runs, an unwritten screen renders as a "being built" card — in a real browser — and
//      after the build the honest "missing file" banner is back;
//   4. the user is told the app is on screen (phone) or shown it (desktop) the moment the entry is written;
//   5. one kill switch turns all of it off.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { earlyPreviewEnabled, shellEarlyRule, writesTheEntry, entryFirstHandoffLine, renderWhileBuilding } from '../src/server/AgentV3/earlyPreview';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { unwrittenEntries } from '../src/server/AgentV3/SimpleBuilder';
import { renderPreview } from '../src/server/runtime/renderPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { isAppEntryPath, offerWatchLive } from '../src/components/agentv3/earlyPreviewCue';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const OFF = { AGENTV3_EARLY_PREVIEW: 'off' } as NodeJS.ProcessEnv;
const ON = {} as NodeJS.ProcessEnv;

describe('1 · the entry is written right after the types', () => {
  it('the architect is told so, and why', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('GET THE APP ON SCREEN EARLY');
    expect(p).toMatch(/right after `src\/types\.ts`, write the ENTRY \(`src\/App\.tsx`\)/);
    expect(p).toMatch(/never stub them out or delete the imports/);
    // The existing rule it sits beside still stands: a CHILD never imports from the root.
    expect(p).toContain('NEVER import a type from `App.tsx`');
    expect(p.indexOf('SHARED TYPES LIVE IN ONE FILE')).toBeLessThan(p.indexOf('GET THE APP ON SCREEN EARLY'));
  });
  it('the specialists that write the UI get it; the rest do not', () => {
    expect(['frontend', 'fullstack', 'mobile'].every(writesTheEntry)).toBe(true);
    expect(['backend', 'database', 'reviewer', 'tester'].some(writesTheEntry)).toBe(false);
    const sub = read('src/server/AgentV3/SubAgent.ts');
    expect(sub).toMatch(/if \(roleExpectsArtifacts\(cfg\.tools\) && writesTheEntry\(role\)\) \{\s*const rule = shellEarlyRule\(\);/);
  });
  it('the write-time typecheck already sends a missing screen to the file that fixes it, not back to the entry', () => {
    // The rule leans on this: an entry written first names screens that do not exist yet.
    expect(read('src/server/AgentV3/tscErrorCause.ts')).toMatch(/const missing = CANNOT_FIND_MODULE_RE\.exec\(message\);/);
  });
});

describe('2 · a fast lane that never reached the entry says so, by name', () => {
  const plan = ['src/types.ts', 'src/utils/dateUtils.ts', 'src/store/eventStore.ts', 'src/components/Header.tsx', 'src/pages/CalendarPage.tsx', 'src/App.tsx'];
  const unwritten = (salvaged: string[]) => unwrittenEntries(plan.map((path) => ({ path, purpose: '' })), salvaged);
  it('🔴 the report: five files salvaged, the entry not among them', () => {
    const line = entryFirstHandoffLine(unwritten(['src/types.ts', 'src/utils.ts', 'src/utils/dateUtils.ts', 'src/vite-env.d.ts', 'src/store/eventStore.ts']), ON);
    expect(line).toMatch(/^src\/App\.tsx is NOT written yet/);
    expect(line).toMatch(/Write src\/App\.tsx NEXT, before any other file/);
  });
  it('nothing to say when the entry was written, or there was no plan', () => {
    expect(entryFirstHandoffLine(unwritten(plan), ON)).toBe('');
    expect(entryFirstHandoffLine([], ON)).toBe('');
    expect(entryFirstHandoffLine(undefined, ON)).toBe('');
  });
  it('both hand-offs carry it', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("const salvageEntryLine = entryFirstHandoffLine(unwrittenEntries((sb.plannedPaths ?? []).map((path) => ({ path, purpose: '' })), sb.salvagedPaths));");
    expect(route).toContain("(salvageEntryLine ? ` ${salvageEntryLine}` : '') +");
    expect(route).toContain("const planEntryLine = entryFirstHandoffLine(unwrittenEntries(sb.plannedPaths.map((path) => ({ path, purpose: '' })), []));");
    expect(route).toContain("(planEntryLine ? ` ${planEntryLine}` : '') +");
  });
});

const APP_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
  // The calendar's entry, written before its screens: two screens and a helper are not there yet.
  'src/App.tsx': "import Header from './components/Header';\nimport CalendarPage from './pages/CalendarPage';\nimport { DayCell } from './components/DayCell';\nimport { formatDate } from './utils/dateUtils';\nexport default function App() {\n  return (<div><Header title=\"My Calendar\" /><main><h1 id=\"t\">Calendar</h1><CalendarPage /><DayCell /><p id=\"d\">{String(formatDate(1))}</p></main></div>);\n}\n",
  'src/components/Header.tsx': "export default function Header({ title }: { title: string }) { return <header id=\"hdr\">{title}</header>; }\n",
};
const html = (building: boolean, origin?: string) => renderPreview(VirtualFileSystem.fromRecord(APP_FILES), origin, 'ws-early', { building });

describe('3 · the preview while a build runs', () => {
  it('the render knows whether a build is running, and nothing else changes when it is not', () => {
    expect(html(true)).toContain('var BUILDING = true;');
    expect(html(false)).toContain('var BUILDING = false;');
    expect(renderPreview(VirtualFileSystem.fromRecord(APP_FILES), undefined, 'ws-early')).toContain('var BUILDING = false;');
  });
  it('🔒 the card text reaches the page as an escape, not a raw control character (the template-literal trap)', () => {
    const page = html(true);
    expect(page).toContain("'\\u23F3 ' + label + ' is being built\\u2026'");
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(page)).toBe(false);
  });
  it('the route asks it only while a build is running, and caches the two renders apart', () => {
    expect(renderWhileBuilding(true, false, ON)).toBe(true);
    expect(renderWhileBuilding(undefined, true, ON)).toBe(true);
    expect(renderWhileBuilding('yes', false, ON)).toBe(false);
    expect(renderWhileBuilding(true, true, OFF)).toBe(false);
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('const building = renderWhileBuilding(req.body?.building, isBuildRunningFor(workspaceId));');
    expect(route).toContain("const cacheKey = `${workspaceId}|${previewOrigin ?? ''}${building ? '|building' : ''}`;");
    expect(route).toContain('renderPreview(vfs, previewOrigin, workspaceId, { building })');
  });
  it('the client says when it is building, and renders once more when the build ends', () => {
    const surface = read('src/components/agentv3/PreviewSurface.tsx');
    expect(surface).toContain('building: buildingRef.current }),');
    expect(surface).toContain('renderedWhileBuilding.current = data.building === true;');
    expect(surface).toMatch(/if \(renderedWhileBuilding\.current && !inFlight\.current\) \{\s*renderedWhileBuilding\.current = false;\s*void loadInBrowser\(\);/);
  });
});

describe('4 · the user is told the app is on screen', () => {
  it('only a write of the ENTRY in this build counts — not the starter that is always there', () => {
    for (const p of ['src/App.tsx', 'App.jsx', './src/App.tsx', 'src/app/page.tsx', 'app/page.tsx']) expect(isAppEntryPath(p)).toBe(true);
    for (const p of ['src/main.tsx', 'src/components/App.css', 'src/pages/AppSettings.tsx', 'src/types.ts', '']) expect(isAppEntryPath(p)).toBe(false);
    let s = agentV3Reducer(initialAgentV3State(), { type: 'build_meta', buildId: 'b1', promptHash: 'h', ts: 1 });
    s = agentV3Reducer(s, { type: 'file_changed', agent: 'architect', change: { path: 'src/pages/CalendarPage.tsx', kind: 'create' }, ts: 10 });
    expect(s.entryWrittenAt).toBeUndefined();
    s = agentV3Reducer(s, { type: 'file_changed', agent: 'architect', change: { path: 'src/App.tsx', kind: 'edit' }, ts: 20 });
    expect(s.entryWrittenAt).toBe(20);
    s = agentV3Reducer(s, { type: 'file_changed', agent: 'architect', change: { path: 'src/App.tsx', kind: 'edit' }, ts: 30 });
    expect(s.entryWrittenAt).toBe(20);
    s = agentV3Reducer(s, { type: 'build_meta', buildId: 'b2', promptHash: 'h', ts: 40 });
    expect(s.entryWrittenAt).toBeUndefined();
  });
  it('the offer appears while building, once the entry is written, and not over an open preview', () => {
    expect(offerWatchLive({ running: true, entryWrittenAt: 5, previewOpen: false })).toBe(true);
    expect(offerWatchLive({ running: true, entryWrittenAt: undefined, previewOpen: false })).toBe(false);
    expect(offerWatchLive({ running: true, entryWrittenAt: 5, previewOpen: true })).toBe(false);
    expect(offerWatchLive({ running: false, entryWrittenAt: 5, previewOpen: false })).toBe(false);
  });
  it('the panel wires it: a button on the live strip, and on a desktop the preview opens itself', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain("onWatchLive={offerWatchLive({ running, entryWrittenAt: state.entryWrittenAt, previewOpen: showWorkspace && tab === 'preview' }) ? () => openSurfaceFromFooter('preview') : undefined}");
    expect(panel).toContain('Your app is on screen — watch it live');
    expect(panel).toContain("const appOnScreen = !!state.previewUrl || (running && state.entryWrittenAt !== undefined);");
  });
});

describe('5 · one kill switch', () => {
  it('off ⇒ no rule, no hand-off line, no building render', () => {
    expect(earlyPreviewEnabled(ON)).toBe(true);
    expect(earlyPreviewEnabled(OFF)).toBe(false);
    expect(shellEarlyRule(OFF)).toEqual([]);
    expect(entryFirstHandoffLine(['src/App.tsx'], OFF)).toBe('');
    expect(renderWhileBuilding(true, true, OFF)).toBe(false);
  });
});

// A REAL BROWSER, where one exists (CI has none — skipped visibly there). React is served from the
// repo's own vendored copy, because the preview's CDN is not reachable from a test machine.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const pub = join(__dirname, '..', 'public');
  const pages: Record<string, string> = {};
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const u = (q.url ?? '/').split('?')[0];
      if (pages[u]) { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pages[u]); return; }
      const f = join(pub, u);
      if (u.startsWith('/vendor/') && existsSync(f)) { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(readFileSync(f)); return; }
      r.writeHead(404); r.end('not found');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    pages['/building'] = html(true, base);
    pages['/after'] = html(false, base);
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function look(path: string) {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-early-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `
import playwright from '${PW}';
import { readFileSync } from 'node:fs';
const pub = ${JSON.stringify(pub)};
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.addInitScript(readFileSync(pub + '/vendor/react18/react.production.min.js', 'utf8') + '\\n' + readFileSync(pub + '/vendor/react18/react-dom.production.min.js', 'utf8'));
await page.route('https://esm.sh/**', (route) => {
  const u = route.request().url();
  const f = u.includes('react-dom') ? (u.includes('/client') ? 'react-dom-client.mjs' : 'react-dom.mjs') : u.includes('jsx-runtime') ? 'jsx-runtime.mjs' : 'react.mjs';
  route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(pub + '/vendor/react18/' + f, 'utf8') });
});
await page.goto(${JSON.stringify(base)} + ${JSON.stringify(path)});
await page.waitForFunction(() => !!document.getElementById('hdr'), null, { timeout: 30000 });
await page.waitForTimeout(500);
const out = await page.evaluate(() => ({
  header: document.getElementById('hdr')?.textContent,
  title: document.getElementById('t')?.textContent,
  cards: [...document.querySelectorAll('[data-nbai-building]')].map((e) => e.textContent),
  banner: [...document.querySelectorAll('div')].some((e) => (e.textContent || '').startsWith('⚠️ Missing file')),
}));
console.log('NBAI_EARLY ' + JSON.stringify(out));
await browser.close();
`);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const line = stdout.split('\n').find((l) => l.startsWith('NBAI_EARLY '));
    return JSON.parse(line!.slice('NBAI_EARLY '.length)) as { header: string; title: string; cards: string[]; banner: boolean };
  }

  it('🔴 mid-build: the entry renders, each unwritten screen is a card, and nothing reads as an error', async () => {
    const out = await look('/building');
    expect(out.header).toBe('My Calendar');
    expect(out.title).toBe('Calendar');
    expect(out.cards).toEqual(['⏳ CalendarPage is being built…', '⏳ DayCell is being built…']);
    expect(out.banner).toBe(false);
  }, 120_000);

  it('after the build: no cards, and the honest missing-file banner is back', async () => {
    const out = await look('/after');
    expect(out.header).toBe('My Calendar');
    expect(out.cards).toEqual([]);
    expect(out.banner).toBe(true);
  }, 120_000);
});
