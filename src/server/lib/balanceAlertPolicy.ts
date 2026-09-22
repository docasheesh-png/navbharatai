// TELL THE USER BEFORE THE WALL, AND EXACTLY TWICE (admin 2026-09-22: *"banao!! dono!"*).
//
// 🔴 WHY IT DID NOT EXIST, AND WHY THAT WAS INVISIBLE. `notifyLowBalance(uid, blocked)` has shipped
// since 2026-07-26 with a `blocked: false` branch whose text reads *"Your balance is running low —
// add credits to avoid interruption."* **Nothing in this repo has ever called it with `false`.** Its
// own docblock claims it fires *"from the paid-tier affordability gate (economy or block branch)"* —
// the economy branch did not call it at all. So a paying user's first and only warning arrived at
// the moment the wall did, which is not a warning.
//
// 🔴 AND THE ONE CALL THAT EXISTED WAS UNBOUNDED. The block branch fired a push on EVERY refused
// build, so a user at ₹0 pressing Build five times was pushed five times. That is precisely the
// noise the admin ended in September (*"yeh alert to user ko bhaga dega… ek information ke liye bas
// 1 mail only. agar jyada jaruri hai, to maximum 2 — woh bhi 48hr baad"*), reproduced in a second
// subsystem that the monitor's fix never touched.
//
// 🔑 THE TRIGGER IS THE PLATFORM'S OWN VERDICT, NOT AN INVENTED NUMBER. `decideAffordability`
// already answers "is this user short of money?" — its `economy` branch means *the balance no longer
// covers this build*. Warning there is self-calibrating (someone building big apps is warned earlier
// than someone making small edits) and adds no threshold anybody has to tune or defend.
//
// 🔒 THE BUDGET IS THE ADMIN'S OWN, VERBATIM: at most **2** notices per episode, the second at least
// **48 hours** after the first, and an ESCALATION (low → blocked) SPENDS the second slot rather than
// being exempt — an exemption is how a cap quietly becomes a suggestion.
//
// 🔒 AN EPISODE ENDS ON A COOLING PERIOD, NEVER ON ONE HEALTHY READING. This is the exact bug
// `monitorAlerts.ts` records: resolving used to DELETE the state, so the cooldown was bypassed by the
// very thing it existed to survive and a wobbling value alerted on every crossing. A balance wobbles
// the same way — a small build is affordable, the next big one is not — so a healthy reading starts a
// clock rather than clearing the episode.
//
// ⚠️ IT FAILS CLOSED: a state that cannot be read sends NOTHING. The two costs are not symmetric —
// a missed warning is one notice a user does not get, while warning on an unreadable state is
// unbounded noise on every build, which is the defect being fixed.

/** What the balance is doing. `blocked` is strictly worse than `low` — it is the wall itself. */
export type BalanceAlertKind = 'low' | 'blocked';

/** The durable per-user record. Absent/unreadable ⇒ see `decideBalanceAlert`'s fail-closed rule. */
export interface BalanceAlertState {
  /** When this episode's most recent notice went out (epoch ms). */
  lastAlertAt?: number;
  /** How many notices this episode has spent. */
  sentThisEpisode?: number;
  /** The worst kind this episode has announced — so an escalation is recognisable. */
  lastKind?: BalanceAlertKind;
  /** When the balance was FIRST seen healthy again. The episode ends once this is old enough. */
  healthySince?: number;
}

export interface BalanceAlertTunables {
  /** Hours between the first notice and the second. Admin-mandated 48. */
  cooldownMs: number;
  /** Notices per episode. Admin-mandated 2. */
  maxPerEpisode: number;
  /** How long the balance must stay healthy before the episode is considered over. */
  coolingMs: number;
}

export const HOUR_MS = 60 * 60 * 1000;

/**
 * The defaults, and where each number comes from — none is invented here.
 *
 * `cooldown` 48 h and `maxPerEpisode` 2 are the admin's own words, quoted above. `cooling` is 120
 * minutes because that is already this repo's answer to "how long must a condition stay clear before
 * it counts as a new episode" (`MONITOR_ALERT_RESOLVE_AFTER_MINUTES`), and having two different
 * answers to one question is how the two subsystems drift apart again.
 */
export const BALANCE_ALERT_DEFAULTS: BalanceAlertTunables = {
  cooldownMs: 48 * HOUR_MS,
  maxPerEpisode: 2,
  coolingMs: 120 * 60 * 1000,
};

function positive(raw: unknown, fallback: number, scale: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  // A malformed value takes the DEFAULT, never "no limit" — the same rule `parseRolloutPercent` and
  // `WALLET_OVERDRAFT_FLOOR_INR` follow, and for the same reason: the unbounded direction is the bug.
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n * scale;
}

export function balanceAlertTunables(env: NodeJS.ProcessEnv = process.env): BalanceAlertTunables {
  return {
    cooldownMs: positive(env.BALANCE_ALERT_COOLDOWN_HOURS, BALANCE_ALERT_DEFAULTS.cooldownMs, HOUR_MS),
    // A cap below 1 would silence the feature entirely, which is what the master switch is for;
    // `positive` already refuses 0 and anything unreadable.
    maxPerEpisode: Math.max(1, Math.floor(positive(env.BALANCE_ALERT_MAX_PER_EPISODE, BALANCE_ALERT_DEFAULTS.maxPerEpisode, 1))),
    coolingMs: positive(env.BALANCE_ALERT_COOLING_MINUTES, BALANCE_ALERT_DEFAULTS.coolingMs, 60 * 1000),
  };
}

export type BalanceAlertReason =
  | 'first-of-episode'      // send: nothing has been said about this balance yet
  | 'escalated'             // send: it was "low", it is now the wall — and this spends a slot
  | 'cooldown'              // hold: too soon after the last notice
  | 'budget-spent'          // hold: this episode has had its 2
  | 'unknown-state';        // hold: the record could not be read — fail closed

export interface BalanceAlertDecision {
  send: boolean;
  reason: BalanceAlertReason;
  /** The state to persist when `send` is true. Absent otherwise — a hold writes nothing. */
  next?: BalanceAlertState;
}

/**
 * Should this user be told their balance is short?
 *
 * `state === null` means the record could not be read and is deliberately NOT the same as "no record
 * yet" (`{}`), which is a brand-new user and must be told.
 */
export function decideBalanceAlert(input: {
  kind: BalanceAlertKind;
  state: BalanceAlertState | null;
  now: number;
  tunables?: BalanceAlertTunables;
}): BalanceAlertDecision {
  const t = input.tunables ?? BALANCE_ALERT_DEFAULTS;
  if (input.state === null) return { send: false, reason: 'unknown-state' };

  const state = episodeAfterCooling(input.state, input.now, t);
  const sent = Number.isFinite(state.sentThisEpisode) ? Math.max(0, Math.floor(state.sentThisEpisode as number)) : 0;
  const last = Number.isFinite(state.lastAlertAt) ? (state.lastAlertAt as number) : 0;

  const next: BalanceAlertState = {
    lastAlertAt: input.now,
    sentThisEpisode: sent + 1,
    lastKind: input.kind,
    // A send means the balance is NOT healthy, so any cooling clock in flight is void.
  };

  if (sent === 0) return { send: true, reason: 'first-of-episode', next };
  if (sent >= t.maxPerEpisode) return { send: false, reason: 'budget-spent' };
  if (input.now - last < t.cooldownMs) return { send: false, reason: 'cooldown' };
  // Past the cooldown with budget left. An escalation is named as such for the record; it costs the
  // same slot either way, which is the whole point of the admin's "maximum 2".
  const escalated = input.kind === 'blocked' && state.lastKind === 'low';
  return { send: true, reason: escalated ? 'escalated' : 'first-of-episode', next };
}

/**
 * Fold a healthy observation into the state: the episode ends only once the balance has been healthy
 * for the whole cooling window. Exported so the caller can record a healthy reading without sending.
 */
export function observeHealthyBalance(state: BalanceAlertState | null, now: number): BalanceAlertState | null {
  if (state === null) return null;
  if (!state.sentThisEpisode) return state;       // nothing to clear
  if (state.healthySince) return state;           // clock already running — do not restart it
  return { ...state, healthySince: now };
}

/** The episode as it stands once a completed cooling window is applied. PURE. */
function episodeAfterCooling(state: BalanceAlertState, now: number, t: BalanceAlertTunables): BalanceAlertState {
  const healthySince = Number.isFinite(state.healthySince) ? (state.healthySince as number) : 0;
  if (!healthySince) return state;
  if (now - healthySince < t.coolingMs) return state; // still cooling — same episode
  return {}; // the episode is genuinely over; the next shortage is a new one and may speak at once
}
