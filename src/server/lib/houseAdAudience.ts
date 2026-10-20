// WHO IS SHOWN A HOUSE AD — decided on the server, never in a client (admin 2026-10-20).
//
// The admin's rule, in their words: "only paid user ad free hai, login user ad free nahi hai". So a
// signed-in free account sees ads exactly like a visitor does, and the ONLY people who never do are
// the ones who have paid. "Paid" is asked of the ACCOUNT, by the same two facts the rest of the
// product already uses:
//
//   • `hasEverPaid` — real rupees spent on tokens (`accountTier.ts`'s definition: gifted balance never
//     counts, so a welcome bonus cannot make anybody look like a customer);
//   • an ACTIVE hosting plan — because the plan's own screens promise "keeps NavBharatAI ad-free for
//     you", and a plan can be bought from a gifted balance, so `hasEverPaid` alone would break that
//     promise for exactly the person who was told it.
//
// 🔒 FAIL IN THE SAFE DIRECTION. If a signed-in person's wallet cannot be read, they get NO ad. Showing
// an ad to somebody who may have paid is the wrong that costs trust; withholding one from a free user
// for a minute costs nothing. (An anonymous visitor has no wallet, so there is nothing to read.)
//
// The wallet follows `mergedInto` to the canonical wallet (`creditWalletId`), the same as every other
// reader, so a merged account is judged by the wallet that actually holds the money.

import { getServerDb, doc, getDoc } from './serverDb';
import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';
import { hostingPlanActive } from './hostingPlan';
import { creditWalletId } from './walletCreditTarget';
import { BoundedCache } from './boundedCache';

export type AdAudience = 'ads' | 'ad-free' | 'unknown';

/** PURE: the whole decision for one wallet document. */
export function audienceFromWallet(wallet: Record<string, any> | null | undefined, nowMs: number = Date.now()): 'ads' | 'ad-free' {
  if (hasEverPaid(wallet as any)) return 'ad-free';
  if (hostingPlanActive(wallet, nowMs)) return 'ad-free';
  return 'ads';
}

const AUDIENCE_TTL_MS = 2 * 60_000;
const READ_TIMEOUT_MS = 2_500;
const cache = new BoundedCache<string, 'ads' | 'ad-free'>({ maxEntries: 5000, ttlMs: AUDIENCE_TTL_MS });

export function _clearAudienceCacheForTests(): void {
  cache.clear();
}

/**
 * The audience for one request. `uid === null` is an anonymous visitor: ads. A signed-in uid is judged by
 * the wallet; any failure is `unknown`, which the caller treats as "show nothing".
 */
export async function houseAdAudience(uid: string | null, now: () => number = Date.now): Promise<AdAudience> {
  if (!uid) return 'ads';
  const hit = cache.get(uid, now());
  if (hit) return hit;
  try {
    const db = getServerDb() as any;
    if (!db) return 'unknown';
    const read = (async () => {
      const walletId = await creditWalletId(db, uid);
      const snap = await getDoc(doc(db, 'user_token_wallets', walletId));
      // No wallet document at all = an account that has never bought anything: it is a free account.
      return audienceFromWallet(snap.exists() ? (snap.data() as Record<string, any>) : null, now());
    })();
    const verdict = await Promise.race([
      read,
      new Promise<null>((r) => setTimeout(() => r(null), READ_TIMEOUT_MS)),
    ]);
    if (!verdict) return 'unknown';
    cache.set(uid, verdict, now());
    return verdict;
  } catch {
    return 'unknown';
  }
}
