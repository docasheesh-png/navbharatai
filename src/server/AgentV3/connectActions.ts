/**
 * 🔴 "CONNECT A DATABASE" WAS PROSE INSIDE A SUMMARY AND REACHED NO SURFACE — PR 2 of the tray.
 *
 * `PROGRESS.md` (2026-09-20) records PR 1 shipping and names this as the bigger half:
 *
 *   > *"The tray shows what the engine already emits. The larger category — 'connect GitHub',
 *   > 'connect a database', 'point your domain' — is still **prose inside the model's summary** and
 *   > reaches no structured surface. PR 2 derives those from facts the server already holds … at
 *   > zero model cost."*
 *
 * `userActions.ts` reserved the shape for it in as many words: *"PR 2 adds 'connect' (GitHub /
 * database / domain)"*. This is that kind, and the one fact that genuinely supports it.
 *
 * ## ⚠️ ONE OF THE THREE, AND THE OTHER TWO ARE NOT DERIVABLE TODAY (rule 6)
 *
 * The instruction was *"facts the server already holds"*. Checked one at a time rather than assumed:
 *
 * | category | the fact | verdict |
 * |---|---|---|
 * | **database** | `databaseReadiness` — the app's OWN files say it needs one, the vault says there is none | ✅ complete, tested, zero cost |
 * | **GitHub** | there is no durable per-user connection record at all; the token arrives per request (`githubTokenFromRequest`) and the build reads a CLIENT-SUPPLIED `githubConnected` hint | ❌ a row would be a guess |
 * | **domain** | `DomainLink` records that a domain is linked and stores the DNS records to add — but carries **no verified status**, so "still not pointed" needs a live DNS probe | ❌ needs I/O whose slow, propagating answer would nag a user who has already done it |
 *
 * A row derived from a client hint is a row that can tell a user to connect something they connected
 * last week. **Shipping one honest row beats shipping three, two of which are guesses** — and the
 * two gaps are named here so the next session re-opens them with the missing fact, not with a
 * heuristic.
 *
 * ## 🔒 WHY THIS CANNOT NAG
 *
 * `appNeedsDatabase` reads the app's own source for real persistence signals, and `connected` accepts
 * EITHER the provider marker OR any real credential — so a user who pasted a `DATABASE_URL` by hand
 * and never opened the Database screen is not told they have no database. Both halves already exist
 * and are already used by the readiness endpoint; this module adds no new judgement, it only carries
 * the answer to a surface the user does not have to go looking for.
 *
 * PURE: no I/O, no clock passed in, no model. Never throws.
 */

import type { UserAction } from './userActions';
import { actionKey } from './userActions';

/** The slice of `DatabaseReadiness` this needs. Structural, so the real type fits without an import cycle. */
export interface DatabaseFacts {
  needsDatabase: boolean;
  connected: boolean;
  /** True when their Supabase account is already connected, so we could create one without leaving. */
  canProvision: boolean;
}

/** The one subject string this row is keyed on. Stable, so the same ask never becomes two rows. */
export const DATABASE_SUBJECT = 'database';

/**
 * The row, or `null` when there is nothing honest to say.
 *
 * ⚠️ **`blocking` is FALSE, always.** A missing database does not stop a build — the app was built
 * and it renders. `blocking` is what makes the tray open ITSELF (`shouldAutoOpen`), and that is
 * reserved for a build genuinely stopped at a gate; using it for "do this before you publish" is
 * exactly how a user learns to dismiss the tray without reading it, which `shouldAutoOpen`'s own
 * docblock warns about.
 *
 * The WORDING follows `canProvision`, because an offer we cannot fulfil is worse than no offer: with
 * their account already connected the action is one press here, and without it the honest action is
 * to connect their own account first. ⚠️ Neither half names the PROVIDER — the row is read by
 * somebody who may never have chosen one, and the Database screen it sends them to names it there.
 */
export function databaseConnectAction(
  facts: DatabaseFacts | null | undefined,
  buildId: string,
  now: number,
): UserAction | null {
  if (!facts || !facts.needsDatabase || facts.connected) return null;
  return {
    id: actionKey('connect', DATABASE_SUBJECT),
    kind: 'connect',
    title: 'Connect a database',
    why: facts.canProvision
      ? 'Your app saves data, and no database is connected yet — so nothing it saves will survive. Your database account is already connected, so this is one press.'
      : 'Your app saves data, and no database is connected yet — so nothing it saves will survive. Connect your own database account in Settings and this is done.',
    blocking: false,
    buildId,
    status: 'open',
    createdAt: now,
  };
}

/**
 * Every connect row this build can honestly derive. A list today of at most one, and a list on
 * purpose: the two gaps above become entries here the moment their facts exist, without any caller
 * changing.
 */
export function connectActions(
  input: { database?: DatabaseFacts | null },
  buildId: string,
  now: number,
): UserAction[] {
  const rows = [databaseConnectAction(input.database, buildId, now)];
  return rows.filter((r): r is UserAction => r !== null);
}
