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
 * Scope: fail-open on ANY Surplus public build-engine failure before the first
 * model-authored write — not timeout-only. Stop / maintenance / budget still
 * propagate (never restart those on Weak).
 *
 * Same product spirit as admission: continue on the Weak/CHEAP_FLOOR ladder.
 * Messaging honesty (#3959) and user-facing "high demand" copy (#3956) are separate;
 * this module recovers the build.
 */
import { PublicBuildEngineError, PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';
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
  if (typeof msg === 'string' && msg === PUBLIC_BUILD_ENGINE_UNAVAILABLE) return 'mid_build_engine_unavailable';
  return 'mid_build_engine_unavailable';
}

/** Is this the public Surplus/engine boundary error (not stop/budget/maintenance)?
 * Covers the immediate LLM_CALL_FAILED→UNAVAILABLE scrub (bench A) as well as
 * timeout / transport / terminal_fold — SurplusTurnRunner folds all of those to
 * PublicBuildEngineError before they leave runTurn.
 */
export function isSurplusPublicBuildEngineFailure(error: unknown): boolean {
  if (error instanceof PublicBuildEngineError) return true;
  if (error instanceof Error && error.message === PUBLIC_BUILD_ENGINE_UNAVAILABLE) return true;
  // #3959 may land first — accept its timeout message without importing a symbol that may not exist yet.
  if (error instanceof Error && /^The build step timed out\./.test(error.message)) return true;
  return false;
}

/**
 * Fail-open when Surplus died for ANY public-engine reason before any user code
 * was written (LLM_CALL_FAILED scrub, transport, timeout, …). Once the model has
 * authored files, do not restart on Weak mid-build.
 */
export function shouldFailOpenSurplusPreWrite(opts: {
  userFilesWritten: number;
  error: unknown;
  alreadyDropped?: boolean;
}): boolean {
  if (opts.alreadyDropped) return false;
  if (!Number.isFinite(opts.userFilesWritten) || opts.userFilesWritten > 0) return false;
  return isSurplusPublicBuildEngineFailure(opts.error);
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
        let files = 0;
        try { files = hooks.userFilesWritten(); } catch { files = 0; }
        if (!shouldFailOpenSurplusPreWrite({ userFilesWritten: files, error, alreadyDropped: hooks.state.dropped })) {
          throw error;
        }
        hooks.state.dropped = true;
        const reason = surplusPreWriteFailOpenReason(error);
        // Spike signal for the admit circuit — next builds skip Surplus during cool-down.
        try { recordSurplusMidBuildDeath(reason); } catch { /* never block fail-open */ }
        try { hooks.onFailOpen?.(reason); } catch { /* audit must never block fail-open */ }
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
