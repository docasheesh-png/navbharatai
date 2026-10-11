// The account's email for a uid — the free list holds addresses, and an API key or a published app
// carries only a uid. Best-effort and cached: a lookup that fails means "not free-listed", which is the
// safe side (a paying answer we could have waived costs pennies; a waived answer we should have charged
// is a leak). Moved here from routes/developerApi.ts (2026-10-04) so the image paths read the same one.

import * as admin from 'firebase-admin';
import { grantEmail, type GrantEmail } from '../AgentV3/featureFlag';
import { BoundedCache } from './boundedCache';

// 🔒 Only a provider-VERIFIED address is returned (Q-624): this lookup exists to match the free list, and an
// unverified address is a claim anyone could have registered.

const EMAIL_CACHE_MS = 10 * 60 * 1000;
// Bounded (audit 2026-10-11): one entry per uid ever seen used to stay for the life of the instance.
const emailCache = new BoundedCache<string, { email: GrantEmail | null; at: number }>({ maxEntries: 20_000, ttlMs: EMAIL_CACHE_MS });

export async function emailForUid(uid: string): Promise<GrantEmail | null> {
  const hit = emailCache.get(uid);
  if (hit && Date.now() - hit.at < EMAIL_CACHE_MS) return hit.email;
  let email: GrantEmail | null = null;
  try {
    if (!process.env.VITEST) {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      const u = await admin.auth().getUser(uid);
      email = grantEmail(u.email, u.emailVerified);
    }
  } catch { email = null; }
  emailCache.set(uid, { email, at: Date.now() });
  return email;
}
