// RECENT PAYMENTS — the purchase records the Buy Tokens page shows, with an HONEST status.
//
// `payment_transactions` holds a row for every order, paid or not. Showing all of them as one list of
// "purchases" would present a pending or failed order as if tokens had arrived, which is the defect the
// brief names ("failed or pending payments are not presented as successful purchases"). The status is
// the server's own `paymentStatus`; this module only chooses the words.
//
// A row that is free credit we GAVE (welcome bonus, a coupon, a referral step) is not a payment and is
// left out — it appears in History under "Earned", where it belongs.
//
// PURE. Rows are untrusted JSON: every field is read defensively.

export type PaymentView = 'paid' | 'waiting' | 'failed';

export interface PaymentRowView {
  /** The order id — the reference the user quotes to support. */
  reference: string;
  status: PaymentView;
  statusText: string;
  amountInr: number;
  tokens: number | null;
  whenMs: number | null;
}

const FREE_CREDIT = new Set(['WELCOME_BONUS', 'COUPON_REDEEM', 'COUPON', 'REFERRAL', 'REFERRAL_REWARD', 'GIFT_REDEEM']);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function millis(v: unknown): number | null {
  if (v && typeof v === 'object') {
    const o = v as { seconds?: unknown; _seconds?: unknown; toMillis?: unknown };
    const s = num(o.seconds ?? o._seconds);
    if (s > 0) return s * 1000;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const ms = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  return null;
}

export const PAYMENT_STATUS_TEXT: Readonly<Record<PaymentView, string>> = Object.freeze({
  paid: 'Paid — tokens added',
  waiting: 'Waiting for the payment to be confirmed',
  failed: 'Payment did not go through',
});

export function paymentRows(txs: unknown, limit = 5): PaymentRowView[] {
  if (!Array.isArray(txs)) return [];
  const out: PaymentRowView[] = [];
  for (const raw of txs) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const provider = String(t.paymentProvider ?? '').toUpperCase();
    if (FREE_CREDIT.has(provider)) continue;
    const amountInr = num(t.amountPaid ?? t.amount);
    if (amountInr <= 0) continue;
    const reference = String(t.orderId ?? t.transactionId ?? t.id ?? '').trim();
    if (!reference) continue;
    const s = String(t.paymentStatus ?? t.status ?? '').toUpperCase();
    // Only an explicit SUCCESS is "paid". Anything unreadable is "waiting", never "paid": showing an
    // unconfirmed order as money that arrived is the error that cannot be walked back on a money screen.
    const status: PaymentView = s === 'SUCCESS' ? 'paid' : s === 'FAILED' || s === 'CANCELLED' || s === 'EXPIRED' ? 'failed' : 'waiting';
    const added = num(t.balanceAdded);
    out.push({
      reference,
      status,
      statusText: PAYMENT_STATUS_TEXT[status],
      amountInr,
      tokens: status === 'paid' && added > 0 ? Math.round(added * 100) : null,
      whenMs: millis(t.createdAt),
    });
  }
  out.sort((a, b) => (b.whenMs ?? 0) - (a.whenMs ?? 0));
  return out.slice(0, Math.max(0, limit));
}
