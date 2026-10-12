// HEAL CENSUS OF AUTOPSY 303e8a6f (2026-10-12) — HTML_ENTRY_REPAIRED is a real repair when it fires correctly, and the
// census kept it a heal. But its detector fired on pages that ALREADY booted, so some of those heals were false —
// and one shape was a harmful write: a second module script beside an entry the page already loaded, which can
// mount the app twice. Five shapes, plus the route picking a `dist/` or `public/` copy that sorts first in the
// durable store's key order.
//
// The CLASS: a "does it boot?" detector that recognised one spelling of a booting page (an `id="root"`, a script
// named main|index). It now reads what the entry module actually mounts into and any local module script, and both
// lanes ask one function which page is the app's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureHtmlEntryScript, appEntryHtmlKey } from '../src/server/AgentV3/HtmlEntryGuard';

const REACT_MAIN = "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(null);\n";
const VUE_MAIN = "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n";
const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('a page that already boots is left alone', () => {
  it.each([
    ['Vue mounts into #app', { 'index.html': page('<div id="app"></div><script type="module" src="/src/main.ts"></script>'), 'src/main.ts': VUE_MAIN }],
    ['an unquoted id', { 'index.html': page('<div id=root></div><script type="module" src="/src/main.tsx"></script>'), 'src/main.tsx': REACT_MAIN }],
    ['the entry script is not named main|index', { 'index.html': page('<div id="root"></div><script type="module" src="/src/app.tsx"></script>'), 'src/main.tsx': REACT_MAIN }],
    ['an inline module script imports the entry', { 'index.html': page('<div id="root"></div><script type="module">import "/src/main.tsx";</script>'), 'src/main.tsx': REACT_MAIN }],
    ['a CRA page the bundler fills in (no root index.html)', { 'public/index.html': page('<div id="root"></div>'), 'src/index.js': REACT_MAIN }],
  ])('%s', (_n, files) => {
    expect(ensureHtmlEntryScript(files as Record<string, string>).injected).toBe(false);
  });
});

describe('a page that cannot boot is still repaired — with the id the entry really uses', () => {
  it('no script and no mount: both are added (the original 2026-07-13 case)', () => {
    const out = ensureHtmlEntryScript({ 'index.html': page(''), 'src/main.tsx': REACT_MAIN });
    expect(out.injected).toBe(true);
    expect(out.files['index.html']).toContain('<div id="root"></div>');
    expect(out.files['index.html']).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it('a Vue page missing its mount gets #app, not #root', () => {
    const out = ensureHtmlEntryScript({ 'index.html': page('<script type="module" src="/src/main.ts"></script>'), 'src/main.ts': VUE_MAIN });
    expect(out.files['index.html']).toContain('<div id="app"></div>');
    expect(out.files['index.html']).not.toContain('id="root"');
  });

  it('a remote script is not the app\'s entry', () => {
    const out = ensureHtmlEntryScript({ 'index.html': page('<div id="root"></div><script type="module" src="https://cdn.example.com/x.js"></script>'), 'src/main.tsx': REACT_MAIN });
    expect(out.injected).toBe(true);
  });
});

describe('🔒 one answer for which page is the app\'s, on both lanes', () => {
  it('the root page — never a dist/ or public/ copy that sorts first', () => {
    expect(appEntryHtmlKey({ 'dist/index.html': '', 'index.html': '' })).toBe('index.html');
    expect(appEntryHtmlKey({ 'public/index.html': '' })).toBeNull();
    const out = ensureHtmlEntryScript({ 'dist/index.html': page(''), 'index.html': page('<div id="root"></div><script type="module" src="/src/main.tsx"></script>'), 'src/main.tsx': REACT_MAIN });
    expect(out.injected).toBe(false);
  });

  it('the route asks the guard which page it is', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const htmlKey = appEntryHtmlKey(full);');
    expect(route).not.toMatch(/const htmlKey = Object\.keys\(full\)\.find\(\(k\) => \/\(\^\|\\\/\)index\\\.html\$\/i/);
  });
});

// Same census, the REPAIR_OUT_OF_SCOPE row: the scope read only the IMPORTER named before `(l,c)`, so a repair that
// correctly created the missing module was dropped as "out of scope" — a real fix blocked, and counted as a heal.
import { pathsNamedInErrors, limitRepairToScope, missingModuleTargets } from '../src/server/AgentV3/SimpleBuilder';

describe('a missing module the error names is in the repair\'s scope', () => {
  const tsc = "src/App.tsx(3,25): error TS2307: Cannot find module './hooks/useAuth' or its corresponding type declarations.";
  it('the target is resolved against the importing file', () => {
    expect(missingModuleTargets(tsc)).toContain('src/hooks/useAuth.ts');
    expect(missingModuleTargets("src/pages/Home.tsx:4:10 - error TS2307: Cannot find module '../lib/api'")).toContain('src/lib/api.ts');
    expect(missingModuleTargets('Failed to resolve import "./styles/app.css" from "src/main.tsx". Does the file exist?')).toEqual(['src/styles/app.css']);
    expect(missingModuleTargets("src/App.tsx(1,1): error TS2307: Cannot find module 'react-router-dom'")).toEqual([]); // a package is not a file
  });

  it('🔒 the repair that creates it is KEPT', () => {
    const r = limitRepairToScope([{ path: 'src/hooks/useAuth.ts' }, { path: 'src/login/Login.tsx' }], ['src/App.tsx', ...pathsNamedInErrors(tsc)]);
    expect(r.kept.map((f) => f.path)).toEqual(['src/hooks/useAuth.ts']);
    expect(r.dropped).toEqual(['src/login/Login.tsx']); // anything else is still out of scope
  });
});

// Same census, the DANGLING_STYLESHEET_IMPORT_REMOVED row: the guard removed an import on ANY read error — and the
// two "is the file absent?" predicates had drifted, only one knowing that a dead sandbox says "no such file" about
// the whole workspace. One predicate now, and only "absent" removes an import.
import { isNotFoundError } from '../src/server/AgentV3/fsErrors';
import { isMissingFileError } from '../src/server/AgentV3/writeTimeTypecheck';

describe('🔒 absent means the sandbox said absent — one predicate', () => {
  it.each([
    [Object.assign(new Error('x'), { code: 'ENOENT' }), true],
    [new Error('ENOENT: no such file or directory, open src/x.css'), true],
    [new Error('[not_found] file not found: src/x.css'), true],
    [new Error('[not_found] lstat /home/user/workspace: no such file or directory'), false], // a dead machine
    [new Error('sandbox timed out'), false],
    [new Error(''), false],
  ])('%s → %s', (err, absent) => {
    expect(isNotFoundError(err)).toBe(absent);
    expect(isMissingFileError(err)).toBe(absent); // the two can no longer drift
  });

  it('the stylesheet guard removes an import only on "absent"', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('.then(() => false, (e: unknown) => isNotFoundError(e));');
    expect(route).not.toContain("readFile(workspaceId, d.sheet).then(() => true, () => false)");
  });
});

// Same census, the Q-740 class it surfaced: the setup drain MERGES the template a fresh machine was seeded with into
// the durable store, and a merge overwrites each path. When the store held this workspace's files and none came
// back, the template would replace the user's package.json, index.html and configs.
import { mayPersistSeededScaffold } from '../src/server/AgentV3/sandboxRestore';

describe('🔒 a failed refill is never repaired by writing our template over the store', () => {
  const o = (durable: number, restored: number) => ({ durable, warm: 0, attempted: durable, restored, assets: 0, skipped: 0 });
  it.each([
    ['an empty store (a new workspace)', o(0, 0), true],
    ['a refill that landed', o(24, 24), true],
    ['no restore record (a warm or resumed machine)', null, true],
    ['the store held 24 files and none landed', o(24, 0), false],
  ])('%s', (_n, outcome, may) => expect(mayPersistSeededScaffold(outcome as never)).toBe(may));

  it('the route asks before it drains', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('&& mayPersistSeededScaffold(restoreOutcome)) {');
  });
});
