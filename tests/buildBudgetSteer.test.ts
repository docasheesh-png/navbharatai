/**
 * THE TIME BUDGET, TOLD TO THE MODEL — the missing subsystem from the f04421ef autopsy (2026-09-13).
 *
 * 🔴 The build that produced this fix ran 9m49s on the prompt "finish/fix the build so the app works
 * end-to-end" and never reported an outcome. After the typecheck was clean at 2m23s it browsed the app
 * for 91 seconds, generated two test files, and spent 80 seconds installing a dev dependency. None of
 * that is wrong work — it is wrong work FOR THE TIME REMAINING, and the engine could not say so, because
 * the wall clock existed only as a guillotine that ends a build and never as a number the model is told.
 */
import { describe, it, expect } from 'vitest';
import {
  budgetStage, budgetSteer, minutesLeft, BUDGET_STAGE_AT, type BudgetStage,
} from '../src/server/AgentV3/buildBudgetSteer';

const THIRTY_MIN = 30 * 60_000;
const mins = (n: number) => n * 60_000;

describe('which stage the build is in', () => {
  it('says nothing while there is plenty of time', () => {
    expect(budgetStage(0, THIRTY_MIN)).toBeNull();
    expect(budgetStage(mins(14), THIRTY_MIN)).toBeNull();
  });

  it('reaches each stage at its fraction, not at a fixed number of minutes', () => {
    // The cap is env-tunable and depth-scaled, so a "at 15 minutes" rule would be meaningless on a short
    // cap and would never fire on a long one. Fractions hold at every cap — asserted on two.
    for (const total of [THIRTY_MIN, mins(8)]) {
      expect(budgetStage(total * 0.5, total), `half @${total}`).toBe('half');
      expect(budgetStage(total * 0.75, total), `wrapping @${total}`).toBe('wrapping');
      expect(budgetStage(total * 0.9, total), `final @${total}`).toBe('final');
      expect(budgetStage(total * 0.49, total), `none @${total}`).toBeNull();
    }
    expect(BUDGET_STAGE_AT).toEqual({ half: 0.5, wrapping: 0.75, final: 0.9 });
  });

  it('reports the stage it is ACTUALLY in after a long jump, not the first one crossed', () => {
    // One very long tool call (the 80-second npm install) can cross two thresholds between turns.
    expect(budgetStage(mins(28), THIRTY_MIN)).toBe('final');
  });

  it('🔒 a build with NO cap configured is never steered — behaviour stays byte-identical', () => {
    for (const total of [0, -1, NaN, Infinity]) {
      expect(budgetStage(mins(99), total as number), String(total)).toBeNull();
    }
    expect(budgetSteer(mins(99), 0, new Set())).toBeNull();
  });
});

describe('what the model is told', () => {
  const fresh = () => new Set<BudgetStage>();

  it('🔴 at half time it is told to stop exactly the things that overran the reported build', () => {
    const out = budgetSteer(mins(15), THIRTY_MIN, fresh())!;
    expect(out.stage).toBe('half');
    // The four items are the real ones from the report: tests, a dependency install, polish, re-auditing.
    expect(out.text).toMatch(/do NOT now/i);
    expect(out.text).toMatch(/generate tests|write or generate tests/i);
    expect(out.text).toMatch(/install, add or upgrade any dependency/i);
    expect(out.text).toMatch(/polish/i);
    expect(out.text).toMatch(/re-verify something that already passed/i);
    expect(out.text).toContain('about 15 minutes');
  });

  it('🔒 …but never forbids the thing the user actually asked for', () => {
    // A user whose whole request IS "add tests" must still get tests. A budget rule that overrides the
    // user's own request would be a worse failure than the overrun it prevents.
    expect(budgetSteer(mins(15), THIRTY_MIN, fresh())!.text)
      .toMatch(/If one of those is the ONLY thing the user actually asked for, do it/i);
  });

  it('at three-quarters it stops exploring and orders a finish', () => {
    const out = budgetSteer(mins(23), THIRTY_MIN, fresh())!;
    expect(out.stage).toBe('wrapping');
    expect(out.text).toMatch(/Stop exploring/i);
    expect(out.text).toMatch(/make sure the app builds and runs/i);
    expect(out.text).toMatch(/Start nothing new/i);
  });

  it('at the end it asks for an HONEST summary rather than a claim', () => {
    const out = budgetSteer(mins(28), THIRTY_MIN, fresh())!;
    expect(out.stage).toBe('final');
    expect(out.text).toMatch(/Stop all work now except saving/i);
    expect(out.text).toMatch(/honest "this part is not done"/i);
  });

  it('every stage carries a user-facing line, so the narrowing is visible not mysterious', () => {
    for (const at of [0.5, 0.75, 0.9]) {
      const out = budgetSteer(THIRTY_MIN * at, THIRTY_MIN, fresh())!;
      expect(out.narration.length, String(at)).toBeGreaterThan(20);
      // 🔒 White-label: nothing the user reads may name a vendor or a model.
      for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'kimi-k2']) {
        expect(out.narration.toLowerCase(), vendor).not.toContain(vendor.toLowerCase());
      }
    }
  });
});

describe('🔒 each stage speaks exactly ONCE', () => {
  it('does not repeat itself turn after turn', () => {
    // A budget warning repeated every turn is noise the model learns to skim — which is how a real
    // warning stops working.
    const sent = new Set<BudgetStage>();
    const first = budgetSteer(mins(16), THIRTY_MIN, sent)!;
    sent.add(first.stage);
    expect(budgetSteer(mins(17), THIRTY_MIN, sent)).toBeNull();
    expect(budgetSteer(mins(20), THIRTY_MIN, sent)).toBeNull();
    // …but the NEXT stage still gets through.
    const second = budgetSteer(mins(23), THIRTY_MIN, sent)!;
    expect(second.stage).toBe('wrapping');
  });

  it('a build that crosses two stages at once hears only the later, cumulative one', () => {
    const sent = new Set<BudgetStage>();
    const out = budgetSteer(mins(28), THIRTY_MIN, sent)!;
    expect(out.stage).toBe('final');
    sent.add(out.stage);
    // "half" is never delivered afterwards — "stop everything optional" already contains it.
    expect(budgetSteer(mins(29), THIRTY_MIN, sent)).toBeNull();
  });
});

describe('the minutes it quotes', () => {
  it('are real, floored at zero, and read as English at the end', () => {
    expect(minutesLeft(mins(15), THIRTY_MIN)).toBe(15);
    expect(minutesLeft(mins(31), THIRTY_MIN)).toBe(0);
    expect(budgetSteer(THIRTY_MIN - 20_000, THIRTY_MIN, new Set())!.text).toMatch(/Under a minute/);
  });
});

/**
 * THE LOOP GUARD'S "BANNED" WAS A LIE, AND NOW IT IS NOT (same f04421ef autopsy).
 *
 * The escalated steer has always told the model *"This call is banned for the rest of this build"* while
 * the module's own header said *"never blocking — it only advises"*. Nothing enforced it, so the reported
 * build heard the warning twice and kept looping for nine minutes. A capability the engine ANNOUNCES and
 * does not have is the state the second absolute rule forbids.
 */
describe('🔴 the loop guard now actually refuses what it says it bans', () => {
  const load = async () => import('../src/server/AgentV3/RepeatProbeGuard');

  it('bans a read-only probe repeated past the FINAL steer', async () => {
    const { newRepeatProbeState, recordAndCheckRepeat, isProbeBanned } = await load();
    const st = newRepeatProbeState();
    const input = { pattern: "from '../types'", path: 'src' };
    expect(isProbeBanned(st, 'grep', input)).toBe(false);
    // Threshold 3 ⇒ steer at 3, FINAL (and ban) at 6 — the exact shape of the loop this guard was
    // written for: the same grep six times, each returning nothing.
    for (let i = 0; i < 6; i++) recordAndCheckRepeat(st, 'grep', input, 3);
    expect(isProbeBanned(st, 'grep', input)).toBe(true);
    // A DIFFERENT search is untouched — only this exact dead call is refused.
    expect(isProbeBanned(st, 'grep', { pattern: 'something else', path: 'src' })).toBe(false);
  });

  it('🔒 NEVER bans a state-changing tool, however often it repeats', async () => {
    // The safety argument for the whole change. A repeated `tsc --noEmit` looks identical to a loop and
    // is usually a build legitimately converging — check, fix, check. Refusing it would stop a build
    // from FINISHING, which is far worse than the wasted minutes the guard prevents.
    const { newRepeatProbeState, recordAndCheckRepeat, isProbeBanned, PROBE_TOOLS } = await load();
    const st = newRepeatProbeState();
    for (const tool of ['bash', 'write_file', 'edit_file', 'write_files_batch', 'task']) {
      const input = { command: './node_modules/.bin/tsc --noEmit' };
      for (let i = 0; i < 40; i++) recordAndCheckRepeat(st, tool, input, 3);
      expect(isProbeBanned(st, tool, input), tool).toBe(false);
      expect(PROBE_TOOLS.has(tool), tool).toBe(false);
    }
  });

  it('still STEERS a repeated command even though it cannot ban it', async () => {
    const { newRepeatProbeState, recordAndCheckRepeat } = await load();
    const st = newRepeatProbeState();
    const input = { command: 'npm run build' };
    let last: string | null = null;
    for (let i = 0; i < 6; i++) last = recordAndCheckRepeat(st, 'bash', input, 3) ?? last;
    expect(last).toMatch(/LOOP GUARD/);
  });

  it('the refusal message tells the model what to do instead of probing again', async () => {
    const { bannedProbeMessage } = await load();
    const msg = bannedProbeMessage('grep');
    expect(msg).toMatch(/refused/i);
    expect(msg).toMatch(/cannot produce a different answer/i);
    expect(msg).toMatch(/say so in your summary/i);
  });

  it('is inert when the guard is switched off', async () => {
    const { newRepeatProbeState, isProbeBanned } = await load();
    // The runner checks `loopGuardOn` before asking, and an empty state bans nothing regardless.
    expect(isProbeBanned(newRepeatProbeState(), 'grep', { a: 1 })).toBe(false);
  });
});
