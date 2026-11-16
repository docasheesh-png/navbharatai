/** An uncertain lookup/reconnect is not evidence that a workspace needs a new machine. */
export type SandboxRecoveryRefuseReason =
  | 'identity-lookup'
  | 'identity-unavailable'
  | 'connect-unknown'
  | 'allocation-unrecorded'
  | 'allocation-lost'
  | 'winner-reconnect';

export class SandboxRecoveryUnavailableError extends Error {
  readonly code = 'SANDBOX_RECOVERY_UNAVAILABLE';
  readonly retryable = true;
  /** Admin-only classification; never part of the user-facing message. */
  readonly reason?: SandboxRecoveryRefuseReason;

  constructor(reason?: SandboxRecoveryRefuseReason) {
    super('Your workspace could not be safely reconnected. Please retry shortly.');
    this.name = 'SandboxRecoveryUnavailableError';
    if (reason) this.reason = reason;
  }
}

export function isSandboxRecoveryUnavailable(error: unknown): error is SandboxRecoveryUnavailableError {
  return error instanceof SandboxRecoveryUnavailableError;
}

export function rethrowSandboxRecoveryUnavailable(error: unknown): void {
  if (isSandboxRecoveryUnavailable(error)) throw error;
}
