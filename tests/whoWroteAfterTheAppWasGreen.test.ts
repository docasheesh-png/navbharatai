import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  groupPostGreenWrites,
  postGreenWritesNote,
  endVerdictFrom,
  BUILD_LOOP_LABEL,
  MAX_NAMED_PASSES,
} from '../src/server/AgentV3/postGreenWrites';
import {
  setWriteObserver,
  setGreenFreezeObserver,
  assertWriteAllowed,
  latchGreen,
  clearGreenLatch,
  runInPass,
} from '../src/server/AgentV3/greenFreeze';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * WHO WROTE AFTER THE APP WAS GREEN — the measurement that decides the next protection (2026-09-18).
 *
 * Option A keeps a working app from being LOST. Before anything stronger (verify-and-revert on every
 * post-green write; arming the freeze before the gate stretch) is built, this answers the question
 * both depend on: after the app first rendered, who kept writing, and did it survive? As of this date
 * no report shows a pass breaking a green app; PR #3084 shipped the loop-side measurement first for
 * the same reason. This is the render-side sibling.
 */

const T0 = 1_700_000_000_000;

describe('the ledger groups writes by who made them', () => {
  it('names the build loop for writes outside any pass, most files first', () => {
    const g = groupPostGreenWrites([
      { path: 'src/App.tsx', pass: null, at: T0 },
      { path: 'src/App.tsx', pass: null, at: T0 + 1 }, // same file twice → one file
      { path: 'src/x.ts', pass: 'design-consistency-heal', at: T0 + 2 },
      { path: 'src/y.ts', pass: 'design-consistency-heal', at: T0 + 3 },
      { path: 'src/z.ts', pass: 'design-consistency-heal', at: T0 + 4 },
    ]);
    expect(g[0]).toEqual({ pass: 'design-consistency-heal', files: 3, paths: ['src/x.ts', 'src/y.ts', 'src/z.ts'] });
    expect(g[1]).toEqual({ pass: BUILD_LOOP_LABEL, files: 1, paths: ['src/App.tsx'] });
  });
  it('is empty for no writes', () => {
    expect(groupPostGreenWrites([])).toEqual([]);
  });
});

describe('the one line an autopsy reads — its SEVERITY is the finding', () => {
  const writes = [
    { path: 'src/App.tsx', pass: null, at: T0 + 200_000 },
    { path: 'src/a.css', pass: 'css-import-guard', at: T0 + 250_000 },
  ];
  it('nothing wrote after green → info, said plainly', () => {
    const n = postGreenWritesNote({ writes: [], firstRenderAt: T0 + 128_000, buildStartedAt: T0, end: 'rendered' });
    expect(n.severity).toBe('info');
    expect(n.message).toBe('The app first rendered 128s in and nothing wrote to it afterwards.');
  });
  it('writes happened and it still rendered → info, the writers named', () => {
    const n = postGreenWritesNote({ writes, firstRenderAt: T0 + 128_000, buildStartedAt: T0, end: 'rendered' });
    expect(n.severity).toBe('info');
    expect(n.autoResolved).toBe(true);
    expect(n.message).toContain('2 file(s) were written by 2 writer(s)');
    expect(n.message).toContain(`${BUILD_LOOP_LABEL} (1 file)`);
    expect(n.message).toContain('css-import-guard (1 file)');
    expect(n.message).toMatch(/still rendered\.$/);
  });
  it('🔴 writes happened and it ended PROVEN BROKEN → WARNING — the evidence B/C wait for', () => {
    const n = postGreenWritesNote({ writes, firstRenderAt: T0 + 128_000, buildStartedAt: T0, end: 'broken' });
    expect(n.severity).toBe('warning');
    expect(n.autoResolved).toBe(false);
    expect(n.message).toMatch(/PROVEN BROKEN/);
    expect(n.message).toMatch(/one of these writers broke a working app/);
  });
  it('the end could not be checked → info, and it says nothing is known', () => {
    const n = postGreenWritesNote({ writes, firstRenderAt: T0 + 128_000, buildStartedAt: T0, end: 'unchecked' });
    expect(n.severity).toBe('info');
    expect(n.message).toMatch(/could not be checked/);
    // It may say the question ("whether they broke it") — it must never state the answer.
    expect(n.message).not.toMatch(/PROVEN BROKEN|broke a working app/);
  });
  it('a crowd of writers is bounded, never truncated silently', () => {
    const many = Array.from({ length: MAX_NAMED_PASSES + 3 }, (_, i) => ({ path: `f${i}.ts`, pass: `pass-${i}`, at: T0 }));
    const n = postGreenWritesNote({ writes: many, firstRenderAt: T0, buildStartedAt: T0, end: 'rendered' });
    expect(n.message).toContain(' and 3 more');
  });
  it('the end verdict is derived from the facts the route already holds', () => {
    expect(endVerdictFrom(true, false)).toBe('rendered');
    expect(endVerdictFrom(true, true)).toBe('rendered');   // green wins — the same precedence Green Stop uses
    expect(endVerdictFrom(false, true)).toBe('broken');
    expect(endVerdictFrom(false, false)).toBe('unchecked');
  });
});

describe('the write observer sits at the ONE chokepoint every write passes', () => {
  const WS = 'ws-post-green-observer';
  let dispose: (() => void) | null = null;
  afterEach(() => { dispose?.(); dispose = null; clearGreenLatch(WS); });

  it('sees an allowed write with the pass that made it, and the build loop as null', async () => {
    const seen: Array<{ path: string; pass: string | null }> = [];
    dispose = setWriteObserver(({ path, pass }) => seen.push({ path, pass }));
    assertWriteAllowed(WS, 'src/App.tsx');
    await runInPass('feature-presence-heal', async () => { assertWriteAllowed(WS, './src/Form.tsx'); });
    expect(seen).toEqual([
      { path: 'src/App.tsx', pass: null },
      { path: 'src/Form.tsx', pass: 'feature-presence-heal' },
    ]);
  });
  it('🔒 never counts infrastructure paths — node_modules and build output are not the app', () => {
    const seen: string[] = [];
    dispose = setWriteObserver(({ path }) => seen.push(path));
    assertWriteAllowed(WS, 'node_modules/x/index.js');
    assertWriteAllowed(WS, 'dist/index.html');
    assertWriteAllowed(WS, 'src/real.ts');
    expect(seen).toEqual(['src/real.ts']);
  });
  it('a REFUSED write reaches the freeze observer, not the write observer — the two ledgers are disjoint', () => {
    const wrote: string[] = [];
    const refused: string[] = [];
    dispose = setWriteObserver(({ path }) => wrote.push(path));
    const disposeFreeze = setGreenFreezeObserver(({ path }) => refused.push(path));
    try {
      latchGreen(WS, ['src/App.tsx']);
      expect(() => assertWriteAllowed(WS, 'src/App.tsx')).toThrow();
      expect(refused).toEqual(['src/App.tsx']);
      expect(wrote).toEqual([]);
    } finally { disposeFreeze(); }
  });
  it('an observer that throws never breaks the write', () => {
    dispose = setWriteObserver(() => { throw new Error('observer bug'); });
    expect(() => assertWriteAllowed(WS, 'src/ok.ts')).not.toThrow();
  });
  it('disposing stops delivery, and only for the observer that was installed', () => {
    const a: string[] = [];
    const d1 = setWriteObserver(({ path }) => a.push(path));
    d1();
    assertWriteAllowed(WS, 'src/after.ts');
    expect(a).toEqual([]);
  });
});

describe('TIME_TO_FIRST_RENDER is recorded once, with the number', () => {
  it('the first proof records it; a second proof does not double-record', () => {
    let t = 0;
    const d = new BuildDiagnostics({ now: () => (t += 10) });
    d.recordTimeToFirstRender(128_400);
    d.recordTimeToFirstRender(300_000);
    const lines = d.report().issues.filter((i) => i.code === 'TIME_TO_FIRST_RENDER');
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toBe('128s from build start to the first real-browser render of the app.');
  });
});

/**
 * 🔒 REVERSION GUARD, READ FROM THE SOURCE. The pure cases pass against a route that never arms the
 * observer or never reads the ledger; the code lists pass against lists that never learned the codes.
 */
describe('the wiring', () => {
  const route = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
  const diag = readFileSync(new URL('../src/server/AgentV3/BuildDiagnostics.ts', import.meta.url), 'utf8');
  const sugg = readFileSync(new URL('../src/server/AgentV3/buildFindingSuggestions.ts', import.meta.url), 'utf8');
  const freeze = readFileSync(new URL('../src/server/AgentV3/greenFreeze.ts', import.meta.url), 'utf8');

  it('the ledger is armed at the write chokepoint, after the in-build proof exists, and disposed with the freeze observer', () => {
    const armed = route.indexOf('disposeWriteObserver = setWriteObserver(');
    const proof = route.indexOf('const attemptInBuildGreen = async');
    const loop = route.indexOf('result = await runner.run(buildPrompt);');
    expect(armed).toBeGreaterThan(proof);
    expect(armed).toBeLessThan(loop);
    expect(route.slice(armed, armed + 300)).toMatch(/if \(inBuildGreenAt > 0/);
    expect(route).toContain('try { disposeWriteObserver?.(); } catch');
  });
  it('the first render is recorded on the proof, and the ledger is read against the end verdict', () => {
    expect(route).toContain('buildDiag.recordTimeToFirstRender(elapsedMs)');
    expect(route).toMatch(/postGreenWritesNote\(\{ writes: postGreenWrites, firstRenderAt: inBuildGreenAt, buildStartedAt, end: endVerdictFrom\(previewGreen, previewProvenBroken\) \}\)/);
  });
  it('the observer fires only on the ALLOWED branch of assertWriteAllowed', () => {
    const at = freeze.indexOf('export function assertWriteAllowed');
    const body = freeze.slice(at, freeze.indexOf('\n}', at));
    expect(body).toMatch(/if \(!writeRefused\(workspaceId, path, env\)\) \{[\s\S]*onWrite\?\.\(/);
  });
  it('both codes are measurements of the engine — never app findings, never suggestions', () => {
    const processOnly = diag.slice(diag.indexOf('const PROCESS_ONLY_CODES = new Set(['), diag.indexOf(']);', diag.indexOf('const PROCESS_ONLY_CODES')));
    expect(processOnly).toContain("'TIME_TO_FIRST_RENDER'");
    expect(processOnly).toContain("'POST_GREEN_WRITES'");
    const never = sugg.slice(sugg.indexOf('const NEVER_SUGGEST = new Set(['), sugg.indexOf(']);', sugg.indexOf('const NEVER_SUGGEST')));
    expect(never).toContain("'TIME_TO_FIRST_RENDER'");
    expect(never).toContain("'POST_GREEN_WRITES'");
  });
});
