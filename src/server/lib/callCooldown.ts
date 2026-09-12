/**
 * ONE per-caller cooldown, for routes that fan out to outbound requests.
 *
 * Several routes have the same problem and it is not a rate limit in the usual sense: a single call
 * can turn into several requests to somebody ELSE's server (checking a user's saved API keys, probing
 * the services they connected). The general rate limiter bounds requests per workspace; what this
 * bounds is a caller looping on a button that costs other people bandwidth.
 *
 * It was written twice before this file existed — `allowVerify` in routes/secrets.ts — and a second
 * copy is how two implementations drift until only one of them has the bug fix. One implementation,
 * two callers.
 *
 * Both edges matter, and each line below is one of them:
 *   * `has`, not `?? 0` — a caller who has NEVER called must be distinguishable from one who called at
 *     timestamp 0. Collapsing the two makes "never" look like "just now" and refuses a first request.
 *   * a REFUSED call must not extend the window, or a client retrying in a tight loop locks itself out
 *     forever.
 *   * the map must not grow without limit on an instance that stays up for weeks.
 *
 * Clearing rather than evicting the oldest entry is deliberate: this is a throttle whose worst case on
 * a flush is that a few callers get one extra turn. Tracking insertion order to evict precisely would
 * cost more than the bug it prevents.
 *
 * PURE apart from the map the caller owns and passes in.
 */

/** Bound on a cooldown map, so it can never become a memory leak. */
export const COOLDOWN_MAX_ENTRIES = 5_000;

export function allowAfterCooldown(
  state: Map<string, number>,
  key: string,
  now: number,
  cooldownMs: number,
  maxEntries: number = COOLDOWN_MAX_ENTRIES,
): boolean {
  const last = state.get(key);
  if (last !== undefined && now - last < cooldownMs) return false;
  if (state.size >= maxEntries) state.clear();
  state.set(key, now);
  return true;
}
