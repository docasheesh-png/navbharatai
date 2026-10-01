// Q-008 (admin 2026-10-01, "han"): a measured share of NEW apps start with TypeScript's strict mode on.
//
// Four things are locked here:
//   1. EVERY starter we seed — the Vite-React template and every golden scaffold — typechecks with ZERO
//      errors, both with strict off (today's apps) and with strict on (the trial). Building this census
//      found two real defects: Panchang's "sunrise may be null" (strict only) and Arcade's `<Empty>`
//      called with props its component does not take (an error in BOTH modes, shipped since that
//      scaffold was written, because nothing ever typechecked our own templates).
//   2. The trial's rules: default 20% of new workspaces, chosen by workspace id; `off` and `0` stop it;
//      only `tsconfig.json` changes; nothing rewrites an existing app's tsconfig.
//   3. The content-based "is this our starter?" readers recognise the strict tsconfig as ours.
//   4. The measurement exists: a `STRICT_TRIAL` report line and a `byStrictCohort` telemetry fold.

import { describe, it, expect, afterAll } from 'vitest';
import ts from 'typescript';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import {
  applyStrictTrial, inStrictTrial, seededForms, strictCohort, strictTrialPercent, strictTsconfig,
  tsconfigIsStrict, STRICT_TRIAL_DEFAULT_PCT,
} from '../src/server/AgentV3/strictTrial';
import { isPlatformSeededFile, _resetPlatformSeededIndex } from '../src/server/AgentV3/platformAuthored';
import { starterFilesToComplete, isOurStarterFile } from '../src/server/AgentV3/starterFragment';
import { foldCostTelemetry, type CostTelemetryEntry } from '../src/server/AgentV3/AgentV3CostTelemetry';

const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tests', `.tmp-strict-trial-${process.pid}`);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// This repository installs @types/react but not @types/react-dom (the app's own package.json does), so
// the one react-dom entry the starters use is declared here — exactly its shape, nothing looser.
const REACT_DOM_SHIM = `declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export function createRoot(container: Element | DocumentFragment): { render(children: ReactNode): void; unmount(): void };
}
`;

/** Typecheck one starter's source the way the app's own tsconfig would. Returns the error lines. */
function typecheck(id: string, files: Record<string, string>, strict: boolean): string[] {
  const dir = join(TMP, `${id}-${strict ? 'strict' : 'loose'}`);
  rmSync(dir, { recursive: true, force: true });
  const names: string[] = [];
  for (const [p, c] of Object.entries(files)) {
    if (!p.startsWith('src/')) continue;
    const full = join(dir, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, c);
    if (/\.tsx?$/.test(p)) names.push(full);
  }
  const shim = join(dir, 'src', 'react-dom-client.d.ts');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(shim, REACT_DOM_SHIM);
  names.push(shim);
  const program = ts.createProgram(names, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
    resolveJsonModule: true,
    allowImportingTsExtensions: true,
    baseUrl: join(dir, 'src'),
    paths: { '@/*': ['*'] },
    strict,
  });
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && d.file.fileName.startsWith(dir))
    .map((d) => `${d.file!.fileName.slice(dir.length + 1)}:${d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

const STARTERS: [string, Record<string, string>][] = [
  ['vite-template', new ViteReactProvider().getFiles([])],
  ...GOLDEN_SCAFFOLDS.map((s) => [s.id, goldenScaffoldFiles(s)] as [string, Record<string, string>]),
];

describe('1 · every starter we seed typechecks, strict off AND strict on', () => {
  it('the census covers every golden scaffold (a new one cannot skip it)', () => {
    expect(STARTERS.length).toBe(GOLDEN_SCAFFOLDS.length + 1);
    expect(GOLDEN_SCAFFOLDS.length).toBeGreaterThan(30);
  });

  for (const [id, files] of STARTERS) {
    it(`${id}: zero errors with strict off and with strict on`, () => {
      expect(typecheck(id, files, false)).toEqual([]);
      expect(typecheck(id, files, true)).toEqual([]);
    }, 60_000);
  }

  it('canary: the census really sees an error (a typecheck that always returns [] would pass for ever)', () => {
    const broken = { 'src/App.tsx': 'export default function App(props: { a: string }) { return <p>{props.b}</p>; }\n' };
    expect(typecheck('canary', broken, false).join('\n')).toMatch(/TS2339/);
    const maybeNull = { 'src/x.ts': 'export function f(v: { s: number | null }) { const g = () => v.s + 1; return g(); }\n' };
    expect(typecheck('canary-null', maybeNull, false)).toEqual([]);
    expect(typecheck('canary-null', maybeNull, true).join('\n')).toMatch(/TS18047/);
  }, 60_000);
});

describe('2 · the trial: who starts strict, and what changes', () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

  it('defaults to 20% of new workspaces; off and 0 stop it; an unreadable value means 0, never 100', () => {
    expect(strictTrialPercent(env({}))).toBe(STRICT_TRIAL_DEFAULT_PCT);
    expect(STRICT_TRIAL_DEFAULT_PCT).toBe(20);
    expect(strictTrialPercent(env({ AGENTV3_STRICT_TRIAL: 'off' }))).toBe(0);
    expect(strictTrialPercent(env({ AGENTV3_STRICT_TRIAL_PCT: '0' }))).toBe(0);
    expect(strictTrialPercent(env({ AGENTV3_STRICT_TRIAL_PCT: '35%' }))).toBe(35);
    expect(strictTrialPercent(env({ AGENTV3_STRICT_TRIAL_PCT: '' }))).toBe(20);
    const err = console.error; console.error = () => {};
    try { expect(strictTrialPercent(env({ AGENTV3_STRICT_TRIAL_PCT: 'lots' }))).toBe(0); } finally { console.error = err; }
  });

  it('is decided by the workspace id: the same project is always in or always out, and ~20% are in', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `ws-${i}-${(i * 7919) % 104729}`);
    const inNow = ids.filter((id) => inStrictTrial(id, env({})));
    expect(ids.filter((id) => inStrictTrial(id, env({})))).toEqual(inNow);
    expect(inNow.length / ids.length).toBeGreaterThan(0.15);
    expect(inNow.length / ids.length).toBeLessThan(0.25);
    expect(inStrictTrial(undefined, env({}))).toBe(false);
    expect(inStrictTrial('anything', env({ AGENTV3_STRICT_TRIAL_PCT: '100' }))).toBe(true);
  });

  it('turns strict on in tsconfig.json only, deterministically, and leaves everything else byte-identical', () => {
    const files = new ViteReactProvider().getFiles([]);
    const out = applyStrictTrial(files, 'w', env({ AGENTV3_STRICT_TRIAL_PCT: '100' }));
    expect(tsconfigIsStrict(files['tsconfig.json'])).toBe(false);
    expect(tsconfigIsStrict(out['tsconfig.json'])).toBe(true);
    for (const p of Object.keys(files)) if (p !== 'tsconfig.json') expect(out[p]).toBe(files[p]);
    expect(strictTsconfig(files['tsconfig.json'])).toBe(out['tsconfig.json']);
    expect(strictTsconfig(out['tsconfig.json'])).toBe(out['tsconfig.json']); // idempotent
    // Every other compiler option survives.
    const before = JSON.parse(files['tsconfig.json']).compilerOptions;
    const after = JSON.parse(out['tsconfig.json']).compilerOptions;
    expect({ ...after, strict: undefined }).toEqual({ ...before, strict: undefined });
    // Out of the trial: the very same object comes back.
    expect(applyStrictTrial(files, 'w', env({ AGENTV3_STRICT_TRIAL: 'off' }))).toBe(files);
  });

  it('never touches a tsconfig it cannot read safely (comments, no compilerOptions)', () => {
    const withComments = '{\n  // ours\n  "compilerOptions": { "strict": false }\n}\n';
    expect(strictTsconfig(withComments)).toBe(withComments);
    expect(strictTsconfig('{ "extends": "./base.json" }')).toBe('{ "extends": "./base.json" }');
  });
});

describe('3 · the strict tsconfig is still recognised as OUR starter, not the user\'s code', () => {
  const loose = new ViteReactProvider().getFiles([])['tsconfig.json'];
  const strict = strictTsconfig(loose);

  it('platformAuthored, starterFragment and isOurStarterFile all know both forms', () => {
    _resetPlatformSeededIndex();
    expect(isPlatformSeededFile('tsconfig.json', loose)).toBe(true);
    expect(isPlatformSeededFile('tsconfig.json', strict)).toBe(true);
    expect(seededForms('tsconfig.json', loose)).toEqual([loose, strict]);
    expect(seededForms('src/App.tsx', 'x')).toEqual(['x']);

    // A trial workspace whose fragment holds the LOOSE tsconfig (seeded before the trial) is still a fragment.
    const template = applyStrictTrial(new ViteReactProvider().getFiles([]), 'w', { AGENTV3_STRICT_TRIAL_PCT: '100' } as unknown as NodeJS.ProcessEnv);
    const missing = starterFilesToComplete({ 'tsconfig.json': loose }, template);
    expect(missing).toContain('package.json');
    expect(missing).not.toContain('tsconfig.json');
    expect(isOurStarterFile('tsconfig.json', strict, [new ViteReactProvider().getFiles([])])).toBe(true);
    // An edited tsconfig is the user's, in either mode.
    expect(isPlatformSeededFile('tsconfig.json', strict.replace('"strict": true', '"strict": true, "noUnusedLocals": true'))).toBe(false);
  });
});

describe('4 · seeding paths apply the trial; the recovery path does not; the measurement is recorded', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('E2B setup, the golden pre-seed and the missing-entry self-heal seed through applyStrictTrial', () => {
    const actuator = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(actuator).toMatch(/return applyStrictTrial\(this\.templateRegistry\.getProvider\(key\)\.getFiles\(\[\]\), workspaceId\)/);
    expect(actuator).toMatch(/fallbackFiles = applyStrictTrial\(/);
    expect(actuator).not.toMatch(/_templateFilesFor\(projectType\)\)/);
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/const goldenFiles = applyStrictTrial\(goldenScaffoldFiles\(golden\), workspaceId\)/);
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toMatch(/applyStrictTrial\(provider\.getFiles\(\[\]\), this\.workspaceId\)/);
  });

  it('the foundation that fills in a MISSING tsconfig for an existing app stays loose (never breaks old code)', () => {
    expect(read('src/server/AgentV3/FrameworkFoundation.ts')).toMatch(/"strict": false/);
  });

  it('the prompt and the error help no longer state "strict is off" as a fact about every app', () => {
    const prompt = read('src/server/AgentV3/systemPrompt.ts');
    expect(prompt).not.toMatch(/THE SCAFFOLD COMPILES WITH/);
    expect(prompt).toMatch(/READ tsconfig\.json FOR `"strict"`/);
    expect(prompt).toMatch(/correct in BOTH modes/);
    expect(read('src/server/AgentV3/tscErrorCause.ts')).not.toMatch(/This project compiles with/);
  });

  it('every build records STRICT_TRIAL and the telemetry folds it by cohort', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/code: 'STRICT_TRIAL'/);
    expect(route).toMatch(/strictCohort: strictCohortLabel/);
    expect(strictCohort(strictTsconfig(new ViteReactProvider().getFiles([])['tsconfig.json']), true)).toBe('strict-new');
    expect(strictCohort(new ViteReactProvider().getFiles([])['tsconfig.json'], false)).toBe('loose-existing');
    expect(strictCohort('// not json', true)).toBe('unknown');

    const base: CostTelemetryEntry = {
      taskType: 'simple_app', startTier: 'weak', billedUsd: 0, inputTokens: 0, outputTokens: 0, ok: true, durationMs: 1,
    } as CostTelemetryEntry;
    let doc = foldCostTelemetry(null, '2026-10-01', { ...base, strictCohort: 'strict-new' }, 1);
    doc = foldCostTelemetry(doc, '2026-10-01', { ...base, strictCohort: 'strict-new', ok: false }, 2);
    doc = foldCostTelemetry(doc, '2026-10-01', { ...base, strictCohort: 'loose-new' }, 3);
    doc = foldCostTelemetry(doc, '2026-10-01', base, 4);
    expect(doc.byStrictCohort!['strict-new']).toMatchObject({ builds: 2, okBuilds: 1 });
    expect(doc.byStrictCohort!['loose-new']).toMatchObject({ builds: 1, okBuilds: 1 });
    expect(doc.byStrictCohort!.unknown.builds).toBe(1);
  });
});
