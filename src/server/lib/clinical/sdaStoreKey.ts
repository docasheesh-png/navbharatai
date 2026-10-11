// Doctor AI case keys — one account can only ever reach its own cases (performance and privacy audit 2026-10-11).

/**
 * The key of a Doctor AI case in its in-memory stores (`routes/sda.ts`). 🔒 PRIVACY (audit 2026-10-11, F2): it was
 * `sessionId || userId` straight from the request BODY, and the stores hold patient details, the last
 * messages and up to three report files that are re-attached to the next model call. Anyone who sent another
 * doctor's `userId` (not a secret) — or their case id — with no `sessionId` read that case into their own
 * answer. The key now starts with the VERIFIED uid, so one account can only ever reach its own cases; the
 * body `userId` is never part of it. A case id that is not a plain token falls back to the account's default
 * case (what an older app that sent no case id got before, now scoped to its own account). Anonymous callers
 * get a fresh one-turn key: they have no identity to keep a case under. PURE.
 */
export function sdaStoreKey(verifiedUid: string | null | undefined, sessionId: unknown, fresh: () => string): string {
  if (!verifiedUid) return `anon:${fresh()}`;
  const sid = typeof sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : 'default';
  return `${verifiedUid}:${sid}`;
}
