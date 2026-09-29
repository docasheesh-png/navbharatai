import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExploreRun, PressResult } from '../src/server/AgentV3/clickExplorer';
import {
  repairTargets, explorerRepairFindings, explorerRepairPlan, explorerRepairTierGate, judgeExplorerRepair,
  runExplorerRepair, explorerRepairOutcomeRecord, explorerRepairProof, explorerRepairUserLine,
  explorerRepairEnabled, MAX_REPAIR_TARGETS, EXPLORER_REPAIR_MAX_MS, EXPLORER_REPAIR_PASS,
  type ExplorerRepairDeps,
} from '../src/server/AgentV3/explorerRepair';
import { strictReverify } from '../src/server/AgentV3/verifyAfterFix';
import { explorerRepairWeakDailyCap, weakRepairAllowed, EXPLORER_REPAIR_WEAK_DAILY_DEFAULT } from '../src/server/lib/explorerRepairBudget';
import { latchGreen, clearGreenLatch, runInPass, writeRefused, ALLOWED_PASSES } from '../src/server/AgentV3/greenFreeze';
import { PHASE_EXPLORER_REPAIR } from '../src/server/AgentV3/billingPhase';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * 2026-09-28, admin: "han dono ho jaye to bahut accha rahe! aap isko real engineering kar ke, world
 * class banao". The click explorer found broken buttons and could only report them. Now one repair is
 * attempted, EVERY button is pressed again, and the change is kept only if the app renders, a broken
 * control now works, and nothing that worked broke. Everything else is undone and not billed.
 */

const press = (over: Partial<PressResult> = {}): PressResult => ({
  label: 'Tab two', tag: 'button', verdict: 'ok', note: 'it responded', errors: [], changed: true, ...over,
});
const run = (presses: PressResult[], loaded = true): ExploreRun => ({
  summary: { loaded, note: '', found: presses.length, chosen: presses.length, skipped: [] },
  presses, outOfTime: false, diagnostic: null,
});

const before = run([
  press({ label: 'Home' }),
  press({ label: 'Settings', verdict: 'blank', note: 'the screen went blank' }),
  press({ label: 'Refresh', via: 'Reports', verdict: 'error', errors: ['TypeError: x is undefined'] }),
  press({ label: 'About', tag: 'a', verdict: 'broken-link' }),
]);
const targets = repairTargets(before);

describe('what is handed to the repair', () => {
  it('takes only the failures, once each, and never more than one focused pass can hold', () => {
    expect(targets.map((t) => t.label)).toEqual(['Settings', 'Refresh', 'About']);
    const many = run(Array.from({ length: 9 }, (_, i) => press({ label: `B${i}`, verdict: 'error' })));
    expect(repairTargets(many)).toHaveLength(MAX_REPAIR_TARGETS);
    const dup = run([press({ label: 'X', verdict: 'error' }), press({ label: 'X', verdict: 'crashed' })]);
    expect(repairTargets(dup)).toHaveLength(1);
    // The same label on two screens is two controls.
    const two = run([press({ label: 'Save', verdict: 'error' }), press({ label: 'Save', via: 'Edit', verdict: 'error' })]);
    expect(repairTargets(two)).toHaveLength(2);
    expect(repairTargets(null)).toEqual([]);
  });

  it('names the control, its screen, what the browser saw — and forbids removing it as a "fix"', () => {
    const f = explorerRepairFindings(targets);
    expect(f[0]).toContain('"Settings"');
    expect(f[0]).toContain('blank');
    expect(f[1]).toContain('after opening "Reports"');
    expect(f[1]).toContain('TypeError: x is undefined');
    expect(f[2]).toContain('page that does not exist');
    for (const line of f) expect(line).toMatch(/Do not remove, hide or disable the control/);
  });
});

describe('the budget and who may be repaired', () => {
  it('starts only when repair AND its full re-check fit inside the build', () => {
    expect(explorerRepairPlan(60_000).repairMs).toBe(0);
    expect(explorerRepairPlan(Number.NaN).repairMs).toBe(0);
    expect(explorerRepairPlan(Number.POSITIVE_INFINITY).repairMs).toBe(EXPLORER_REPAIR_MAX_MS);
    const mid = explorerRepairPlan(250_000).repairMs;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(EXPLORER_REPAIR_MAX_MS);
  });

  it('Normal and Strong always; Weak only under the daily allowance, which fails closed', () => {
    expect(explorerRepairTierGate({ tier: 'off', freeListed: false, weakAllowed: null })).toEqual({ attempt: true, countAgainstWeakBudget: false });
    expect(explorerRepairTierGate({ tier: 'mini', freeListed: false, weakAllowed: false })).toEqual({ attempt: true, countAgainstWeakBudget: false });
    expect(explorerRepairTierGate({ tier: 'weak', freeListed: true, weakAllowed: false })).toEqual({ attempt: true, countAgainstWeakBudget: false });
    expect(explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: true })).toEqual({ attempt: true, countAgainstWeakBudget: true });
    expect(explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: false }).attempt).toBe(false);
    expect(explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: null }).attempt).toBe(false);
  });

  it('the daily cap reads what an operator types and never becomes unlimited by accident', () => {
    expect(explorerRepairWeakDailyCap({} as NodeJS.ProcessEnv)).toBe(EXPLORER_REPAIR_WEAK_DAILY_DEFAULT);
    expect(explorerRepairWeakDailyCap({ AGENTV3_EXPLORER_REPAIR_WEAK_DAILY: '20' } as NodeJS.ProcessEnv)).toBe(20);
    expect(explorerRepairWeakDailyCap({ AGENTV3_EXPLORER_REPAIR_WEAK_DAILY: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(explorerRepairWeakDailyCap({ AGENTV3_EXPLORER_REPAIR_WEAK_DAILY: ' OFF ' } as NodeJS.ProcessEnv)).toBe(Number.POSITIVE_INFINITY);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(explorerRepairWeakDailyCap({ AGENTV3_EXPLORER_REPAIR_WEAK_DAILY: 'lots' } as NodeJS.ProcessEnv)).toBe(EXPLORER_REPAIR_WEAK_DAILY_DEFAULT);
    spy.mockRestore();
    expect(weakRepairAllowed(null, 100)).toBe(false); // unreadable ⇒ closed
    expect(weakRepairAllowed(99, 100)).toBe(true);
    expect(weakRepairAllowed(100, 100)).toBe(false);
    expect(weakRepairAllowed(0, 0)).toBe(false);
    expect(weakRepairAllowed(null, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('the kill switch reverts to report-only', () => {
    expect(explorerRepairEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(explorerRepairEnabled({ AGENTV3_EXPLORER_REPAIR: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('the judgement — kept only when it is proven', () => {
  it('a broken button that now WORKS is fixed; a deleted one is not', () => {
    const after = run([press({ label: 'Home' }), press({ label: 'Settings' }), press({ label: 'Refresh', via: 'Reports' })]);
    const j = judgeExplorerRepair(targets, before, after, true);
    expect(j.keep).toBe(true);
    expect(j.fixed).toEqual(['"Settings"', '"Refresh" (on the "Reports" screen)']);
    // "About" was not pressed again (removed, or not reached) — never counted as fixed.
    expect(j.stillBroken).toEqual(['"About"']);
    expect(j.remaining).toEqual([]);
  });

  it('breaking a button that worked undoes the whole repair, whatever it fixed', () => {
    const after = run([press({ label: 'Home', verdict: 'crashed' }), press({ label: 'Settings' })]);
    const j = judgeExplorerRepair(targets, before, after, true);
    expect(j.keep).toBe(false);
    expect(j.regressions).toEqual(['"Home"']);
    expect(j.remaining).toEqual(['"Home"']);
  });

  it('fixing nothing, not rendering, or not being able to look again are all "not proven"', () => {
    expect(judgeExplorerRepair(targets, before, run([press({ label: 'Home' })]), true).keep).toBe(false);
    expect(judgeExplorerRepair(targets, before, run([press({ label: 'Settings' })]), false).keep).toBe(false);
    expect(judgeExplorerRepair(targets, before, null, true).keep).toBe(false);
    expect(judgeExplorerRepair(targets, before, run([press({ label: 'Settings' })], false), true).keep).toBe(false);
  });
});

function deps(over: Partial<ExplorerRepairDeps> = {}): ExplorerRepairDeps & { reverted: Record<string, string>[] } {
  const reverted: Record<string, string>[] = [];
  return {
    reverted,
    repairMs: 60_000,
    snapshot: { 'src/App.tsx': 'old' },
    repair: async () => true,
    changedSince: async () => 2,
    renders: async () => true,
    explore: async () => run([press({ label: 'Home' }), press({ label: 'Settings' }), press({ label: 'Refresh', via: 'Reports' }), press({ label: 'About', tag: 'a' })]),
    revert: async (s) => { reverted.push(s); },
    ...over,
  };
}

describe('the orchestration', () => {
  it('a proven fix is kept and nothing is reverted', async () => {
    const d = deps();
    const o = await runExplorerRepair(targets, before, d);
    expect(o.kept).toBe(true);
    expect(d.reverted).toHaveLength(0);
    expect(o.judgement?.fixed).toHaveLength(3);
    expect(explorerRepairOutcomeRecord(o).code).toBe('EXPLORE_REPAIRED');
  });

  it('a regression is undone to the exact snapshot', async () => {
    const d = deps({ explore: async () => run([press({ label: 'Home', verdict: 'error' }), press({ label: 'Settings' })]) });
    const o = await runExplorerRepair(targets, before, d);
    expect(o.kept).toBe(false);
    expect(o.reverted).toBe(true);
    expect(d.reverted).toEqual([{ 'src/App.tsx': 'old' }]);
    expect(explorerRepairOutcomeRecord(o).code).toBe('EXPLORE_REPAIR_UNDONE');
  });

  it('a re-check that THROWS proves nothing and is undone — not kept as "unverified"', async () => {
    const d = deps({ renders: async () => { throw new Error('browser timed out'); } });
    const o = await runExplorerRepair(targets, before, d);
    expect(o.kept).toBe(false);
    expect(o.reverted).toBe(true);
  });

  it('a repair that runs out of time is stopped, allowed to settle, then undone', async () => {
    let seen: AbortSignal | null = null;
    const d = deps({
      repair: (_f, signal) => { seen = signal; return new Promise<boolean>(() => {}); },
      setTimer: (fn) => { queueMicrotask(fn); return 1; },
      clearTimer: () => {},
    });
    const o = await runExplorerRepair(targets, before, d);
    expect(o.timedOut).toBe(true);
    expect(seen!.aborted).toBe(true);
    expect(o.kept).toBe(false);
    expect(o.reverted).toBe(true);
    expect(explorerRepairOutcomeRecord(o).message).toMatch(/did not finish inside its 60 s budget/);
  });

  it('a pass that changed no file is not a fix, is not re-checked, and reverts nothing', async () => {
    const renders = vi.fn(async () => true);
    const d = deps({ changedSince: async () => 0, renders });
    const o = await runExplorerRepair(targets, before, d);
    expect(o.kept).toBe(false);
    expect(o.reverted).toBe(false);
    expect(renders).not.toHaveBeenCalled();
    expect(d.reverted).toHaveLength(0);
    expect(explorerRepairOutcomeRecord(o).code).toBe('EXPLORE_REPAIR_NO_CHANGE');
  });

  it('a pass that did not complete is undone', async () => {
    const d = deps({ repair: async () => false });
    const o = await runExplorerRepair(targets, before, d);
    expect(o.kept).toBe(false);
    expect(o.reverted).toBe(true);
  });

  it('stopping the build stops the repair', async () => {
    const ctl = new AbortController();
    ctl.abort();
    let seen: AbortSignal | null = null;
    const d = deps({ buildSignal: ctl.signal, repair: async (_f, s) => { seen = s; return true; } });
    const o = await runExplorerRepair(targets, before, d);
    expect(seen!.aborted).toBe(true);
    expect(o.kept).toBe(false);
  });
});

describe('what the user is told', () => {
  const original = { ok: false, headline: 'NavBharatAI tested your app and found a problem', steps: ['Pressing "Settings" left the screen blank.'] };

  it('a kept repair names what now works and says every button was pressed again', async () => {
    const o = await runExplorerRepair(targets, before, deps());
    const card = explorerRepairProof(original, o);
    expect(card.ok).toBe(true);
    expect(card.headline).toBe('NavBharatAI found broken buttons and fixed them');
    expect(card.steps.at(-1)).toMatch(/pressed again in a real browser/);
    expect(explorerRepairUserLine(o)).toMatch(/found 3 that did not work\. All of them were fixed/);
  });

  it('an undone repair keeps the failures in front of the user and says they were not charged', async () => {
    const o = await runExplorerRepair(targets, before, deps({ repair: async () => false }));
    const card = explorerRepairProof(original, o);
    expect(card.ok).toBe(false);
    expect(card.steps[0]).toBe(original.steps[0]);
    expect(card.steps.at(-1)).toMatch(/undone.*not charged/);
    expect(explorerRepairUserLine(o)).toBe('');
  });

  it('carries no codes, tool or vendor names', async () => {
    const o = await runExplorerRepair(targets, before, deps());
    const text = JSON.stringify([explorerRepairProof(original, o), explorerRepairUserLine(o), explorerRepairFindings(targets)]);
    expect(text).not.toMatch(/EXPLORE_|playwright|chromium|glm|kimi|claude|gemini|grok|sonnet|opus/i);
  });
});

describe('the safety rules it runs under', () => {
  afterEach(() => clearGreenLatch('ws-er'));

  it('an unproven check is a failed check (strictReverify)', async () => {
    expect(await strictReverify(async () => { throw new Error('x'); })()).toBe(false);
    expect(await strictReverify(async () => true)()).toBe(true);
    expect(await strictReverify(async () => false)()).toBe(false);
  });

  it('may write to a working app, and never to a secret file', async () => {
    expect(ALLOWED_PASSES.has(EXPLORER_REPAIR_PASS)).toBe(true);
    latchGreen('ws-er', ['src/App.tsx', '.env']);
    await runInPass(EXPLORER_REPAIR_PASS, async () => {
      expect(writeRefused('ws-er', 'src/App.tsx')).toBe(false);
      expect(writeRefused('ws-er', 'src/pages/About.tsx')).toBe(false);
      expect(writeRefused('ws-er', '.env')).toBe(true);
      expect(writeRefused('ws-er', 'server/.env.local')).toBe(true);
    });
  });

  it('a recheck clears only the finding it re-measured', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'preview', severity: 'warning', code: 'EXPLORE_FAILED', message: 'a', autoResolved: false });
    d.record({ phase: 'preview', severity: 'warning', code: 'JOURNEY_FAILED', message: 'b', autoResolved: false });
    expect(d.resolveOnRecheck('EXPLORE_FAILED')).toBe(1);
    const issues = d.report().issues;
    expect(issues.find((i) => i.code === 'EXPLORE_FAILED')?.autoResolved).toBe(true);
    expect(issues.find((i) => i.code === 'JOURNEY_FAILED')?.autoResolved).toBe(false);
  });
});

describe('the wiring (source guards — tsc and vitest cannot see a missing call)', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const at = route.indexOf('runExplorerRepair(targets, exploreRun');

  it('runs after the explorer, inside its own pass AND its own billing phase', () => {
    expect(at).toBeGreaterThan(route.indexOf('const exploreRun = parseExploreOutput(out.stdout);'));
    const block = route.slice(at, at + 4000);
    expect(block).toContain('runInBillingPhase(PHASE_EXPLORER_REPAIR, () => runInPass(EXPLORER_REPAIR_PASS,');
    expect(block).toContain('revert: revertToGreenSnapshot,');
  });

  it('takes its snapshot BEFORE the repair, and never repairs without one', () => {
    const pre = route.slice(at - 2500, at);
    expect(pre).toContain('const snap = (await collectWorkspaceFiles(actuator, workspaceId)).files;');
    expect(pre).toContain("skip('no snapshot of the working app could be taken')");
  });

  it('a repair that is not kept is not billed', () => {
    const post = route.slice(at, at + 5000);
    expect(post).toContain('if (!outcome.kept) barrenPhases.add(PHASE_EXPLORER_REPAIR);');
    expect(PHASE_EXPLORER_REPAIR).toBe(EXPLORER_REPAIR_PASS);
  });

  it('the stale EXPLORE_FAILED is cleared only when the re-press found nothing broken', () => {
    const post = route.slice(at, at + 5000);
    expect(post).toMatch(/outcome\.kept && outcome\.judgement && outcome\.judgement\.remaining\.length === 0\)[\s\S]{0,120}resolveOnRecheck\('EXPLORE_FAILED'\)/);
  });

  it('the reviewer\'s green repair gained the same strict re-check (the sibling)', () => {
    const g = route.indexOf("runInPass('reviewer-functional-repair'");
    expect(route.slice(g, g + 2500)).toContain('reverify: strictReverify(async () => {');
  });
});
