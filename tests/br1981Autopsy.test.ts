/**
 * BR1981 (attachment-specified study/quiz app, failed, free / not charged) —
 * retained evidence, not a replay.
 *
 * Setup hit the E2B concurrent-sandbox cap of 20. The workspace listed 0 paths, yet the
 * text-only fast lane still planned and generated the app (14 Surplus calls, ~3 minutes).
 * Progress checkmarks claimed files were built; every write was then refused with
 * "Could not read the existing … safely — not overwriting it"; the lane logged
 * "Built your app — 0 file(s)" and recorded SIMPLE_BUILD_SUCCESS. The type-check note
 * said the files were being shipped unverified. The free-tier path then invited the
 * user to add credits for a stronger engine. The sandbox never recovered. 0 files
 * landed; the user was not charged.
 *
 * Already closed on main, locked here against this report's shape:
 *   • BR1952 (#4124) — FAST_LANE_SKIPPED_SANDBOX: a dead workspace does not start the
 *     text-only lane.
 *   • BR1961 F2 (#4146) — sandboxUnavailableNotice does not invite a second Start.
 *   • BR1952 — an unrecovered sandbox is not a paid-capability verdict.
 *   • The generate tick now says "Generated … — not saved yet" rather than a bare ✓.
 *
 * Shipped in this PR:
 *   • A fast-lane pass that saved no files returns ok:false (nothing_landed) and does
 *     not claim "Built your app" or "shipping the files unverified". This report's
 *     HTML/JS plan has no App.tsx, so the existing root-refusal hand-off did not fire.
 *
 * Sibling already closed, locked here: OneShot (Q-982) already refuses a write that
 * landed fewer than minFiles and does not return ok:true for it.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { freeTierUpsellMessage } from '../src/server/AgentV3/FreeTierBuildRouting';
import { runSimpleBuild, unwrittenEntries } from '../src/server/AgentV3/SimpleBuilder';
import { classifyBuildOutcome } from '../src/server/AgentV3/BuildOutcome';

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const SIMPLE = readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8');
const ONESHOT = readFileSync('src/server/AgentV3/OneShotBuilder.ts', 'utf8');

// Synthetic plan in this report's shape: HTML + JS + data, no App.tsx / app/page.
// Distinctive attachment paths are not reproduced.
const MANIFEST = [
  'types.ts :: shared types',
  'utils.ts :: helpers',
  'index.html :: page shell',
  'js/app.js :: quiz runtime',
  'js/storage.js :: progress',
  'data.ts :: shared constants',
  'data/catalog.json :: catalog',
].join('\n');

const refuse = (path: string) =>
  ({ path, ok: false as const, error: `Could not read the existing ${path} safely (transient sandbox error) — not overwriting it. Retry in a moment.` });

function lane(over: Partial<Parameters<typeof runSimpleBuild>[0]> = {}) {
  const logs: string[] = [];
  let verifyCalls = 0;
  let previewCalls = 0;
  return {
    logs,
    counts: { verifyCalls: () => verifyCalls, previewCalls: () => previewCalls },
    deps: {
      prompt: 'Create this study quiz from the attached specification.',
      framework: 'vite-react' as const,
      scaffoldPaths: [] as string[],
      shareContract: false,
      depOrder: false,
      generate: async (_system: string, user: string) => {
        if (user.includes('Plan the file list')) return MANIFEST;
        if (user.includes('Design the shared contract')) return 'export type Id = string;';
        const path = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim() || 'types.ts';
        return `<<<FILE ${path}>>>\nexport default {};\n<<<ENDFILE>>>`;
      },
      writeFiles: async (files: Array<{ path: string }>) => files.map((f) => refuse(f.path)),
      verify: async () => {
        verifyCalls += 1;
        // This report's shape: the check could not execute in the sandbox. A throw is recorded as
        // ran:false + sticky success — without the 0-file guard that becomes ok:true and "shipping
        // the files unverified".
        throw new Error('Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes (20)');
      },
      startPreview: async () => {
        previewCalls += 1;
      },
      log: (s: string) => logs.push(s),
      ...over,
    },
  };
}

describe('BR1981 — a busy sandbox is not a goodbye', () => {
  it('the notice says we are still trying and does not invite a second Start (this report\'s old goodbye is gone)', () => {
    const n = sandboxUnavailableNotice();
    expect(n).toMatch(/temporarily unavailable/i);
    expect(n).toMatch(/still trying|as soon as I can/i);
    expect(n).not.toMatch(/I can't create files right now/i);
    expect(n).not.toMatch(/please try building again in a little while/i);
    expect(n).not.toMatch(/try building again|try again later|please retry/i);
    expect(n).not.toMatch(/I can still chat and plan/i);
  });
});

describe('BR1981 — a dead workspace does not start the text-only lane', () => {
  it('FAST_LANE_SKIPPED_SANDBOX is recorded when setup failed, and the lane is not admitted', () => {
    expect(ROUTE).toContain("code: 'FAST_LANE_SKIPPED_SANDBOX'");
    expect(ROUTE).toMatch(/Workspace setup failed: text-only fast lanes cannot run against an unavailable workspace/);
    const admit = ROUTE.indexOf('const fastLaneWouldRun = !sandboxUnavailable &&');
    expect(admit).toBeGreaterThan(0);
    const skipAt = ROUTE.indexOf("code: 'FAST_LANE_SKIPPED_SANDBOX'");
    expect(skipAt).toBeGreaterThan(admit);
    expect(ROUTE.slice(admit, skipAt + 200)).toContain('if (sandboxUnavailable)');
  });

  it('neighbour: the same admission still runs the lane when the workspace is available', () => {
    const line = ROUTE.split('\n').find((l) => l.includes('const fastLaneWouldRun = !sandboxUnavailable &&'));
    expect(line).toBeTruthy();
    expect(line).toContain('!goldenPreseeded');
    expect(line).toContain('oneShotEnabled()');
    expect(line).toContain("intent === 'new_build'");
  });
});

describe('BR1981 — an unrecovered sandbox is not a reason to ask for credits', () => {
  it('the upsell interruption includes sandboxUnavailable, and the ask is behind that flag', () => {
    const interrupted = ROUTE.indexOf('const interrupted = !stopped && (sandboxUnavailable ||');
    expect(interrupted).toBeGreaterThan(0);
    const ask = ROUTE.indexOf('if (!refused && !stopped && !interrupted && !answerOnlyNow())');
    expect(ask).toBeGreaterThan(interrupted);
    expect(ROUTE).toMatch(/Did not ask this user to add credits: our workspace or platform prevented this build/);
    const emitWindow = ROUTE.slice(ask, ask + 2500);
    expect(emitWindow).toContain('freeTierUpsellMessage');
    // The sentence this report showed is still the engine-limit message; the gate above is what
    // stops it firing on an unrecovered sandbox.
    expect(freeTierUpsellMessage('engine')).toMatch(/strongest engine/i);
    expect(freeTierUpsellMessage('engine')).toMatch(/add credits/i);
  });
});

describe('BR1981 — generating a file is not the same as saving it', () => {
  it('the per-file tick says the file is not saved yet, and no longer uses a bare checkmark', () => {
    expect(SIMPLE).toContain('Generated ${spec.path} (${filesDone}/${manifest.length}) — not saved yet.');
    expect(SIMPLE).not.toMatch(/`✓ \$\{spec\.path\} \(\$\{filesDone\}\/\$\{manifest\.length\}\)`/);
  });
});

describe('BR1981 — a fast-lane pass that saved no files is not a successful build', () => {
  it('classifyBuildOutcome already calls 0 files a build failure', () => {
    expect(classifyBuildOutcome({ filesWritten: 0, typecheckOk: null })).toBe('BUILD_FAILED');
  });

  it('this report\'s HTML/JS plan: every write refused, no App.tsx — ok is false, nothing is claimed shipped', async () => {
    const h = lane();
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(false);
    expect(r.filesWritten).toBe(0);
    expect(r.outcome).toBe('BUILD_FAILED');
    expect(r.reason).toBe('nothing_landed');
    expect(r.summary).toMatch(/no files could be saved/i);
    expect(r.summary).not.toMatch(/Built your app file-by-file/i);
    expect(h.logs.some((l) => /Built your app — 0 file/i.test(l))).toBe(false);
    expect(h.logs.some((l) => /shipping the files unverified/i.test(l))).toBe(false);
    expect(h.counts.verifyCalls()).toBe(0);
    expect(h.counts.previewCalls()).toBe(0);
  });

  it('neighbour: the same plan with landed writes is still a successful lane', async () => {
    const h = lane({
      writeFiles: async (files) => files.map((f) => ({ path: f.path, ok: true as const })),
      verify: undefined,
      startPreview: undefined,
    });
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBeGreaterThan(0);
    expect(r.summary).toMatch(/Built your app file-by-file/i);
    expect(h.logs.some((l) => /Built your app — \d+ file/i.test(l))).toBe(true);
  });

  it('neighbour: an App.tsx plan whose root cannot be written still hands off, as before', async () => {
    const h = lane({
      generate: async (_system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/util.ts :: helpers';
        const path = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
      },
    });
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(false);
    expect(r.filesWritten).toBe(0);
    expect(r.reason).toMatch(/root component/i);
    expect(r.reason).toMatch(/stopped early/i);
    expect(r.reason).not.toBe('nothing_landed');
    expect(h.logs.some((l) => /Built your app — 0 file/i.test(l))).toBe(false);
  });

  it('neighbour: the same HTML/JS plan with one landed write is still a successful lane', async () => {
    const h = lane({
      writeFiles: async (files) =>
        files.map((f, i) => (i === 0 ? { path: f.path, ok: true as const } : refuse(f.path))),
      verify: undefined,
      startPreview: undefined,
    });
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(1);
    expect(r.reason).not.toBe('nothing_landed');
    expect(h.logs.some((l) => /Built your app — 1 file/i.test(l))).toBe(true);
    expect(h.counts.verifyCalls()).toBe(0);
    expect(h.counts.previewCalls()).toBe(0);
  });

  it('neighbour: unwrittenEntries still does not treat index.html as a root', () => {
    expect(unwrittenEntries([
      { path: 'index.html', purpose: 'page shell' },
      { path: 'js/app.js', purpose: 'quiz runtime' },
      { path: 'data/catalog.json', purpose: 'catalog' },
    ], [])).toEqual([]);
  });

  it('the zero-file failure is decided before the success log or the unverified-shipping note', () => {
    const guard = SIMPLE.indexOf("reason: 'nothing_landed'");
    const successLog = SIMPLE.indexOf('Built your app — ${files.length} file(s), each generated individually.');
    const unverified = SIMPLE.indexOf('The type-check could not run in the sandbox — shipping the files unverified');
    expect(guard).toBeGreaterThan(0);
    expect(successLog).toBeGreaterThan(guard);
    expect(unverified).toBeGreaterThan(successLog);
    expect(SIMPLE).toMatch(/if \(files\.length === 0\)/);
  });
});

describe('BR1981 — the sibling one-shot lane already refuses a write that landed nothing', () => {
  it('OneShot throws on a below-minFiles landing and returns ok:false (Q-982)', () => {
    expect(ONESHOT).toMatch(/if \(landed\.length < minFiles\) throw new Error\(ONE_SHOT_FILES_REFUSED\)/);
    const refused = ONESHOT.indexOf('if (landed.length < minFiles) throw new Error(ONE_SHOT_FILES_REFUSED)');
    const success = ONESHOT.indexOf('Built your app in one shot — ${files.length} file(s).');
    expect(refused).toBeGreaterThan(0);
    expect(success).toBeGreaterThan(refused);
    expect(ONESHOT).toContain("reason === ONE_SHOT_FILES_REFUSED");
    expect(ONESHOT).toMatch(/return \{ ok: false, filesWritten: 0/);
  });
});
