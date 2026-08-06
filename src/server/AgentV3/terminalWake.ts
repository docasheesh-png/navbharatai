/**
 * Pure helpers for the background terminal wake (admin 2026-08-06: "start hone me bahut time laga,
 * fir bhi start nahi hua").
 *
 * In their own module — not routes/agentv3.ts — because they are pure functions with unit tests, and
 * importing a 7000-line route module (with its side effects) to test two pure functions is how a
 * 5-second test timeout happens. The wake job itself lives beside the shell routes; only what is
 * pure lives here.
 */

/** The live progress of one background wake, as tracked by the wake job. */
export interface TerminalWakeState {
  phase: 'starting' | 'seeding' | 'finishing' | 'ready' | 'failed';
  seeded: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/**
 * The wake state a WORKSPACE OWNER may see (the poll route is ownership-checked): progress fields
 * plus the sanitized failure reason — never timestamps or anything else internal.
 */
export function wakePublicState(s: Pick<TerminalWakeState, 'phase' | 'seeded' | 'total' | 'error'>): {
  phase: string; seeded: number; total: number; error?: string;
} {
  return { phase: s.phase, seeded: s.seeded, total: s.total, ...(s.error ? { error: s.error } : {}) };
}

/**
 * A wake failure's real message, bounded and with infra branding neutralized — the user-facing word
 * for the machine is "sandbox"/"workspace", never a vendor name. A wake that will not name its
 * failure is undiagnosable from a screenshot, which is the whole lesson of this terminal's history.
 */
export function sanitizeWakeError(e: unknown): string {
  const msg = e instanceof Error && e.message ? e.message : String(e ?? 'unknown error');
  return msg.replace(/e2b/gi, 'sandbox').slice(0, 300);
}
