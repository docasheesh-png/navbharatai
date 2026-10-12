// AUTOPSY 303e8a6f (2026-10-12), item Z — 11.4 s passed before the first model call; the SETUP_TIMING lines covered
// 4.4 s of it. The other 7.0 s (62%) sat in six stretches no line timed — git init as three serial sandbox round
// trips, two full vault reads with decrypt, an entitlement probe for services the user did not have, two reads of
// one Firestore document, serial conversation look-ups — each added by a feature that put one more `await` between
// two hand-placed timing lines. Three earlier autopsies each timed the one window they were pointed at.
//
// The CLASS: unmeasured serial awaits on the critical path to the first model call, with no invariant that the
// timing lines cover the wait. Now (1) every SETUP_TIMING is a span, and windows start where the last span ended, so
// they tile the wait by construction; (2) the first-call line says how much of the wait was timed and names the
// largest untimed stretch; (3) the waste found in the window is removed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { createPrepSteps, prepWindowDetail } from '../src/server/AgentV3/prepClock';
import { GitManager } from '../src/server/AgentV3/GitManager';

const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const T0 = 1791817491537; // the report's build start

/** The report's own setup lines, as spans: [start offset, end offset, message]. */
const REPORT_SPANS: Array<[number, number, string]> = [
  [400, 2_571, 'Workspace ready in 2s'],
  [2_894, 3_806, 'Project checked in 1s — nothing needed restoring'],
  [7_396, 7_527, 'Personal context loaded in 131ms'],
  [7_546, 8_652, 'Project context prepared in 1.1s'],
];

function reportTimeline(withWindows: boolean) {
  let now = T0;
  const d = new BuildDiagnostics({ now: () => now } as never);
  for (const [a, b, message] of REPORT_SPANS) {
    if (withWindows && message.startsWith('Personal')) { now = T0 + a; d.closeSetupWindow('Build wiring ready', [{ name: 'git init', ms: 1_400 }, { name: 'vault', ms: 900 }]); }
    now = T0 + b;
    d.recordSetupTiming({ message, startMs: T0 + a, endMs: T0 + b });
  }
  return { d, at: (ms: number) => { now = T0 + ms; } };
}

describe('1 · the windows tile the wait', () => {
  it('a window starts exactly where the last timed span ended, and names what it did not time', () => {
    let now = 1_000;
    const d = new BuildDiagnostics({ now: () => now } as never);
    now = 3_000; d.recordSetupTiming({ message: 'Workspace ready in 2s', startMs: 1_000 });
    now = 6_590; d.closeSetupWindow('Build wiring ready', [{ name: 'git init', ms: 1_200 }, { name: 'vault', ms: 800 }]);
    now = 7_000; d.closeSetupWindow('Prompt context gathered');
    const rows = d.report().issues.filter((i) => i.code === 'SETUP_TIMING');
    expect(rows.map((r) => r.message)).toEqual(['Workspace ready in 2s', 'Build wiring ready in 3.6s', 'Prompt context gathered in 410ms']);
    expect(rows[1]!.detail).toBe('git init 1200ms · vault 800ms · other 1590ms');
    // Contiguous: no millisecond from 1000 to 7000 is outside a span.
    expect(d.setupCoverage(1_000, 7_000)).toMatchObject({ timedMs: 6_000, untimedMs: 0 });
  });

  it('steps are timed by name and rethrow what they threw', async () => {
    let t = 0;
    const steps = createPrepSteps(() => t);
    await steps.step('git init', async () => { t += 820; });
    await expect(steps.step('vault', async () => { t += 100; throw new Error('vault down'); })).rejects.toThrow('vault down');
    expect(steps.list()).toEqual([{ name: 'git init', ms: 820 }, { name: 'vault', ms: 100 }]);
    expect(prepWindowDetail(steps.list(), 1_500)).toBe('git init 820ms · vault 100ms · other 580ms');
  });
});

describe('2 · the report\'s own timeline: the first-call line says how much was timed', () => {
  it('🔴 without windows: 62% of the wait was in no line — and the line now says so, naming the 3.6 s hole', () => {
    const { d, at } = reportTimeline(false);
    at(29_836);
    d.recordLlmCall({ model: 'kimi-k2.7-code', latencyMs: 18_423, answerMs: 3_415, ok: true } as never);
    const ttfc = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(ttfc).toMatch(/^11s of preparation/);
    expect(ttfc).toMatch(/Timed setup steps account for 4\.3s of the 11\.4s; 7\.1s is outside every timed step \(largest: 3\.6s after "Project checked in 1s — nothing needed restoring"\)\./);
  });

  it('with the wiring window in place, that hole is named instead of hidden', () => {
    const { d, at } = reportTimeline(true);
    at(29_836);
    d.recordLlmCall({ model: 'kimi-k2.7-code', latencyMs: 18_423, answerMs: 3_415, ok: true } as never);
    const rows = d.report().issues.filter((i) => i.code === 'SETUP_TIMING').map((i) => i.message);
    expect(rows).toContain('Build wiring ready in 3.6s');
    const ttfc = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(ttfc).not.toMatch(/after "Project checked/);
  });
});

describe('3 · 🔒 census: every SETUP_TIMING is a span, and the windows are where the wait was', () => {
  it('no hand-written SETUP_TIMING record in the route', () => {
    expect(ROUTE).not.toMatch(/code: 'SETUP_TIMING'/);
    expect((ROUTE.match(/buildDiag\.recordSetupTiming\(\{/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('the three windows close in order between the build start and the first lane', () => {
    const at = (s: string) => ROUTE.indexOf(s);
    const marks = [
      'const setupT0 = Date.now();',
      "buildDiag.closeSetupWindow('Build wiring ready', wiringSteps.list())",
      'const contextT0 = Date.now();',
      "buildDiag.closeSetupWindow('Prompt context gathered', promptSteps.list())",
      'const pmDiag = projectModeDiagnosis({',
      "buildDiag.closeSetupWindow('Final preparation', finalSteps.list())",
    ].map(at);
    for (const m of marks) expect(m).toBeGreaterThan(0);
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
  });
});

describe('4 · the waste found in the window is gone', () => {
  it('git init is ONE sandbox round trip, same order, same idempotent steps', async () => {
    const calls: string[] = [];
    const git = new GitManager({ runCommand: async (_w: string, c: string) => { calls.push(c); return { stdout: '', stderr: '', exitCode: 0 }; } } as never, 'ws');
    expect(await git.ensureRepo()).toBe(true);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.indexOf('.gitignore')).toBeLessThan(c.indexOf('git init'));
    expect(c.indexOf('git init')).toBeLessThan(c.indexOf('git rm -r --cached'));
  });

  it('🔒 one vault read for keys and withheld names; no plan probe without a service; one manual-edit read', () => {
    expect(ROUTE).toContain("loadUserVaultForBuild(userId, workspaceId)");
    expect(ROUTE).not.toContain('withheldVaultSecretNames(userId, workspaceId)');
    expect(ROUTE).toMatch(/const mcpFacts = servers\.length > 0\s*\? await wiringSteps\.step\('service plan check'/);
    expect(ROUTE).toContain('consumeManualEditsWithOwned(workspaceId)');
    expect(ROUTE).not.toMatch(/await userOwnedFiles\(workspaceId\)/);
  });

  it('🔒 git init still runs before the secrets file — both rewrite .gitignore', () => {
    expect(ROUTE.indexOf("wiringSteps.step('git init', () => gm.ensureRepo())")).toBeGreaterThan(0);
    expect(ROUTE.indexOf("wiringSteps.step('git init', () => gm.ensureRepo())")).toBeLessThan(ROUTE.indexOf('dispatcher.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS)'));
  });
});
