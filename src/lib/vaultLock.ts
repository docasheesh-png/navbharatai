// THE BROWSER HALF OF THE VAULT'S DEVICE LOCK (admin 2026-09-12).
//
// What this file is NOT: a security check. Everything here can be bypassed by anyone who can edit the
// page, which is why nothing here decides whether the vault opens. Its job is to collect a proof the
// SERVER can verify — a signature from the device's secure hardware, or a genuinely fresh sign-in — and
// to carry the resulting ticket on every call that reads or destroys a key. The decision lives in
// `server/lib/deviceUnlock.ts`.
//
// WHY WebAuthn RATHER THAN A PLUGIN. The admin asked for "phone lock / face lock / pin". A biometric
// plugin can show that prompt, but a plugin's answer is a boolean inside the app — trivially faked and
// worthless to the server. A WebAuthn platform authenticator produces a signature over OUR challenge,
// made by a private key the device releases only after the same face / fingerprint / PIN check. Same
// prompt, real proof.

import { authHeaders } from './authedFetch';

/** The header the server reads the unlock ticket from. Must match UNLOCK_TICKET_HEADER on the server. */
export const UNLOCK_TICKET_HEADER = 'x-vault-unlock';

export type UnlockMethod = 'device-lock' | 'account-reauth';

export interface UnlockState {
  ticket: string;
  method: UnlockMethod;
  /** Epoch ms after which the ticket is dead and the screen must re-lock itself. */
  expiresAt: number;
}

export interface LockStatus {
  challenge: string;
  credentialIds: string[];
  hasDeviceLock: boolean;
}

/**
 * Can this browser offer a device lock at all?
 *
 * Checked rather than assumed, because the answer decides which door the user is shown FIRST. A desktop
 * with no Hello, an older Android WebView, or a browser with WebAuthn disabled all land here — and for
 * them the account-password path is not a downgrade, it is the only honest option. Treating it as an
 * error would lock someone out of their own keys, which is a worse failure than a weaker prompt.
 */
export async function deviceLockAvailable(): Promise<boolean> {
  try {
    const w = window as unknown as {
      PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> };
      isSecureContext?: boolean;
    };
    if (!w.isSecureContext) return false; // WebAuthn needs https; http would fail mid-ceremony instead
    if (!navigator.credentials || !w.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return await w.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ── byte/base64url plumbing (the browser APIs speak ArrayBuffer, the wire speaks base64url) ─────────

export function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function post<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let message = fallback;
    let needsReauth = false;
    try {
      const parsed = await res.json();
      if (parsed?.error) message = String(parsed.error);
      needsReauth = !!parsed?.needsReauth;
    } catch { /* non-JSON body */ }
    const err = new Error(message) as Error & { needsReauth?: boolean; status?: number };
    err.needsReauth = needsReauth;
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Ask the server for a challenge and whether this account already has a device registered. */
export function lockStatus(userId: string): Promise<LockStatus> {
  return post<LockStatus>(`/api/secrets/${userId}/lock/challenge`, {}, 'Could not reach your vault. Please try again.');
}

/**
 * Register this device's lock. Shows the OS prompt once, then the device can open the vault by itself.
 *
 * `residentKey: 'discouraged'` and a named allow-list on unlock keep this a SECOND factor for an
 * already-signed-in account rather than a passwordless login — the account sign-in is unchanged, and
 * this feature cannot become a new way in.
 */
export async function registerDeviceLock(userId: string, userLabel: string): Promise<UnlockState> {
  const { challenge } = await lockStatus(userId);
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: new TextEncoder().encode(challenge),
      rp: { name: 'NavBharatAI' },
      user: {
        id: new TextEncoder().encode(userId),
        name: userLabel || 'NavBharatAI account',
        displayName: userLabel || 'NavBharatAI account',
      },
      // ES256 then RS256 — the two the server accepts, because both verify under one code path there.
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        // The built-in lock, not a USB key: this is meant to be the phone's own face/fingerprint/PIN.
        authenticatorAttachment: 'platform',
        // 🔒 The whole point. 'required' makes the device refuse to sign unless it verified the PERSON,
        // and the server independently checks the resulting flag — so this is not a request we trust.
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 90_000,
      attestation: 'none',
    },
  })) as (PublicKeyCredential & { response: AuthenticatorAttestationResponse }) | null;

  if (!created) throw new Error('Your device did not complete the setup. Please try again.');
  const response = created.response;
  const spki = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
  if (!spki) {
    // getPublicKey() returns null for a key type we deliberately do not accept. Saying so plainly beats
    // storing something the server will refuse on every future unlock.
    throw new Error('This device\'s lock is not supported by the vault. Use your account password instead.');
  }
  const algorithm = typeof response.getPublicKeyAlgorithm === 'function' ? response.getPublicKeyAlgorithm() : -7;

  return post<{ ticket: string; expiresInMs: number }>(
    `/api/secrets/${userId}/lock/register`,
    {
      credentialId: created.id,
      publicKeySpki: toBase64url(spki),
      alg: algorithm,
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(
        typeof response.getAuthenticatorData === 'function' ? response.getAuthenticatorData() : new ArrayBuffer(0),
      ),
      label: deviceLabel(),
    },
    'Could not register this device.',
  ).then((r) => ({ ticket: r.ticket, method: 'device-lock' as const, expiresAt: Date.now() + r.expiresInMs }));
}

/** Open the vault with the device lock. Throws if the user cancels or the device refuses. */
export async function unlockWithDevice(userId: string): Promise<UnlockState> {
  const status = await lockStatus(userId);
  if (!status.hasDeviceLock) throw new Error('No device lock is set up for this account yet.');

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: new TextEncoder().encode(status.challenge),
      allowCredentials: status.credentialIds.map((id) => ({ type: 'public-key' as const, id: fromBase64url(id) })),
      userVerification: 'required',
      timeout: 90_000,
    },
  })) as (PublicKeyCredential & { response: AuthenticatorAssertionResponse }) | null;

  if (!assertion) throw new Error('Your device did not confirm it is you. Please try again.');
  const r = assertion.response;
  const out = await post<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/secrets/${userId}/unlock`,
    {
      mode: 'device',
      credentialId: assertion.id,
      clientDataJSON: toBase64url(r.clientDataJSON),
      authenticatorData: toBase64url(r.authenticatorData),
      signature: toBase64url(r.signature),
    },
    'Could not confirm it is you.',
  );
  return { ticket: out.ticket, method: out.method, expiresAt: Date.now() + out.expiresInMs };
}

/**
 * Open the vault with a just-completed account sign-in.
 *
 * The caller re-authenticates through Firebase FIRST (which is what refreshes `auth_time` inside the ID
 * token); this only asks the server to check it. Splitting it that way keeps every Firebase credential
 * type — password, Google, phone — working without this module knowing about any of them.
 */
export async function unlockWithAccount(userId: string): Promise<UnlockState> {
  const out = await post<{ ticket: string; expiresInMs: number; method: UnlockMethod }>(
    `/api/secrets/${userId}/unlock`,
    { mode: 'account' },
    'Could not confirm your account.',
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
  const res = await fetch(`/api/secrets/${userId}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [UNLOCK_TICKET_HEADER]: ticket, ...(await authHeaders()) },
    body: '{}',
  });
  if (!res.ok) {
    let message = 'Could not read your keys.';
    try {
      const parsed = await res.json();
      if (parsed?.error) message = String(parsed.error);
    } catch { /* non-JSON */ }
    const err = new Error(message) as Error & { needsUnlock?: boolean };
    err.needsUnlock = res.status === 401;
    throw err;
  }
  return res.json();
}

/** Delete one key for good. Requires a live ticket — deleting is destructive, so it needs the same proof. */
export async function deleteSecretLocked(userId: string, secretId: string, ticket: string): Promise<void> {
  const res = await fetch(`/api/secrets/${userId}/${secretId}`, {
    method: 'DELETE',
    headers: { [UNLOCK_TICKET_HEADER]: ticket, ...(await authHeaders()) },
  });
  if (!res.ok) {
    let message = 'Could not delete the key.';
    try {
      const parsed = await res.json();
      if (parsed?.error) message = String(parsed.error);
    } catch { /* non-JSON */ }
    const err = new Error(message) as Error & { needsUnlock?: boolean };
    err.needsUnlock = res.status === 401;
    throw err;
  }
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

/** A short, non-identifying name for the registered device, so a user can tell two entries apart. */
export function deviceLabel(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const s = ua.toLowerCase();
  if (/iphone/.test(s)) return 'iPhone';
  if (/ipad/.test(s)) return 'iPad';
  if (/android/.test(s)) return 'Android phone';
  if (/mac os x|macintosh/.test(s)) return 'Mac';
  if (/windows/.test(s)) return 'Windows PC';
  if (/linux/.test(s)) return 'Linux PC';
  return 'This device';
}
