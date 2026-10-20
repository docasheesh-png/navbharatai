/** An uncertain lookup/reconnect is not evidence that a workspace needs a new machine. */
export class SandboxRecoveryUnavailableError extends Error {
  readonly code = 'SANDBOX_RECOVERY_UNAVAILABLE';
  readonly retryable = true;

  constructor() {
    super('Your workspace could not be safely reconnected. Please retry shortly.');
    this.name = 'SandboxRecoveryUnavailableError';
  }
}

export function isSandboxRecoveryUnavailable(error: unknown): error is SandboxRecoveryUnavailableError {
  return error instanceof SandboxRecoveryUnavailableError;
}

export function rethrowSandboxRecoveryUnavailable(error: unknown): void {
  if (isSandboxRecoveryUnavailable(error)) throw error;
}
