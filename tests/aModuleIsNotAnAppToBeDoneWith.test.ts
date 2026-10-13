import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shouldCheckDone, endOfTurnReadyMark, doneSignalConfig, readyOverrunNote, doneSteer, DONE_SCORE,
} from '../src/server/AgentV3/doneSignal';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

/**
 * 🧬 A MODULE IS NOT AN APP TO BE "DONE" WITH — autopsy `50378049`, Q-906 **and** Q-907, which are one
 * root cause wearing two report lines (BlockWorld, a voxel game, 2026-10-12).
 *
 * The build was a Project Mode module turn, and the game kit had seeded a complete, working 3D game
 * shell before the model's first call (`GAME_KIT_SEEDED`). At **step 10** the done check scored the
 * PROJECT 100/100 with no blockers and injected, verbatim:
 *
 *     [BUILD CHECKPOINT] An automatic check of the whole project says the app is complete and healthy
 *     — 100/100, no blockers.
 *     If everything the user asked for is present, STOP HERE: write your summary and hand the app over.
 *
 * The model ignored it and built the user's game over **62 more steps and 1019 s**. The report carried
 * both halves of that one mistake: a `READY_BEFORE_END` overrun of 62 steps (Q-906), and a platform
 * instruction the model had to DISOBEY to do the right thing (Q-907).
 *
 * 🔴 **Had the model obeyed, the user would have been handed NavBharatAI's own seeded shell as their
 * voxel game.** That is the cost, and it is not a cosmetic one.
 *
 * 🔑 THE THIRD TIME THIS REASONING HAS BEEN ACCEPTED IN THIS MODULE, and the first two did not hunt
 * this sibling:
 *
 * | guard | autopsy | the reasoning |
 * |---|---|---|
 * | `wroteThisRun` | `1389f0d5` | the project is exactly what it was; whatever it scores is not this run's work |
 * | `editingExistingApp` | `2b1f845e` | *"the project was healthy before the turn began, so the score cannot say whether the REQUEST is done"* |
 * | **`projectModule`** | **`50378049`** | a module is one part of an app another module assembles |
 *
 * And `readyOverrunNote` ALREADY carried the principle in its own words — *"this turn built one project
 * module … not the whole app, so the project score cannot say when it was done"*. The sentence was
 * written; the guard never reached `shouldCheckDone`, so that sentence could only ever print for a turn
 * that was never judged at all. **The explanation and the behaviour disagreed, and the explanation was
 * right.**
 */

const finished = (score = 100): ReadinessReport => ({
  score, ready: true, blockers: [], warnings: [], tier: 'full',
} as unknown as ReadinessReport);

const cfg = doneSignalConfig({} as NodeJS.ProcessEnv);

/** The reported build's own numbers. */
const AT_STEP_10 = { cfg, step: 10, toolUses: 14, alreadySignalled: false, wroteThisRun: true } as const;

describe('a module is not an app to be done with (autopsy 50378049, Q-906 + Q-907)', () => {
  describe('shouldCheckDone — the steer that told a module turn to stop', () => {
    it('🔴 THE REPORTED BUILD: a module turn is never told the app is finished', () => {
      expect(shouldCheckDone({ ...AT_STEP_10, projectModule: 'Shared Types & Constants' })).toBe(false);
    });

    it('…and without the carve-out the same turn WOULD be told (the reversion, in one line)', () => {
      expect(shouldCheckDone({ ...AT_STEP_10 })).toBe(true);
      expect(shouldCheckDone({ ...AT_STEP_10, projectModule: null })).toBe(true);
      expect(shouldCheckDone({ ...AT_STEP_10, projectModule: undefined })).toBe(true);
    });

    it('a blank or whitespace module name is not a module — it must not silence a real build', () => {
      expect(shouldCheckDone({ ...AT_STEP_10, projectModule: '' })).toBe(true);
      expect(shouldCheckDone({ ...AT_STEP_10, projectModule: '   ' })).toBe(true);
    });

    it('the two older carve-outs still hold, unchanged', () => {
      expect(shouldCheckDone({ ...AT_STEP_10, editingExistingApp: true })).toBe(false);
      expect(shouldCheckDone({ ...AT_STEP_10, wroteThisRun: false })).toBe(false);
      expect(shouldCheckDone({ ...AT_STEP_10, alreadySignalled: true })).toBe(false);
      expect(shouldCheckDone({ ...AT_STEP_10, step: 4 })).toBe(false); // warm-up
    });
  });

  describe('endOfTurnReadyMark — or the honest report line stays unreachable', () => {
    const base = {
      existing: null, readiness: finished(), typeErrors: 0,
      editingExistingApp: false, wroteThisRun: true, step: 72, elapsedMs: 1_240_000,
    };

    it('🔴 no project-score mark is recorded for a module turn', () => {
      expect(endOfTurnReadyMark({ ...base, projectModule: 'Shared Types & Constants' })).toBeNull();
    });

    it('…and a mark IS recorded for a real app turn, exactly as before', () => {
      expect(endOfTurnReadyMark({ ...base })).toEqual({ step: 72, elapsedMs: 1_240_000, score: 100 });
    });

    it('🔑 THE TWO MUST AGREE: a mark here made readyOverrunNote\'s module sentence unreachable', () => {
      const mark = endOfTurnReadyMark({ ...base, projectModule: 'Shared Types & Constants' });
      // With the guard, there is no mark, so the honest sentence is what the admin reads.
      expect(readyOverrunNote(mark, 72, 1_240_000, { projectModule: 'Shared Types & Constants' }))
        .toContain('Not measured: this turn built one project module');
      // Without it, the mark exists and the report instead claims a 62-step overrun of a finished app.
      const asItWas = endOfTurnReadyMark({ ...base });
      expect(readyOverrunNote(asItWas, 72, 1_240_000, { projectModule: 'Shared Types & Constants' }))
        .toContain('was judged finished at step 72');
    });
  });

  describe('the steer itself is unchanged for the builds it is for', () => {
    it('a genuinely finished app still gets the checkpoint, with its reason', () => {
      const text = doneSteer(finished())!;
      expect(text).toContain('[BUILD CHECKPOINT]');
      expect(text).toContain('100/100, no blockers');
      // It still invites disagreement — an engine check cannot know what was asked for.
      expect(text).toContain('ignore this and finish that one thing');
    });

    it('a merely-ready app below the quality bar is still left to keep working', () => {
      expect(doneSteer(finished(DONE_SCORE - 1))).toBeNull();
    });
  });

  describe('🔒 the wiring — a getter, because the module is chosen later', () => {
    const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

    it('every done-signal reader in the runner is passed the module fact', () => {
      const calls = [...runner.matchAll(/shouldCheckDone\(\{[^}]*\}\)/g)].map((m) => m[0]);
      expect(calls.length).toBe(2); // the "due" probe and the real check
      for (const c of calls) expect(c).toContain('projectModule: this.opts.projectModule?.() ?? null');
      const mark = runner.slice(runner.indexOf('readyMark = endOfTurnReadyMark({'));
      expect(mark.slice(0, 500)).toContain('projectModule: this.opts.projectModule?.() ?? null');
    });

    it('the route passes it as a GETTER, not a value', () => {
      // `projectModuleRef` is assigned long after `baseRunnerOpts` is built, so a value here would
      // always be null — the same reason `hasExistingFiles` is a getter.
      expect(route).toContain('projectModule: () => projectModuleRef?.name ?? null,');
      expect(route).not.toContain('projectModule: projectModuleRef?.name,');
    });
  });
});
