// Durable auth-session persistence for the NATIVE app — ROOT-CAUSE FIX (admin 2026-07-25:
// "app band karo, background se clear karo, wapas open karo — logout hi mila tha").
//
// THE BUG CLASS THIS KILLS: `initializeAuth(app, { persistence: browserLocalPersistence })` picks the
// persistence ONCE, at module-init time, by asking each candidate `_isAvailable()`. If localStorage is
// momentarily unavailable at that exact instant inside the WebView, the Firebase SDK SILENTLY falls back
// to IN-MEMORY persistence for the entire app session. The symptom is exactly what was reported: sign-in
// works and the app behaves normally while it stays open, but the session is gone the moment the app is
// killed and relaunched — on every provider (Google/email/Apple/GitHub) and on both platforms, because
// the defect is in how the instance was initialized, not in any one sign-in flow.
//
// Crucially it also explains why EVERYTHING ELSE survived a cold restart (settings, chats, workspaces):
// our own code writes localStorage later, once storage is warm, so only the auth session — written during
// that narrow init window — was ever lost. A "localStorage is wiped" theory cannot explain that split.
//
// THE FIX IS TWO LAYERS (prevent, then heal — never one without the other):
//   1. PREVENT: give `initializeAuth` an ordered HIERARCHY of DURABLE stores instead of a single one, so
//      a transient localStorage miss falls through to IndexedDB (also durable) rather than collapsing to
//      in-memory. localStorage stays FIRST because it is synchronous and immune to the WebKit IndexedDB
//      suspension that bit the native sign-in before (see src/lib/firebase.ts).
//   2. HEAL: after a session exists, VERIFY a durable record was actually written. If it was not, the
//      instance is running in-memory — re-apply a durable persistence, which makes the Firebase SDK
//      MIGRATE the current user into it, and re-verify. This self-heals the exact failure above so the
//      next cold start finds a real session.
//
// Everything here is pure over injected deps so it is fully unit-testable without a browser or Firebase.

/** Prefix the Firebase JS SDK uses for its persisted current-user record (localStorage + IndexedDB). */
export const FIREBASE_AUTH_USER_PREFIX = 'firebase:authUser:';

/** The exact key the SDK writes for a given API key + app name. */
export function firebaseAuthUserKey(apiKey: string, appName = '[DEFAULT]'): string {
  return `${FIREBASE_AUTH_USER_PREFIX}${apiKey}:${appName}`;
}

/** Minimal storage surface we need (DI for tests). */
export interface KeyListingStorage {
  getItem(key: string): string | null;
  length?: number;
  key?(index: number): string | null;
}

/**
 * Is a Firebase auth session actually recorded in this storage? Matches on the PREFIX rather than an
 * exact key so it stays correct across app-name / API-key changes. Never throws — an unreadable storage
 * simply reports "not persisted", which routes to the repair path rather than crashing the app.
 */
export function hasPersistedSession(storage: KeyListingStorage | undefined | null): boolean {
  if (!storage) return false;
  try {
    const len = typeof storage.length === 'number' ? storage.length : 0;
    for (let i = 0; i < len; i++) {
      const k = storage.key?.(i);
      if (k && k.startsWith(FIREBASE_AUTH_USER_PREFIX) && storage.getItem(k)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type SessionPersistenceOutcome =
  /** A durable record already exists — nothing to do (the healthy path). */
  | 'already-persisted'
  /** No durable record existed; re-applying persistence migrated the session successfully. */
  | 'repaired'
  /** No durable record existed and the repair did NOT produce one — reported honestly, never faked. */
  | 'repair-failed';

export interface EnsurePersistedDeps {
  /** True when a durable auth record exists right now. */
  hasDurableSession: () => boolean;
  /**
   * Re-apply a durable persistence to the live auth instance. The Firebase SDK migrates the current
   * user into the new persistence, which is what actually writes the record.
   */
  applyDurablePersistence: () => Promise<void>;
  /** Optional structured diagnostic sink (never user-facing). */
  log?: (message: string) => void;
}

/**
 * Verify the signed-in session was durably written and, if it was not, repair it.
 *
 * Returns an HONEST outcome: a failed repair is reported as `repair-failed`, never as success — so the
 * caller (and any future diagnostic) can tell the truth about whether the session will actually survive
 * the next cold start. Never throws: a repair that blows up degrades to `repair-failed`.
 */
export async function ensureSessionPersisted(deps: EnsurePersistedDeps): Promise<SessionPersistenceOutcome> {
  if (deps.hasDurableSession()) return 'already-persisted';

  deps.log?.('[auth] no durable session record found — auth is running in-memory; repairing persistence');
  try {
    await deps.applyDurablePersistence();
  } catch (e) {
    deps.log?.(`[auth] persistence repair threw: ${(e as { message?: string })?.message || String(e)}`);
    return 'repair-failed';
  }

  if (deps.hasDurableSession()) {
    deps.log?.('[auth] persistence repaired — the session will now survive an app restart');
    return 'repaired';
  }
  deps.log?.('[auth] persistence repair did NOT produce a durable record — session will not survive a restart');
  return 'repair-failed';
}
