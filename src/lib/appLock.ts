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
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE ACCOUNT BOUNDARY — added 2026-09-20 after both halves were PROVEN to leak across users.
 *
 * Decisions 1 and 2 above are right, and they were built on an assumption nothing stated: that the
 * signed-in user never changes while this module is loaded. Module state outlives every React remount,
 * so the moment that assumption is false, ONE user's lock answers another user's questions.
 *
 * Measured, not reasoned about, before this was written:
 *   - `appLockStatus('userA')` cached `{hasPin:false}`. `appLockStatus('userB')` — a different account,
 *     really `{hasPin:true, areas:['settings','billing','code_studio']}` — returned **userA's answer**
 *     and never asked the server. Every gate then read `shouldGate(area, statusA)` ⇒ false, so B's
 *     locked screens rendered WIDE OPEN with no PIN.
 *   - After `unlockWithPin('userA', …)`, `currentUnlock()` still returned A's live ticket while B was
 *     signed in, and `unlockHeaders()` put it on B's requests.
 *
 * WHY IT HAD NOT BEEN NOTICED, which is the part worth keeping: the ordinary logout survives it by
 * ACCIDENT. `performSignOut` reloads the page as its last step (`signOutFlow.ts`), and a reload wipes
 * module state — so the protection was incidental, never designed. `resetAppLock()` below says in its
 * own docstring that it is "called on SIGN-OUT" and was called from NOWHERE. And exactly one sign-out
 * skips the reload: `signInAgain()` in `AppLockGate.tsx`, the no-email account's raw `signOut(auth)`.
 *
 * THE FIX IS HERE, NOT AT THE CALL SITES, and that distinction is the whole point. Adding a
 * `resetAppLock()` to that one sign-out would have fixed the one instance and left the class: the next
 * path that changes the user without a reload re-opens it, silently, with every test still green. So
 * the state now RECORDS WHOSE IT IS, and a question asked on behalf of a different user is answered
 * `null` — by construction, in the three readers, with no call site having to remember.
 *
 * ⚠️ THIS IS NOT THE FAIL-OPEN TRADE ABOVE BEING REVERSED, and the two must not be confused. That trade
 * answers "we could not reach the server — what now?" and its answer is still to render. This answers a
 * different question: "the state I hold belongs to somebody else — is it an answer about this user?"
 * It is not an answer at all. Unknown ⇒ locked applies HERE, where nothing is being traded away: the
 * gate simply asks the server about the user who is actually signed in.
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
  /**
   * WHOSE unlock this is. The PIN that earned it belongs to one account, so the ticket does too.
   *
   * Recorded on the state rather than inferred, because the alternative — trusting that whoever asks
   * is whoever unlocked — is exactly the assumption that failed (see THE ACCOUNT BOUNDARY below).
   */
  userId: string;
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
/** Whose answer `statusCache` is. Without this the cache answers for whoever asks — see THE ACCOUNT BOUNDARY. */
let statusUserId: string | null = null;
let statusInFlight: Promise<AppLockStatus> | null = null;
/** Whose request `statusInFlight` is, so a switch mid-flight cannot be served the wrong user's response. */
let statusInFlightUserId: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/**
 * Is state held for `heldFor` an answer about `askedFor`?
 *
 * ONE predicate, used by every reader, so "the same user" can never come to mean two different things
 * in two places. A caller that does not name a user (`undefined`) is asking the old, unscoped question
 * and gets the old answer — that keeps a caller with no uid to hand working exactly as before, and the
 * SERVER is still the thing that checks a ticket against a uid.
 */
function sameAccount(heldFor: string | null, askedFor?: string): boolean {
  if (askedFor === undefined) return true;
  return heldFor === askedFor;
}

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

/**
 * The live unlock, or null.
 *
 * Expiry is checked on READ as well as by the timer, so a suspended tab that never fired its timeout
 * cannot come back to a stale open lock.
 *
 * 🔒 `forUserId` is the account boundary: a ticket earned by one account is NOT live for another, so a
 * gate rendering for user B can never be handed user A's open lock. Omitting it asks the old, unscoped
 * question — see `sameAccount`.
 */
export function currentUnlock(forUserId?: string): UnlockState | null {
  if (!unlockIsLive(unlockState)) {
    if (unlockState) { unlockState = null; }
    return null;
  }
  // Deliberately does NOT clear the ticket: the rightful owner may still be signed in in another tab,
  // and this reader's job is to answer a question, not to destroy somebody else's live unlock.
  if (!sameAccount(unlockState?.userId ?? null, forUserId)) return null;
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

/**
 * The last answer this device received, or null if it has never had one.
 *
 * 🔒 `forUserId` is the account boundary: an answer about a different account is not an answer about
 * this one, so it is reported as "not known yet" and the gate asks the server. Omitting it asks the
 * old, unscoped question — see `sameAccount`.
 */
export function cachedAppLockStatus(forUserId?: string): AppLockStatus | null {
  if (!sameAccount(statusUserId, forUserId)) return null;
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

/**
 * Ask the server. Shared: concurrent callers get the same in-flight request, not one each.
 *
 * 🔴 A DIFFERENT USER IS A HARD RESET, and it happens FIRST — before a cached answer is served, before
 * an in-flight promise is joined, before the request goes out. This is the single point every gate,
 * every row and every screen already passes through to learn the lock's state, which is what makes it
 * the right place for the boundary: the previous account's status AND its unlock are dropped by
 * construction, so no call site has to remember to do it. See THE ACCOUNT BOUNDARY at the top.
 */
export function appLockStatus(userId: string, force = false): Promise<AppLockStatus> {
  if (statusUserId !== null && statusUserId !== userId) {
    // Not `invalidateAppLockStatus()` — that keeps the unlock, which is correct when the SETTINGS
    // changed and wrong here. The user changed, so the previous user's open lock must go with it.
    resetAppLock();
  }
  if (!force && statusUserId === userId && statusCache) return Promise.resolve(statusCache);
  if (!force && statusInFlightUserId === userId && statusInFlight) return statusInFlight;
  statusInFlightUserId = userId;
  statusInFlight = call<Partial<AppLockStatus>>(`/api/app-lock/${userId}`, { method: 'GET' }, 'Could not reach your app lock. Please try again.')
    .then((raw) => {
      const answer = readStatus(raw);
      // Guard the LANDING as well as the departure: a user switch while this was in flight must not
      // install an answer about the account that has already been left.
      if (statusInFlightUserId !== userId) return answer;
      statusCache = answer;
      statusUserId = userId;
      statusInFlight = null;
      statusInFlightUserId = null;
      notify();
      return statusCache;
    })
    .catch((err) => {
      if (statusInFlightUserId === userId) { statusInFlight = null; statusInFlightUserId = null; }
      throw err;
    });
  return statusInFlight;
}

/** Drop the cached answer, so the next gate or screen re-reads it. The unlock is deliberately KEPT —
 *  this is what a settings change calls, and it must not shut a lock the user just opened. */
export function invalidateAppLockStatus(): void {
  statusCache = null;
  statusUserId = null;
  statusInFlight = null;
  statusInFlightUserId = null;
  notify();
}

/**
 * Reset everything this module holds.
 *
 * Called on SIGN-OUT, and it is not housekeeping: leaving one account's unlock and locked-area list in
 * memory while a different person signs in on the same device would hand them an open lock.
 *
 * ⚠️ THAT SENTENCE WAS A CLAIM, NOT A FACT, UNTIL 2026-09-20 — this function was exported and called
 * from NOWHERE, and the ordinary logout survived only because `performSignOut` reloads the page. It is
 * now called from two places, and the second is the one that matters: `appLockStatus` calls it whenever
 * the user it is asked about is not the user it holds state for, so the reset happens even on a path
 * that never thought to ask for it. The sign-out call site is belt and braces on top of that.
 */
export function resetAppLock(): void {
  statusCache = null;
  statusUserId = null;
  statusInFlight = null;
  statusInFlightUserId = null;
  clearUnlock();
}

// ── The five calls a screen makes ──────────────────────────────────────────────────────────────────

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
  const state = { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs, userId };
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
  const state = { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs, userId };
  setUnlock(state);
  return state;
}

/**
 * Change the PIN with the current one (admin 2026-09-17: "change lock ka bhi option dikhe").
 *
 * Needs BOTH a live unlock (this is only reachable from the opened App Lock screen) and the current PIN
 * typed now — the server compares it, and a wrong one counts exactly like a wrong unlock. Returns a
 * fresh unlock on the new PIN so the screen stays open.
 */
export async function changePin(userId: string, currentPin: string, newPin: string): Promise<UnlockState> {
  const unlock = currentUnlock(userId);
  if (!unlock) {
    const err = new Error('Enter your PIN to open App Lock before changing it.') as VaultError;
    err.needsUnlock = true;
    throw err;
  }
  const out = await call<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/app-lock/${userId}/pin/change`,
    jsonBody('POST', { currentPin, newPin }, unlock.ticket),
    'Could not change your PIN. Please try again.',
  );
  const state = { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs, userId };
  setUnlock(state);
  invalidateAppLockStatus();
  return state;
}

/**
 * Save which areas the PIN guards.
 *
 * Requires a live unlock, and the server requires it too — a lock somebody can switch off without the
 * PIN is a preference, not a lock.
 */
export async function saveLockedAreas(userId: string, areas: AppLockArea[]): Promise<AppLockArea[]> {
  const unlock = currentUnlock(userId);
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
  if (statusCache && statusUserId === userId) {
    statusCache = { ...statusCache, areas: saved, effectiveAreas: effectiveLockedAreas(saved) };
    notify();
  }
  return saved;
}

// ── Small pure helpers the screens share ───────────────────────────────────────────────────────────

/**
 * The unlock header for a call that is NOT in this module — the money routes check the same ticket.
 *
 * Returns `{}` when nothing is unlocked, so a caller spreads it unconditionally and a user with no lock
 * sends exactly the request they sent before this feature existed. The SERVER decides whether the header
 * was needed; this only makes sure a user who has already entered their PIN is not asked twice.
 */
export async function unlockHeaders(forUserId?: string): Promise<Record<string, string>> {
  const unlock = currentUnlock(forUserId);
  return unlock ? { [UNLOCK_TICKET_HEADER]: unlock.ticket } : {};
}

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
