/**
 * The explorer TRIES a search box and a sort menu, not only buttons (admin 2026-09-30, after autopsy
 * ee0e6de5: "haan, search/sort wala check bana do"). A lookup app with a search box and an A–Z / Z–A
 * sort had both controls go untested ("nothing safe to press"), and a search that filters nothing would
 * have passed every check we own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  pickSearchWord, SEARCH_CONTROL, SORT_CONTROL, MAX_NARROWING_PROBES, FAILING_VERDICTS,
  parseExploreOutput, summarizeExplore, exploreUserSummary, describeTries, clickExplorerModule, clickExplorerScript,
  EXPLORE_RESULT_MARKER, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE, type PressResult,
} from '../src/server/AgentV3/clickExplorer';
import { repairTargets, explorerRepairFindings } from '../src/server/AgentV3/explorerRepair';
import { makeTempDir } from './helpers/tempDir';

const countries = ['India New Delhi Asia', 'Japan Tokyo Asia', 'France Paris Europe', 'Kenya Nairobi Africa', 'Peru Lima South America'];

describe('the word it types comes from the list itself', () => {
  it('a word some items have and some do not — so a working search must change the screen', () => {
    const w = pickSearchWord(countries);
    expect(w.length).toBeGreaterThanOrEqual(3);
    const having = countries.filter((c) => c.toLowerCase().includes(w.toLowerCase())).length;
    expect(having).toBeGreaterThan(0);
    expect(having).toBeLessThan(countries.length);
  });
  it('a Hindi word keeps its vowel signs', () => {
    expect(pickSearchWord(['भारत नई दिल्ली', 'जापान टोक्यो', 'फ्रांस पेरिस'])).toBe('जापान');
  });
  it('no word when every item shares every word, so nothing is tried', () => {
    expect(pickSearchWord(['same row', 'same row', 'same row'])).toBe('');
    expect(pickSearchWord([])).toBe('');
  });
  it('the runner carries the same body — it gives the same answer', () => {
    const mod = clickExplorerModule({ base: 'http://x/' });
    const body = mod.slice(mod.indexOf('function pickSearchWord(items) {'));
    const fnSrc = body.slice(0, body.indexOf('\n}\n') + 2);
    // eslint-disable-next-line no-new-func
    const runnerPick = new Function(`${fnSrc}; return pickSearchWord;`)() as (items: string[]) => string;
    for (const sample of [countries, ['भारत नई दिल्ली', 'जापान टोक्यो', 'फ्रांस पेरिस'], ['a b', 'a b'], ['alpha beta', 'alpha gamma', 'alpha delta']]) {
      expect(runnerPick(sample)).toBe(pickSearchWord(sample));
    }
  });
});

describe('only a control that names itself a search or a sort is tried', () => {
  it('search boxes, in English and Hindi', () => {
    for (const n of ['Search countries', 'Filter by name', 'Find a city', 'खोजें', 'yahan khoje']) expect(SEARCH_CONTROL.test(n)).toBe(true);
    for (const n of ['Name', 'Email address', 'Phone', 'Your message']) expect(SEARCH_CONTROL.test(n)).toBe(false);
  });
  it('sort and filter menus — by their name or their options', () => {
    for (const n of ['Sort by', 'A-Z Z-A', 'Newest Oldest', 'Price: low to high', 'Category', 'क्रम']) expect(SORT_CONTROL.test(n)).toBe(true);
    for (const n of ['Language', 'Theme', 'Status', 'Type', 'Country', 'English Hindi']) expect(SORT_CONTROL.test(n)).toBe(false);
  });
  it('a bounded number per build', () => {
    expect(MAX_NARROWING_PROBES).toBe(3);
  });
});

const line = (o: object) => `${EXPLORE_RESULT_MARKER}${JSON.stringify(o)}`;
const summary = line({ type: 'summary', loaded: true, note: '', found: 1, chosen: 0, skipped: [{ label: 'made by NavBharatAI', why: 'opens outside the app' }] });

describe('a search that does nothing is a failure, told in plain words', () => {
  it('unresponsive is a failing verdict, and the kind survives parsing', () => {
    expect(FAILING_VERDICTS.has('unresponsive')).toBe(true);
    const run = parseExploreOutput([summary,
      line({ type: 'press', kind: 'type', label: 'Search countries', tag: 'input', verdict: 'unresponsive', note: 'typing "Japan" into it changed nothing on the screen', errors: [], changed: false }),
      line({ type: 'press', kind: 'pick', label: 'Sort', tag: 'select', verdict: 'ok', note: 'choosing "Z-A" changed what the screen shows', errors: [], changed: true }),
    ].join('\n'));
    expect(run.presses.map((p) => p.kind)).toEqual(['type', 'pick']);
    const v = summarizeExplore(run);
    expect(v.code).toBe('EXPLORE_FAILED');
    expect(v.message).toMatch(/^Tried 2 search or sort control\(s\) in a real browser; 1 did not work: "Search countries"/);
    const card = exploreUserSummary(v);
    expect(card.steps[0]).toBe('Typing into "Search countries" changed nothing on the screen — it does not search the list.');
    expect(card.steps.join(' ')).not.toMatch(/EXPLORE_|playwright|chromium|glm|kimi|claude/i);
  });

  it('the lookup app of the autopsy now PASSES instead of "nothing to press"', () => {
    const run = parseExploreOutput([summary,
      line({ type: 'press', kind: 'type', label: 'खोजें', tag: 'input', verdict: 'ok', note: 'typing "जापान" changed what the screen shows', errors: [], changed: true }),
      line({ type: 'press', kind: 'pick', label: 'क्रम', tag: 'select', verdict: 'ok', note: 'choosing "Z-A" changed what the screen shows', errors: [], changed: true }),
    ].join('\n'));
    const v = summarizeExplore(run);
    expect(v.code).toBe('EXPLORE_PASSED');
    expect(exploreUserSummary(v).steps).toEqual([
      'Typed into the search box — the list changed to match.',
      'Changed the sort or filter menu — the list changed with it.',
    ]);
  });

  it('describes a mixed run honestly', () => {
    const p = (kind?: PressResult['kind']): PressResult => ({ label: 'x', tag: 'button', verdict: 'ok', note: '', errors: [], changed: true, ...(kind ? { kind } : {}) });
    expect(describeTries([p(), p(), p('type')])).toBe('Pressed 2 control(s) and tried 1 search or sort control(s)');
    expect(describeTries([p(), p()])).toBe('Pressed 2 control(s)');
  });

  it('the repair takes it on, and is told to wire the box — never to remove it', () => {
    const run = parseExploreOutput([summary,
      line({ type: 'press', kind: 'type', label: 'Search countries', tag: 'input', verdict: 'unresponsive', note: 'typing "Japan" into it changed nothing on the screen', errors: [], changed: false }),
    ].join('\n'));
    const targets = repairTargets(run);
    expect(targets).toHaveLength(1);
    const [finding] = explorerRepairFindings(targets);
    expect(finding).toMatch(/typing into "Search countries" changes nothing on the screen/);
    expect(finding).toMatch(/really filters that list/);
    expect(finding).toMatch(/Do not remove, hide or disable the control/);
  });

  it('🔒 the repair reads the explorer\'s own failing set, never a copy', () => {
    const src = readFileSync('src/server/AgentV3/explorerRepair.ts', 'utf8');
    expect(src).toMatch(/const FAILING: ReadonlySet<PressVerdict> = FAILING_VERDICTS;/);
    expect(src).not.toMatch(/new Set<PressVerdict>\(\['crashed'/);
  });
});

describe('the runner', () => {
  it('is valid JavaScript and carries the search/sort rules as data', () => {
    const dir = makeTempDir('nbai-narrow-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({ base: 'http://x/', marker: EXPLORE_RESULT_MARKER }));
    execFileSync(process.execPath, ['--check', file]);
    const script = clickExplorerScript('http://x/', { blockWrites: false });
    expect(script).toContain(JSON.stringify(SEARCH_CONTROL.source).slice(1, -1));
    expect(script).toContain('"maxNarrow":3');
  });
  it('tries them after the first-screen presses and before any inner screen', () => {
    const mod = clickExplorerModule({ base: 'http://x/' });
    const narrow = mod.indexOf('for (const target of (plan.narrow || []))');
    expect(narrow).toBeGreaterThan(mod.indexOf('for (const target of plan.chosen)'));
    expect(narrow).toBeLessThan(mod.indexOf('for (const target of second.slice(0, cfg.maxSecond))'));
  });
});

// A REAL BROWSER, where one exists (see theAppIsPressedNotOnlyPainted.test.ts). CI has none.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

const table = `<table><tbody id="rows"></tbody></table>`;
const data = `const all = [['India','New Delhi'],['Japan','Tokyo'],['France','Paris'],['Kenya','Nairobi'],['Peru','Lima']];
function draw(list) { document.getElementById('rows').innerHTML = list.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join(''); }
draw(all);`;
const page = (controls: string, script: string) => `<!doctype html><html><body><div id="root"><h1>Countries</h1>${controls}${table}</div><script>${data}${script}</script></body></html>`;

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const pages: Record<string, string> = {
    // Works: a live search, and a sort that reverses.
    '/good': page(
      '<label>Search <input id="q" type="text" placeholder="Search countries"></label><label>Sort <select id="s"><option value="az">A-Z</option><option value="za">Z-A</option></select></label>',
      `document.getElementById('q').oninput = (e) => draw(all.filter((r) => r.join(' ').toLowerCase().includes(e.target.value.toLowerCase())));
       document.getElementById('s').onchange = (e) => draw(e.target.value === 'za' ? all.slice().reverse() : all);`),
    // Broken: both look real and do nothing.
    '/dead': page(
      '<input type="search" aria-label="Search countries"><select aria-label="Sort by"><option>A-Z</option><option>Z-A</option></select>', ''),
    // A search that waits for its button: not tried as broken.
    '/button': page('<div><input type="text" placeholder="Search"><button>Go</button></div>', ''),
    // Hindi labels, a working search.
    '/hindi': page('<label>खोजें <input id="q" type="text"></label>',
      `document.getElementById('q').oninput = (e) => draw(all.filter((r) => r.join(' ').includes(e.target.value)));`),
    // A settings menu is not a sort, and is never tried.
    '/settings': page('<label>Language <select><option>English</option><option>Hindi</option></select></label>', ''),
  };
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const body = pages[(q.url ?? '/').split('?')[0]];
      r.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      r.end(body ?? `Cannot GET ${q.url}`);
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function explore(path: string) {
    const dir = makeTempDir('nbai-narrow-real-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base: base + path, marker: EXPLORE_RESULT_MARKER, maxClicks: 12, maxSecond: 0, perParent: 0, budgetMs: 60_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
      maxNarrow: MAX_NARROWING_PROBES, searchSrc: SEARCH_CONTROL.source, searchFlags: SEARCH_CONTROL.flags, sortSrc: SORT_CONTROL.source, sortFlags: SORT_CONTROL.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    return parseExploreOutput(stdout).presses.filter((p) => p.kind === 'type' || p.kind === 'pick').map((p) => `${p.kind}:${p.verdict}`);
  }

  it('a working search and sort pass', async () => {
    expect(await explore('/good')).toEqual(['type:ok', 'pick:ok']);
  }, 120_000);
  it('a search and a sort that do nothing are reported unresponsive', async () => {
    expect(await explore('/dead')).toEqual(['type:unresponsive', 'pick:unresponsive']);
  }, 120_000);
  it('a search that waits for its button is not called broken', async () => {
    expect(await explore('/button')).toEqual(['type:skipped']);
  }, 120_000);
  it('a Hindi-labelled search is found and passes', async () => {
    expect(await explore('/hindi')).toEqual(['type:ok']);
  }, 120_000);
  it('a settings menu is never tried', async () => {
    expect(await explore('/settings')).toEqual([]);
  }, 120_000);
});
