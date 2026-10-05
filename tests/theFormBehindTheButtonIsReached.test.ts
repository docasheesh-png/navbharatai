// Autopsy 12c642ed (2026-09-30). The habit tracker's "add habit" form lived in a modal behind a
// "+ New Habit" button. The journey looked for the submit control on the page as loaded, did not find
// it, and reported JOURNEY_NOT_RUN — "the submit control was not present on the running page" — about
// a form every user reaches in one tap. The release gate then held the build YELLOW for a journey
// "that could not be reached".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { journeyScript, parseJourneyResults, JOURNEY_OPENER, TOOLS_DIR, type Journey } from '../src/server/AgentV3/journeyDerivation';
import { NEVER_PRESS } from '../src/server/AgentV3/clickExplorer';
import { makeTempDir } from './helpers/tempDir';

describe('what counts as an opener', () => {
  it.each(['+ New Habit', 'Add task', 'New', 'Create note', '＋ Add'])('%s', (l) => {
    expect(JOURNEY_OPENER.test(l) && !NEVER_PRESS.test(l)).toBe(true);
  });
  it.each(['Delete all', 'Clear filters', 'Why no cloud?', 'Sign out', 'Add to cart and pay', 'Send new invite'])('NOT %s', (l) => {
    expect(JOURNEY_OPENER.test(l) && !NEVER_PRESS.test(l)).toBe(false);
  });
});

describe('the generated runner', () => {
  const j: Journey = { id: 'j1', kind: 'create-persists', route: '/', title: 't', writes: true, fields: [{ target: { kind: 'placeholder', value: 'Habit name' }, value: 'MARK-1' }], submit: { kind: 'text', value: 'Save habit' } };
  const script = journeyScript('http://x', [j], 'MARK-1');
  it('looks for an opener only when the submit is not visible, and before filling', () => {
    const open = script.indexOf("out.step = 'open';");
    const fill = script.indexOf("out.step = 'fill';");
    expect(open).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(open);
    expect(script).toContain('if (!(await submitVisible())) {');
    // Since autopsy e49afa97 every name the control goes by (text, aria-label, title) is asked.
    expect(script).toContain('const name = names.find((x) => OPENER.test(x) || /^[+＋]$/.test(x));');
    expect(script).toContain('if (!name || names.some((x) => NEVER.test(x))) continue;');
  });
});

// A REAL BROWSER, where one exists (the session container); skipped visibly in CI, which has none.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const page = `<!doctype html><html lang="en"><head><title>Habits</title></head><body><div id="root">
<h1>Habits</h1>
<button onclick="document.body.dataset.cleared='1'">Clear filters</button>
<button id="open">+ New Habit</button>
<ul id="list"></ul>
<div id="modal" hidden><form id="f"><input placeholder="Habit name" id="name"><button type="submit">Save habit</button></form></div>
</div><script>
const KEY = 'habits';
const draw = () => { document.getElementById('list').innerHTML = JSON.parse(localStorage.getItem(KEY) || '[]').map((h) => '<li>' + h + '</li>').join(''); };
document.getElementById('open').onclick = () => { document.getElementById('modal').hidden = false; };
document.getElementById('f').onsubmit = (e) => { e.preventDefault(); const v = document.getElementById('name').value; localStorage.setItem(KEY, JSON.stringify([...JSON.parse(localStorage.getItem(KEY) || '[]'), v])); document.getElementById('modal').hidden = true; draw(); };
draw();
</script></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('🔴 presses "+ New Habit", fills the modal, and proves the habit survives a reload', async () => {
    const j: Journey = { id: 'j1', kind: 'create-persists', route: '/', title: 't', writes: true, fields: [{ target: { kind: 'placeholder', value: 'Habit name' }, value: 'NBAI-MARK-7' }], submit: { kind: 'text', value: 'Save habit' } };
    const full = journeyScript(base, [j], 'NBAI-MARK-7');
    const body = full.slice(full.indexOf('\n') + 1, full.lastIndexOf('NBAI_EOF'))
      .replace(`import playwright from '${TOOLS_DIR}/node_modules/playwright/index.js';`, `import playwright from '${PW}';`);
    const dir = makeTempDir('nbai-journey-real-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, body);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const [r] = parseJourneyResults(stdout);
    expect(r.verdict).toBe('passed');
    expect(r.note).toMatch(/still there after a reload/);
    expect((r as unknown as { opener?: string }).opener).toBe('+ New Habit');
  }, 120_000);
});
