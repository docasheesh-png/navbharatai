/** An uncertain lookup/reconnect is not evidence that a workspace needs a new machine. */
export type SandboxRecoveryRefuseReason =
  | 'identity-lookup'
  | 'identity-unavailable'
  | 'connect-unknown'
  | 'allocation-unrecorded'
  | 'allocation-lost'
  | 'winner-reconnect';

// BR1995: the sentences live in src/lib so the client can recognise them; the bytes are unchanged.
import { SANDBOX_RECOVERY_FIRST_MESSAGE, SANDBOX_RECOVERY_REPEAT_MESSAGE } from '../../lib/sandboxRecoveryMessages';
export { SANDBOX_RECOVERY_FIRST_MESSAGE, SANDBOX_RECOVERY_REPEAT_MESSAGE };

export class SandboxRecoveryUnavailableError extends Error {
  readonly code = 'SANDBOX_RECOVERY_UNAVAILABLE';
  readonly retryable: boolean;
  readonly repeated: boolean;
  /** Admin-only classification; never part of the user-facing message. */
  readonly reason?: SandboxRecoveryRefuseReason;

  constructor(reason?: SandboxRecoveryRefuseReason, opts?: { repeated?: boolean }) {
    const repeated = opts?.repeated === true;
    super(repeated ? SANDBOX_RECOVERY_REPEAT_MESSAGE : SANDBOX_RECOVERY_FIRST_MESSAGE);
    this.name = 'SandboxRecoveryUnavailableError';
    this.repeated = repeated;
    this.retryable = !repeated;
    if (reason) this.reason = reason;
  }
}

export function isSandboxRecoveryUnavailable(error: unknown): error is SandboxRecoveryUnavailableError {
  return error instanceof SandboxRecoveryUnavailableError;
}

export function rethrowSandboxRecoveryUnavailable(error: unknown): void {
  if (isSandboxRecoveryUnavailable(error)) throw error;
}

/** Metadata or issue-code shapes that identify a prior reconnect refusal. */
export type SandboxRecoveryHistoryEntry = {
  ok?: boolean;
  summary?: string;
  userStopped?: boolean | null;
  endedAt?: number;
  issues?: ReadonlyArray<{ code?: string } | null | undefined> | null;
};

export function isSandboxRecoveryUnavailableRecord(
  entry: SandboxRecoveryHistoryEntry | null | undefined,
): boolean {
  if (!entry || entry.ok !== false || entry.userStopped === true) return false;
  if (entry.issues?.some((i) => i?.code === 'SANDBOX_RECOVERY_UNAVAILABLE')) return true;
  return typeof entry.summary === 'string' && /could not be safely reconnected/i.test(entry.summary);
}

/**
 * True when the newest settled prior attempt on this workspace ended as a reconnect refusal.
 * In-progress rows (no endedAt) are skipped. A missing or unreadable list is not a match.
 */
export function latestSettledAttemptWasSandboxRecoveryUnavailable(
  entries: ReadonlyArray<SandboxRecoveryHistoryEntry> | null | undefined,
): boolean {
  if (!Array.isArray(entries)) return false;
  const previous = entries.find((e) => e && typeof e.endedAt === 'number');
  return isSandboxRecoveryUnavailableRecord(previous);
}
