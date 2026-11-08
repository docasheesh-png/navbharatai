import type { AdminWalletCreditReview } from '../../lib/adminWalletCreditReview';

const tokens = (n: number | null | undefined) => n == null ? 'Unknown / not tracked' : n.toLocaleString('en-IN');
const inr = (n: number | null | undefined) => n == null ? 'Unknown' : `₹${n.toFixed(2)}`;

/** Read-only; the existing separately authenticated preview/confirmation remains the only action. */
export function WalletCreditReview({ review }: { review?: AdminWalletCreditReview }) {
  if (!review) return null;
  return <section className="mt-4 rounded-xl border border-line bg-card p-3 text-[11px] text-body" aria-label="Wallet credit review">
    <h5 className="font-bold text-ink">Wallet credit review — read-only</h5>
    {!review.ok ? <p className="mt-2 text-warn" role="status">{review.reason || 'Wallet review is unavailable.'}</p> : <>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          ['Requested account', review.requestedUserId], ['Canonical wallet', review.canonicalUserId],
          ['Stored canonical balance', `${tokens(review.storedTokens)} tokens · ${inr(review.storedInr)}`],
          ['Owner-visible balance', `${tokens(review.ownerVisibleTokens)} tokens · ${inr(review.ownerVisibleInr)}`],
          ['Canonical Weak-eligible tokens (before admission checks)', tokens(review.weakEligibleTokens)],
          ['Canonical paid-spendable tokens (policy calculation)', tokens(review.paidSpendableTokens)],
          ['Canonical explicitly tracked gift tokens', tokens(review.trackedGiftTokens)],
          ['Canonical explicitly tracked Weak admin tokens', tokens(review.trackedAdminTokens)],
          ['Canonical tracked ordinary gift remainder', tokens(review.trackedOrdinaryGiftTokens)],
          ['Free program', review.pauseStateKnown ? (review.paused ? 'Paused' : 'Active') : 'State unavailable — treated as paused'],
        ].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="break-all text-ink">{value}</dd></div>)}
      </dl>
      {review.requestedUserId !== review.canonicalUserId && <p className="mt-2 text-warn">This account was merged. {review.mergeResolutionEnabled ? 'The owner view follows the canonical wallet.' : 'Merge resolution is disabled: this login still reads and spends from the retired source wallet, not the canonical balance shown here.'}</p>}
      {!review.provenanceConsistent && <p className="mt-2 text-warn">Gift tracking is missing or inconsistent. Do not infer a historical grant from the total balance.</p>}
      {review.pendingReservations && <p className="mt-2 text-warn">Pending wallet reservations must finish before any reclassification.</p>}
      {review.suspended && <p className="mt-2 text-warn">The canonical account is suspended.</p>}
      <p className="mt-2 text-muted">Stored and visible balances can differ while gifts are paused. Eligibility is not proof of payment or of any particular gift. These are current balances, not the unspent amount of an old grant.</p>
      <details className="mt-3">
        <summary className="cursor-pointer text-ink">Retained admin ledger evidence ({review.ledgerRows?.length ?? 0} shown of {review.retainedAdminRows ?? 0})</summary>
        <p className="mt-2 text-muted">History is bounded and may have rolled off. No matching row does not prove that a grant never occurred. Request IDs identify recorded operations; this review does not verify their durable receipts.</p>
        <p className="mt-2 text-muted">Dated rows are shown newest first. {review.retainedUndatedRows ?? 0} retained rows have unknown time and follow dated rows in stored order, subject to the same display limit.</p>
        <ul className="mt-2 space-y-2">{review.ledgerRows?.map((row, i) => <li key={i} className="rounded-lg border border-line p-2 break-words">
          <p>{row.at || 'Unknown time'} · {row.type} · {tokens(row.tokens)} tokens</p>
          <p>{row.description}</p><p className="text-muted">Source: {row.creditSource || 'Not recorded'} · Weak delta: {tokens(row.adminTokensDelta)}</p>
          <p className="break-all text-muted">Request ID: {row.requestId || 'Not recorded'}</p>
          {(row.buildRef || row.rollupRef) && <p className="break-all text-muted">Usage reference: {row.buildRef || row.rollupRef}</p>}
        </li>)}</ul>
      </details>
      <p className="mt-3 text-muted">To review a policy change on verified existing gifts, use Users → Existing gifts → Weak. Review its canonical account and exact amount before confirming. It adds no tokens or money, grants no paid status, and cannot fund hosting purchases. Do not add the old grant again.</p>
    </>}
  </section>;
}
