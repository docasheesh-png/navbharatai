// Owner (2026-10-23): each FREE image (the existing 5/day, AI_IMAGE_FREE_PER_DAY) ALSO uses one of the
// user's daily free text messages. Config: UNIFIED_WALLET_IMAGE_COUNTS_TEXT (default on, only while
// UNIFIED_WALLET_ENABLED). Best-effort: an image is never refused because the text quota is empty or busy —
// the image keeps its own allowance/price rules (imageAllowance.ts / imageHold.ts), unchanged.
import { randomUUID } from 'node:crypto';
import { FreeAnswerQuotaStore, type FreeAnswerReservation } from '../freeAnswerQuotaStore';
import { dailyAllowance, unifiedWalletConfig } from './policy';

type Env = Record<string, string | undefined>;
export function imageCountsAgainstText(env: Env = process.env): boolean {
  const cfg = unifiedWalletConfig(env);
  return cfg.enabled && env.UNIFIED_WALLET_IMAGE_COUNTS_TEXT !== '0' && env.UNIFIED_WALLET_IMAGE_COUNTS_TEXT !== 'false';
}

export interface TextSlot { settle(delivered: boolean): Promise<void> }
const NONE: TextSlot = { settle: async () => {} };

export async function takeTextSlotForFreeImage(uid: string, env: Env = process.env, store = new FreeAnswerQuotaStore(), clock: () => number = Date.now): Promise<TextSlot> {
  if (!uid || !imageCountsAgainstText(env)) return NONE;
  try {
    const cfg = unifiedWalletConfig(env);
    const r = await store.reserve({ key: `user:${uid}`, limit: dailyAllowance(cfg, { signedIn: true }) }, randomUUID(), clock());
    if (!r.allowed) return NONE;
    const res: FreeAnswerReservation = r.reservation;
    let done = false;
    return {
      settle: async (delivered) => {
        if (done) return; done = true;
        try { await store.settle(res, delivered ? 'answered' : 'provider-failed', clock()); } catch { /* retained, like chat */ }
      },
    };
  } catch { return NONE; }
}
