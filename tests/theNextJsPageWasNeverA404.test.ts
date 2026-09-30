// Autopsy b47c56d8 (2026-09-30) — "make app ui theme like this", Weak, Next.js, 19.9 min, RED, ₹0.
//
// Every healthy Next.js page read as a 404 to our own preview judge, because the not-found boundary we
// SEED (`app/not-found.tsx`: "404 — Page not found") rides inside the inline flight payload of every
// page. Fixing that alone would have turned a false RED into a false GREEN: what actually rendered was
// our own starter ("Hello from Next.js!"), which the starter check did not know — the fast lane had
// planned against an empty listing (the scaffold arrived on its first write) and built a header and a
// footer that nothing mounted. Both halves ship together, locked here, with the siblings that report
// carried: a CLI dependency called "unused", Next's own error.tsx called "no error boundary", an E2E
// suite pointed at Vite's port, and a one-token TS1361 that cost 763 s of model repair.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePreviewHtml } from '../src/server/AgentV3/PreviewVerify';
import {
  STARTER_ENTRY_PATHS, isUntouchedStarterEntry, starterIsWhatRendered, pageShowsStarter,
  starterPreviewProblem, withStarterVerdict, entryIsStillTheStarter, starterLabelFor,
} from '../src/server/AgentV3/stillTheStarterApp';
import { NEXTJS_STARTER_PAGE } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/NextjsProvider';
import { ensureEntryPlanned, unwrittenEntries, manifestSystemPrompt, providedBoilerplate } from '../src/server/AgentV3/SimpleBuilder';
import { findUnusedDependencies } from '../src/server/AgentV3/ImportExportAnalysis';
import { isNextErrorBoundaryFile } from '../src/server/AgentV3/ErrorBoundaryAnalysis';
import { fixTypeOnlyValueImports, parseTscErrors, endgameDeterministicPass } from '../src/server/AgentV3/EndgameRepair';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// The shape the report's own curl returned: a visible starter page, and the not-found boundary's text
// inside the flight payload script.
const NEXT_STARTER_HTML = '<!DOCTYPE html><html lang="en"><head><title>My App</title>'
  + '<script src="/_next/static/chunks/app/not-found.js" async=""></script></head><body>'
  + '<main style="padding:2rem"><h1>Hello from Next.js!</h1><p>Edit <code>app/page.tsx</code> to get started.</p></main>'
  + '<script>self.__next_f.push([1,"c:[\\"$\\",\\"main\\",null,{\\"style\\":{\\"padding\\":\\"2rem\\"},\\"children\\":[[\\"$\\",\\"h2\\",null,{\\"children\\":\\"404 — Page not found\\"}],[\\"$\\",\\"p\\",null,{\\"children\\":\\"Could not find the requested page.\\"}]]}]\\n"])</script>'
  + '</body></html>';

const NEXT_BUILT_HTML = NEXT_STARTER_HTML.replace('<h1>Hello from Next.js!</h1><p>Edit <code>app/page.tsx</code> to get started.</p>', '<header>Obsidian Flow</header><h1>Dashboard</h1><p>Your notes</p>');

describe('the preview judge reads what a person sees, not the page scripts', () => {
  it('a healthy Next.js page is not a 404 because its not-found boundary rides in the flight payload', () => {
    const v = analyzePreviewHtml(NEXT_BUILT_HTML, { source: 'browser', painted: true });
    expect(v.problems.join(' ')).not.toMatch(/404/);
    expect(v.rendered).toBe(true);
  });

  it('a real 404 in visible text is still a 404 — Express and Next both', () => {
    expect(analyzePreviewHtml('<html><body><pre>Cannot GET /</pre></body></html>').problems.join(' ')).toMatch(/Cannot GET/);
    const next404 = '<html><body><div><h1 class="next-error-h1">404</h1><div><h2>This page could not be found.</h2></div></div></body></html>';
    expect(analyzePreviewHtml(next404, { source: 'browser', painted: true }).rendered).toBe(false);
  });

  it('the rule is applied to visible text (source guard)', () => {
    const src = read('src/server/AgentV3/PreviewVerify.ts');
    expect(src).toMatch(/const seen = visibleText\(h\);\s*\n\s*if \(\/cannot get \\\/\/i\.test\(seen\)/);
  });
});

describe('the Next.js starter is a starter', () => {
  it('the page we seed is recognised, from the template itself', () => {
    expect(STARTER_ENTRY_PATHS).toContain('app/page.tsx');
    expect(isUntouchedStarterEntry(NEXTJS_STARTER_PAGE)).toBe(true);
    expect(isUntouchedStarterEntry(NEXTJS_STARTER_PAGE.replace('Hello from Next.js!', 'Obsidian Flow'))).toBe(false);
    expect(starterLabelFor('app/page.tsx')).toBe('Hello from Next.js!');
  });

  it('once the false 404 is gone, the starter page is still NOT counted as the app', () => {
    const v = analyzePreviewHtml(NEXT_STARTER_HTML, { source: 'browser', painted: true });
    expect(v.rendered).toBe(true); // the page did paint — honestly
    expect(pageShowsStarter(NEXT_STARTER_HTML)).toBe(true);
    expect(starterIsWhatRendered('app/page.tsx', NEXT_STARTER_HTML)).toBe(true);
    const judged = withStarterVerdict(v, 'app/page.tsx');
    expect(judged.rendered).toBe(false);
    expect(judged.problems[0]).toContain('Hello from Next.js!');
    expect(starterPreviewProblem('app/page.tsx')).toContain('app/page.tsx');
  });

  it('each entry proves only its own template', () => {
    expect(starterIsWhatRendered('app/page.tsx', '<h1>Hello World</h1>')).toBe(false);
    expect(starterIsWhatRendered('src/App.tsx', NEXT_STARTER_HTML)).toBe(false);
    expect(starterIsWhatRendered('src/App.tsx', '<h1>Hello World</h1>')).toBe(true);
  });

  it('the readiness gate and the render proofs ask the same question of a Next.js project', async () => {
    const project = (files: Record<string, string>) => async (p: string) => {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    };
    expect(await entryIsStillTheStarter(project({ 'app/page.tsx': NEXTJS_STARTER_PAGE, 'public/index.html': '<div id="root"></div>' }))).toBe(true);
    expect(await entryIsStillTheStarter(project({ 'app/page.tsx': 'export default function Home() { return <Dashboard />; }' }))).toBe(false);
  });
});

describe('the fast lane plans against the scaffold that is really there', () => {
  it('a Next.js starter is replaced by its page, never by a src/main.tsx nothing runs', () => {
    const plan = [{ path: 'src/main.tsx', purpose: 'entry' }, { path: 'src/Header.tsx', purpose: 'header' }];
    const r = ensureEntryPlanned(plan, 'app/page.tsx');
    expect(r.injected).toBe('app/page.tsx');
    expect(ensureEntryPlanned([...plan, { path: 'app/page.tsx', purpose: 'home' }], 'app/page.tsx').injected).toBeNull();
    // Vite is unchanged: main.tsx is a real root there.
    expect(ensureEntryPlanned(plan, 'src/App.tsx').injected).toBeNull();
    expect(unwrittenEntries([{ path: 'app/page.tsx', purpose: 'home' }], ['src/Header.tsx'])).toEqual(['app/page.tsx']);
  });

  it('the planner is told where a Next.js app\'s entry lives, and is never promised a Vite file', () => {
    const next = manifestSystemPrompt('nextjs', ['app/page.tsx', 'app/layout.tsx', 'package.json']);
    expect(next).toContain('app/page.tsx');
    expect(next).toContain('NO src/main.tsx');
    expect(next).not.toContain('src/ErrorBoundary.tsx');
    expect(manifestSystemPrompt('vite-react')).toContain('e.g. src/App.tsx, index.html');
    expect(providedBoilerplate(['src/App.tsx'])).toEqual([]);
    expect(providedBoilerplate(['src/ErrorBoundary.tsx'])).toEqual(['src/ErrorBoundary.tsx']);
    expect(providedBoilerplate([])).toEqual(['src/ErrorBoundary.tsx']);
  });

  it('the scaffold is ensured BEFORE the lane lists it (source guard)', () => {
    const route = read('src/server/routes/agentv3.ts');
    const i = route.indexOf('await dispatcher.ensureFrameworkScaffold()');
    const j = route.indexOf('const scaffold = (await actuator.listFiles(workspaceId).catch(() => [] as string[]))');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(j - i).toBeLessThan(1500);
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toMatch(/ensureFrameworkScaffold\(\): Promise<void> \{\s*return this\.ensureScaffoldOnce\(\);/);
  });
});

describe('siblings the same report carried', () => {
  it('a dependency the project\'s own scripts run is used', () => {
    const pkg = JSON.stringify({ scripts: { dev: 'next dev --port 3000', start: 'NODE_ENV=production npx serve out' }, dependencies: { next: '14', serve: '^14', lodash: '^4' } });
    const unused = findUnusedDependencies({ 'package.json': pkg, 'src/Header.tsx': "import React from 'react';" }).map((u) => u.name);
    expect(unused).not.toContain('next');
    expect(unused).not.toContain('serve');
    expect(unused).toContain('lodash'); // neither imported nor run — still reported
  });

  it("Next.js's error.tsx is an error boundary", () => {
    const err = "'use client';\nexport default function Error({ reset }: { reset: () => void }) { return <button onClick={reset}>Try again</button>; }";
    expect(isNextErrorBoundaryFile('app/error.tsx', err)).toBe(true);
    expect(isNextErrorBoundaryFile('app/dashboard/error.tsx', err)).toBe(true);
    expect(isNextErrorBoundaryFile('app/global-error.tsx', err)).toBe(true);
    expect(isNextErrorBoundaryFile('app/error.tsx', err.replace("'use client';\n", ''))).toBe(false);
    expect(isNextErrorBoundaryFile('src/error.tsx', err)).toBe(false);
  });

  it('the E2E suite is pointed at the port the app declares (source guard)', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain("planE2eScaffold({ appName: workspaceId, devCommand: 'npm run dev', port: declaredPortFrom(e2eFiles)?.port ?? null })");
  });
});

describe('TS1361 is a string edit, not a repair pass', () => {
  const errs = parseTscErrors("src/ThemeToggle.tsx(4,27): error TS1361: 'ThemeMode' cannot be used as a value because it was imported using 'import type'.");

  it('the report\'s exact error: the value moves out of the type import', () => {
    const r = fixTypeOnlyValueImports({ 'src/ThemeToggle.tsx': 'import type { ThemeToggleProps, ThemeMode } from "./types";\nconst a = ThemeMode.Dark;\n' }, errs);
    expect(r.files['src/ThemeToggle.tsx']).toBe('import type { ThemeToggleProps } from "./types";\nimport { ThemeMode } from "./types";\nconst a = ThemeMode.Dark;\n');
    expect(r.fixed).toHaveLength(1);
  });

  it('a lone type import becomes a value import; an inline `type` modifier is dropped', () => {
    const e = [{ ...errs[0], file: 'a.tsx' }];
    expect(fixTypeOnlyValueImports({ 'a.tsx': "import type { ThemeMode } from './t';\n" }, e).files['a.tsx']).toBe("import { ThemeMode } from './t';\n");
    expect(fixTypeOnlyValueImports({ 'a.tsx': "import { type ThemeMode, X } from './t';\n" }, e).files['a.tsx']).toBe("import { ThemeMode, X } from './t';\n");
  });

  it('anything it cannot match with certainty is left alone', () => {
    const e = [{ ...errs[0], file: 'a.tsx' }];
    const twice = "import type { ThemeMode } from './t';\nimport type { Other as ThemeMode } from './u';\n";
    expect(fixTypeOnlyValueImports({ 'a.tsx': twice }, e).fixed).toEqual([]);
    expect(fixTypeOnlyValueImports({ 'a.tsx': "import { ThemeMode } from './t';\n" }, e).fixed).toEqual([]);
    // An aliased import binds only its LOCAL name, so `ThemeMode as M` is not the binding tsc named.
    expect(fixTypeOnlyValueImports({ 'a.tsx': "import type { ThemeMode as M } from './t';\n" }, e).fixed).toEqual([]);
  });

  it('the shared deterministic pass applies it before any model is called', async () => {
    const r = await endgameDeterministicPass({ 'src/ThemeToggle.tsx': 'import type { ThemeToggleProps, ThemeMode } from "./types";\nexport const a = ThemeMode.Dark;\n' }, errs);
    expect(r.changedPaths).toContain('src/ThemeToggle.tsx');
    expect(r.fixes.join(' ')).toContain("'ThemeMode' as a value");
  });
});
