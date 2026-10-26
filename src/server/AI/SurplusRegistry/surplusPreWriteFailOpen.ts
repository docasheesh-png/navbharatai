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
 * - Night A/B (prod 04948 / #3964 live): SURPLUS_ADMITTED → scope LLM_CALL_FAILED
 *   (unwrapped session.runner) → AgentRunner soft-returns BUILD_ERROR / engine-
 *   unavailable with Files=starter and **SURPLUS_FALLBACK ABSENT**. The throw-only
 *   wrap never saw the scrub path: AgentRunner catches PublicBuildEngineError and
 *   returns `{ok:false, summary}` instead of rethrowing through the wrap.
 *
 * Scope: fail-open on ANY Surplus public build-engine failure before the first
 * model-authored write — thrown OR soft-scrubbed — not timeout-only. Stop /
 * maintenance / budget still propagate (never restart those on Weak).
 *
 * Same product spirit as admission: continue on the Weak/CHEAP_FLOOR ladder.
 * Messaging honesty (#3959) and user-facing "high demand" copy (#3956) are separate;
 * this module recovers the build.
 */
import {
  PublicBuildEngineError,
  PUBLIC_BUILD_ENGINE_UNAVAILABLE,
  PUBLIC_BUILD_ENGINE_TIMEOUT,
} from '../../lib/buildEngineError';
import type { TurnRunner } from '../../AgentV3/ClaudeClient';
import { SurplusBuildTransportError } from './transport';
import {
  SAFE_SURPLUS_ADMISSION_REASONS,
  type SafeSurplusAdmissionReason,
} from './admitOrFallback';

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

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return '';
}

/**
 * Public engine-unavailable / timeout text — covers thrown PublicBuildEngineError
 * messages AND AgentRunner soft-scrub summaries (`Error: The build engine…`).
 */
export function isPublicBuildEngineUnavailableText(text: string | undefined | null): boolean {
  if (!text || typeof text !== 'string') return false;
  if (text.includes(PUBLIC_BUILD_ENGINE_UNAVAILABLE)) return true;
  if (text.includes(PUBLIC_BUILD_ENGINE_TIMEOUT)) return true;
  if (/build engine is temporarily unavailable/i.test(text)) return true;
  if (/The build step timed out\./i.test(text)) return true;
  return false;
}

/**
 * Map a Surplus mid-build failure to a build-report-safe reason. Never returns
 * upstream text, URLs, or provider identity.
 */
export function surplusPreWriteFailOpenReason(error: unknown): SurplusPreWriteFailOpenReason {
  if (error instanceof SurplusBuildTransportError) return 'mid_build_transport';
  const msg = errorMessage(error);
  // Match main's UNAVAILABLE string and #3959's timeout wording without requiring that PR.
  if (/timed out|timeout/i.test(msg)) return 'mid_build_timeout';
  if (error instanceof PublicBuildEngineError) return 'mid_build_engine_unavailable';
  if (msg === PUBLIC_BUILD_ENGINE_UNAVAILABLE || isPublicBuildEngineUnavailableText(msg)) {
    return 'mid_build_engine_unavailable';
  }
  return 'mid_build_engine_unavailable';
}

/** Is this the public Surplus/engine boundary error (not stop/budget/maintenance)?
 * Covers the immediate LLM_CALL_FAILED→UNAVAILABLE scrub (bench A) as well as
 * timeout / transport / terminal_fold — SurplusTurnRunner folds all of those to
 * PublicBuildEngineError before they leave runTurn. Also accepts duck-typed
 * DISCOUNT_BUILD_UNAVAILABLE (bundle instanceof miss) and plain summary strings
 * from AgentRunner's soft-return scrub path (night A/B).
 */
export function isSurplusPublicBuildEngineFailure(error: unknown): boolean {
  if (error instanceof PublicBuildEngineError) return true;
  if (error instanceof SurplusBuildTransportError) return true;
  // Duck-type SurplusBuildUnavailableError when instanceof fails across bundles.
  if (error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'DISCOUNT_BUILD_UNAVAILABLE') {
    return true;
  }
  const msg = errorMessage(error);
  if (!msg) return false;
  if (msg === PUBLIC_BUILD_ENGINE_UNAVAILABLE) return true;
  if (msg === PUBLIC_BUILD_ENGINE_TIMEOUT) return true;
  if (/^The build step timed out\./.test(msg)) return true;
  if (isPublicBuildEngineUnavailableText(msg)) return true;
  return false;
}

/**
 * Fail-open when Surplus died for ANY public-engine reason before any user code
 * was written (LLM_CALL_FAILED scrub, transport, timeout, soft AgentRunner
 * summary, …). Once the model has authored files, do not restart on Weak mid-build.
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
 * Mark Surplus dropped + fire onFailOpen when Files=0 and the failure is a public
 * engine fold. Used by the throw wrap AND by non-throw scrub callers (early scope
 * LLM_CALL_FAILED, AgentRunner soft `{ok:false}` summary). Returns the reason when
 * consumed, else null.
 */
export function tryConsumeSurplusPreWriteFailOpen(
  hooks: SurplusPreWriteFailOpenHooks,
  error: unknown,
): SurplusPreWriteFailOpenReason | null {
  let files = 0;
  try { files = hooks.userFilesWritten(); } catch { files = 0; }
  if (!shouldFailOpenSurplusPreWrite({ userFilesWritten: files, error, alreadyDropped: hooks.state.dropped })) {
    return null;
  }
  hooks.state.dropped = true;
  const reason = surplusPreWriteFailOpenReason(error);
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
        return await surplus.runTurn(params);
      } catch (error) {
        if (!tryConsumeSurplusPreWriteFailOpen(hooks, error)) throw error;
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
