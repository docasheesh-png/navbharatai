/**
 * COME BACK TO WHERE YOU WERE — reopen Publish after the GitHub round trip.
 *
 * 🔴 THE GAP THIS CLOSES (admin 2026-09-12, step 3 of their flow: *"Successful authorization के बाद
 * यूज़र को वापस NavBharatAI में redirect किया जाए"*).
 *
 * The redirect itself already worked — GitHub returns to the exact URL the app left from. What did NOT
 * survive was the user's PLACE in the app: connecting GitHub is a full page navigation, so the Publish
 * sheet is gone when they land, and a user who pressed Publish, was sent to GitHub, authorized, and
 * came back was shown the app's home screen with no sign that anything had happened. Finishing the
 * thing they asked for meant finding the three-dot menu and starting again.
 *
 * So the intent is written down before the page leaves and consumed once on the way back.
 *
 * 🔒 THREE PROPERTIES, EACH THERE FOR A REASON:
 *   • **One-shot.** Reading it removes it, so a later reload never pops a sheet nobody asked for.
 *   • **Workspace-scoped.** Coming back with a different app open must not reopen Publish over it —
 *     the same "one app's state shown for another" bug this panel has fixed twice before.
 *   • **It expires.** A marker left behind by an authorization the user abandoned must not ambush them
 *     next week. Ten minutes is far longer than an OAuth round trip and far shorter than a habit.
 *
 * Storage is injected, so every rule above is tested without a browser — and a storage that throws
 * (private windows, blocked site data) simply means no resume, never a crash on a working publish.
 */

/** The tiny slice of `Storage` this needs — so a test can pass a plain object. */
export interface IntentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PUBLISH_INTENT_KEY = 'nb_publish_after_github';

/** How long a written intent stays valid. Longer than any OAuth round trip, shorter than a habit. */
export const PUBLISH_INTENT_TTL_MS = 10 * 60 * 1000;

interface StoredIntent {
  workspaceId: string;
  at: number;
}

/**
 * Remember that this workspace was mid-publish when we sent the user to GitHub.
 *
 * Never throws: a storage that refuses to write costs the resume, and the publish itself is unharmed.
 */
export function rememberPublishIntent(store: IntentStore | null | undefined, workspaceId: string, now = Date.now()): void {
  const id = String(workspaceId ?? '').trim();
  if (!store || !id) return;
  try {
    store.setItem(PUBLISH_INTENT_KEY, JSON.stringify({ workspaceId: id, at: now } satisfies StoredIntent));
  } catch { /* no resume; never a broken publish */ }
}

/**
 * Should the Publish sheet reopen for this workspace? Consumes the intent either way.
 *
 * ⚠️ CONSUMING ON A MISMATCH IS DELIBERATE. An intent that belongs to a workspace the user is no longer
 * in is already stale — leaving it to fire when they happen to switch back would be a sheet opening
 * for a decision they made ten minutes and one app ago.
 */
export function takePublishIntent(store: IntentStore | null | undefined, workspaceId: string, now = Date.now()): boolean {
  const id = String(workspaceId ?? '').trim();
  if (!store || !id) return false;
  let raw: string | null = null;
  try { raw = store.getItem(PUBLISH_INTENT_KEY); } catch { return false; }
  if (!raw) return false;
  try { store.removeItem(PUBLISH_INTENT_KEY); } catch { /* consumed in memory regardless */ }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return false; }
  const intent = parsed as Partial<StoredIntent> | null;
  if (!intent || typeof intent.workspaceId !== 'string' || typeof intent.at !== 'number') return false;
  if (intent.workspaceId !== id) return false;
  if (!Number.isFinite(intent.at) || now - intent.at > PUBLISH_INTENT_TTL_MS || intent.at > now) return false;
  return true;
}

/** The browser's session storage, or null where it is unavailable. Session-scoped on purpose: the */
/** intent belongs to this visit, and a new tab is a new decision. */
export function browserIntentStore(): IntentStore | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch { return null; }
}
