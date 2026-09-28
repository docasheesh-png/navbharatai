// WHOSE CHATS ARE ON THIS DEVICE? — the saved chats in localStorage, bound to one account.
//
// 🔴 WHY (found 2026-09-28 while making History list this device's chats). `navbharat_sessions` holds
// the full saved chats of whoever was signed in, and NOTHING cleared or labelled it on sign-out —
// `localStorageSafe.ts` said App.tsx cleared it on sign-out, and App.tsx never did. So on a shared phone,
// account A signs out, account B signs in, and App.tsx loaded A's chats into B's session list (and its
// cloud sync then uploaded them into B's workspace). History listing this device's chats would have put
// A's conversations in front of B.
//
// The fix is an OWNER stamp beside the chats, checked at the two doors that read them: the sign-in load
// (App.tsx) and History. Another account's chats are removed the moment a different account signs in on
// this device; they are never read by, shown to, or uploaded for anyone else.
//
// Storage is injectable so the rule is tested without a browser.

export const DEVICE_SESSIONS_KEY = 'navbharat_sessions';
export const DEVICE_SESSIONS_OWNER_KEY = 'navbharat_sessions_owner';
/** The History screen's small index (lib/historyIndex.ts) — the same account's data, cleared with it. */
const HISTORY_INDEX_KEYS = ['navbharat_history_index_v1'];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStore(): Store | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * Bind this device's saved chats to the account that just signed in.
 *   'kept'    — they are already this account's.
 *   'cleared' — they belonged to ANOTHER account and were removed (with the History index).
 *   'adopted' — no owner was recorded (saved before this rule existed); the signed-in account takes them,
 *               which is what the app did with them before, on a device that is almost always one person's.
 */
export function claimDeviceSessions(uid: string, store: Store | null = browserStore()): 'kept' | 'cleared' | 'adopted' | 'unavailable' {
  if (!store || !uid) return 'unavailable';
  try {
    const owner = store.getItem(DEVICE_SESSIONS_OWNER_KEY);
    if (owner === uid) return 'kept';
    if (owner) {
      store.removeItem(DEVICE_SESSIONS_KEY);
      for (const k of HISTORY_INDEX_KEYS) store.removeItem(k);
      store.setItem(DEVICE_SESSIONS_OWNER_KEY, uid);
      return 'cleared';
    }
    store.setItem(DEVICE_SESSIONS_OWNER_KEY, uid);
    return 'adopted';
  } catch {
    return 'unavailable';
  }
}

/** This device's saved chats — ONLY when they belong to `uid`; anything else reads as none. */
export function readDeviceSessionsFor(uid: string | undefined | null, store: Store | null = browserStore()): unknown[] {
  if (!store || !uid) return [];
  try {
    if (store.getItem(DEVICE_SESSIONS_OWNER_KEY) !== uid) return [];
    const parsed = JSON.parse(store.getItem(DEVICE_SESSIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
