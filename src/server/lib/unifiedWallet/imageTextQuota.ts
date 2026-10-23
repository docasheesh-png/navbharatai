// Owner (2026-10-23): each FREE image (the existing 5/day, AI_IMAGE_FREE_PER_DAY) ALSO uses one of the
// user's daily free text messages. Own flag: UNIFIED_WALLET_IMAGE_COUNTS_TEXT (default OFF).
//
// 🔒 COUNTED ONLY AFTER DELIVERY (review fix 2026-10-23). Taking the unit before the engine ran meant every
// failure path — exception, timeout, client abort, a lease that expired during a slow image — had to give
// it back, and an expired lease cannot be refunded. Now nothing is taken until the picture was sent, so
// there is no failure path that can strand a unit. Best-effort: a full/busy text quota never blocks an image.
import { randomUUID } from 'node:crypto';
import { FreeAnswerQuotaStore } from '../freeAnswerQuotaStore';
import { signedInDailyLimit, truthy } from './policy';

type Env = Record<string, string | undefined>;
export function imageCountsAgainstText(env: Env = process.env): boolean {
  return truthy(env.UNIFIED_WALLET_IMAGE_COUNTS_TEXT);
}

/** Call once, after the image was delivered. Returns whether a text unit was used. Never throws. */
export async function countDeliveredFreeImage(uid: string, env: Env = process.env, store = new FreeAnswerQuotaStore(), clock: () => number = Date.now): Promise<boolean> {
  if (!uid || !imageCountsAgainstText(env)) return false;
  try {
    const r = await store.reserve({ key: `user:${uid}`, limit: signedInDailyLimit(env) }, randomUUID(), clock());
    if (!r.allowed) return false;
    return await store.settle(r.reservation, 'answered', clock());
  } catch { return false; }
}
