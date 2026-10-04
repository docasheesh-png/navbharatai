// A PRIVILEGED ADMIN ACTION CARRIES THE ADMIN'S OWN REASON (admin panel audit, PR 1, 2026-10-04).
//
// The audit found three actions that changed a real person's account or reached every user with one
// press and no stated reason:
//   • Ban / suspend — the screen sent the hard-coded reason "Admin action", so the audit trail recorded
//     a sentence nobody wrote.
//   • Token adjustment — the reason box could be left empty, and the server filled in "Admin adjustment".
//   • "Send a message to all users" — a single press, no confirmation, no preview.
//
// ONE rule, read by the screen (to keep Confirm disabled) AND by the server (to refuse the request).
// The screen is not the security boundary: an old phone build or a hand-written request that skips the
// dialog is refused by the same function here.
//
// PURE: no React, no I/O.

export const ADMIN_REASON_MIN = 3;
export const ADMIN_REASON_MAX = 500;

/**
 * The placeholder sentences earlier versions of the admin screen SENT ON THE ADMIN'S BEHALF. A request
 * carrying one of these exactly is an old client filling in a reason nobody typed, so it is refused
 * like an empty reason — recording it would put words in the admin's mouth.
 */
const PLACEHOLDER_REASONS = new Set(['admin action', 'admin adjustment']);

export type ReasonRead = { ok: true; reason: string } | { ok: false; error: string };

export function readAdminReason(raw: unknown): ReasonRead {
  const reason = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!reason) return { ok: false, error: 'A reason is required for this action.' };
  if (PLACEHOLDER_REASONS.has(reason.toLowerCase())) {
    return { ok: false, error: 'Write the real reason for this action — the old automatic reason is no longer accepted.' };
  }
  if (reason.length < ADMIN_REASON_MIN) return { ok: false, error: `The reason must be at least ${ADMIN_REASON_MIN} characters.` };
  if (reason.length > ADMIN_REASON_MAX) return { ok: false, error: `The reason must be at most ${ADMIN_REASON_MAX} characters.` };
  return { ok: true, reason };
}

/** The value a message to EVERY user must carry, so a stray or replayed request cannot broadcast. */
export const ALL_USERS_SCOPE = 'ALL_USERS';

/** Is this announcement allowed to go out? A one-user message needs no scope; an all-users one does. */
export function broadcastScopeConfirmed(targetType: 'all' | 'user', confirmScope: unknown): boolean {
  return targetType === 'user' || confirmScope === ALL_USERS_SCOPE;
}

/** A whole-number token change that is not zero and not absurd. */
export function readTokenDelta(raw: unknown): { ok: true; delta: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n === 0) {
    return { ok: false, error: 'Enter a whole number of tokens to add (or a negative number to remove).' };
  }
  if (Math.abs(n) > 100_000_000) return { ok: false, error: 'That amount is too large for one adjustment.' };
  return { ok: true, delta: n };
}

// ── What each confirmation says before it is pressed ──────────────────────────────────────────────

export interface ConfirmCopy {
  title: string;
  /** What happens if the admin presses Confirm, in plain words. */
  consequence: string;
  confirmLabel: string;
  reasonRequired: boolean;
  danger: boolean;
}

export function banCopy(who: string, banning: boolean): ConfirmCopy {
  return banning
    ? {
        title: `Ban ${who}?`,
        consequence: 'This account will be suspended: it can no longer build, chat or spend from its wallet until the ban is lifted. The reason is saved in the audit log.',
        confirmLabel: 'Confirm ban',
        reasonRequired: true,
        danger: true,
      }
    : {
        title: `Lift the ban on ${who}?`,
        consequence: 'This account will be able to build, chat and spend from its wallet again.',
        confirmLabel: 'Lift the ban',
        reasonRequired: false,
        danger: false,
      };
}

export function tokenAdjustCopy(who: string, delta: number, currentBalance: number | null): ConfirmCopy {
  const verb = delta > 0 ? `Add ${delta.toLocaleString('en-IN')} tokens to` : `Remove ${Math.abs(delta).toLocaleString('en-IN')} tokens from`;
  const after = currentBalance === null
    ? 'The new balance is shown after the change.'
    : `Balance: ${currentBalance.toLocaleString('en-IN')} → ${(currentBalance + delta).toLocaleString('en-IN')} tokens.`;
  return {
    title: `${verb} ${who}?`,
    consequence: `${after} This changes the user's real wallet and is recorded with your reason in the audit log.`,
    confirmLabel: delta > 0 ? 'Add tokens' : 'Remove tokens',
    reasonRequired: true,
    danger: delta < 0,
  };
}

export function broadcastCopy(targetType: 'all' | 'user', email: string): ConfirmCopy {
  return targetType === 'all'
    ? {
        title: 'Send this message to ALL users?',
        consequence: 'Every NavBharatAI user receives this notification. It cannot be taken back once sent.',
        confirmLabel: 'Confirm send to all users',
        reasonRequired: false,
        danger: true,
      }
    : {
        title: `Send this message to ${email}?`,
        consequence: 'Only this user receives the notification.',
        confirmLabel: 'Confirm send',
        reasonRequired: false,
        danger: false,
      };
}
