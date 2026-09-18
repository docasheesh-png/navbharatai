/**
 * THE DONE SIGNAL — the engine computes "this app is ready" and throws the answer away.
 *
 * 🔎 WHAT IS ACTUALLY MISSING. `assessBuildReadiness` is free, deterministic and already runs inside
 * the build loop (`shouldRunWeakCheckpoint`, every 20 steps on a weak build). It returns a full
 * verdict — score, blockers, warnings, `ready` — and `weakCheckpointSteer` reads exactly one half of
 * it: the blockers. **When the answer is "this app is finished and healthy", nothing is said and
 * nothing is recorded.** The loop then runs until the model itself decides to stop or the step cap
 * ends it.
 *
 * ⚠️ THE EVIDENCE FOR THE CURE IS THINNER THAN THE EVIDENCE FOR THE GAP, AND THIS FILE SAYS SO
 * RATHER THAN OVERSTATING IT. The case everyone cites is autopsy `681bd91b` — an app finished,
 * rendering and preview-published at minute 4:45, followed by 26 minutes that ended in failure. But
 * those 26 minutes were the TYPECHECK GATE grinding a Vite scaffold the user had forbidden, not the
 * model choosing to polish, and PR #3059 fixed that at its own root. In the other reports to hand
 * (`baa0b3c7`, `e706e068`, `dd1f5f60`) the builds were genuinely BROKEN and grinding — a readiness
 * scan would have said "not ready" and this signal would correctly have stayed silent.
 *
 * So: **the gap is proven, the size of the win is not.** That asymmetry decides the whole design.
 *
 * 🔑 THEREFORE THE MEASUREMENT IS THE DELIVERABLE AND THE STEER IS THE CHEAP HALF THAT RIDES WITH IT.
 * `readyAt` records the first moment a build was judged finished; the route reports how many steps and
 * seconds ran AFTER it. Within days that turns "builds overrun after they are done" from a belief into
 * a number — the same measure-first discipline that caught the E2B rate being 2x wrong, where the
 * derivation everybody trusted was the one that could not fail.
 *
 * 🔒 IT IS A STEER, NOT A STOP, and that is deliberate rather than timid. Ending the loop on our own
 * judgement would ship whatever exists the moment a deterministic scan says 'ready' — and `ready` is a
 * FLOOR (`MIN_READY_SCORE` = 50, "at least half the defect budget remains"), not a statement that the
 * user got what they asked for. Nothing in the loop has seen the app render. Cutting a build on that
 * would trade a slow app for a missing one, which is the wrong direction under the one absolute rule.
 * The stop-the-loop half is an OPEN decision for after the measurement lands.
 *
 * PURE — no I/O, no clock, never throws. The caller supplies the counters it already holds.
 */
import type { ReadinessReport } from './Readiness';

/**
 * The score a build must clear to be called FINISHED — deliberately far above `MIN_READY_SCORE`.
 *
 * `ready` answers "is anything blocking?" and its floor is 50, chosen so a working app is never
 * condemned. "You may stop now" is a different and much stronger claim, and saying it at 50/100 would
 * be telling a model to walk away from an app with half its defect budget spent. 85 leaves room for
 * the cosmetic warnings a good app legitimately carries while excluding anything that reads as rough.
 */
export const DONE_SCORE = 85;

export interface DoneSignalConfig {
  /** Default ON. `AGENTV3_DONE_SIGNAL=off` restores the pre-change behaviour exactly. */
  enabled: boolean;
  /** Run the check every N steps (it rides the readiness scan, so this is its own cadence). */
  everyN: number;
  /** Warm-up: never before this step — an app cannot be finished before it exists. */
  minStep: number;
}

export function doneSignalConfig(env: NodeJS.ProcessEnv = process.env): DoneSignalConfig {
  const int = (v: string | undefined, d: number, min: number): number => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) && n >= min ? n : d;
  };
  return {
    enabled: String(env.AGENTV3_DONE_SIGNAL ?? '').trim().toLowerCase() !== 'off',
    everyN: int(env.AGENTV3_DONE_SIGNAL_EVERY, 10, 1),
    minStep: int(env.AGENTV3_DONE_SIGNAL_MIN_STEP, 8, 1),
  };
}

/**
 * Whether to run the done check on THIS step. Pure.
 *
 * `alreadySignalled` is what makes it fire ONCE: a model that has been told it may stop and carried on
 * has decided otherwise, and repeating the message would be the nagging `maxNudges` exists to prevent.
 */
export function shouldCheckDone(p: {
  cfg: DoneSignalConfig;
  step: number;
  toolUses: number;
  alreadySignalled: boolean;
}): boolean {
  const { cfg, step, toolUses, alreadySignalled } = p;
  if (!cfg.enabled || alreadySignalled) return false;
  if (toolUses <= 0) return false;      // nothing written yet — nothing can be finished
  if (step < cfg.minStep) return false; // warm-up
  return step % cfg.everyN === 0;
}

/**
 * Is this app FINISHED by the platform's own deterministic measure? Pure.
 *
 * Both halves are required and neither implies the other: `ready` is the hard gate (no build-breaker,
 * no high-severity security issue) and `DONE_SCORE` is the quality bar. A build can pass the gate with
 * a mediocre score, and that is precisely the build that should keep working.
 */
export function appIsDone(readiness: ReadinessReport | null | undefined): boolean {
  if (!readiness) return false;
  if (!readiness.ready) return false;
  if (readiness.blockers.length > 0) return false;
  return Number.isFinite(readiness.score) && readiness.score >= DONE_SCORE;
}

/**
 * The ONE message injected when the app is judged finished — null when it is not.
 *
 * It states the measure it is based on, because a model told "you are done" with no reason has been
 * given an instruction rather than evidence, and the honest thing is to let it disagree: an engine
 * check cannot know that the user asked for a feature nobody has built yet.
 */
export function doneSteer(readiness: ReadinessReport | null | undefined): string | null {
  if (!appIsDone(readiness)) return null;
  const r = readiness as ReadinessReport;
  return [
    `[BUILD CHECKPOINT] An automatic check of the whole project says the app is complete and healthy `
      + `— ${r.score}/100, no blockers.`,
    'If everything the user asked for is present, STOP HERE: write your summary and hand the app over. '
      + 'Do not add polish, refactors or extra features nobody requested.',
    'If something they asked for is genuinely still missing, ignore this and finish that one thing — '
      + 'this check measures code health, and it cannot know what was requested.',
  ].join('\n');
}

/** Where a build stood when it was FIRST judged finished. Recorded even when the model keeps going. */
export interface ReadyMark {
  step: number;
  elapsedMs: number;
  score: number;
}

/**
 * The admin report line: how much of the build ran AFTER the app was already finished.
 *
 * This is the number the stop-the-loop decision needs and nobody has. A build that was never judged
 * ready says so plainly — "we did not look" and "it never got there" must not read as zero overrun.
 */
export function readyOverrunNote(mark: ReadyMark | null | undefined, endStep: number, endMs: number): string {
  if (!mark) return 'The app was never judged finished during the build.';
  const steps = Math.max(0, endStep - mark.step);
  const secs = Math.max(0, Math.round((endMs - mark.elapsedMs) / 1000));
  if (steps === 0 && secs === 0) return `The app was judged finished at step ${mark.step} (${mark.score}/100) and the build ended there.`;
  return `The app was judged finished at step ${mark.step} (${mark.score}/100); the build then ran `
    + `${steps} more step(s) over ${secs}s before it ended.`;
}
