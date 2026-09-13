// THE BROWSER HALF OF THE VAULT'S PIN LOCK (admin 2026-09-13: *"bas PIN banao, mobile number/email otp
// se PIN banao, PIN (4 digit pin se hi open ho) … waaki sab hata do, simple rahne do"*).
//
// What this file is NOT: a security check. Everything here can be bypassed by anyone who can edit the
// page, which is why nothing here decides whether the vault opens — and in particular, the PIN is never
// compared in the browser. It is sent, the server answers right-or-wrong and nothing else, and on success
// hands back a short-lived ticket that this module carries on every call that reads or destroys a key.
// The decision lives in `server/lib/vaultPin.ts` and `server/lib/vaultTicket.ts`.
//
// 🔴 WHAT WAS DELETED HERE, AND WHY IT IS NOT A DOWNGRADE. This file used to run a WebAuthn ceremony —
// the phone's own face / fingerprint / PIN, which is genuinely stronger proof than four digits. It could
// not be reached from inside the app at all: WebAuthn binds a credential to an ORIGIN and the Capacitor
// shell's origin is a custom scheme. So the stronger lock was, on the platform most users hold, no lock
// at all, and its fallback used a web popup the WebView blocks. A server-verified PIN with a real
// lock-out works identically on the app, on the web and on a borrowed laptop — a slightly weaker secret
// that actually exists beats a stronger one nobody can open.

import { authHeaders } from './authedFetch';

/** The header the server reads the unlock ticket from. Must match UNLOCK_TICKET_HEADER on the server. */
export const UNLOCK_TICKET_HEADER = 'x-vault-unlock';

/** How the vault was opened. One value — the ticket exists so this can change without the callers doing. */
export type UnlockMethod = 'pin';

export interface UnlockState {
  ticket: string;
  method: UnlockMethod;
  /** Epoch ms after which the ticket is dead and the screen must re-lock itself. */
  expiresAt: number;
}

/** Where a verification code can go for this account. `none` is honest, not an error. */
export type OtpChannel = 'email' | 'fresh-sign-in' | 'none';

export interface PinStatus {
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
}

export type VaultError = Error & {
  status?: number;
  /** The account has no email, so the code path is a fresh sign-in instead. */
  needsFreshSignIn?: boolean;
  /** There is no PIN yet — the screen must offer setup rather than an unlock field. */
  needsSetup?: boolean;
  /** The ticket lapsed mid-action: the vault has re-locked, and the screen should say so by re-locking. */
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
    err.needsUnlock = res.status === 401 && !!extra.needsUnlock;
    if (typeof extra.lockedForMs === 'number') err.lockedForMs = extra.lockedForMs;
    if (typeof extra.attemptsLeft === 'number') err.attemptsLeft = extra.attemptsLeft;
    throw err;
  }
  return res.json() as Promise<T>;
}

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

/** Does this account have a PIN, is it locked out, and where would a code be sent? */
export function pinStatus(userId: string): Promise<PinStatus> {
  return call<PinStatus>(`/api/secrets/${userId}/pin`, { method: 'GET' }, 'Could not reach your vault. Please try again.');
}

/** Ask the server to email a verification code. The code itself never comes back to the browser. */
export function sendPinCode(userId: string, purpose: 'create' | 'reset'): Promise<{ sent: boolean; destination: string; resendInMs: number }> {
  return call(`/api/secrets/${userId}/pin/otp`, jsonPost({ purpose }), 'Could not send your code. Please try again.');
}

/**
 * Set the PIN — used for both the first setup and a reset after "Forgot PIN".
 *
 * One call for both, because both need the same proof; a separate reset path would be a second place for
 * that requirement to weaken. Returns a live unlock, so the user lands inside their keys rather than
 * being asked immediately for the PIN they just chose.
 */
export async function setPin(userId: string, pin: string, otp: string): Promise<UnlockState> {
  const out = await call<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/secrets/${userId}/pin`,
    jsonPost({ pin, otp }),
    'Could not save your PIN. Please try again.',
  );
  return { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs };
}

/** Open the vault with the PIN. The comparison happens on the server; this only carries the answer. */
export async function unlockWithPin(userId: string, pin: string): Promise<UnlockState> {
  const out = await call<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/secrets/${userId}/pin/unlock`,
    jsonPost({ pin }),
    'Could not open your vault. Please try again.',
  );
  return { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs };
}

export interface RevealedSecret {
  id: string;
  secret_name: string;
  secret_value: string;
  /** False when the stored value could not be decrypted — shown as such, never as an empty key. */
  readable: boolean;
  workspace_id?: string | null;
  created_at?: unknown;
}

/** Read the real values. Requires a live ticket; the server refuses otherwise. */
export async function revealSecrets(userId: string, ticket: string): Promise<RevealedSecret[]> {
  return call<RevealedSecret[]>(
    `/api/secrets/${userId}/reveal`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', [UNLOCK_TICKET_HEADER]: ticket }, body: '{}' },
    'Could not read your keys.',
  );
}

/** Delete one key for good. Requires a live ticket — deleting is destructive, so it needs the same proof. */
export async function deleteSecretLocked(userId: string, secretId: string, ticket: string): Promise<void> {
  await call<unknown>(
    `/api/secrets/${userId}/${secretId}`,
    { method: 'DELETE', headers: { [UNLOCK_TICKET_HEADER]: ticket } },
    'Could not delete the key.',
  );
}

/** Is this unlock still good? Pure, so the screen can re-lock itself on a timer without guessing. */
export function unlockIsLive(state: UnlockState | null, nowMs: number = Date.now()): boolean {
  return !!state && typeof state.ticket === 'string' && state.ticket.length > 0 && state.expiresAt > nowMs;
}

/** Whole seconds left on the unlock, floored at 0 — what the "re-locks in 4:31" countdown renders. */
export function secondsRemaining(state: UnlockState | null, nowMs: number = Date.now()): number {
  if (!state) return 0;
  return Math.max(0, Math.floor((state.expiresAt - nowMs) / 1000));
}

/** Exactly four digits, checked here only so the keypad can enable its button — never as the security. */
export function looksLikePin(pin: string): boolean {
  return /^\d{4}$/.test(String(pin ?? ''));
}

/** A whole-minutes countdown for a lock-out, so the screen says "in 14 minutes" rather than milliseconds. */
export function lockoutMinutes(lockedForMs: number): number {
  return Math.max(1, Math.ceil((Number(lockedForMs) || 0) / 60_000));
}
