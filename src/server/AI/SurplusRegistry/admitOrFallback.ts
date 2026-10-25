/**
 * Surplus Pro builder admission with hard timeout + fail-open to Weak/CHEAP_FLOOR.
 *
 * Product rule (owner 2026-10-25): key + AGENTV3_SURPLUS_BUILDER=on prefers Surplus, but a
 * hang / missing registry snapshot / Surplus API failure must NEVER block the existing Weak
 * ladder or leave the UI at 100% with zero reply. Review/connection gates stay removed.
 */
import { createSurplusBuildSession, SurplusBuildUnavailableError, surplusBuilderEnabled, type SurplusBuildSession } from './buildSession';

/** Bound for metadata refresh + sticky model selection before the first HTTP inference. */

/** Safe, non-secret reasons for build-report SURPLUS_* diagnostics. Never includes key material or URLs. */
export const SAFE_SURPLUS_ADMISSION_REASONS = [
  'flag_off',
  'missing_or_invalid_key',
  'admission_timeout',
  'stale_or_missing_snapshot',
  'no_eligible_90_percent_offer',
  'review_unavailable',
  'other_safe',
] as const;
export type SafeSurplusAdmissionReason = (typeof SAFE_SURPLUS_ADMISSION_REASONS)[number];

const SAFE_REASON_SET = new Set<string>(SAFE_SURPLUS_ADMISSION_REASONS);

/** Map an internal fallback/skip reason to a build-report-safe token. Never returns secrets. */
export function safeSurplusAdmissionReason(reason: string | undefined | null): SafeSurplusAdmissionReason {
  const raw = String(reason ?? '').trim();
  if (!raw) return 'other_safe';
  if (SAFE_REASON_SET.has(raw)) return raw as SafeSurplusAdmissionReason;
  // createSurplusBuildSession / adapter failures that are not already in SAFE_ADMISSION_REASONS
  if (/api key missing|invalid for live|credential/i.test(raw)) return 'missing_or_invalid_key';
  if (/timed out|admission_timeout/i.test(raw)) return 'admission_timeout';
  if (/stale_or_missing_snapshot|no observed models|metadata snapshot/i.test(raw)) return 'stale_or_missing_snapshot';
  if (/no_eligible_90_percent_offer/i.test(raw)) return 'no_eligible_90_percent_offer';
  if (/flag_off|builder is disabled/i.test(raw)) return 'flag_off';
  // Known SurplusBuildUnavailableError allowlist reasons pass through when listed above; else fold.
  const known = new Set([
    'reviewed_capability_or_exact_route_contract_missing', 'invalid_build_scope', 'weak_model_not_authorized',
    'previous_call_accounting_unavailable', 'price_objective_not_enforced', 'returned_route_identity_mismatch',
    'expired_or_replayed_dispatch', 'response_accounting_unavailable', 'invalid_workload',
    'stale_or_missing_snapshot', 'pricing_units_not_independently_verified', 'account_or_privacy_not_reviewed',
    'no_reviewed_coding_models', 'incomparable_quality_cohorts', 'no_eligible_90_percent_offer',
    'invalid_metadata_or_review', 'request_time_floor_contract_not_reviewed', 'review_unavailable',
  ]);
  if (raw === 'stale_or_missing_snapshot') return 'stale_or_missing_snapshot';
  if (raw === 'no_eligible_90_percent_offer') return 'no_eligible_90_percent_offer';
  if (raw === 'review_unavailable' || known.has(raw)) return 'review_unavailable';
  return 'other_safe';
}

export const SURPLUS_ADMISSION_TIMEOUT_MS = 20_000;

export type SurplusAdmissionOutcome =
  | { status: 'admitted'; session: SurplusBuildSession }
  | { status: 'skipped'; session: undefined; reason: 'flag_off' }
  | { status: 'fallback'; session: undefined; reason: string };

function fallbackReason(error: unknown): string {
  if (error instanceof SurplusBuildUnavailableError) return error.reason;
  if (error instanceof Error && /timed out/i.test(error.message)) return 'admission_timeout';
  return 'review_unavailable';
}

function raceAdmissionTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`surplus_admission timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Prefer Surplus when the flag is on; on any failure or hard timeout return undefined so the
 * caller can continue on Weak/CHEAP_FLOOR. Never throws for Surplus unavailability.
 */
export async function admitSurplusOrFallback(options: {
  buildId: string;
  tier: string;
  initialWorkload?: Parameters<typeof createSurplusBuildSession>[0]['initialWorkload'];
  timeoutMs?: number;
  enabled?: boolean;
  create?: typeof createSurplusBuildSession;
  now?: () => number;
  onFallback?: (reason: string) => void;
}): Promise<SurplusAdmissionOutcome> {
  const enabled = options.enabled ?? surplusBuilderEnabled();
  if (!enabled) return { status: 'skipped', session: undefined, reason: 'flag_off' };

  const create = options.create ?? createSurplusBuildSession;
  const timeoutMs = options.timeoutMs ?? SURPLUS_ADMISSION_TIMEOUT_MS;
  try {
    const session = await raceAdmissionTimeout(
      create({
        buildId: options.buildId,
        tier: options.tier,
        initialWorkload: options.initialWorkload,
        enabled: true,
        now: options.now,
      }),
      timeoutMs,
    );
    if (!session) {
      const reason = 'review_unavailable';
      options.onFallback?.(reason);
      return { status: 'fallback', session: undefined, reason };
    }
    return { status: 'admitted', session };
  } catch (error) {
    const reason = fallbackReason(error);
    options.onFallback?.(reason);
    return { status: 'fallback', session: undefined, reason };
  }
}


/** Route-facing helper: keeps control-flow branches OUT of the chat handler (TS2563 budget). */
export async function resolveProBuildSurplusAdmission(options: {
  buildId: string;
  tier: string;
  initialWorkload?: Parameters<typeof createSurplusBuildSession>[0]['initialWorkload'];
  timeoutMs?: number;
  enabled?: boolean;
  create?: typeof createSurplusBuildSession;
  now?: () => number;
  tierEngineAvailable: () => boolean;
  onFallback?: (reason: string) => void;
  onAdmitted?: (session: SurplusBuildSession) => void;
}): Promise<{ ok: true; session: SurplusBuildSession | undefined } | { ok: false; afterSurplusFallback: boolean }> {
  const admission = await admitSurplusOrFallback({
    buildId: options.buildId,
    tier: options.tier,
    initialWorkload: options.initialWorkload,
    timeoutMs: options.timeoutMs,
    enabled: options.enabled,
    create: options.create,
    now: options.now,
    onFallback: options.onFallback,
  });
  if (admission.status === 'admitted') {
    try { options.onAdmitted?.(admission.session); } catch { /* best-effort */ }
    return { ok: true, session: admission.session };
  }
  const afterSurplusFallback = admission.status === 'fallback';
  if (!options.tierEngineAvailable()) return { ok: false, afterSurplusFallback };
  return { ok: true, session: undefined };
}
