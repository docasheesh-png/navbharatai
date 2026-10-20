// The default wiring of the house-ad client: the real Firebase viewer and the real fetch.
// The rules live in `src/lib/houseAdClient.ts`; this file only answers "who is looking?".

import { useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';
import { resolveApiHref } from '../../lib/apiBase';
import { createHouseAdClient, type Viewer } from '../../lib/houseAdClient';
import type { HouseAdPlacement, ServedHouseAd } from '../../lib/houseAds';

/** How long the sign-in state may take to settle before we give up and draw nothing. */
const AUTH_SETTLE_MS = 4_000;

/**
 * Who is looking — asked only once the sign-in state is KNOWN.
 *   signed out        → anonymous (a visitor, shown ads)
 *   signed in         → their ID token (the server decides whether they have paid)
 *   not settled/failed → unknown (nothing is drawn)
 */
async function currentViewer(): Promise<Viewer> {
  try {
    const settled = await Promise.race([
      auth.authStateReady().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), AUTH_SETTLE_MS)),
    ]);
    if (!settled) return { kind: 'unknown' };
    const user = auth.currentUser;
    if (!user) return { kind: 'anonymous' };
    const token = await user.getIdToken();
    return token ? { kind: 'user', uid: user.uid, token } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

const client = createHouseAdClient({
  getViewer: currentViewer,
  fetchImpl: (input, init) => fetch(input, init),
  resolveHref: (path) => resolveApiHref(path, window),
});

/** The ad for one place, or null while loading and whenever there is none. Draws nothing on any doubt. */
export function useHouseAd(placement: HouseAdPlacement, enabled = true): ServedHouseAd | null {
  const [ad, setAd] = useState<ServedHouseAd | null>(null);
  useEffect(() => {
    if (!enabled) { setAd(null); return; }
    let cancelled = false;
    void client.get(placement).then((a) => { if (!cancelled) setAd(a); });
    return () => { cancelled = true; };
  }, [placement, enabled]);
  return ad;
}
