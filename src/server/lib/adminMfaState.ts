/** Authoritative MFA resolution. Unavailable is NEVER equivalent to disabled. */
export interface AdminMfaState {
  available: boolean;
  enabled: boolean;
  secret: string | null;
  envManaged: boolean;
}

export const unavailableAdminMfa = (): AdminMfaState => ({
  available: false, enabled: false, secret: null, envManaged: false,
});

/** Call only after a successful authoritative read. null means a confirmed absent document. */
export function resolveAdminMfaDocument(
  data: Record<string, unknown> | null,
  decryptSecret: (encrypted: string) => string,
): AdminMfaState {
  if (data === null || data.enabled === false) {
    return { available: true, enabled: false, secret: null, envManaged: false };
  }
  // Legacy pending-only enrolment is explicitly disabled in persisted data. Unknown shapes
  // must not turn an enrolled owner's missing/corrupt state into a password-only login.
  if (data.enabled !== true || typeof data.encrypted_secret !== 'string' || !data.encrypted_secret) {
    return unavailableAdminMfa();
  }
  try {
    const secret = decryptSecret(data.encrypted_secret);
    if (typeof secret !== 'string' || !secret.trim()) return unavailableAdminMfa();
    return { available: true, enabled: true, secret, envManaged: false };
  } catch {
    return unavailableAdminMfa();
  }
}

export class AdminMfaPolicyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function requireMfaEnrollmentAllowed(data: Record<string, unknown> | null, decryptSecret: (value: string) => string): void {
  const state = resolveAdminMfaDocument(data, decryptSecret);
  if (!state.available) throw new AdminMfaPolicyError(503, 'Admin verification temporarily unavailable.');
  if (state.enabled) throw new AdminMfaPolicyError(409, 'An active authenticator cannot be replaced through enrolment.');
}

export function pendingAdminMfaSecret(data: Record<string, unknown> | null, now: number, decryptSecret: (value: string) => string): string {
  requireMfaEnrollmentAllowed(data, decryptSecret);
  if (!data || typeof data.pending_expires_at_ms !== 'number' || data.pending_expires_at_ms <= now ||
      data.pending_expires_at_ms > now + 10 * 60_000 || typeof data.encrypted_pending !== 'string' || !data.encrypted_pending) {
    throw new AdminMfaPolicyError(400, 'No current pending enrolment. Start enrolment again.');
  }
  let pending = '';
  try { pending = decryptSecret(data.encrypted_pending); } catch { /* fail closed */ }
  if (!pending || !pending.trim()) throw new AdminMfaPolicyError(503, 'Pending authenticator unavailable.');
  return pending;
}
