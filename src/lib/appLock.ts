/**
 * THE BROWSER HALF OF THE APP LOCK — one PIN, several screens, ONE unlock.
 *
 * What this file is NOT: a security check. Everything here can be bypassed by anyone who can edit the
 * page, which is why nothing here compares a PIN. It is sent, the server answers right-or-wrong and
 * nothing else, and on success hands back a short-lived ticket this module holds and spends. The rules
 * live in `server/lib/vaultPin.ts`; the ticket in `server/lib/vaultTicket.ts`.
 *
 * 🔴 TWO DECISIONS HERE ARE LOAD-BEARING, and both exist because the lock now covers SIX screens instead
 * of one.
 *
 * 1. **THE UNLOCK IS MODULE-LEVEL, NOT PER-COMPONENT.** If each gate held its own ticket, a user who
 *    locked Settings and Billing would type their PIN on every screen they opened — and the 5-minute
 *    ticket is per USER, not per screen, so that would be friction buying nothing. One store, every gate
 *    subscribes, one PIN entry opens everything until it lapses.
 *
 * 2. **THE STATUS IS FETCHED ONCE AND SHARED.** Six gates mounting would otherwise make six identical
 *    requests on the first render of the app. One in-flight promise, one cached answer, invalidated when
 *    the settings change.
 *
 * 🔒 WHAT HAPPENS WHEN THE STATUS REQUEST FAILS, stated plainly because it is a real trade and not an
 * oversight. A gate falls back to the last answer THIS DEVICE received, and with no cached answer at all
 * it renders the screen. The alternative — failing closed — would lock a user out of Settings over a
 * dropped request, which breaks the app for the many people who never switched any of this on, to deter
 * an attacker who can already open devtools. The ONE exception is `api_keys`, which never renders without
 * a real unlock, because there the server refuses to decrypt anyway: that lock does not depend on this
 * file being honest, and so it is the only one that is more than a screen lock.
 */
import { authHeaders } from './authedFetch';
import { effectiveLockedAreas, normaliseLockedAreas, type AppLockArea } from './appLockAreas';

/** The header the server reads the unlock ticket from. Must match `UNLOCK_TICKET_HEADER` server-side. */
export const UNLOCK_TICKET_HEADER = 'x-vault-unlock';

/** How the lock was opened. One value — the ticket exists so this can change without callers doing. */
export type UnlockMethod = 'pin';

export interface UnlockState {
  ticket: string;
  method: UnlockMethod;
  /** Epoch ms after which the ticket is dead and every gate must re-lock. */
  expiresAt: number;
}

/** Where a verification code can go for this account. `none` is honest, not an error. */
export type OtpChannel = 'email' | 'fresh-sign-in' | 'none';

export interface AppLockStatus {
  hasPin: boolean;
  locked: boolean;
  lockedForMs: number;
  attemptsLeft: number;
  maxAttempts: number;
  channel: OtpChannel;
  /** Masked destination, e.g. `aa•••@gmail.com` — enough to recognise, not enough to disclose. */
  destination: string;
  resendInMs: number;
  codePending: boolean;
  /** Exactly what the user ticked — what the Settings list renders. */
  areas: AppLockArea[];
  /** What is in force once containment is applied — what the GATES read. */
  effectiveAreas: AppLockArea[];
}

export type VaultError = Error & {
  status?: number;
  /** The account has no email, so the code path is a fresh sign-in instead. */
  needsFreshSignIn?: boolean;
  /** There is no PIN yet — the screen must offer setup rather than an unlock field. */
  needsSetup?: boolean;
  /** The ticket lapsed mid-action: the lock has closed, and the screen should say so by re-locking. */
  needsUnlock?: boolean;
  /** Milliseconds of lock-out remaining, when the server refused for that reason. */
  lockedForMs?: number;
  attemptsLeft?: number;
};

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...(await authHeaders()) } });
  if (!res.ok) {
    let message = fallback;
    let extra: Record<string, unknown> = {};
    try {
      const parsed = await res.json();
      if (parsed?.error) message = String(parsed.error);
      extra = parsed ?? {};
    } catch { /* non-JSON body */ }
    const err = new Error(message) as VaultError;
    err.status = res.status;
    err.needsFreshSignIn = !!extra.needsFreshSignIn;
    err.needsSetup = !!extra.needsSetup;
    err.needsUnlock = !!extra.needsUnlock;
    if (typeof extra.lockedForMs === 'number') err.lockedForMs = extra.lockedForMs;
    if (typeof extra.attemptsLeft === 'number') err.attemptsLeft = extra.attemptsLeft;
    throw err;
  }
  return res.json() as Promise<T>;
}

const jsonBody = (method: 'POST' | 'PUT', body: unknown, ticket?: string): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(ticket ? { [UNLOCK_TICKET_HEADER]: ticket } : {}),
  },
  body: JSON.stringify(body ?? {}),
});

// ── The shared unlock, and the timer that closes it ────────────────────────────────────────────────

let unlockState: UnlockState | null = null;
let statusCache: AppLockStatus | null = null;
let statusInFlight: Promise<AppLockStatus> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one subscriber's render error must not stop the others from re-locking */
    }
  }
}

/** Subscribe to unlock/status changes. Returns the unsubscribe function. */
export function subscribeAppLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Is this unlock still good? Pure, so a screen can re-lock itself without guessing. */
export function unlockIsLive(state: UnlockState | null, nowMs: number = Date.now()): boolean {
  return !!state && typeof state.ticket === 'string' && state.ticket.length > 0 && state.expiresAt > nowMs;
}

/** The live unlock, or null. Expiry is checked on READ as well as by the timer, so a suspended tab that
 *  never fired its timeout cannot come back to a stale open lock. */
export function currentUnlock(): UnlockState | null {
  if (!unlockIsLive(unlockState)) {
    if (unlockState) { unlockState = null; }
    return null;
  }
  return unlockState;
}

export function setUnlock(state: UnlockState): void {
  unlockState = state;
  if (expiryTimer) clearTimeout(expiryTimer);
  // One timer for the whole app: when the ticket dies, every gate is told at once rather than each
  // polling its own interval.
  expiryTimer = setTimeout(() => { unlockState = null; expiryTimer = null; notify(); }, Math.max(0, state.expiresAt - Date.now()) + 50);
  notify();
}

export function clearUnlock(): void {
  unlockState = null;
  if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
  notify();
}

/** Whole seconds left on the unlock, floored at 0 — what a "re-locks in 4:31" countdown renders. */
export function secondsRemaining(state: UnlockState | null, nowMs: number = Date.now()): number {
  if (!state) return 0;
  return Math.max(0, Math.floor((state.expiresAt - nowMs) / 1000));
}

// ── Status, fetched once ───────────────────────────────────────────────────────────────────────────

/** The last answer this device received, or null if it has never had one. */
export function cachedAppLockStatus(): AppLockStatus | null {
  return statusCache;
}

function readStatus(raw: Partial<AppLockStatus> | null | undefined): AppLockStatus {
  const areas = normaliseLockedAreas(raw?.areas);
  return {
    hasPin: !!raw?.hasPin,
    locked: !!raw?.locked,
    lockedForMs: Number(raw?.lockedForMs) || 0,
    attemptsLeft: Number(raw?.attemptsLeft) || 0,
    maxAttempts: Number(raw?.maxAttempts) || 5,
    channel: (raw?.channel === 'email' || raw?.channel === 'fresh-sign-in' ? raw.channel : 'none'),
    destination: typeof raw?.destination === 'string' ? raw.destination : '',
    resendInMs: Number(raw?.resendInMs) || 0,
    codePending: !!raw?.codePending,
    areas,
    // Derived locally as well as sent by the server, so a stale client and a new server cannot disagree
    // about whether locking Wallet & Billing covers the recharge tab inside it.
    effectiveAreas: effectiveLockedAreas(raw?.effectiveAreas ?? areas),
  };
}

/** Ask the server. Shared: concurrent callers get the same in-flight request, not one each. */
export function appLockStatus(userId: string, force = false): Promise<AppLockStatus> {
  if (!force && statusCache) return Promise.resolve(statusCache);
  if (!force && statusInFlight) return statusInFlight;
  statusInFlight = call<Partial<AppLockStatus>>(`/api/app-lock/${userId}`, { method: 'GET' }, 'Could not reach your app lock. Please try again.')
    .then((raw) => {
      statusCache = readStatus(raw);
      statusInFlight = null;
      notify();
      return statusCache;
    })
    .catch((err) => {
      statusInFlight = null;
      throw err;
    });
  return statusInFlight;
}

/** Drop the cached answer, so the next gate or screen re-reads it. */
export function invalidateAppLockStatus(): void {
  statusCache = null;
  statusInFlight = null;
  notify();
}

/**
 * Reset everything this module holds.
 *
 * Called on SIGN-OUT, and it is not housekeeping: leaving one account's unlock and locked-area list in
 * memory while a different person signs in on the same device would hand them an open lock.
 */
export function resetAppLock(): void {
  statusCache = null;
  statusInFlight = null;
  clearUnlock();
}

// ── The four calls a screen makes ──────────────────────────────────────────────────────────────────

/** Ask the server to email a verification code. The code itself never comes back to the browser. */
export function sendPinCode(userId: string, purpose: 'create' | 'reset'): Promise<{ sent: boolean; destination: string; resendInMs: number }> {
  return call(`/api/app-lock/${userId}/otp`, jsonBody('POST', { purpose }), 'Could not send your code. Please try again.');
}

/**
 * Set the PIN — used for both the first setup and a reset after "Forgot PIN".
 *
 * One call for both, because both need the same proof; a separate reset path would be a second place for
 * that requirement to weaken. Returns a live unlock, so the user lands inside what they were opening.
 */
export async function setPin(userId: string, pin: string, otp: string): Promise<UnlockState> {
  const out = await call<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/app-lock/${userId}/pin`,
    jsonBody('POST', { pin, otp }),
    'Could not save your PIN. Please try again.',
  );
  const state = { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs };
  setUnlock(state);
  invalidateAppLockStatus();
  return state;
}

/** Open the lock with the PIN. The comparison happens on the server; this only carries the answer. */
export async function unlockWithPin(userId: string, pin: string): Promise<UnlockState> {
  const out = await call<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/app-lock/${userId}/unlock`,
    jsonBody('POST', { pin }),
    'Could not open your app lock. Please try again.',
  );
  const state = { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs };
  setUnlock(state);
  return state;
}

/**
 * Save which areas the PIN guards.
 *
 * Requires a live unlock, and the server requires it too — a lock somebody can switch off without the
 * PIN is a preference, not a lock.
 */
export async function saveLockedAreas(userId: string, areas: AppLockArea[]): Promise<AppLockArea[]> {
  const unlock = currentUnlock();
  if (!unlock) {
    const err = new Error('Enter your PIN to change what is locked.') as VaultError;
    err.needsUnlock = true;
    throw err;
  }
  const out = await call<{ areas: AppLockArea[] }>(
    `/api/app-lock/${userId}/areas`,
    jsonBody('PUT', { areas }, unlock.ticket),
    'Could not save your app lock settings. Please try again.',
  );
  const saved = normaliseLockedAreas(out.areas);
  if (statusCache) {
    statusCache = { ...statusCache, areas: saved, effectiveAreas: effectiveLockedAreas(saved) };
    notify();
  }
  return saved;
}

// ── Small pure helpers the screens share ───────────────────────────────────────────────────────────

/** Exactly four digits, checked here only so the keypad can enable its button — never as the security. */
export function looksLikePin(pin: string): boolean {
  return /^\d{4}$/.test(String(pin ?? ''));
}

/** A whole-minutes countdown for a lock-out, so a screen says "in 14 minutes" rather than milliseconds. */
export function lockoutMinutes(lockedForMs: number): number {
  return Math.max(1, Math.ceil((Number(lockedForMs) || 0) / 60_000));
}

/**
 * Should this area be shown behind the PIN right now?
 *
 * The one decision every gate asks, in one place. `null` status means "we have not been told yet" — and
 * the answer then depends on the area, which is the trade documented at the top of this file: a screen
 * renders, `api_keys` does not.
 */
export function shouldGate(area: AppLockArea, status: AppLockStatus | null): boolean {
  if (!status) return area === 'api_keys';
  if (!status.hasPin) {
    // No PIN exists yet. The keys screen still has to collect one (the server will not decrypt without a
    // ticket either way); an optional area cannot be locked by a PIN that does not exist.
    return area === 'api_keys';
  }
  return status.effectiveAreas.includes(area);
}
