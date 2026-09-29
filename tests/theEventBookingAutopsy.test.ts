// AUTOPSY a7aa447c (2026-09-29): an event-booking app on the Weak tier, built on the second rung in 11
// minutes, green at the end. Four things in that report were the platform's own doing, and each cost the
// build steps it should never have spent — or told the builder something false.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { VueProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/VueProvider';
import { VanillaProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/VanillaProvider';
import { RemixProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/RemixProvider';
import { PreactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/PreactProvider';
import { SolidProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/SolidProvider';
import { LitProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/LitProvider';
import { missingViteEnvTypes } from '../src/server/AgentV3/viteEnvTypes';
import { withVitestDeclared, VITEST_RANGE } from '../src/server/AgentV3/TestGenerationAgent';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { renderSeenThisBuild } from '../src/server/AgentV3/renderProof';
import { computeBuildConfidence } from '../src/server/AgentV3/BuildConfidence';
import { rendersDataList, analyzeDesignCoverage } from '../src/server/AgentV3/DesignCoverage';

describe('1 · every Vite + TypeScript starter declares Vite\'s client types', () => {
  const providers = { ViteReactProvider, VueProvider, VanillaProvider, PreactProvider, SolidProvider, LitProvider };
  for (const [name, P] of Object.entries(providers)) {
    it(`${name}: a file that reads import.meta.env typechecks from the first write`, () => {
      const files = new P().getFiles([]);
      const withEnvRead = { ...files, 'src/pay.ts': 'export const key = import.meta.env.VITE_KEY;' };
      expect(missingViteEnvTypes(withEnvRead)).toBeNull();
    });
  }
  it('the reported template: the Razorpay file in that build hit TS2339 on import.meta.env', () => {
    expect(new ViteReactProvider().getFiles([])['src/vite-env.d.ts']).toBe('/// <reference types="vite/client" />\n');
  });
  it('Remix ships the env.d.ts its own tsconfig names', () => {
    const files = new RemixProvider().getFiles([]);
    expect(JSON.parse(files['tsconfig.json']).include).toContain('env.d.ts');
    expect(files['env.d.ts']).toMatch(/vite\/client/);
  });
});

describe('2 · a test the builder asks for can run', () => {
  const pkg = JSON.stringify({ name: 'x', devDependencies: { vite: '^8.3.0' } });
  it('vitest is added to devDependencies, keeping what was there', () => {
    const out = JSON.parse(withVitestDeclared(pkg)!);
    expect(out.devDependencies).toEqual({ vite: '^8.3.0', vitest: VITEST_RANGE });
  });
  it('nothing is written when it is already declared anywhere, or the file cannot be read', () => {
    expect(withVitestDeclared(JSON.stringify({ dependencies: { vitest: '^1' } }))).toBeNull();
    expect(withVitestDeclared(JSON.stringify({ devDependencies: { vitest: '^1' } }))).toBeNull();
    expect(withVitestDeclared('{ not json')).toBeNull();
    expect(withVitestDeclared(null)).toBeNull();
  });
  it('the pinned range is the one this repository actually runs, on a Vite major it supports', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(root.devDependencies.vitest).toBe(VITEST_RANGE);
  });
  it('generate_tests declares the runner before writing the test', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const at = src.indexOf("case 'generate_tests': {");
    const body = src.slice(at, src.indexOf("case 'generate_integration_tests'", at));
    expect(body.indexOf('withVitestDeclared(pkgBefore)')).toBeGreaterThan(0);
    expect(body.indexOf('withVitestDeclared(pkgBefore)')).toBeLessThan(body.indexOf('await this.actuator.writeFile(this.workspaceId, path, content);'));
  });
});

describe('3 · the tools can read the render proof', () => {
  it('a recorded render proof is readable per workspace; a new build clears it', () => {
    const d = new BuildDiagnostics({ workspaceId: 'ws-autopsy' });
    expect(renderSeenThisBuild('ws-autopsy')).toBe(false);
    d.record({ phase: 'preview', severity: 'info', code: 'IN_BUILD_GREEN', message: 'rendered', autoResolved: true });
    expect(renderSeenThisBuild('ws-autopsy')).toBe(true);
    new BuildDiagnostics({ workspaceId: 'ws-autopsy' });
    expect(renderSeenThisBuild('ws-autopsy')).toBe(false);
  });
  it('only an info-severity proof counts, and only for its own workspace', () => {
    const d = new BuildDiagnostics({ workspaceId: 'ws-a' });
    d.record({ phase: 'preview', severity: 'warning', code: 'APP_RENDERED', message: 'odd', autoResolved: false });
    expect(renderSeenThisBuild('ws-a')).toBe(false);
    d.record({ phase: 'preview', severity: 'info', code: 'APP_RENDERED', message: 'ok', autoResolved: true });
    expect(renderSeenThisBuild('ws-a')).toBe(true);
    expect(renderSeenThisBuild('ws-b')).toBe(false);
  });
  it('with the proof, the confidence no longer says "no preview"', () => {
    const base = {
      readinessScore: 92, ready: true,
      architecture: { unresolvedImports: 0, cycles: 0, layering: 0 },
      security: { high: 0, medium: 0, low: 0 }, authenticity: 0, dependencies: { missing: 0, unused: 0 },
      envVarsMissing: 0, accessibility: { high: 0, medium: 0, low: 0 }, compliance: { high: 0, medium: 0, low: 0 },
    };
    expect(computeBuildConfidence(base).negatives[0]).toMatch(/was ever proven to RUN/);
    const proven = computeBuildConfidence({ ...base, runtimeProven: 'passed' });
    expect(proven.negatives.join(' ')).not.toMatch(/was ever proven to RUN/);
    expect(proven.positives[0]).toMatch(/Proven to RUN/);
  });
  it('the evaluate tool passes it', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8'))
      .toMatch(/renderSeenThisBuild\(this\.workspaceId\) \? \{ runtimeProven: 'passed' as const \} : \{\}/);
  });
});

describe('4 · a list over the app\'s own imported catalogue needs no empty state', () => {
  const page = "import { packages } from '../data/packages';\nexport default function HomePage() { return <div className=\"a\"><h1 className=\"b\">x</h1>{packages.map((p) => <div key={p.id} className=\"c\">{p.name}</div>)}<p className=\"d\">a</p><p className=\"e\">b</p><p className=\"f\">c</p></div>; }";
  const data = 'export const packages: EventPackage[] = [\n  { id: "1", name: "Birthday" },\n];';
  it('the reported page: imported literal array ⇒ not a data list', () => {
    expect(rendersDataList(page, 'src/pages/HomePage.tsx', { 'src/data/packages.ts': data })).toBe(false);
    const report = analyzeDesignCoverage({ 'src/pages/HomePage.tsx': page, 'src/data/packages.ts': data });
    expect(report.findings.flatMap((f) => f.defects)).not.toContain('LIST_WITHOUT_EMPTY_STATE');
  });
  it('still a data list when the import is not a literal array, or cannot be found', () => {
    expect(rendersDataList(page, 'src/pages/HomePage.tsx', { 'src/data/packages.ts': 'export function packages() { return fetch("/x"); }' })).toBe(true);
    expect(rendersDataList(page, 'src/pages/HomePage.tsx', {})).toBe(true);
    const report = analyzeDesignCoverage({ 'src/pages/HomePage.tsx': page });
    expect(report.findings.flatMap((f) => f.defects)).toContain('LIST_WITHOUT_EMPTY_STATE');
  });
});
