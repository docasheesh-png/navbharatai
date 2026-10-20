// Real-time USD→INR exchange rate for customer billing (always shown in INR).
//
// The billing path must NEVER block or throw on the FX source, so this keeps a CACHED
// rate that is refreshed best-effort in the background; readers (`usdInrRate()`) always
// return synchronously. On any fetch failure the last good value (or the env/default
// fallback) is kept. Default/fallback is `USD_INR_RATE` (env) or 85.

/**
 * 🔴 Q-881 — A NUMBER THAT MULTIPLIES EVERY BILL NEEDS A BOUND, WHEREVER IT ENTERS.
 *
 * Until this, the only check on the live rate was `Number.isFinite(rate) && rate > 0`. So any positive
 * number the free FX source returned — `0.5`, `5000`, a glitch, a compromised response — became the
 * multiplier on every bill on that instance until the next refresh. `usdInrRate()` is read at ~24 billing
 * sites, so "every bill" is literal.
 *
 * ⚠️ AND THE OBVIOUS FIX WOULD HAVE RE-CREATED A BUG THIS MODULE ALREADY HAD. The revenue audit of
 * 2026-09-10 found `refreshUsdInrRate` was never wired, so the rate sat FROZEN at the 85 fallback while
 * the real rate was 87-88 and every build was under-billed ~3% — silently, with nothing failing. A naive
 * "reject anything more than 5% from the last good value" band would freeze the rate again the first time
 * the rupee really moved 6%, which is the same bug wearing a safety badge. So:
 *
 *   · ABSOLUTE BAND — refuse outright. `MIN`/`MAX` are deliberately WIDE (a 2.5x move from today's ~85 is
 *     still accepted); they exist to catch the impossible, not to have an opinion about FX. A rate outside
 *     them is not a market event, it is a broken payload.
 *   · A LARGE JUMP IS HELD, NOT REFUSED. A move beyond `JUMP_FRACTION` of the last good value is accepted
 *     only when the NEXT fetch agrees with it, so one glitch never lands and a genuine move lands on the
 *     following cycle. The rate can never freeze on a real move, which is the property the 2026-09-10 bug
 *     says matters most.
 *   · EVERY REFUSAL IS LOUD. That bug was invisible for months because nothing said anything; a refusal
 *     here logs, and `usdInrRateHealth()` exposes it so a persistent one can be seen rather than inferred.
 *
 * PURE. No I/O; the caller supplies the candidate and the last good value.
 */
export const USD_INR_MIN = 30;
export const USD_INR_MAX = 300;
/** A single fetch may move the rate by at most this fraction before it needs confirming. */
export const USD_INR_JUMP_FRACTION = 0.05;

/** Is this a number that could possibly be a USD→INR rate at all? PURE. */
export function usdInrInAbsoluteBand(rate: unknown): boolean {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= USD_INR_MIN && rate <= USD_INR_MAX;
}

/** Is `candidate` within the per-fetch jump allowance of `lastGood`? PURE. */
export function usdInrIsSmallMove(candidate: number, lastGood: number): boolean {
  if (!Number.isFinite(lastGood) || lastGood <= 0) return true; // nothing to compare against yet
  return Math.abs(candidate - lastGood) / lastGood <= USD_INR_JUMP_FRACTION;
}

/**
 * Fallback rate from env, or 85.
 *
 * The env value goes through the SAME absolute band: CLAUDE.md's own warning is that an env value always
 * beats a code default, so a typo of `850` for `85` would multiply every bill by ten with nothing to catch
 * it. An out-of-band env value is refused loudly and 85 is used.
 */
function fallbackRate(): number {
  const raw = process.env.USD_INR_RATE;
  if (raw === undefined || raw === '') return 85;
  const n = Number(raw);
  if (usdInrInAbsoluteBand(n)) return n;
  console.error(`[fx] USD_INR_RATE=${JSON.stringify(raw)} is outside the plausible band [${USD_INR_MIN}, ${USD_INR_MAX}] — ignoring it and using 85. Every bill is converted at this rate, so a typo here is a pricing incident.`);
  return 85;
}

let cached = fallbackRate();
let lastUpdated = 0;
/** A candidate seen once that moved too far to accept unconfirmed; the next agreeing fetch lands it. */
let heldCandidate: number | null = null;
/** Why the last refresh did not update the rate, for `usdInrRateHealth()`. '' when the last one landed. */
let lastRefusal = '';
let refusalsInARow = 0;

/** The current USD→INR rate (synchronous; never throws). */
export function usdInrRate(): number {
  return cached;
}

/** Epoch ms of the last successful live refresh (0 if never). */
export function usdInrRateUpdatedAt(): number {
  return lastUpdated;
}

/**
 * Manually set the rate (ops override / tests).
 *
 * 🔑 THE ABSOLUTE BAND APPLIES HERE TOO — this was the SIBLING, and Q-881's row names only the fetch path.
 * A hand-typed `8500` would have been accepted exactly as a glitched payload was. The JUMP rule does NOT
 * apply: an override is a deliberate human act, and making a person confirm their own keystroke twice
 * would just teach them to call it twice. The band catches the typo; the human owns the value.
 */
export function setUsdInrRate(rate: number): void {
  if (usdInrInAbsoluteBand(rate)) {
    cached = rate;
    return;
  }
  console.error(`[fx] refusing a manual USD→INR override of ${rate} — outside the plausible band [${USD_INR_MIN}, ${USD_INR_MAX}]. The rate is unchanged at ${cached}.`);
}

/**
 * What the FX guard is currently doing — so a persistent refusal is SEEN rather than inferred.
 *
 * The 2026-09-10 revenue audit's bug was invisible for months precisely because a frozen rate looks
 * exactly like a working one from the outside. This is the handle that makes the difference visible.
 */
export function usdInrRateHealth(): { rate: number; updatedAt: number; heldCandidate: number | null; lastRefusal: string; refusalsInARow: number } {
  return { rate: cached, updatedAt: lastUpdated, heldCandidate, lastRefusal, refusalsInARow };
}

/** Convert a USD amount to INR at the current cached rate. */
export function usdToInr(usd: number): number {
  return Math.max(0, usd) * cached;
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  return res.json();
};

function accept(rate: number): void {
  cached = rate;
  lastUpdated = Date.now();
  heldCandidate = null;
  lastRefusal = '';
  refusalsInARow = 0;
}

function refuse(reason: string): void {
  lastRefusal = reason;
  refusalsInARow += 1;
  // Loud EVERY time, not once: a refusal that goes quiet after the first occurrence is how a frozen rate
  // hid for months in 2026-09. The count is in the line so a reader can see it is not a one-off.
  console.error(`[fx] refusing a USD→INR update (#${refusalsInARow} in a row): ${reason}. Billing stays at ${cached}.`);
}

/**
 * Best-effort live refresh from a free no-key FX source. Updates the cache on success;
 * on ANY failure keeps the last good value. Never throws. Returns the (possibly unchanged)
 * current rate. `fetchJson` is injectable for tests (no network).
 */
export async function refreshUsdInrRate(fetchJson: FetchJson = defaultFetchJson): Promise<number> {
  try {
    const data = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as { rates?: { INR?: unknown } };
    const rate = Number(data?.rates?.INR);
    if (!usdInrInAbsoluteBand(rate)) {
      refuse(`${JSON.stringify(data?.rates?.INR)} is outside the plausible band [${USD_INR_MIN}, ${USD_INR_MAX}]`);
      return cached;
    }
    if (usdInrIsSmallMove(rate, cached)) {
      accept(rate);
      return cached;
    }
    // A big move: land it only if an INDEPENDENT fetch agrees, so one glitch never bills anybody and a
    // real move still lands on the next cycle. "Agrees" is itself a small move, not an exact match —
    // the true rate keeps drifting between the two observations.
    if (heldCandidate !== null && usdInrIsSmallMove(rate, heldCandidate)) {
      accept(rate);
      console.warn(`[fx] USD→INR moved to ${rate} from ${heldCandidate} — a second fetch agreed, so it is now the billing rate.`);
      return cached;
    }
    heldCandidate = rate;
    refuse(`${rate} is more than ${USD_INR_JUMP_FRACTION * 100}% from the last good rate ${cached}; holding it until a second fetch agrees`);
  } catch {
    // keep last good / fallback — billing must never break on FX
  }
  return cached;
}

// Best-effort periodic refresh in production only (never under tests — no network in CI).
if (!process.env.VITEST) {
  void refreshUsdInrRate();
  const timer = setInterval(() => void refreshUsdInrRate(), 60 * 60 * 1000);
  // Don't keep the process alive just for the FX refresher.
  (timer as { unref?: () => void }).unref?.();
}
