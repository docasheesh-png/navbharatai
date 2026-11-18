// BR1995: the two reconnect-refusal sentences, written once and read by both sides.
//
// The server raises them (`SandboxRecoveryUnavailableError`). The client must recognise them so the
// "Fix with AI" button is not offered under a platform infrastructure refusal: no edit to the app can
// reconnect a workspace. PURE. No I/O; importable by client and server alike.

export const SANDBOX_RECOVERY_FIRST_MESSAGE =
  'Your workspace could not be safely reconnected. Please retry shortly.';

export const SANDBOX_RECOVERY_REPEAT_MESSAGE =
  'Your workspace could not be safely reconnected again. Retrying immediately is unlikely to help. Please try again in a few minutes.';

/**
 * True only when `message`, trimmed, is exactly one of the two refusal sentences. Anything else,
 * including a sentence that merely contains one of them, answers false (fail-safe: unclear keeps main).
 */
export function isSandboxRecoveryRefusalMessage(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  return text === SANDBOX_RECOVERY_FIRST_MESSAGE || text === SANDBOX_RECOVERY_REPEAT_MESSAGE;
}
