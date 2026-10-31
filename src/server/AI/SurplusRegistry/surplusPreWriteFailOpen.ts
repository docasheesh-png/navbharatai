/**
 * Mid-build Surplus → Weak fail-open (pre-first user write).
 *
 * Admission already fail-opens before SURPLUS_ADMITTED (`admitOrFallback` /
 * `surplusChatAdmission`). Once admitted there was NO mid-build fail-open: ANY
 * Surplus failure that SurplusTurnRunner folds to PUBLIC_BUILD_ENGINE_UNAVAILABLE
 * (immediate LLM_CALL_FAILED scrub, transport error, turn_timeout, terminal_fold, …)
 * killed the whole Weak build while Files were still 0.
 *
 * Bench evidence (2026-10-26):
 * - Case A: SURPLUS_ADMITTED → LLM_CALL_FAILED scrubbed to build-engine-unavailable
 *   in well under a second (NOT turn_timeout).
 * - Cases B/C: ~52–54s / 90% / Files 0 / starter Hello — same public scrub class.
 *
 * Early scope classification is outside the build runner. Its real exception is
 * retained privately and consumed before any build runner is constructed. Never
 * infer a retry from report text or replay a builder after it published an error.
 * Stop, maintenance, budget and policy refusals remain terminal.
 *
 * Same product spirit as admission: continue on the Weak/CHEAP_FLOOR ladder.
 * Messaging honesty (#3959) and user-facing "high demand" copy (#3956) are separate;
 * this module recovers the build.
 */
import {
  PublicBuildEngineError,
  PUBLIC_BUILD_ENGINE_UNAVAILABLE,
  PUBLIC_BUILD_ENGINE_TIMEOUT,
  publicBuildEngineSafeReason,
} from '../../lib/buildEngineError';
import type { TurnRunner } from '../../AgentV3/ClaudeClient';
import { SurplusBuildTransportError } from './transport';
import {
  SAFE_SURPLUS_ADMISSION_REASONS,
  type SafeSurplusAdmissionReason,
} from './admitOrFallback';
import { recordSurplusMidBuildDeath, recordSurplusAdmitProbeSuccess } from './surplusAdmitCircuit';

/** Safe mid-build reasons appended to the admission allowlist. Never secret/URL-bearing. */
export const SURPLUS_PRE_WRITE_FAIL_OPEN_REASONS = [
  'mid_build_timeout',
  'mid_build_transport',
  'mid_build_engine_unavailable',
  'mid_build_after_write',
] as const;

export type SurplusPreWriteFailOpenReason = (typeof SURPLUS_PRE_WRITE_FAIL_OPEN_REASONS)[number];

const PRE_WRITE_REASON_SET = new Set<string>(SURPLUS_PRE_WRITE_FAIL_OPEN_REASONS);

/** Shared across every Surplus-wrapped runner in one build so fail-open happens once. */
export type SurplusPreWriteFailOpenState = { dropped: boolean };

export type SurplusPreWriteFailOpenHooks = {
  state: SurplusPreWriteFailOpenState;
  /** Count of model-authored (non-platform-seed) files written so far. */
  userFilesWritten: () => number;
  onFailOpen?: (reason: SurplusPreWriteFailOpenReason) => void;
  /** Owner per-profile opt-out (surplusNoFallback): never drop Surplus to Weak; error propagates. */
  noFallback?: boolean;
  /** Observe every Surplus turn error (raw-error profiles). Never alters control flow. */
  onSurplusError?: (error: unknown) => void;
};

/** True when `reason` is one of the mid-build fail-open tokens (for tests / allowlist checks). */
export function isSurplusPreWriteFailOpenReason(reason: string | undefined | null): reason is SurplusPreWriteFailOpenReason {
  return !!reason && PRE_WRITE_REASON_SET.has(reason);
}

/** All safe Surplus admission+mid-build reasons (admission list ∪ pre-write list). */
export function allSafeSurplusFailOpenReasons(): readonly string[] {
  return [...SAFE_SURPLUS_ADMISSION_REASONS, ...SURPLUS_PRE_WRITE_FAIL_OPEN_REASONS];
}

/**
 * Map a Surplus mid-build failure to a build-report-safe reason. Never returns
 * upstream text, URLs, or provider identity.
 */
export function surplusPreWriteFailOpenReason(error: unknown): SurplusPreWriteFailOpenReason {
  if (error instanceof SurplusBuildTransportError) return 'mid_build_transport';
  const msg = error instanceof Error ? error.message : '';
  // Match main's UNAVAILABLE string and #3959's timeout wording without requiring that PR.
  if (/timed out|timeout/i.test(msg)) return 'mid_build_timeout';
  if (error instanceof PublicBuildEngineError) return 'mid_build_engine_unavailable';
  if (msg === PUBLIC_BUILD_ENGINE_UNAVAILABLE) return 'mid_build_engine_unavailable';
  return 'mid_build_engine_unavailable';
}

/** Only a real public engine error can authorize recovery. Narrative summaries,
 * duck-typed codes and provider messages are not dispatch authority. */
export function isSurplusPublicBuildEngineFailure(error: unknown): boolean {
  if (publicBuildEngineSafeReason(error) === 'policy_refusal') return false;
  if (error instanceof PublicBuildEngineError) return true;
  return error instanceof Error && (
    error.message === PUBLIC_BUILD_ENGINE_UNAVAILABLE || error.message === PUBLIC_BUILD_ENGINE_TIMEOUT
  );
}

/**
 * Fail-open when Surplus died for ANY public-engine reason (transport, timeout or public
 * engine boundary) — BEFORE or AFTER the model authored files.
 *
 * DNA (bench 2026-10-31 ~5PM IST, hard games on Weak): platformer / tower-defence / physics
 * builds wrote 2–4 of 10–13 plan steps, then Surplus died mid-build. The old Files=0 guard
 * refused recovery, so the build ended at 90% with "build engine temporarily unavailable",
 * leaving App.tsx importing a never-written `./game/Game` (Vite error) or the starter
 * Hello World — 3/4 hard games unusable. The wrapper never restarts the build: it retries the
 * SAME turn (same params = same conversation + files already on disk) on the Weak ladder, and a
 * turn that threw applied no tool calls, so continuing after writes is as safe as before them.
 */
export function shouldFailOpenSurplusPreWrite(opts: {
  userFilesWritten: number;
  error: unknown;
  alreadyDropped?: boolean;
  /** Only the per-turn wrapper (same-turn retry) may continue after writes; scope recovery may not. */
  allowAfterWrite?: boolean;
}): boolean {
  if (opts.alreadyDropped) return false;
  const n = opts.userFilesWritten;
  const proven = Number.isInteger(n) && n >= 0;
  if (!proven) return false;
  if (n !== 0 && !opts.allowAfterWrite) return false;
  return isSurplusPublicBuildEngineFailure(opts.error);
}

/**
 * Mark Surplus dropped + fire onFailOpen when Files=0 and the failure is a public
 * engine fold. Used by the throw wrapper and the actual early-scope exception
 * captured separately from its sanitized report row. Returns the reason when
 * consumed, else null.
 */
export function tryConsumeSurplusPreWriteFailOpen(
  hooks: SurplusPreWriteFailOpenHooks,
  error: unknown,
  opts: { allowAfterWrite?: boolean } = {},
): SurplusPreWriteFailOpenReason | null {
  if (hooks.noFallback) return null;
  let files: number;
  try { files = hooks.userFilesWritten(); } catch { return null; }
  if (!shouldFailOpenSurplusPreWrite({ userFilesWritten: files, error, alreadyDropped: hooks.state.dropped, allowAfterWrite: opts.allowAfterWrite })) {
    return null;
  }
  hooks.state.dropped = true;
  const reason: SurplusPreWriteFailOpenReason = files > 0 ? 'mid_build_after_write' : surplusPreWriteFailOpenReason(error);
  // Spike signal for the admit circuit — next builds skip Surplus during cool-down.
  try { recordSurplusMidBuildDeath(reason); } catch { /* never block fail-open */ }
  try { hooks.onFailOpen?.(reason); } catch { /* audit must never block fail-open */ }
  return reason;
}

/**
 * Wrap a Surplus TurnRunner so the first public engine failure with Files=0
 * (including sub-second LLM_CALL_FAILED→UNAVAILABLE scrub) drops Surplus and
 * retries that turn on the Weak ladder factory.
 */
export function wrapSurplusRunnerPreWriteFailOpen(
  surplus: TurnRunner,
  weakFactory: () => TurnRunner,
  hooks: SurplusPreWriteFailOpenHooks,
): TurnRunner {
  let weak: TurnRunner | undefined;
  const getWeak = (): TurnRunner => {
    if (!weak) weak = weakFactory();
    return weak;
  };
  return {
    async runTurn(params) {
      if (hooks.state.dropped) return getWeak().runTurn(params);
      try {
        const result = await surplus.runTurn(params);
        // Healthy Surplus turn clears a prior admit-circuit spike (HALF_OPEN → CLOSED).
        try { recordSurplusAdmitProbeSuccess(); } catch { /* never block the turn */ }
        return result;
      } catch (error) {
        try { hooks.onSurplusError?.(error); } catch { /* observer must never alter the turn */ }
        if (params.signal?.aborted || !tryConsumeSurplusPreWriteFailOpen(hooks, error, { allowAfterWrite: true })) throw error;
        return getWeak().runTurn(params);
      }
    },
  };
}

/** Narrow a mid-build reason to the admission SafeSurplusAdmissionReason union when recording diags. */
export function asSafeSurplusAdmissionReason(reason: SurplusPreWriteFailOpenReason): SafeSurplusAdmissionReason {
  // Mid-build tokens are intentionally NOT in the admission const array on older mains;
  // recordSurplusAdmissionDiag accepts `string` on the diag.reason field. Cast keeps call sites typed.
  return reason as unknown as SafeSurplusAdmissionReason;
}
