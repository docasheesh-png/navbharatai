import {
  latestSettledAttemptWasSandboxRecoveryUnavailable,
  type SandboxRecoveryHistoryEntry,
} from './SandboxRecoveryError';

/** What the admin ETA_BASIS line should say about whether the user was shown the opening estimate. */
export function openingEtaShownNote(
  skippedForModule: boolean,
  holdUntilSandbox: boolean,
  shown: string,
): string {
  if (skippedForModule) {
    return 'Not shown to the user: this "continue" builds the next module of a stored project plan, and the estimate describes the whole app.';
  }
  if (holdUntilSandbox) {
    return 'Not shown to the user before workspace setup (the previous attempt failed to reconnect).';
  }
  return `Shown to the user: "${shown.replace(/^⏱️\s*/, '')}"`;
}

/**
 * After a settled reconnect refusal, hold the opening estimate until the workspace is up.
 * Other builds emit immediately. Returns the held text, or null when it was already emitted.
 */
export function recordOrEmitOpeningEta(
  etaShown: string,
  priorEntries: ReadonlyArray<SandboxRecoveryHistoryEntry> | null | undefined,
  emit: (text: string) => void,
): string | null {
  if (latestSettledAttemptWasSandboxRecoveryUnavailable(priorEntries)) return etaShown;
  emit(etaShown);
  return null;
}

/** Emit a held opening estimate once the workspace is up. Always returns null. */
export function emitPendingOpeningEta(
  pending: string | null,
  emit: (text: string) => void,
): null {
  if (pending) emit(pending);
  return null;
}

export function sandboxRecoveryRepeatOpts(
  priorEntries: ReadonlyArray<SandboxRecoveryHistoryEntry> | null | undefined,
): { repeated: boolean } {
  return { repeated: latestSettledAttemptWasSandboxRecoveryUnavailable(priorEntries) };
}
