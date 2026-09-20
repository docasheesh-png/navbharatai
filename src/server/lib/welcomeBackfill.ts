// THE ₹250 WELCOME BACKFILL — for the people the retirement left with nothing.
//
// 🔴 THE GAP, and it is real rather than theoretical. On 2026-09-17 the admin retired the flat welcome
// gift outright (`giftPolicy.ts`: *"nahi welcome bonus ₹500 band karna hai! sirf refer aur verification
// wale ₹400 dene hai"*), and the referral ladder was to pay in its place. `flatWelcomeGiftAllowed()`
// returns a hardcoded `false`, so no signup has been gifted since — and `REFERRAL_REWARDS` was never
// set, so the ladder that was meant to replace it has never paid either. **Between those two dates a
// new account received ₹0 from a platform whose whole first-run experience assumes ₹250 of credit**
// (`giftPlan.ts`: *"₹250 is what funds a COMPLETE first app"*).
//
// The admin's instruction (2026-09-20, verbatim): *"woh sare user jinko welcome bonus nahi mila hai,
// unko sabhi ki 250₹ ke welcome bonus dene hai! admin penal me kuch der ke liye aisi vyabasta kar do!
// jab new app playstore par live hogi tab han, apna refral code wala system start kar denge."*
//
// So this is a BACKFILL, not a change of policy. The signup path is untouched: it still grants nothing,
// because the referral ladder is still the plan and it starts when the Play Store build is live.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔒 THE ONE THING THIS MODULE EXISTS TO GET RIGHT: never pay the same person twice.
//
// "Who has not had a welcome bonus?" has no single authoritative answer in this data, because the grant
// has been written three different ways over the project's life. So the decision reads THREE
// independent signals and refuses on ANY of them, rather than trusting whichever one looks cleanest:
//
//   1. the durable marker `payment_transactions/welcome_<uid>` — written in the SAME transaction as the
//      grant since 2026-07-12, in a separate collection precisely so it survives wallet recreation;
//   2. the wallet's own ledger, via `walletReceivedWelcome` (`accountMerge.ts`) — the "Welcome Bonus:
//      … Credited!" row `buildInitialWallet` writes;
//   3. `freeGiftedTokens` — the running lifetime total of everything ever gifted to the account.
//
// ⚠️ AND THE RESIDUAL RISK IS STATED RATHER THAN HIDDEN. None of the three is complete on its own: the
// marker post-dates the 2026-07-12 fix, the ledger is bounded (`MAX_WALLET_LEDGER_ENTRIES`) so a very
// old and very active account can have rolled its welcome row off the end, and `freeGiftedTokens` is
// newer than the oldest wallets. Together they cover every account this platform has actually written,
// but a pre-2026-07 wallet with 500+ ledger entries and no gift total could in principle read as
// "never gifted". That is why the admin route previews before it pays and reports the counts: the
// decision to spend is made against real numbers, not against this comment.
//
// 🔒 THE ₹400 LIFETIME CEILING STILL APPLIES, and deliberately so. `capSelfGift` is the admin's own
// standing ruling — *"mera (admin) ek user ke liye maximum = ₹475. isse 1 paisa jyada nahi"* — and a
// backfill that ignored it would be this session quietly overriding a rule the admin set three days
// earlier. An account that has had nothing has ₹400 of room, so the full ₹250 lands; what the cap
// changes is only the LATER case, where the referral ladder tops the same account up to ₹400 rather
// than to ₹650. If the admin wants ₹250 on top of the ladder instead, that is one constant here and a
// decision for them to make knowingly.
//
// PURE — inputs in, decision out. The caller owns Firestore, the transaction and the marker write.

import { TOKENS_PER_RUPEE } from './payments';
import { parseEnvFlag } from './envFlag';
import { capSelfGift } from './giftPolicy';
import { walletReceivedWelcome } from './accountMerge';

/** The grant, in rupees. The admin named this number; it is not derived from anything. */
export const BACKFILL_RUPEES = 250;

/** The per-user idempotency marker. Same collection and shape as the welcome marker it sits beside. */
export function backfillMarkerId(userId: string): string {
  return `welcome_backfill_${String(userId ?? '').trim()}`;
}

/**
 * How many tokens one backfill grant is worth.
 *
 * A malformed or negative value falls back to ₹250 rather than to zero or to something larger — the
 * same reasoning `parseRolloutPercent` and `WALLET_OVERDRAFT_FLOOR_INR` already use in this repo: a
 * value that is present and unreadable can never be evidence of an intention to pay more.
 */
export function backfillTokens(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WELCOME_BACKFILL_TOKENS);
  if (!Number.isFinite(n) || n <= 0) return BACKFILL_RUPEES * TOKENS_PER_RUPEE;
  // Capped at the lifetime self-gift ceiling: a console value can never raise the admin's own ceiling,
  // which is the failure mode `MAX_SELF_GIFT_TOKENS` was written to prevent.
  return Math.min(Math.round(n), capSelfGift(Math.round(n), 0));
}

/**
 * Is the backfill allowed to run at all?
 *
 * ⚠️ DEFAULT IS **ON**, which is the opposite of most money flags in this repo, and the reason is the
 * second absolute rule rather than an oversight: the admin asked for this button today, and a button
 * that needs a Cloud Run key before it does anything is a button that does nothing. `WELCOME_BACKFILL=off`
 * is the instant, no-deploy stop. The real protections are that it pays each account at most once, is
 * capped, and refuses to move money without an explicit confirmation from the caller.
 */
export function backfillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag((env.WELCOME_BACKFILL || '').trim().toLowerCase()) !== false;
}

export type BackfillReason =
  | 'owed'                // never gifted, and there is room — pay
  | 'already-backfilled'  // this sweep has already paid this account
  | 'already-welcomed'    // the account had a welcome gift by one of the three signals
  | 'no-room'             // at or above the ₹400 lifetime self-gift ceiling
  | 'no-wallet'           // no wallet doc — nothing to credit, and we never create one here
  | 'disabled';           // WELCOME_BACKFILL=off

export interface BackfillDecision {
  tokens: number;
  reason: BackfillReason;
}

export interface BackfillInput {
  /** The wallet doc, or null when it does not exist. */
  wallet: Record<string, unknown> | null | undefined;
  /** Does `payment_transactions/welcome_<uid>` exist? */
  welcomeMarker: boolean;
  /** Does `payment_transactions/welcome_backfill_<uid>` exist? */
  backfillMarker: boolean;
  env?: NodeJS.ProcessEnv;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * What this one account is owed.
 *
 * Every refusal is a NAMED reason rather than a bare zero, because the admin's preview is built from
 * these counts and "skipped" with no breakdown is exactly the unaccountable number this repo's money
 * rules forbid.
 */
export function decideBackfill(input: BackfillInput): BackfillDecision {
  const env = input.env ?? process.env;
  if (!backfillEnabled(env)) return { tokens: 0, reason: 'disabled' };
  // Checked FIRST, before any wallet reasoning: a paid account must read as paid even if its wallet
  // has since been altered, and this marker is the only signal written by this feature itself.
  if (input.backfillMarker) return { tokens: 0, reason: 'already-backfilled' };
  if (!input.wallet) return { tokens: 0, reason: 'no-wallet' };

  // The three independent "has this person already been gifted?" signals. ANY of them refuses.
  if (input.welcomeMarker) return { tokens: 0, reason: 'already-welcomed' };
  if (walletReceivedWelcome(input.wallet)) return { tokens: 0, reason: 'already-welcomed' };
  if (num(input.wallet.freeGiftedTokens) > 0) return { tokens: 0, reason: 'already-welcomed' };

  // Defence in depth rather than arithmetic: reaching here means `freeGiftedTokens` is 0, so the cap
  // cannot bite today. It stays because it is the admin's ceiling, and a later edit that relaxes the
  // signal above must not silently also relax the ceiling.
  const tokens = capSelfGift(backfillTokens(env), input.wallet.freeGiftedTokens);
  return tokens > 0 ? { tokens, reason: 'owed' } : { tokens: 0, reason: 'no-room' };
}

/** Rupees for a token figure, for the admin's own reading. */
export function backfillRupees(tokens: number): number {
  return (Number(tokens) || 0) / TOKENS_PER_RUPEE;
}

/** What the wallet ledger row says. Worded as the user will read it in their own statement. */
export function backfillLedgerDescription(tokens: number): string {
  const rupees = backfillRupees(tokens);
  return `Welcome Bonus: ₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })} credited`;
}

export interface BackfillTally {
  scanned: number;
  owed: number;
  owedTokens: number;
  alreadyWelcomed: number;
  alreadyBackfilled: number;
  noRoom: number;
  noWallet: number;
}

export function emptyTally(): BackfillTally {
  return { scanned: 0, owed: 0, owedTokens: 0, alreadyWelcomed: 0, alreadyBackfilled: 0, noRoom: 0, noWallet: 0 };
}

/** Fold one decision into the running tally. Pure, so the admin's counts are unit-tested. */
export function tally(t: BackfillTally, d: BackfillDecision): BackfillTally {
  const next: BackfillTally = { ...t, scanned: t.scanned + 1 };
  switch (d.reason) {
    case 'owed':
      next.owed += 1;
      next.owedTokens += d.tokens;
      break;
    case 'already-welcomed': next.alreadyWelcomed += 1; break;
    case 'already-backfilled': next.alreadyBackfilled += 1; break;
    case 'no-room': next.noRoom += 1; break;
    case 'no-wallet': next.noWallet += 1; break;
    case 'disabled': break;
  }
  return next;
}
