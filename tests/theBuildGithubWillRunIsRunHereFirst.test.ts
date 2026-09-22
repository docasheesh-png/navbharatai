import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readRealBuildFailure, realBuildBudgetMs, realBuildCheckEnabled, realBuildNote, runRealBuildCheck,
  type RealBuildActuator,
} from '../src/server/lib/mobileShipRealBuild';

/**
 * "RUN THE BUILD GITHUB WILL RUN, HERE, FIRST" (admin 2026-09-22).
 *
 * The pre-flight already refuses to push an app that cannot parse, whose imports do not resolve, or
 * whose packages are undeclared — and its own header says the worst place to find a compile error is a
 * GitHub runner. But all three of those checks are STATIC. The thing that actually decides a phone
 * build is the app's own `npm run build`, and its first execution anywhere was five minutes into a
 * remote run that costs one of the user's three repair attempts.
 *
 * These cases lock the three properties that keep the check from costing more than it saves.
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VITE_APP = {
  'package.json': JSON.stringify({ scripts: { build: 'tsc && vite build' }, dependencies: { vite: '^5' } }),
  'src/main.tsx': 'export {}',
};

/** An actuator that records what it was asked to do, so a test needs no sandbox and no E2B key. */
function fakeActuator(over: Partial<RealBuildActuator> & { warm?: boolean; result?: { success: boolean; logs: string }; delayMs?: number } = {}) {
  const writes: string[] = [];
  let built = 0;
  const a: RealBuildActuator & { writes: string[]; builds: () => number } = {
    hasLiveSandbox: over.warm === undefined ? () => true : () => over.warm as boolean,
    // The presence proof (`sandboxHoldsApp`) reads the project marker back before any verdict is
    // trusted; a fake that holds the app answers it, and the case below removes it to prove the guard.
    readFile: over.readFile ?? (async (_w, p) => (p === 'package.json' ? VITE_APP['package.json'] : '')),
    writeFile: async (_w, p) => { writes.push(p); },
    build: async () => {
      built += 1;
      if (over.delayMs) await new Promise((r) => setTimeout(r, over.delayMs));
      return over.result ?? { success: true, logs: 'ok' };
    },
    writes,
    builds: () => built,
  };
  return a;
}

const ENV_KEYS = ['MOBILE_SHIP_REAL_BUILD', 'MOBILE_SHIP_REAL_BUILD_MS'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('rule 1 — it NEVER starts a machine', () => {
  it('🔴 a workspace with no warm sandbox is SKIPPED, not woken', async () => {
    // Every other entry point on the actuator goes through getSandbox, which creates or resumes a
    // billable VM. An opportunistic pre-flight that did that would be the most expensive step in the
    // whole ship — the opposite of the thing it was added to save.
    const a = fakeActuator({ warm: false });
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP);
    expect(v).toEqual({ ran: false, reason: 'no-sandbox' });
    expect(a.builds()).toBe(0);
    expect(a.writes).toEqual([]);
  });

  it('🔒 an actuator that cannot ANSWER the warmth question counts as no', async () => {
    // Local and Docker actuators have no such map. "Unknown" must read as no: a wrong yes starts a
    // machine, a wrong no costs one skipped check the runner still performs.
    const a = fakeActuator();
    delete (a as { hasLiveSandbox?: unknown }).hasLiveSandbox;
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP);
    expect(v).toEqual({ ran: false, reason: 'no-sandbox' });
    expect(a.builds()).toBe(0);
  });

  it('no actuator at all, or no workspace, is a skip rather than a throw', async () => {
    expect(await runRealBuildCheck(null, 'ws1', VITE_APP)).toEqual({ ran: false, reason: 'unavailable' });
    expect(await runRealBuildCheck(fakeActuator(), '', VITE_APP)).toEqual({ ran: false, reason: 'unavailable' });
  });

  it('a STATIC app has no build script to predict', async () => {
    const a = fakeActuator();
    const v = await runRealBuildCheck(a, 'ws1', { 'index.html': '<html></html>' });
    expect(v).toEqual({ ran: false, reason: 'static-app' });
    expect(a.builds()).toBe(0);
  });

  it('🔴 a warm handle whose machine does NOT hold the app is "could not tell", never a pass', async () => {
    // `build()` answers success for a machine with no package.json ("no build step — static project").
    // A sandbox that came back empty, or a paused handle whose existence checks were swallowed, would
    // therefore PASS this check without building anything. Reading the marker back is what rules it out.
    const a = fakeActuator({ readFile: async () => { throw new Error('sandbox is paused'); } });
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP);
    expect(v).toEqual({ ran: false, reason: 'unavailable' });
    expect(a.builds()).toBe(0);
  });

  it('the kill switch reverts it to the day before, without reaching the sandbox', async () => {
    process.env.MOBILE_SHIP_REAL_BUILD = 'off';
    const a = fakeActuator();
    expect(await runRealBuildCheck(a, 'ws1', VITE_APP)).toEqual({ ran: false, reason: 'flag-off' });
    expect(a.builds()).toBe(0);
    // …and unset means ON, because the check makes the ship cheaper rather than dearer.
    delete process.env.MOBILE_SHIP_REAL_BUILD;
    expect(realBuildCheckEnabled()).toBe(true);
  });
});

describe('rule 2 — it is bounded, and an unanswered build is never a failure', () => {
  it('🔴 a build that outruns its budget is "could not tell", not "your app is broken"', async () => {
    const a = fakeActuator({ delayMs: 50 });
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP, {}, 10);
    expect(v).toEqual({ ran: false, reason: 'timed-out' });
  });

  it('a sandbox that throws tells us nothing about the app', async () => {
    const a = fakeActuator();
    a.build = async () => { throw new Error('sandbox died'); };
    expect(await runRealBuildCheck(a, 'ws1', VITE_APP)).toEqual({ ran: false, reason: 'unavailable' });
  });

  it('a heal that cannot reach the sandbox skips, because the build would judge the OLD code', async () => {
    const a = fakeActuator();
    a.writeFile = async () => { throw new Error('no route to sandbox'); };
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP, { 'src/main.tsx': 'export const x = 1' });
    expect(v).toEqual({ ran: false, reason: 'unavailable' });
    expect(a.builds()).toBe(0);
  });

  it('a malformed budget takes the default, never "no limit"', () => {
    process.env.MOBILE_SHIP_REAL_BUILD_MS = 'soon';
    expect(realBuildBudgetMs()).toBe(180_000);
    process.env.MOBILE_SHIP_REAL_BUILD_MS = '5';   // below the floor: a build cannot answer in 5ms
    expect(realBuildBudgetMs()).toBe(180_000);
    process.env.MOBILE_SHIP_REAL_BUILD_MS = '99999999';
    expect(realBuildBudgetMs()).toBe(600_000);
  });
});

describe('rule 3 — it is NOT stricter than the runner it is predicting', () => {
  it('🔴 a TYPE-ONLY failure is reported and NOT acted on — the workflow rescues it itself', () => {
    // WEB_BUILD_STEP re-runs the bundler directly when only `error TS…` stopped the strict script, so
    // the app ships exactly as the preview showed it. Blocking here would refuse apps that really build
    // — being stricter than the thing you are predicting is worse than not predicting at all.
    const v = readRealBuildFailure('src/App.tsx(3,7): error TS2322: Type string is not assignable to number.');
    expect(v.code).toBe('TYPE_GATE_BLOCKED_PACKAGING');
    expect(v.blocking).toBe(false);
  });

  it('🔴 a real bundler failure IS blocking — the runner would meet it too', () => {
    const v = readRealBuildFailure('error during build:\nCould not resolve "./Missing" from "src/App.tsx"');
    expect(v.blocking).toBe(true);
  });

  it('the verdict names the class with the SAME classifier the remote repair loop uses', () => {
    // One rule, two places. A second copy here would drift, and then our prediction and the runner's
    // own diagnosis would disagree about the same log.
    const src = codeOnly(read('src/server/lib/mobileShipRealBuild.ts'));
    expect(src).toContain("import { classifyBuildFailure } from './mobileBuildRepair';");
    expect(src).toContain('classifyBuildFailure(String(log || \'\')');
  });
});

describe('what it does when it really runs', () => {
  it('writes ONLY the healed files, then builds once', async () => {
    // The sandbox already holds the app — that is where it was built. Uploading the whole project to
    // ask one question would make the cheap check expensive.
    const a = fakeActuator();
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP, { 'src/main.tsx': 'export const x = 1' });
    expect(v).toEqual({ ran: true, ok: true });
    expect(a.writes).toEqual(['src/main.tsx']);
    expect(a.builds()).toBe(1);
  });

  it('a failure carries the real log, bounded', async () => {
    const a = fakeActuator({ result: { success: false, logs: `${'x'.repeat(9000)}\nerror during build:\nboom` } });
    const v = await runRealBuildCheck(a, 'ws1', VITE_APP);
    expect(v.ran).toBe(true);
    if (v.ran && !v.ok) {
      expect(v.blocking).toBe(true);
      expect(v.log.length).toBeLessThanOrEqual(6000);
      expect(v.log).toContain('error during build:');
    }
  });

  it('🔒 the user is told nothing at all when we could not check', () => {
    // "We could not check" is not information anybody can act on, and putting it on screen turns a
    // silent optimisation into a worry. The ship proceeds either way.
    expect(realBuildNote({ ran: false, reason: 'no-sandbox' })).toBeNull();
    expect(realBuildNote({ ran: false, reason: 'timed-out' })).toBeNull();
    // …nor for a class the runner rescues by itself.
    expect(realBuildNote({ ran: true, ok: false, blocking: false, code: 'TYPE_GATE_BLOCKED_PACKAGING', summary: 's', log: '' })).toBeNull();
    // A pass is worth saying, and a real failure is worth saying plainly.
    expect(realBuildNote({ ran: true, ok: true })).toContain('compiled');
    expect(realBuildNote({ ran: true, ok: false, blocking: true, code: 'APP_CODE_BUILD_FAILED', summary: 'It did not compile.', log: '' }))
      .toContain('would have failed too');
  });

  it('no vendor or model name ever reaches the user (White-Label Law)', () => {
    const notes = [
      realBuildNote({ ran: true, ok: true }),
      realBuildNote({ ran: true, ok: false, blocking: true, code: 'APP_CODE_BUILD_FAILED', summary: 'Your app itself did not compile.', log: '' }),
    ].join(' ');
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Sonnet', 'Opus', 'Gemini', 'Grok', 'OpenAI', 'E2B', 'sandbox']) {
      expect(notes.toLowerCase()).not.toContain(vendor.toLowerCase());
    }
  });
});

describe('the wiring', () => {
  const route = codeOnly(read('src/server/routes/mobileSetup.ts'));

  it('runs AFTER the heal, on the healed files, and refuses only a BLOCKING failure', () => {
    expect(route).toContain('await runRealBuildCheck(buildActuator(), workspaceId, appFiles, preflight.changed)');
    expect(route).toContain('if (realBuild.ran && !realBuild.ok && realBuild.blocking) {');
    expect(route).toContain("code: 'real-build-failed',");
  });

  it('since 2026-09-22 the ship BUILDS the app here first; the check runs only where that never started a build', () => {
    // The prebuild is the ship's own production build. Where it ran — shipped, timed out, or produced
    // nothing readable — a second build in the same machine proves nothing and doubles the cost.
    expect(route).toContain('const prebuild = await prebuildForShip(buildActuator(), workspaceId, appFiles, preflight.changed)');
    expect(route.indexOf('prebuildForShip(')).toBeLessThan(route.indexOf('await runRealBuildCheck('));
    expect(route).toContain("prebuild.kind === 'skip' && !prebuild.buildRan");
    expect(route).toContain("{ ran: false, reason: 'prebuilt' }");
    // A blocking failure of the prebuild is the SAME refusal, so the counter and the message tell one story.
    expect(route).toContain("if (prebuild.kind === 'refuse') {");
    expect(route).toContain('failureCode: prebuild.code,');
  });

  it('🔒 a thrown check can never fail the ship', () => {
    // This is an optimisation, not a gate. If it breaks, the user still gets the build they asked for.
    expect(route).toContain(".catch(() => ({ ran: false as const, reason: 'unavailable' as const }))");
  });

  it('the refusal names the class, so the counter and the message tell one story', () => {
    expect(route).toContain('failureCode: realBuild.code,');
  });
});
