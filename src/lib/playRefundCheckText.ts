// What the admin's Revenue page says about the daily Google Play refund check (Q-690).
//
// The server reports the check's LAST RUN (`playRefundCheck` on `/api/admin/purchases`, built by
// `playRefundCheckView` in `src/server/lib/playVoidedPurchases.ts`). This turns it into one sentence.
// 🔒 It never says "tracked" on its own: a check that is not configured, was refused, or has never run
// says exactly that, so a Play row is never presented as final when nothing is watching it.
//
// PURE. The input is an untrusted server body.

export function playRefundCheckText(raw: unknown): string {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const reason = typeof v.reason === 'string' && v.reason.trim() ? ` — ${v.reason.trim()}` : '';
  const at = typeof v.lastRunAt === 'string' && v.lastRunAt ? v.lastRunAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'an unknown time';
  const counts = `${n(v.seen)} voided, ${n(v.reversed)} taken back, ${n(v.alreadyReversed)} already done, ${n(v.unknown)} not ours${n(v.errors) ? `, ${n(v.errors)} failed` : ''}`;
  switch (v.status) {
    case 'ok': return `Google Play refunds: last checked ${at} — ${counts}.${reason ? ` Note${reason}` : ''}`;
    case 'partial': return `Google Play refunds: last checked ${at}, only partly (${counts})${reason}.`;
    case 'not-configured': return `Google Play refunds are NOT being checked: the daily check is not configured${reason}`;
    case 'refused': return `Google Play refunds are NOT being checked: Google refused the daily check${reason}`;
    case 'failed': return `Google Play refunds: the last daily check failed at ${at}${reason}`;
    default: return 'Google Play refunds: the daily check has not run yet — check Play Console before treating a Play row as final.';
  }
}
