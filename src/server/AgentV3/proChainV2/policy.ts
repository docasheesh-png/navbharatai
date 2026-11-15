/**
 * PRO CHAIN V2 — who gets the new builder chain (owner 2026-11-15, t350u).
 *
 *   Surplus → Router One → Qubax → Mitrify   (ONLY these four; no GLM/KIMI tail)
 *
 * "pahle z@gmail.com par chala ke dekhenge … chal gaya, to pura navbharatai pro me sabhi public ke
 * liye on kar denge". So the chain is OFF for everybody except the owner's test profile by default,
 * and going public is ONE env change (`PRO_CHAIN_V2_PUBLIC=on`).
 *
 * Env (read per call, so a Cloud Run revision change applies without a code change):
 *   PRO_CHAIN_V2          kill switch. `off` ⇒ nobody gets v2 (not even z@). Unset/`on` ⇒ the rules below.
 *   PRO_CHAIN_V2_PUBLIC   `on` ⇒ every Weak (default Pro) build uses v2. Unset/`off` ⇒ allowlist only.
 *   PRO_CHAIN_V2_USERS    optional comma list of emails and/or verified uids that get v2. Unset ⇒ the
 *                         owner test profile from lib/zTestAccount.ts (z@gmail.com + its verified uid).
 *
 * Scope: the Weak band only (the default NavBharatAI Pro band — the only band where Surplus and Router One
 * already run). Normal/Strong/Powerful keep their own ladders untouched. PURE.
 */
import { parseEnvFlag } from '../../lib/envFlag';
import { isZTestAccount } from '../../lib/zTestAccount';

/** Neutral, admin-only provider labels (same brand rule as Router One's `ENGINE_R1`). */
export const PRO_CHAIN_V2_QUBAX_LABEL = 'ENGINE_QX';
export const PRO_CHAIN_V2_MITRIFY_LABEL = 'ENGINE_MF';
export const PRO_CHAIN_V2_SUPPLIER_LABELS: readonly string[] = [PRO_CHAIN_V2_QUBAX_LABEL, PRO_CHAIN_V2_MITRIFY_LABEL];

export function isProChainV2SupplierLabel(provider: string | null | undefined): boolean {
  const p = String(provider ?? '').trim().toUpperCase().replace(/#\d+$/, '');
  return p === PRO_CHAIN_V2_QUBAX_LABEL || p === PRO_CHAIN_V2_MITRIFY_LABEL;
}

function listEnv(raw: string | undefined): string[] {
  return String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export type ProChainV2Reason = 'kill-switch' | 'not-weak' | 'public' | 'allowlist' | 'test-profile' | 'not-listed';

/** Why (or why not) this build gets v2 — the reason rides into the build report. PURE. */
export function proChainV2Decision(
  tier: string | null | undefined,
  email: string | null | undefined,
  uid: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; reason: ProChainV2Reason } {
  if (parseEnvFlag(env.PRO_CHAIN_V2) === false) return { enabled: false, reason: 'kill-switch' };
  if (String(tier ?? '').trim().toLowerCase() !== 'weak') return { enabled: false, reason: 'not-weak' };
  if (parseEnvFlag(env.PRO_CHAIN_V2_PUBLIC) === true) return { enabled: true, reason: 'public' };
  const listed = listEnv(env.PRO_CHAIN_V2_USERS);
  if (listed.length > 0) {
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const u = typeof uid === 'string' ? uid.trim() : '';
    const hit = listed.some((x) => (e !== '' && x.toLowerCase() === e) || (u !== '' && x === u));
    return hit ? { enabled: true, reason: 'allowlist' } : { enabled: false, reason: 'not-listed' };
  }
  return isZTestAccount(email, uid) ? { enabled: true, reason: 'test-profile' } : { enabled: false, reason: 'not-listed' };
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
