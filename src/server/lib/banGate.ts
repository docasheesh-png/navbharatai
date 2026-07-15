// Admin user-management — REAL ban enforcement (admin-requested 2026-07-14).
//
// The admin "Block user" action writes { banned, banReason, bannedAt } onto the user's wallet doc
// (POST /api/admin/users/:userId/ban). Until now that flag was STORED BUT NEVER ENFORCED — a banned
// user could still start builds and spend NavBharatAI's provider budget. That is a fake feature (a
// button that does nothing, breaking absolute rule 2). This module is the enforcement: the build entry
// reads the ban status for the VERIFIED user and refuses a banned account with an honest 403.
//
// FAIL-OPEN by design: a degraded/slow Firestore must never lock out EVERY user, so any read error or
// timeout resolves to "not banned" (a rare banned user slipping through during an outage is acceptable;
// blocking all legitimate users is not). Same posture as the abuse gate and the wallet affordability gate.

export interface BanStatus {
  banned: boolean;
  reason?: string;
  bannedAt?: string;
}

const NOT_BANNED: BanStatus = { banned: false };

/** Pure: normalize a wallet document's ban fields into a BanStatus. Only a strict boolean `true`
 *  counts as banned (a stray truthy string must never suspend an account). */
export function banStatusFromWallet(data: unknown): BanStatus {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.banned !== true) return NOT_BANNED;
  return {
    banned: true,
    reason: typeof d.banReason === 'string' && d.banReason ? d.banReason : undefined,
    bannedAt: typeof d.bannedAt === 'string' ? d.bannedAt : undefined,
  };
}

/**
 * Read a user's ban status via an injected wallet-doc reader. Fail-open: a missing/null doc or ANY
 * thrown error resolves to NOT_BANNED. Firestore-free (the reader is injected), so it unit-tests with
 * a fake and can never itself stall or crash the build entry.
 */
export async function readBanStatus(
  read: (userId: string) => Promise<unknown | null>,
  userId: string | null | undefined,
): Promise<BanStatus> {
  if (!userId || userId === 'anon') return NOT_BANNED;
  try {
    const data = await read(userId);
    if (!data) return NOT_BANNED;
    return banStatusFromWallet(data);
  } catch {
    return NOT_BANNED;
  }
}

/** The honest, user-facing message for a suspended account (used in the 403 body). */
export function suspendedMessage(status: BanStatus): string {
  const base = 'Your account has been suspended by an administrator.';
  const reason = status.reason ? ` Reason: ${status.reason}.` : '';
  return `${base}${reason} If you believe this is a mistake, please contact support.`;
}
