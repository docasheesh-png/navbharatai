import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  parseExploreOutput, summarizeExplore, exploreUserSummary, clickExplorerModule,
  FAILING_VERDICTS, EXPLORE_RESULT_MARKER, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  PRESS_FAILURE_CAUSE, MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT,
} from '../src/server/AgentV3/clickExplorer';
import { explorerRepairFindings } from '../src/server/AgentV3/explorerRepair';
import { leanReviewInline, leanReviewAnswersInOneCall, LEAN_REVIEW_FILE_CHARS, LEAN_REVIEW_INLINE_CHARS } from '../src/server/AgentV3/ReviewerAgent';
import { appHasNoDataEntry, dataEntryEvidence } from '../src/server/AgentV3/journeyDerivation';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

/**
 * AUTOPSY 8b8743a3 (2026-10-04) — "Road infinite both side street light with start restart scoring".
 *
 * A 3D driving game, 8.0 minutes, `ok: true`, ₹122.59, release gate YELLOW. Three facts from that one
 * report, each a separate defect, each fixed here:
 *
 *  1. 🔴 ITS THREE CONTROLS COULD NOT BE PRESSED, AND THAT WAS REPORTED AS OUR OWN SHORTCOMING.
 *     "City Road", "Forest Road" and "Start Race" each failed with `locator.click: Timeout 4000ms
 *     exceeded`; every one was recorded `skipped`; `summarizeExplore` drops every skipped press; so the
 *     verdict was `EXPLORE_NOTHING_TO_PRESS` — *"Controls were found but none could be pressed on a
 *     fresh load, so nothing was proven about them"* — an info line with no offer and no repair. The
 *     app shipped GREEN-rendered and the closing reply told the user to press Start Race.
 *  2. 🔴 THE LEAN REVIEW WAS HANDED NOTHING AND READ ONE FILE TWELVE TIMES. The build changed exactly
 *     one source file, a 22,306-byte `src/App.tsx`: over the per-file inline cap, so omitted, so
 *     nothing was inline, so the review kept its tools and spent all 12 steps paginating that single
 *     file (the LOOP GUARD fired) and reported nothing.
 *  3. 🔴 A SPEED SLIDER MADE A GAME A DATA APP. Its one `<input type="range">` matched "a form
 *     element", so the save-and-reload journey could not be derived from a form that does not exist,
 *     and the release gate told the user *"whether it actually SAVES anything is untested"* about an
 *     app with nothing to save.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const line = (o: unknown) => `${EXPLORE_RESULT_MARKER}${JSON.stringify(o)}`;
const summaryLine = (over: Record<string, unknown> = {}) => line({ type: 'summary', loaded: true, note: '', found: 4, chosen: 3, skipped: [], ...over });
const press = (over: Record<string, unknown> = {}) => line({ type: 'press', label: 'Start Race', tag: 'button', verdict: 'ok', note: '', errors: [], changed: true, ...over });

// ── 1 · A control nobody can press is the app's defect ─────────────────────────────────────────────

describe('a control that cannot be pressed is a finding, not a shrug', () => {
  const coveredRun = () => parseExploreOutput([
    summaryLine(),
    press({ label: 'City Road', verdict: 'covered', note: 'it cannot be pressed: canvas#game is on top of it' }),
    press({ label: 'Forest Road', verdict: 'covered', note: 'it cannot be pressed: canvas#game is on top of it' }),
    press({ label: 'Start Race', verdict: 'covered', note: 'it cannot be pressed: something covering the whole screen (canvas#game) is on top of it' }),
  ].join('\n'));

  it('the report\'s own three controls now FAIL the check instead of proving nothing', () => {
    const v = summarizeExplore(coveredRun());
    expect(v.code).toBe('EXPLORE_FAILED');
    expect(v.outcome).toBe('failed');
    expect(v.failures.map((f) => f.label)).toEqual(['City Road', 'Forest Road', 'Start Race']);
    expect(v.pressed).toBe(3);
    expect(v.message).toContain('3 did not work');
  });

  it('the user is told in plain words, with no code and no tool name', () => {
    const proof = exploreUserSummary(summarizeExplore(coveredRun()));
    expect(proof.ok).toBe(false);
    expect(proof.headline).toBe('NavBharatAI tested your app and found a problem');
    expect(proof.steps[0]).toBe('"City Road" cannot be pressed at all — something else on the screen is on top of it.');
    expect(JSON.stringify(proof)).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|playwright|locator|canvas#|z-index/i);
  });

  it('a search box that cannot be reached says "used", not "pressed"', () => {
    const run = parseExploreOutput([summaryLine(), press({ label: 'Search', kind: 'type', verdict: 'covered', note: 'it cannot be used: div.modal is on top of it' })].join('\n'));
    expect(exploreUserSummary(summarizeExplore(run)).steps[0]).toContain('cannot be used at all');
  });

  it('it is one of the failing verdicts, so the repair that reads that set picks it up', () => {
    expect(FAILING_VERDICTS.has('covered')).toBe(true);
    expect(read('src/server/AgentV3/explorerRepair.ts')).toContain('FAILING_VERDICTS');
    const [finding] = explorerRepairFindings([{
      label: 'Start Race', tag: 'button', verdict: 'covered', changed: false, errors: [],
      note: 'it cannot be pressed: something covering the whole screen (canvas#game) is on top of it',
    }]);
    expect(finding).toContain('"Start Race"');
    expect(finding).toContain('a user cannot reach the control at all');
    expect(finding).toContain('z-index');                              // the fix names the real cause
    expect(finding).toContain('Do not remove, hide or disable the control');
  });

  it('EXPLORE_FAILED still carries the user\'s one-tap offer, so the finding is actionable', () => {
    const [offer] = buildFindingSuggestions([{ code: 'EXPLORE_FAILED', autoResolved: false }]);
    expect(offer).toBeTruthy();
    expect(offer.prompt.length).toBeGreaterThan(40);
  });

  it('⚠️ PRECISION: a press that really was OURS is still skipped and still proves nothing', () => {
    const ours = parseExploreOutput([
      summaryLine(),
      press({ label: 'City Road', verdict: 'skipped', note: 'could not be pressed: locator.click: Timeout 4000ms exceeded. — element is detached' }),
    ].join('\n'));
    const v = summarizeExplore(ours);
    expect(v.code).toBe('EXPLORE_NOTHING_TO_PRESS');
    expect(v.failures).toEqual([]);
    expect(exploreUserSummary(v).headline).toBe('');     // the card says nothing rather than blaming the app
  });
});

describe('🔒 covered is decided by the PAGE, never inferred from a timeout', () => {
  const mod = clickExplorerModule({ causeSrc: PRESS_FAILURE_CAUSE.source, causeFlags: PRESS_FAILURE_CAUSE.flags }, 'const chromium = null;');

  it('the judge starts at skipped and only a positive statement of coverage moves it', () => {
    // `tsc` and `vitest` cannot see that a probe was replaced by a guess, which is why this is a source
    // guard: the ORDER is the invariant — skipped first, then an early return when nothing says covered.
    const at = (s: string) => mod.indexOf(s);
    expect(at("res.verdict = 'skipped';")).toBeGreaterThan(0);
    expect(at("res.verdict = 'skipped';")).toBeLessThan(at('if (!over && !intercepts) return;'));
    expect(at('if (!over && !intercepts) return;')).toBeLessThan(at("res.verdict = 'covered';"));
    expect(mod).toContain('const over = marked >= 0 ? await page.evaluate(coveredBy, { attr: attr, i: marked }).catch(() => null) : null;');
    expect(mod).toContain('const intercepts = /intercepts pointer events/i.test(String(message || \'\'));');
  });

  it('the probe answers null for everything that is NOT coverage', () => {
    // The in-page function, run here against a real DOM-free string check of its own branches: each of
    // these early returns is the difference between a finding about the app and a lie about it.
    expect(mod).toContain('if (!el) return null;');
    expect(mod).toContain('if (r.width < 1 || r.height < 1) return null;');
    expect(mod).toContain('if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null;');
    expect(mod).toContain('if (!top || top === el || el.contains(top) || top.contains(el)) return null;');
  });

  it('a failure BEFORE the control was tried never reaches the probe (marked stays -1)', () => {
    expect(mod).toContain('let marked = -1;');
    expect(mod).toContain('marked = hit.i;');
    // Both lanes carry it, so a covered search box is found the same way a covered button is.
    expect(mod.match(/let marked = -1;/g)!.length).toBe(2);
  });

  it('the generated module still parses as JavaScript', async () => {
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'nbai-covered-parse-'));
    const file = join(dir, 'm.mjs');
    writeFileSync(file, mod);
    expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow();
  });
});

// ── 2 · The lean review is handed the one file it has to judge ─────────────────────────────────────

describe('the one changed file is handed over even when it is over the per-file cap', () => {
  // The report's real size, to the byte.
  const app = `// src/App.tsx\n${'z'.repeat(22_306 - 16)}\n`;

  it('a 22,306-byte App.tsx is inlined, so the review answers in one call with no tools', () => {
    expect(app.length).toBe(22_306);
    expect(app.length).toBeGreaterThan(LEAN_REVIEW_FILE_CHARS);
    expect(app.length).toBeLessThan(LEAN_REVIEW_INLINE_CHARS);
    const inline = leanReviewInline(['src/App.tsx'], () => app);
    expect(inline.files.map((f) => f.path)).toEqual(['src/App.tsx']);
    expect(inline.omitted).toEqual([]);
    expect(leanReviewAnswersInOneCall(inline)).toBe(true);
  });

  it('⚠️ PRECISION: a set that genuinely does not fit still applies the per-file cap, as before', () => {
    const files: Record<string, string> = {
      'src/App.tsx': 'a'.repeat(30_000),
      'src/pages/Home.tsx': 'b'.repeat(20_000),
      'src/huge.ts': 'c'.repeat(40_000),
    };
    const inline = leanReviewInline(Object.keys(files), (p) => files[p]);
    expect(inline.omitted).toContain('src/huge.ts');          // over the per-file cap, and the set overflows
    expect(inline.files.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(LEAN_REVIEW_INLINE_CHARS);
  });

  it('the total bound is never exceeded, whichever branch runs', () => {
    const one = { 'src/App.tsx': 'x'.repeat(LEAN_REVIEW_INLINE_CHARS + 1) };
    const inline = leanReviewInline(Object.keys(one), (p) => one[p as keyof typeof one]);
    expect(inline.files).toEqual([]);
    expect(inline.omitted).toEqual(['src/App.tsx']);
    expect(leanReviewAnswersInOneCall(inline)).toBe(false);    // nothing inline ⇒ reading is the only way
  });
});

// ── 3 · A slider is not data a person expects to find again ────────────────────────────────────────

describe('a speed slider does not make a game a data app', () => {
  const game = `import { useState } from 'react';
export default function App() {
  const [speed, setSpeed] = useState(1);
  return (<div>
    <h1>Road Racer</h1>
    <input type="range" min={1} max={10} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
    <button onClick={() => start()}>Start Race</button>
  </div>);
}
`;

  it('the report\'s own markup is no longer read as taking input', () => {
    expect(appHasNoDataEntry({ 'src/App.tsx': game })).toBe(true);
    expect(dataEntryEvidence({ 'src/App.tsx': game })).toBeNull();
  });

  it('every other non-data control type is the same', () => {
    for (const type of ['range', 'button', 'submit', 'reset', 'hidden', 'image']) {
      const src = `export default () => <form><input type="${type}" onChange={(e) => go(e)} /></form>;`;
      // The `<form>` itself still counts — the point is that the INPUT no longer does.
      expect(dataEntryEvidence({ 'src/App.tsx': src })!.what).toBe('a form element');
      const noForm = `export default () => <div><input type="${type}" onChange={(e) => go(e)} /></div>;`;
      expect(appHasNoDataEntry({ 'src/App.tsx': noForm }), type).toBe(true);
    }
  });

  it('⚠️ PRECISION: everything that CAN hold saveable data still counts', () => {
    const cases: Array<[string, string]> = [
      ['a text box', '<input type="text" onChange={f} />'],
      ['a bare input', '<input onChange={f} />'],
      ['a checkbox', '<input type="checkbox" checked={d} onChange={f} />'],
      ['a number', '<input type="number" value={n} onChange={f} />'],
      ['a date', '<input type="date" value={d} onChange={f} />'],
      ['a type we cannot read', '<input type={kind} onChange={f} />'],
      ['a textarea', '<textarea onChange={f} />'],
      ['a select', '<select onChange={f}><option>a</option></select>'],
      ['a UI-library slider (contract unknown)', '<Slider value={v} onChange={f} />'],
      ['a UI-library switch (contract unknown)', '<Switch checked={v} onChange={f} />'],
      ['an editable surface', '<div contentEditable />'],
    ];
    for (const [what, markup] of cases) {
      expect(appHasNoDataEntry({ 'src/App.tsx': `export default () => <div>${markup}</div>;` }), what).toBe(false);
    }
  });

  it('a slider BESIDE a real text box does not hide it — every occurrence is read', () => {
    const both = `export default () => (<div>
  <input type="range" value={v} onChange={(e) => setV(+e.target.value)} />
  <input type="text" placeholder="Your name" onChange={(e) => setName(e.target.value)} />
</div>);`;
    const found = dataEntryEvidence({ 'src/App.tsx': both });
    expect(found).not.toBeNull();
    expect(found!.line).toContain('type="text"');
  });

  it('a multi-line slider tag is read whole, not to its first `>`', () => {
    // The JSX-multiline class this repo has paid for three times: the `>` of the arrow is not the tag's.
    const multi = `export default () => (<div><input
      type="range"
      value={speed}
      onChange={(e) => setSpeed(Number(e.target.value))}
    /></div>);`;
    expect(appHasNoDataEntry({ 'src/App.tsx': multi })).toBe(true);
  });
});

// ── A REAL BROWSER, where one exists ──────────────────────────────────────────────────────────────
// CI has no Chromium, so this is skipped — visibly — there. The string tests above are what CI holds;
// this is what proves a covered button really reads as covered on a real page, and an uncovered one
// does not. Without it, "something is on top of it" would be a claim about a DOM nobody ran.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const menu = `<div id="root">
<h1>Road Racer</h1>
<button onclick="document.getElementById('msg').textContent='city'">City Road</button>
<button onclick="document.getElementById('msg').textContent='forest'">Forest Road</button>
<button onclick="document.getElementById('msg').textContent='go'">Start Race</button>
<p id="msg">pick a road</p>
</div>`;
  const pages: Record<string, string> = {
    // The report's app: a full-viewport canvas mounted OVER the menu it is supposed to sit behind.
    '/': `<!doctype html><html lang="en"><head><title>t</title></head><body>${menu}
<canvas id="game" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9"></canvas>
</body></html>`,
    // The same app with the stacking right — the control of the experiment.
    '/fixed': `<!doctype html><html lang="en"><head><title>t</title></head><body>
<canvas id="game" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:0"></canvas>
<div style="position:relative;z-index:1">${menu}</div>
</body></html>`,
  };
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const body = pages[(q.url ?? '/').split('?')[0]];
      r.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
      r.end(body ?? `Cannot GET ${q.url}`);
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function explore(path: string) {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-covered-real-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base: base + path.replace(/^\//, ''), marker: EXPLORE_RESULT_MARKER, maxClicks: 6,
      maxSecond: MAX_SECOND_LEVEL_CLICKS, perParent: MAX_SECOND_LEVEL_PER_PARENT, budgetMs: 90_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
      causeSrc: PRESS_FAILURE_CAUSE.source, causeFlags: PRESS_FAILURE_CAUSE.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 170_000 }, (e, out) => (e ? rej(e) : res(out))));
    return parseExploreOutput(stdout);
  }

  it('a canvas over the menu makes every control covered, and the check FAILS', async () => {
    const run = await explore('/');
    expect(run.presses.length).toBeGreaterThan(0);
    for (const p of run.presses) expect(p.verdict, `${p.label}: ${p.note}`).toBe('covered');
    expect(run.presses[0].note).toContain('is on top of it');
    expect(run.presses[0].note).toContain('canvas');
    expect(summarizeExplore(run).code).toBe('EXPLORE_FAILED');
  }, 180_000);

  it('⚠️ the SAME app with the stacking right passes — so this is not every canvas', async () => {
    const run = await explore('/fixed');
    expect(run.presses.length).toBeGreaterThan(0);
    for (const p of run.presses) expect(p.verdict, `${p.label}: ${p.note}`).toBe('ok');
    expect(summarizeExplore(run).code).toBe('EXPLORE_PASSED');
  }, 180_000);
});
