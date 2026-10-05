// Autopsy 8257ca59 (2026-10-01): a calculator from our own template, a polish step that replaced the
// working light/dark switch with one that styled nothing, and the checks around it that could not tell.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { rootThemeHooks, deadThemeSwitchNote } from '../src/server/AgentV3/deadThemeSwitch';
import {
  THEME_CONTROL, MAX_THEME_PRESSES, clickExplorerModule, parseExploreOutput, exploreUserSummary, summarizeExplore,
  EXPLORE_RESULT_MARKER, MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  type ExploreRun,
} from '../src/server/AgentV3/clickExplorer';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { dataEntryEvidence, appHasNoDataEntry } from '../src/server/AgentV3/journeyDerivation';
import { reviewChangedPaths } from '../src/server/AgentV3/ReviewerAgent';
import { droppedRelativeImports, importStem, droppedImportOrphanLabel } from '../src/server/AgentV3/buildAuthorship';
import {
  writeTypecheckWarmupCommand, WARMUP_COMPILED_MARKER, writeTypecheckSummary, emptyWriteTypecheckStats,
} from '../src/server/AgentV3/writeTimeTypecheck';
import { themeTsx } from '../src/server/AgentV3/goldenScaffolds/base';

const read = (p: string) => readFileSync(p, 'utf8');

// The report's own shapes: the template's stylesheet styles `data-theme`, its switch lives in src/theme.tsx.
const indexCss = ":root { --bg: #fff; }\n@media (prefers-color-scheme: dark) { :root { --bg: #000; } }\n";
const handRolled = "export default function App() {\n  return <button onClick={() => document.documentElement.classList.toggle('dark')}>🌓</button>;\n}\n";

describe('1 · a theme switch that sets something nothing styles is named while the file is open', () => {
  it('the report\'s 🌓 button: class "dark" on <html>, no .dark rule — the note points at the working ThemeToggle', () => {
    expect(rootThemeHooks(handRolled)).toEqual([{ kind: 'class', name: 'dark' }]);
    const note = deadThemeSwitchNote('src/App.tsx', handRolled, { 'src/App.tsx': handRolled, 'src/index.css': indexCss, 'src/theme.tsx': themeTsx });
    expect(note).toContain('src/App.tsx switches the class "dark"');
    expect(note).toContain('ThemeToggle in src/theme.tsx');
  });

  it('stands down when anything styles it: a .dark rule, Tailwind dark: classes, a darkMode setting, a [data-theme] rule', () => {
    expect(deadThemeSwitchNote('src/App.tsx', handRolled, { 'src/App.tsx': handRolled, 'src/index.css': '.dark { --bg: #000; }' })).toBe('');
    expect(deadThemeSwitchNote('src/App.tsx', handRolled, { 'src/App.tsx': handRolled, 'src/Card.tsx': '<div className="bg-white dark:bg-black" />' })).toBe('');
    expect(deadThemeSwitchNote('src/App.tsx', handRolled, { 'src/App.tsx': handRolled, 'tailwind.config.js': "export default { darkMode: 'class' }" })).toBe('');
    const viaData = "document.documentElement.dataset.theme = 'dark';";
    expect(rootThemeHooks(viaData)).toEqual([{ kind: 'attribute', name: 'data-theme' }]);
    expect(deadThemeSwitchNote('src/App.tsx', viaData, { 'src/App.tsx': viaData, 'src/theme.tsx': themeTsx })).toBe('');
  });

  it('judges only what it can read: a computed name, or a project it could not read, says nothing', () => {
    expect(rootThemeHooks("document.documentElement.classList.toggle(theme)")).toEqual([]);
    expect(deadThemeSwitchNote('src/App.tsx', handRolled, null)).toBe('');
  });

  it('follows an alias of <html>, and a data attribute with no rule is dead too', () => {
    const alias = "const root = document.documentElement;\nroot.classList.add('night');\nroot.setAttribute('data-mode', 'dark');";
    expect(rootThemeHooks(alias)).toEqual([{ kind: 'class', name: 'night' }, { kind: 'attribute', name: 'data-mode' }]);
    expect(deadThemeSwitchNote('src/x.ts', alias, { 'src/x.ts': alias, 'src/index.css': indexCss })).toContain('[data-mode]');
  });

  it('is one of the write-time notes every write door asks', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(src).toMatch(/const theme = await this\.deadThemeSwitchNotes\(files\);/);
    // The invariant is that `theme` is a TERM of the one shared return, not the exact list of its
    // siblings: pinning the whole expression made every later note (autopsy 39e982bd added
    // `entryFirst`) fail a test about the theme switch. The guard still bites if the term is dropped.
    const ret = src.slice(src.indexOf('private async writeSteeringNotes(')).match(/\n    return hooks \+[^;]*;/)?.[0] ?? '';
    expect(ret).toMatch(/\+ theme\b/);
  });
});

describe('2 · the explorer presses a light/dark switch until the colours change', () => {
  it('names a theme switch by its text, aria-label or icon — never a bare "Light" or "Day"', () => {
    for (const yes of ['🌓', 'Toggle light/dark theme', 'Dark mode', 'Theme', '🌙 Dark', 'थीम']) expect(THEME_CONTROL.test(yes)).toBe(true);
    for (const no of ['Light', 'Day', 'Highlight', 'Today']) expect(THEME_CONTROL.test(no)).toBe(false);
    expect(MAX_THEME_PRESSES).toBe(3);
  });

  it('a dead switch is a failure the user is told about in plain words', () => {
    const run: ExploreRun = {
      summary: { loaded: true, note: '', found: 2, chosen: 2, skipped: [] }, outOfTime: false, diagnostic: null,
      presses: [
        { label: '7', tag: 'button', verdict: 'ok', note: 'it responded', errors: [], changed: true },
        { label: '🌓', tag: 'button', verdict: 'unresponsive', note: 'pressing it 3 times never changed the app\'s colours', errors: [], changed: false },
      ],
    };
    const v = summarizeExplore(run);
    expect(v.code).toBe('EXPLORE_FAILED');
    expect(exploreUserSummary(v).steps[0]).toBe('Pressing "🌓" never changed the app\'s colours — the light/dark switch does not switch the theme.');
  });

  it('the template\'s own switch says what it is, so a builder has no reason to replace it', () => {
    expect(themeTsx).toContain("'🌓 Auto'");
    expect(THEME_CONTROL.test('Toggle light/dark theme')).toBe(true);
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("KEEP the template's own working controls — above all its light/dark switch (ThemeToggle in src/theme.tsx");
  });
});

// A REAL BROWSER, where one exists (the same harness as theAppIsPressedNotOnlyPainted.test.ts).
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('2b · in a real browser', () => {
  let server: http.Server;
  let base = '';
  // Kit-like hover and focus styles on every button, so a hover is never read as the theme changing.
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title><style>
:root { --bg: #ffffff; --fg: #111111; }
[data-theme='dark'] { --bg: #000000; --fg: #eeeeee; }
body { background: var(--bg); color: var(--fg); }
button { background: #eeeeee; } button:hover { background: #cccccc; } button:focus { outline: 3px solid red; background: #bbbbbb; }
</style></head><body><div id="root">
<h1>Calc</h1><p id="d">0</p>
<button onclick="document.documentElement.classList.toggle('dark')">🌓</button>
<button id="t" aria-label="Toggle light/dark theme" onclick="cycle()">Auto</button>
<button onclick="document.getElementById('d').textContent='lamp on'">Light</button>
</div><script>
var modes = ['auto', 'light', 'dark'], i = 0;
function cycle() { i = (i + 1) % 3; var m = modes[i]; if (m === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m); document.getElementById('t').textContent = m; }
</script></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('the dead 🌓 is unresponsive; the cycling switch passes on its second press; the lamp is just a button', async () => {
    const dir = makeTempDir('nbai-theme-real-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base, marker: EXPLORE_RESULT_MARKER, maxClicks: 12, maxSecond: MAX_SECOND_LEVEL_CLICKS, perParent: MAX_SECOND_LEVEL_PER_PARENT, budgetMs: 60_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
      themeSrc: THEME_CONTROL.source, themeFlags: THEME_CONTROL.flags, maxThemePresses: MAX_THEME_PRESSES,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const run = parseExploreOutput(stdout);
    const by = Object.fromEntries(run.presses.map((p) => [p.label, p]));
    expect(by['🌓'].verdict).toBe('unresponsive');
    expect(by.Auto.verdict).toBe('ok');
    expect(by.Auto.note).toContain('colours on press 2');
    expect(by.Light.verdict).toBe('ok');
  }, 120_000);
});

describe('3 · the release gate reads the explorer', () => {
  const base: RuntimeEvidence = { buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'none-derivable', typecheck: 'passed', tests: 'not-run' };
  const clean = { blockers: 0, highSeverity: 0, warnings: 0 };

  it('an app with nothing to save whose controls were pressed and held up is GREEN', () => {
    const v = releaseGate({ ...base, explore: 'passed', explorePresses: 12 }, clean);
    expect(v.state).toBe('green');
    expect(v.headline).toContain('pressing its controls in a real browser held up');
    expect(v.proven).toContain('pressing 12 of its controls in a real browser broke nothing');
  });

  it('the report\'s case — no journey derived, controls pressed — never says "SAVES anything" and never claims nothing was verified', () => {
    const v = releaseGate({ ...base, journeys: 'not-run', explore: 'passed', explorePresses: 12 }, clean);
    expect(v.state).toBe('yellow');
    expect(v.headline).not.toContain('SAVES anything');
    expect(v.headline).toContain('pressing its controls in a real browser broke nothing');
  });

  it('without the explorer, every sentence and verdict is as before', () => {
    expect(releaseGate({ ...base, journeys: 'not-run' }, clean).headline).toContain('whether it actually SAVES anything is untested');
    expect(releaseGate(base, clean).state).toBe('yellow');
    expect(releaseGate({ ...base, explore: 'failed', explorePresses: 3 }, clean).state).toBe('yellow');
  });

  it('the route hands the explorer\'s verdict to the gate, and a kept repair updates it', () => {
    const src = read('src/server/routes/agentv3.ts');
    expect(src).toContain('gateEvidence.explore = explored.outcome;');
    expect(src).toMatch(/resolveOnRecheck\('EXPLORE_FAILED'\)[^\n]*\n\s*gateEvidence\.explore = 'passed';/);
  });
});

describe('4 · a "data app" verdict names the file and line that made it one', () => {
  it('names the first data-entry sign, or nothing', () => {
    const files = { 'src/App.tsx': 'export default () => <button>7</button>;', 'src/Search.tsx': 'const x = 1;\n  <input value={q} onChange={(e) => setQ(e.target.value)} />\n' };
    expect(appHasNoDataEntry(files)).toBe(false);
    expect(dataEntryEvidence(files)).toEqual({ path: 'src/Search.tsx', what: 'a form element', line: '<input value={q} onChange={(e) => setQ(e.target.value)} />' });
    expect(dataEntryEvidence({ 'src/App.tsx': 'export default () => <button>7</button>;' })).toBeNull();
    expect(read('src/server/routes/agentv3.ts')).toContain('Read as taking input because of ${why.what} in ${why.path}');
  });
});

describe('5 · the review looks at what the builder changed, not at the template we seeded', () => {
  it('an untouched seed file is not "changed this turn"; a rewritten one is', () => {
    const written = new Map([['src/App.tsx', 'edited'], ['src/index.css', 'KIT'], ['src/theme.tsx', 'SEED-REWRITTEN'], ['public/sw.js', 'sw']]);
    const seeded = new Map([['src/App.tsx', 'seed'], ['src/index.css', 'KIT'], ['src/theme.tsx', 'SEED']]);
    expect(reviewChangedPaths(written, new Set(['public/sw.js']), seeded)).toEqual(['src/App.tsx', 'src/theme.tsx']);
    expect(read('src/server/routes/agentv3.ts')).toContain('const reviewChanged = reviewChangedPaths(writtenFiles, finishingPaths, preseededGolden);');
  });
});

describe('6 · an orphan this build made is this build\'s, not "your existing code"', () => {
  it('a rewrite that stops importing ./theme drops src/theme', () => {
    const before = "import { useState } from 'react';\nimport ThemeToggle from './theme';\nimport './index.css';\n";
    const after = "import { useState } from 'react';\nimport './index.css';\n";
    expect(droppedRelativeImports('src/App.tsx', before, after)).toEqual(['src/theme']);
    expect(importStem('src/theme.tsx')).toBe('src/theme');
    expect(importStem('src/components/Nav/index.tsx')).toBe('src/components/Nav');
    expect(droppedRelativeImports('src/App.tsx', '', after)).toEqual([]);
    expect(droppedImportOrphanLabel(['src/theme.tsx (ThemeToggle)'])).toContain('this build removed the only import of src/theme.tsx (ThemeToggle)');
  });

  it('both write doors record what they stopped importing, and the readiness split reads it', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(src).toContain("if (kind === 'modify') this.noteDroppedImports(path, existingContent, content);");
    expect(src).toContain('this.noteDroppedImports(path, existing, updated);');
    expect(src).toContain('this._droppedImportStems.has(importStem(o.file))');
  });
});

describe('7 · a warm-up that compiled nothing does not claim a warm cache', () => {
  it('prints its marker only inside the branch that compiles', () => {
    expect(writeTypecheckWarmupCommand()).toMatch(new RegExp(`>/dev/null 2>&1; echo ${WARMUP_COMPILED_MARKER}; fi; true$`));
  });

  it('a skipped warm-up is said as such', () => {
    const skipped = { ...emptyWriteTypecheckStats(), warmupStarted: true, warmupSkipped: true, runs: 3, cleanRuns: 3, elapsedMs: 18_000 };
    const line = writeTypecheckSummary(skipped, true, 5);
    expect(line).not.toContain('warmed at build start');
    expect(line).toContain('found no compiler installed yet');
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('if (String(r?.stdout ?? \'\').includes(WARMUP_COMPILED_MARKER)) s.warmupMs = Date.now() - startedAt;');
  });
});

import { pruneGeneratedListing, isPrunableListing } from '../src/server/AgentV3/generatedListing';
import { makeTempDir } from './helpers/tempDir';

describe('8 · a shell file listing leaves out node_modules and dist, as glob does', () => {
  const findCmd = "find . -maxdepth 3 -type f \\( -name '*.tsx' -o -name '*.js' \\) | head -100";
  const out = ['./dist/assets/index-Br06EGwa.css', './dist/index.html', './index.html', './src/App.tsx',
    './node_modules/browserslist/browser.js', './node_modules/browserslist/cli.js', './node_modules/csstype/index.d.ts',
    './node_modules/detect-libc/index.d.ts', './e2e/smoke.spec.ts'].join('\n');

  it('the report\'s find: the app\'s own files stay, the generated ones go, and the model is told', () => {
    const r = pruneGeneratedListing(findCmd, out);
    expect(r.pruned).toBe(6);
    expect(r.stdout).toContain('./src/App.tsx');
    expect(r.stdout).toContain('./e2e/smoke.spec.ts');
    expect(r.stdout).not.toContain('node_modules/browserslist');
    expect(r.stdout).toContain('6 line(s) inside node_modules, dist');
  });

  it('a command that names the folder, a non-listing command, or a short listing is left exactly as it was', () => {
    expect(isPrunableListing('find node_modules/react -name "*.json"')).toBe(false);
    expect(pruneGeneratedListing('cat package-lock.json', out).stdout).toBe(out);
    expect(pruneGeneratedListing(findCmd, './src/App.tsx\n./dist/index.html').pruned).toBe(0);
    expect(isPrunableListing('ls -R src')).toBe(true);
    expect(isPrunableListing('ls src')).toBe(false);
  });

  it('the bash tool hands back the pruned listing', () => {
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('`exit=${exitCode}\\n${redactSecrets(listing.stdout)}`');
  });
});
