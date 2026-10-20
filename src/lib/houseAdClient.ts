// The client's one way to ask "is there an ad for this place?" (admin house ads, 2026-10-20).
//
// PURE of Firebase and React: the viewer and the transport are injected, so every rule below is a plain
// unit test. The default wiring (the real Firebase viewer, the real `fetch`) is in
// `components/ads/useHouseAd.ts`.
//
// 🔒 THE SERVER DECIDES WHO IS AD-FREE; THE CLIENT'S JOB IS ONLY NOT TO LIE ABOUT WHO IT IS. Two ways a
// client could lie by accident, both closed here:
//   • Asking before the sign-in state is known. A signed-in paying user whose session has not finished
//     loading would be sent as a visitor and shown an ad. `getViewer` resolves only AFTER the sign-in state
//     is settled, and a state that never settles is `unknown` — which draws nothing.
//   • A token that cannot be read for a person who IS signed in. The old shared helper falls back to a guest
//     identity there; that fallback is right for a build quota and wrong here, so a signed-in user whose
//     token fails is `unknown` too, never `anonymous`.
//
// Everything that is not a clean, well-formed answer is NO ad. The body is checked at the one place it enters
// state (`parseServedHouseAd`), so a malformed answer cannot become a half-drawn card.

import { parseServedHouseAd, type HouseAdPlacement, type ServedHouseAd } from './houseAds';

export type Viewer =
  | { kind: 'anonymous' }
  | { kind: 'user'; uid: string; token: string }
  | { kind: 'unknown' };

export interface HouseAdClientDeps {
  getViewer: () => Promise<Viewer>;
  fetchImpl: typeof fetch;
  /** Turns `/api/ads/x` into an absolute URL inside the bundled phone app (`resolveApiHref`). */
  resolveHref?: (path: string) => string;
  now?: () => number;
  timeoutMs?: number;
}

/** How long one answer is reused. Short: an admin's change and a user's first payment both show within a minute. */
export const HOUSE_AD_CLIENT_TTL_MS = 60_000;

export interface HouseAdClient {
  get(placement: HouseAdPlacement): Promise<ServedHouseAd | null>;
  clear(): void;
}

export function createHouseAdClient(deps: HouseAdClientDeps): HouseAdClient {
  const now = deps.now ?? Date.now;
  const resolve = deps.resolveHref ?? ((p: string) => p);
  const timeoutMs = deps.timeoutMs ?? 6_000;
  const cache = new Map<string, { at: number; ad: ServedHouseAd | null }>();
  const inFlight = new Map<string, Promise<ServedHouseAd | null>>();

  async function load(placement: HouseAdPlacement, viewer: Exclude<Viewer, { kind: 'unknown' }>, key: string): Promise<ServedHouseAd | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await deps.fetchImpl(resolve(`/api/ads/${placement}`), {
        headers: viewer.kind === 'user' ? { Authorization: `Bearer ${viewer.token}` } : {},
        signal: controller.signal,
      });
      if (!res.ok) return null; // a failed read is not cached: the next screen asks again
      const ad = parseServedHouseAd(await res.json().catch(() => null));
      cache.set(key, { at: now(), ad });
      return ad;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async get(placement) {
      let viewer: Viewer;
      try { viewer = await deps.getViewer(); } catch { return null; }
      if (viewer.kind === 'unknown') return null;
      const key = `${placement}|${viewer.kind === 'user' ? viewer.uid : 'anon'}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < HOUSE_AD_CLIENT_TTL_MS) return hit.ad;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const p = load(placement, viewer, key).finally(() => { inFlight.delete(key); });
      inFlight.set(key, p);
      return p;
    },
    clear() {
      cache.clear();
    },
  };
}
