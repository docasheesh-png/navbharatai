// HOW MUCH OF THE APP IS BUILT — and why not one point of it is invented.
//
// Admin, 2026-09-20: *"app kitne % ban gayi woh bhi likh kar aana chahiye … 100% done - tap on
// preview!"*. The last clause is the whole design: **the preview IS the completion criterion**, and the
// platform already treats it that way everywhere that matters — `markAppRendered` is the single
// producer of that proof, and the billing law turns on it (*"app bani = preview chala"*).
//
// 🔴 THE THING THIS FILE EXISTS TO REFUSE: a timer. Every builder on the market shows a bar that
// crawls on elapsed time, and it is a lie by construction — it moves while nothing happens, it is
// always at 90% when a build is about to fail, and the one moment a user needs it to be true is the
// moment it cannot be. The second absolute rule is explicit that a status indicator must reflect real
// state and must never be faked, so **every number here is a count of things that genuinely happened**:
// todos the engine marked done, the phase it declared, a preview URL it published, a render it proved.
// If nothing happened, the number does not move — and the elapsed clock beside it is what tells the
// user the build is alive, because a clock is a measurement rather than a promise.
//
// ⚠️ THE HONEST COST, stated rather than discovered later: on a build with no plan the number JUMPS
// (5 → 80 → 90 → 100) instead of gliding. That is not a defect to smooth over — the in-between values
// do not exist, and inventing them is the thing being refused. `basis` says which case a reading came
// from so the gap is visible rather than mysterious.
//
// 🔒 AND 100% IS EARNED, NEVER ANNOUNCED. A build that ends without a proven render stops at the last
// number it really reached and says so. "100% done — tap Preview" is a claim about the user's app, and
// this repo has an autopsy (697b38ee) about telling a user the opposite of what their screen showed.

import type { BuildPhase } from './previewReloadPolicy';
import type { TodoItem } from './agentV3Types';

/** Every input is an observed fact from the live event stream — nothing derived from a clock. */
export interface ProgressInput {
  /** A build has begun this turn (the `workspace` / `build_meta` event has landed). */
  started: boolean;
  /** The engine's own plan. Only `done` is counted — see `planShare`. */
  todos: readonly TodoItem[];
  /** What the engine says it is doing. 'settling' means the app EXISTS and runs. */
  buildPhase: BuildPhase;
  /** A live preview URL the engine published. */
  previewUrl?: string;
  /** The app was PROVEN to render in a real browser. The only thing that can earn 100%. */
  appRendered?: boolean;
  done: boolean;
  ok?: boolean;
  /** The previous reading, so a number can never fall backwards mid-build. */
  floor?: number;
}

export interface BuildProgress {
  /** 0–100. Below 100 unless the app is finished AND its render was proven. */
  pct: number;
  /** What to show beside it. Never claims more than the evidence. */
  label: string;
  /** True only for a finished, proven-rendered build. */
  complete: boolean;
  /**
   * WHERE the number came from — 'plan' (a real done/total fraction), 'milestone' (stage floors only,
   * so it will jump), or 'none' (nothing has happened yet). Not shown to the user; it exists so a
   * future reader can tell a lumpy reading from a broken one without guessing.
   */
  basis: 'plan' | 'milestone' | 'none';
}

/** Stage floors. A stage that is REACHED sets a minimum; it never sets a maximum below a real count. */
const FLOOR_STARTED = 5;
const FLOOR_PLANNED = 15;
const FLOOR_SETTLING = 80;
const FLOOR_PREVIEW_UP = 90;

/** The band a real plan fraction maps onto: 15% at zero todos done, 75% at all of them. */
const PLAN_FROM = FLOOR_PLANNED;
const PLAN_TO = 75;

/**
 * The highest a RUNNING build may show. Not a cosmetic cap: it is what makes 100 mean something.
 * A user who has seen 99% on a build that then failed will never trust the number again.
 */
const MAX_WHILE_RUNNING = 97;

/**
 * What share of the plan is genuinely finished. PURE.
 *
 * ⚠️ ONLY `done` COUNTS. Giving an `in_progress` todo half a point is a convention, not a measurement,
 * and this whole module is worth nothing the moment it starts containing conventions. A `blocked` todo
 * is likewise not progress. The result is lumpier and every value is true.
 */
export function planShare(todos: readonly TodoItem[]): number | null {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const done = todos.filter((t) => t?.status === 'done').length;
  return done / todos.length;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function buildProgress(input: ProgressInput): BuildProgress {
  const floor = Number.isFinite(input.floor) ? clampPct(input.floor as number) : 0;

  // ── Finished ────────────────────────────────────────────────────────────────────────────────────
  if (input.done) {
    // The ONE path to 100. `appRendered` has a single producer on the server (`markAppRendered`), so
    // this is the same proof the release gate and the bill use — not a second opinion about it.
    const basis: BuildProgress['basis'] = planShare(input.todos) == null ? 'milestone' : 'plan';
    if (input.ok && input.appRendered) {
      return { pct: 100, label: '100% done — tap Preview', complete: true, basis };
    }
    const pct = Math.min(MAX_WHILE_RUNNING, clampPct(Math.max(floor, milestonePct(input))));
    return {
      pct,
      label: input.ok
        // It finished and we could not prove the app runs. Saying "100% done — tap Preview" here is
        // exactly the sentence autopsy 697b38ee was written about, in the other direction.
        ? `${pct}% — finished, preview not confirmed`
        : `${pct}% — stopped. Your files are saved.`,
      complete: false,
      basis,
    };
  }

  // ── Running ─────────────────────────────────────────────────────────────────────────────────────
  if (!input.started) {
    return { pct: clampPct(floor), label: `${clampPct(floor)}%`, complete: false, basis: 'none' };
  }

  const share = planShare(input.todos);
  const fromPlan = share == null ? 0 : PLAN_FROM + share * (PLAN_TO - PLAN_FROM);
  const pct = Math.min(
    MAX_WHILE_RUNNING,
    clampPct(Math.max(floor, milestonePct(input), fromPlan)),
  );
  return {
    pct,
    label: `${pct}%`,
    complete: false,
    basis: share == null ? (pct > 0 ? 'milestone' : 'none') : 'plan',
  };
}

/** The floor set purely by which observable stages have been reached. PURE. */
function milestonePct(input: ProgressInput): number {
  if (input.previewUrl) return FLOOR_PREVIEW_UP;
  if (input.buildPhase === 'settling') return FLOOR_SETTLING;
  if (Array.isArray(input.todos) && input.todos.length > 0) return FLOOR_PLANNED;
  if (input.started) return FLOOR_STARTED;
  return 0;
}
