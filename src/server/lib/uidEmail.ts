// The account's email for a uid — the free list holds addresses, and an API key or a published app
// carries only a uid. Best-effort and cached: a lookup that fails means "not free-listed", which is the
// safe side (a paying answer we could have waived costs pennies; a waived answer we should have charged
// is a leak). Moved here from routes/developerApi.ts (2026-10-04) so the image paths read the same one.

import * as admin from 'firebase-admin';

const emailCache = new Map<string, { email: string | null; at: number }>();
const EMAIL_CACHE_MS = 10 * 60 * 1000;

export async function emailForUid(uid: string): Promise<string | null> {
  const hit = emailCache.get(uid);
  if (hit && Date.now() - hit.at < EMAIL_CACHE_MS) return hit.email;
  let email: string | null = null;
  try {
    if (!process.env.VITEST) {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      const u = await admin.auth().getUser(uid);
      email = u.email ?? null;
    }
  } catch { email = null; }
  emailCache.set(uid, { email, at: Date.now() });
  return email;
}
