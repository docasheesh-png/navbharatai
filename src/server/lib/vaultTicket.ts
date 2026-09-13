/**
 * THE SECRET VAULT'S TICKET — the one thing that makes the lock real rather than a screen.
 *
 * 🔴 WHY A TICKET EXISTS AT ALL, restated here because the reasoning survived three redesigns of the
 * door and must survive the next one.
 *
 * The obvious way to build "ask for a PIN before showing the keys" is to check the PIN in the browser
 * and render the list on success. That is THEATRE, and it is exactly the "built but not really working"
 * state the second absolute rule forbids: the values would still be one ordinary request away, so
 * anyone holding the session — a stolen unlocked laptop, a browser extension, or simply devtools —
 * reads every key without ever meeting the prompt. The lock would protect the SCREEN and leave the
 * SECRETS open.
 *
 * So the decision lives on the server. A proof is verified HERE, and only then is a short-lived ticket
 * minted. The routes that can return a decrypted value or destroy a key refuse to act without one. If
 * somebody deleted the entire unlock UI, the keys would become unreadable rather than public — which is
 * the test of whether a lock is real.
 *
 * WHAT CHANGED ON 2026-09-13, and why the WebAuthn machinery that used to live here is gone. The door
 * was a device lock (face / fingerprint / PIN via WebAuthn) with a fresh account sign-in as a fallback.
 * Both were real, and on the native app NEITHER could be reached: WebAuthn binds a credential to an
 * ORIGIN and the Capacitor shell's origin is a custom scheme, while the account fallback used the web
 * popup flow the WebView blocks. The admin, holding the phone, asked for the simple thing instead —
 * *"bas PIN banao, mobile number/email otp se PIN banao"* — so the proof is now a server-verified
 * 4-digit PIN (`vaultPin.ts`), which works identically on the app, the web and a borrowed laptop.
 *
 * This module kept its ticket unchanged through that swap, which is the point of having it: the proof
 * can be replaced without touching a single route that spends the ticket.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * 🔒 DOMAIN SEPARATION, and the reason this module does not borrow `previewDoor`'s signer.
 *
 * Both sign "a payload plus an expiry" with the same `SECRET_ENCRYPTION_KEY`, so sharing one helper
 * looks like the obvious de-duplication. It is the wrong call here: a preview-door token and a vault
 * unlock ticket would then be the same kind of string, and any future payload collision — a workspace
 * id that happens to look like a uid — would let a token minted for a PREVIEW open somebody's KEYS.
 * The label below makes that impossible by construction: a MAC computed under one label can never
 * verify under another, whatever the payload.
 */
const TICKET_LABEL = 'navbharatai.vault.ticket.v1';

/**
 * How long ONE unlock lasts.
 *
 * Five minutes is a deliberate middle: long enough to read a key, copy it and delete another without
 * re-entering the PIN on every tap, short enough that a screen left open on a shared desk closes
 * itself. The ticket is not a session — it is permission to do the next few things, and the vault
 * re-locks on its own when it lapses.
 */
export const TICKET_TTL_MS = 5 * 60 * 1000;

/**
 * Per-process fallback key, for dev and tests only.
 *
 * In production `SECRET_ENCRYPTION_KEY` is set (it is what encrypts the vault itself), so tickets verify
 * across every Cloud Run instance. Without it each instance would mint tickets only it could verify, and
 * a user would be asked to unlock again every time the load balancer moved them — which is why this is
 * a random per-process value rather than a hardcoded string: a shared constant in source would let
 * anyone with the repo forge an unlock ticket.
 */
const processSecret = randomBytes(32).toString('hex');

/** The HMAC key behind the ticket. */
export function unlockSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.SECRET_ENCRYPTION_KEY ?? '').trim() || processSecret;
}

/** Constant-time compare that never throws on a length mismatch. */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function mac(label: string, payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${label}|${payload}`).digest('hex').slice(0, 48);
}

/**
 * How the vault was opened. Recorded on the ticket so the audit trail can say which proof was given.
 *
 * One value today. It stays a union rather than becoming a bare string because the ticket's whole
 * purpose is to let the PROOF change without the spenders changing, and a second method (should one
 * ever be needed) must be impossible to confuse with the first.
 */
export type UnlockMethod = 'pin';

export function mintUnlockTicket(uid: string, nowMs: number, secret: string, method: UnlockMethod = 'pin'): string {
  const exp = nowMs + TICKET_TTL_MS;
  const payload = `${uid}|${method}|${exp}`;
  return `${method}.${exp}.${mac(TICKET_LABEL, payload, secret)}`;
}

/**
 * Verify a ticket. Returns the method when valid so the caller can record it, and `null` otherwise —
 * there is deliberately no "valid but expired" shade: to every caller, not-now is not-valid.
 */
export function verifyUnlockTicket(
  ticket: string,
  uid: string,
  nowMs: number,
  secret: string,
): { method: UnlockMethod } | null {
  const parts = String(ticket ?? '').split('.');
  if (parts.length !== 3) return null;
  const [method, expRaw, sig] = parts;
  if (method !== 'pin') return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  if (!sameSecret(sig, mac(TICKET_LABEL, `${uid}|${method}|${exp}`, secret))) return null;
  return { method };
}

/**
 * The one sentence shown when an unlock is refused for a reason the user cannot act on.
 *
 * Always the same, whatever the real cause. Specific reasons are useful to us and useful to an attacker
 * probing the endpoint, so the detail goes to the server log and the screen gets a line that helps an
 * honest user and nobody else. The PIN path is the exception and says how many tries remain — that is
 * information the owner needs and an attacker already has from the count of their own attempts.
 */
export const UNLOCK_REFUSED_MESSAGE = 'Could not open your vault. Please try again.';
