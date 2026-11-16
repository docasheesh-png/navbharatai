/**
 * ALWAYS-ON SUPPLIERS (owner t357u, 2026-11-16, verbatim): "mitrify aur qubax hamesa on rahe, kisi bhi
 * condition me ban nahi hona chahiye … cheaperinference - yeh bhi hamesa on rahe, ban nahi hona chahiye
 * kabhi (default on) … photo/image analysis me bhi yahi 3 lagao … user ka kabhi bhi pata na lage ki
 * provider kon hai".
 *
 * ONE place decides whether Mitrify, Qubax and CheaperInference are on, so no call site can invent
 * its own dialect. Each is ON when its switch is unset, empty or unrecognised; ONLY an explicit
 * off value (`off`, `false`, `0`, `no`, …, the shared `parseEnvFlag` set) turns one off, and that
 * is kept purely as the operator's emergency kill switch. A missing API key still skips the
 * provider: there is nothing to call without one.
 *
 * What "never banned" means in code (and what it does NOT mean):
 *   - no flag, written approval or admin-only gate decides whether these three serve a user;
 *   - a failure is never remembered across requests as a bench, a retirement or a long cooldown;
 *   - inside ONE request a failed call still falls through to the next provider (otherwise the
 *     user gets no answer at all);
 *   - the owner's shared paid budget (daily/monthly caps) still bounds total spend. That is a
 *     money ceiling the owner sets, not a ban on a provider.
 */
import { parseEnvFlag } from './envFlag';

type Env = Record<string, string | undefined>;

/** Default ON. Only an explicit off value is the kill switch. */
function defaultOn(raw: string | undefined): boolean {
  return parseEnvFlag(raw) !== false;
}

/** Qubax for Chat and image analysis. `QUBAX_ENABLED=off` (or 0/false/no) is the emergency stop. */
export function qubaxSwitchOn(env: Env = process.env): boolean {
  return defaultOn(env.QUBAX_ENABLED);
}

/** Mitrify for Chat. `MITRIFY_CHAIN_ENABLED=off` (or 0/false/no) is the emergency stop. */
export function mitrifySwitchOn(env: Env = process.env): boolean {
  return defaultOn(env.MITRIFY_CHAIN_ENABLED);
}

/**
 * Longest a failure of an always-on supplier may keep it out of later requests. A provider-side
 * 401/402/429 used to bench a rung for an hour or a day; for these three it now waits at most this
 * long, so a fixed key or a topped-up wallet is used again on the very next minute.
 */
export const ALWAYS_ON_MAX_COOLDOWN_MS = 30_000;
