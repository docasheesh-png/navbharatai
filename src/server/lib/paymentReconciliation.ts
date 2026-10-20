// WHEN THE PAID-VS-RECORDED CHECK COULD NOT RUN, THE ORDER ITSELF SAYS SO (Q-1135).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// Q-890 made the un-reconcilable credit LOUD: `payments.ts` logs `UNRECONCILED CREDIT for order …`
// and credits our own recorded figure. That asymmetry is deliberate and must not be "completed" into
// a symmetric rule — the provider's amount unreadable REFUSES, our own record unreadable CREDITS,
// because refusing there would strand a customer who really paid (the reasoning is held in
// `tests/theAmountCheckCannotBeSkipped.test.ts` so it cannot be lost).
//
// But a log line is not a record. Container logs roll, nobody greps them during a support call, and
// the admin Revenue page cannot show what it cannot read. So the one credit that was never reconciled
// looked, forever after, exactly like the thousands that were. This module is that fact — named once
// and read everywhere, which is `REVERSAL_FIELDS`' pattern in `paymentReversal.ts` for the same
// reason: a writer and its readers must not drift apart.
//
// ── 🔴 WHY EVERY VALUE IS FIRESTORE-SAFE BY CONSTRUCTION ─────────────────────────────────────────
// The patch is merged into the SAME `runTransaction` `tx.update` that flips PENDING → SUCCESS. Q-613
// exists to keep that one transaction whole, so a second write is not an option. That raises the cost
// of a mistake here: it does not degrade a payment, it STRANDS one. Firestore rejects an `undefined`
// field value, and a rejected update rolls the credit back with it.
//
// And the inputs are, by definition, the values already known to be junk — the whole trigger is that
// the recorded amount was unreadable (absent, a string, NaN). So:
//   · the recorded amount is rendered with `String()`, never `JSON.stringify`, whose result for
//     `undefined` is itself `undefined` — the exact value that would throw;
//   · the provider amount is a number only when it really is finite, and is otherwise OMITTED rather
//     than invented. A `0` there would read as "the provider charged nothing", which is a lie about
//     money, and this module's whole purpose is to stop money facts from being unreadable.
// `unreconciledPatchIsStorable` proves both properties over hostile inputs, and the test suite runs
// it over every value this path has ever been seen to carry.
//
// PURE. No Firestore, no network, no clock — the ISO timestamp is passed in by the caller, which is
// the same `nowIso` the surrounding transaction already uses.

/** Fields an un-reconciled credit writes on its `payment_transactions` document. Named once, read everywhere. */
export const RECONCILE_FIELDS = {
  /** `true` when the paid-vs-recorded check could not run on this order. The queryable marker. */
  unreconciledCredit: 'unreconciledCredit',
  /** Which side was unreadable. One value today; a union so a second cause cannot arrive unnamed. */
  unreconciledReason: 'unreconciledReason',
  /** ₹ the provider said it charged, when that was readable. Absent rather than invented. */
  unreconciledProviderInr: 'unreconciledProviderInr',
  /** Our own recorded amount, rendered as text exactly as it was found — the evidence. */
  unreconciledRecordedSeen: 'unreconciledRecordedSeen',
  /** ISO timestamp of the credit that could not be reconciled. */
  unreconciledAt: 'unreconciledAt',
} as const;

/** Why a credit could not be reconciled. */
export type UnreconciledReason = 'recorded-amount-unreadable';

export interface UnreconciledPatch {
  unreconciledCredit: true;
  unreconciledReason: UnreconciledReason;
  unreconciledProviderInr?: number;
  unreconciledRecordedSeen: string;
  unreconciledAt: string;
}

/**
 * The fields to merge into the SUCCESS flip when the paid-vs-recorded check could not run.
 *
 * `recordedSeen` is whatever was found on the order — undefined, a string, NaN, an object. It is
 * rendered to text here and never trusted as a number.
 */
export function unreconciledCreditPatch(
  providerAmountInr: unknown,
  recordedSeen: unknown,
  nowIso: string,
  reason: UnreconciledReason = 'recorded-amount-unreadable',
): UnreconciledPatch {
  const provider = typeof providerAmountInr === 'number' && Number.isFinite(providerAmountInr)
    ? Math.round(providerAmountInr * 100) / 100
    : null;
  return {
    unreconciledCredit: true,
    unreconciledReason: reason,
    ...(provider === null ? {} : { unreconciledProviderInr: provider }),
    unreconciledRecordedSeen: describeRecorded(recordedSeen),
    unreconciledAt: typeof nowIso === 'string' && nowIso !== '' ? nowIso : new Date(0).toISOString(),
  };
}

/**
 * The recorded amount as text. `String()` on an object gives `[object Object]`, which says nothing, so
 * an object or array is rendered through a GUARDED `JSON.stringify` — guarded because it can throw on a
 * circular value and can return `undefined` for a function or a symbol, and either one inside the money
 * transaction would strand the payment this fix exists to record.
 */
function describeRecorded(v: unknown): string {
  if (typeof v === 'object' && v !== null) {
    try {
      const json = JSON.stringify(v);
      if (typeof json === 'string' && json !== '') return json.slice(0, 200);
    } catch {
      /* circular or non-serialisable — fall through to String() */
    }
  }
  const s = String(v);
  return (s === '' ? "'' (empty string)" : s).slice(0, 200);
}

/** Whether this order's credit was never reconciled. Rows are untrusted JSON, so the marker is strict. */
export function isUnreconciledCredit(tx: Record<string, unknown> | null | undefined): boolean {
  return !!tx && tx[RECONCILE_FIELDS.unreconciledCredit] === true;
}

/**
 * Whether a patch can be written to Firestore at all: no `undefined` value, every key one of the names
 * above. Used by the tests over hostile inputs, and callable in anger if this path ever grows a caller
 * whose inputs are less well understood than today's.
 */
export function unreconciledPatchIsStorable(patch: Record<string, unknown>): boolean {
  const names = new Set<string>(Object.values(RECONCILE_FIELDS));
  for (const [k, v] of Object.entries(patch)) {
    if (!names.has(k)) return false;
    if (v === undefined) return false;
    if (typeof v === 'number' && !Number.isFinite(v)) return false;
  }
  return true;
}
