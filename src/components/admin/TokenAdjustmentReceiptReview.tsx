import type { AdminTokenAdjustmentReceiptResponse } from '../../lib/adminTokenAdjustmentReceipt';

const tokens = (value: number | null) => value === null ? 'Unknown' : value.toLocaleString('en-IN');

/** No grant action: acknowledgment only removes the exact locally saved, proven-completed operation. */
export function TokenAdjustmentReceiptReview({ response, busy, onAcknowledge }: {
  response: AdminTokenAdjustmentReceiptResponse; busy: boolean; onAcknowledge: () => void;
}) {
  const { receipt, currentWallet } = response;
  return <section className="mt-3 space-y-2 rounded-xl border border-line bg-card p-3 text-xs text-body" aria-label="Confirmed adjustment receipt">
    <h4 className="font-bold text-ink">Original adjustment confirmed — no new credit</h4>
    <p className="break-all">Operation ID: {receipt.requestId}</p>
    <p className="break-all">Original target: {receipt.requestedUserId} · Wallet at that operation: {receipt.walletId}</p>
    <p>Requested adjustment: {tokens(receipt.delta)} tokens · Recorded at {receipt.committedAt}</p>
    <p>Historical receipt balances: {tokens(receipt.previousBalance)} → {tokens(receipt.newBalance)} tokens. These are not the current balance.</p>
    {currentWallet.ok ? <div className="space-y-1 border-t border-line pt-2">
      <p className="break-all">Current canonical wallet: {currentWallet.canonicalUserId}</p>
      <p>Current stored tokens: {tokens(currentWallet.storedTokens)} · Owner-visible for the requested login: {tokens(currentWallet.ownerVisibleTokens)}</p>
      <p>Current Weak-eligible tokens (before admission checks): {tokens(currentWallet.weakEligibleTokens)} · Paid-spendable tokens (policy calculation): {tokens(currentWallet.paidSpendableTokens)}</p>
      <p className="text-muted">Refreshed separately at {currentWallet.refreshedAt}. Later consumption, credits or merges can change these values.</p>
      {!currentWallet.pauseStateKnown && <p className="text-warn">Free-program state is unavailable. Owner-visible and Weak eligibility figures are unknown, not zero.</p>}
      {currentWallet.pauseStateKnown && <p className="text-muted">Free program: {currentWallet.paused ? 'Paused' : 'Active'}.</p>}
      {!currentWallet.mergeResolutionEnabled && receipt.requestedUserId !== currentWallet.canonicalUserId && <p className="text-warn">Merge resolution is disabled. This login still reads and spends from the retired source wallet; the other figures here describe the current canonical wallet.</p>}
    </div> : <p className="text-warn">{'reason' in currentWallet ? currentWallet.reason : 'The current wallet is unknown.'}</p>}
    <p className="text-muted">Acknowledging this receipt only clears this browser's matching completed operation. It adds no tokens, does not replay the adjustment, and does not convert gift credits into purchased or hosting money. A new adjustment still requires a separate deliberate confirmation.</p>
    <button type="button" disabled={busy} onClick={onAcknowledge} className="rounded-lg border border-line bg-raised px-3 py-2 font-bold text-ink disabled:opacity-40">
      {busy ? 'Checking…' : 'Acknowledge confirmed operation'}
    </button>
  </section>;
}
