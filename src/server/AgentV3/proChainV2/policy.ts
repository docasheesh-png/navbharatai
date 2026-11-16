/**
 * Pro Chain V2 containment: no production activation until builder-specific
 * data/spend admission and exact accounting evidence are implemented and reviewed.
 * Existing builder and chat routes remain unchanged. Flags cannot override this hold.
 */
import { parseEnvFlag } from '../../lib/envFlag';

/** Neutral, admin-only provider labels (same brand rule as Router One's `ENGINE_R1`). */
export const PRO_CHAIN_V2_QUBAX_LABEL = 'ENGINE_QX';
export const PRO_CHAIN_V2_MITRIFY_LABEL = 'ENGINE_MF';
export const PRO_CHAIN_V2_SUPPLIER_LABELS: readonly string[] = [PRO_CHAIN_V2_QUBAX_LABEL, PRO_CHAIN_V2_MITRIFY_LABEL];

export function isProChainV2SupplierLabel(provider: string | null | undefined): boolean {
  const p = String(provider ?? '').trim().toUpperCase().replace(/#\d+$/, '');
  return p === PRO_CHAIN_V2_QUBAX_LABEL || p === PRO_CHAIN_V2_MITRIFY_LABEL;
}

export type ProChainV2Reason = 'kill-switch' | 'not-weak' | 'admission-unavailable';

export function proChainV2Decision(
  tier: string | null | undefined,
  _email: string | null | undefined,
  _uid: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; reason: ProChainV2Reason } {
  if (parseEnvFlag(env.PRO_CHAIN_V2) === false) return { enabled: false, reason: 'kill-switch' };
  if (String(tier ?? '').trim().toLowerCase() !== 'weak') return { enabled: false, reason: 'not-weak' };
  return { enabled: false, reason: 'admission-unavailable' };
}

export function proChainV2EnabledFor(
  tier: string | null | undefined,
  email: string | null | undefined,
  uid: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return proChainV2Decision(tier, email, uid, env).enabled;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
}

/** Tunables, each with a safe default. PURE. */
export function proChainV2Tuning(env: NodeJS.ProcessEnv = process.env): {
  /** An agent keeps the engine that last answered for this many turns, then retries the owner's order. */
  stickyTurns: number;
  /** After this many agents of ONE build lost Surplus, NEW agents skip it for `surplusSkipMs`. */
  surplusSkipAfter: number;
  surplusSkipMs: number;
} {
  return {
    stickyTurns: positiveInt(env.PRO_CHAIN_V2_STICKY_TURNS, 4, 100),
    surplusSkipAfter: positiveInt(env.PRO_CHAIN_V2_SURPLUS_SKIP_AFTER, 3, 100),
    surplusSkipMs: positiveInt(env.PRO_CHAIN_V2_SURPLUS_SKIP_MS, 120_000, 3_600_000),
  };
}
