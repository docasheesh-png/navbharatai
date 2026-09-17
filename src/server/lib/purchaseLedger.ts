// WHO PAID, FOR WHAT, AND WHICH ROWS ARE REVENUE — one reading of `payment_transactions`.
//
// Admin request (2026-09-17): the Revenue page showed a total and ten recent rows with a truncated
// user id, and could not answer "this revenue came from which users?". The rows to answer it were
// already in `payment_transactions` — every recharge, store pack, Professional Pass, coupon and gift
// lands there with an amount, the credit it produced, a provider, a status and a gateway reference.
// Nothing new is recorded; this module is the ONE reading of those documents, so the Revenue table,
// the analytics tiles and the account sheet cannot disagree about what counts as money.
//
// 🔒 REVENUE IS MONEY THAT ACTUALLY ARRIVED. A row is revenue only when its status is SUCCESS, its
// paid amount is above zero and it came through a payment rail. A coupon redemption is a SUCCESS row
// with `amountPaid: 0`; a welcome gift and a referral step are credits we GAVE. They are purchases in
// the sense that credit moved, and they are shown, but they are never revenue — the old "Token
// Purchases" tile counted coupon redemptions as successful payments.
//
// ⚠️ REFUNDS ARE NOT RECORDED ANYWHERE. The Cashfree webhook and the verifier only ever move a row
// from PENDING to SUCCESS; no writer produces REFUNDED, and a refund issued in the Cashfree dashboard
// leaves the row here saying SUCCESS. The summary carries `refundTracked: false` so the screen says so
// rather than presenting a refunded payment as revenue by silence. Building refund tracking needs the
// gateway's refund event wired in; that is a separate change and is recorded as an open item.
//
// PURE. Rows are untrusted JSON.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';

/** Rails that only ever GIVE credit — a SUCCESS row from one of these is never money that arrived. */
const FREE_CREDIT_PROVIDERS = new Set(['WELCOME_BONUS', 'COUPON_REDEEM', 'COUPON', 'REFERRAL', 'REFERRAL_REWARD']);

export type PurchaseKind = 'recharge' | 'store' | 'pass' | 'coupon' | 'gift' | 'referral' | 'other';
export type PurchaseStatus = 'SUCCESS' | 'PENDING' | 'FAILED' | 'OTHER';

export interface PurchaseRow {
  id: string;
  userId: string;
  /** ISO timestamp the row was created (an order's creation for a recharge; the credit for a store pack). */
  at: string;
  atMs: number;
  kind: PurchaseKind;
  product: string;
  /** What the user paid, in rupees (0 for a coupon or a gift). Gross, fee included. */
  amountInr: number;
  currency: 'INR';
  /** What reached the wallet, in rupees. */
  creditInr: number;
  /** The same credit in the app's own unit. */
  tokens: number;
  status: PurchaseStatus;
  rawStatus: string;
  /** Our own transaction id (the document id / order id). */
  transactionId: string;
  /** The gateway's reference (Cashfree cf_order_id, the store's transaction id, a coupon code). '' when none. */
  gatewayReference: string;
  method: string;
  rawProvider: string;
  platformFeeInr: number | null;
  /** The store's list price when the rail was Google Play / App Store (what the user actually paid the store). */
  storePriceInr: number | null;
  /** True only for a row that counts toward Total Revenue. */
  revenue: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function money(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function optionalMoney(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function normalisePurchaseStatus(raw: unknown): PurchaseStatus {
  const s = str(raw).toUpperCase();
  if (s === 'SUCCESS' || s === 'PAID') return 'SUCCESS';
  if (s === 'PENDING' || s === 'ACTIVE' || s === '') return 'PENDING';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'USER_DROPPED' || s === 'EXPIRED') return 'FAILED';
  return 'OTHER';
}

export function purchaseKind(tx: Record<string, unknown>): PurchaseKind {
  const provider = str(tx.paymentProvider).toUpperCase();
  const productType = str(tx.productType).toLowerCase();
  if (provider === 'WELCOME_BONUS') return 'gift';
  if (provider === 'COUPON_REDEEM' || provider === 'COUPON') return 'coupon';
  if (provider === 'REFERRAL' || provider === 'REFERRAL_REWARD') return 'referral';
  if (productType === 'professional_pass') return 'pass';
  if (provider === 'GOOGLE_PLAY' || provider === 'APPLE_IAP') return 'store';
  if (provider === 'CASHFREE') return 'recharge';
  return 'other';
}

/** The one rule for "does this row count toward revenue?". */
export function isRevenueRow(tx: Record<string, unknown>): boolean {
  if (normalisePurchaseStatus(tx.paymentStatus) !== 'SUCCESS') return false;
  if (money(tx.amountPaid) <= 0) return false;
  const provider = str(tx.paymentProvider).toUpperCase();
  // An unknown rail that recorded real money is still money that arrived; only the rails we KNOW give
  // credit for free are excluded by name. Under-counting a paid row would hide revenue.
  return !FREE_CREDIT_PROVIDERS.has(provider);
}

function methodLabel(provider: string): string {
  switch (provider) {
    case 'CASHFREE': return 'Cashfree (web)';
    case 'GOOGLE_PLAY': return 'Google Play';
    case 'APPLE_IAP': return 'App Store';
    case 'COUPON_REDEEM':
    case 'COUPON': return 'Coupon';
    case 'WELCOME_BONUS': return 'Welcome gift';
    case 'REFERRAL':
    case 'REFERRAL_REWARD': return 'Referral reward';
    case '': return 'Unknown';
    default: return provider.charAt(0) + provider.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}

function productLabel(tx: Record<string, unknown>, kind: PurchaseKind): string {
  switch (kind) {
    case 'pass': {
      const plan = str(tx.passPlan);
      const days = Number(tx.passDays);
      return `Professional Pass${plan ? ` (${plan}${Number.isFinite(days) && days > 0 ? `, ${days} days` : ''})` : ''}`;
    }
    case 'store': return str(tx.productId) ? `Token pack ${str(tx.productId)}` : 'Token pack';
    case 'coupon': return str(tx.paymentReference).replace(/^REDEMPTION_/, '') ? `Coupon ${str(tx.paymentReference).replace(/^REDEMPTION_/, '')}` : 'Coupon';
    case 'gift': return 'Welcome gift';
    case 'referral': return 'Referral reward';
    case 'recharge': return 'Wallet recharge';
    default: return str(tx.productType) || 'Wallet credit';
  }
}

/** Credits in tokens: `balanceAdded` is what every credit path actually writes; `tokenAmount` exists only on the oldest rows. */
export function purchaseTokens(tx: Record<string, unknown>): number {
  const credit = money(tx.balanceAdded);
  if (credit > 0) return Math.round(credit * TOKENS_PER_RUPEE);
  const legacy = Number(tx.tokenAmount);
  return Number.isFinite(legacy) && legacy > 0 ? Math.floor(legacy) : 0;
}

export function purchaseRow(id: string, raw: unknown): PurchaseRow {
  const tx = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = purchaseKind(tx);
  const provider = str(tx.paymentProvider).toUpperCase();
  const at = str(tx.createdAt);
  const atMs = Date.parse(at);
  return {
    id: str(id) || str(tx.transactionId),
    userId: str(tx.userId),
    at,
    atMs: Number.isFinite(atMs) ? atMs : 0,
    kind,
    product: productLabel(tx, kind),
    amountInr: money(tx.amountPaid),
    currency: 'INR',
    creditInr: money(tx.balanceAdded),
    tokens: purchaseTokens(tx),
    status: normalisePurchaseStatus(tx.paymentStatus),
    rawStatus: str(tx.paymentStatus).toUpperCase(),
    transactionId: str(tx.transactionId) || str(id),
    gatewayReference: str(tx.paymentReference),
    method: methodLabel(provider),
    rawProvider: provider,
    platformFeeInr: optionalMoney(tx.platformFeeInr),
    storePriceInr: optionalMoney(tx.storePriceInr),
    revenue: isRevenueRow(tx),
  };
}

export interface PurchaseSummary {
  rows: number;
  /** Money that actually arrived, over the rows given. */
  revenueInr: number;
  revenueRows: number;
  pendingRows: number;
  failedRows: number;
  /** SUCCESS rows that are not revenue (coupons, gifts, referral steps). */
  freeCreditRows: number;
  creditedInr: number;
  creditedTokens: number;
  /** Refunds are not recorded by any writer — see the module header. Always false today. */
  refundTracked: false;
}

export function summarisePurchases(rows: readonly PurchaseRow[]): PurchaseSummary {
  let revenueInr = 0, revenueRows = 0, pendingRows = 0, failedRows = 0, freeCreditRows = 0, creditedInr = 0, creditedTokens = 0;
  for (const r of rows) {
    if (r.revenue) { revenueInr += r.amountInr; revenueRows++; }
    if (r.status === 'PENDING') pendingRows++;
    else if (r.status === 'FAILED') failedRows++;
    else if (r.status === 'SUCCESS') {
      if (!r.revenue) freeCreditRows++;
      creditedInr += r.creditInr;
      creditedTokens += r.tokens;
    }
  }
  return {
    rows: rows.length,
    revenueInr: Math.round(revenueInr * 100) / 100,
    revenueRows, pendingRows, failedRows, freeCreditRows,
    creditedInr: Math.round(creditedInr * 100) / 100,
    creditedTokens,
    refundTracked: false,
  };
}

export type PurchaseStatusFilter = 'all' | 'revenue' | 'success' | 'pending' | 'failed' | 'free';
export type PurchaseSort = 'date' | 'amount' | 'tokens';

export interface PurchaseQuery {
  /** Matches user id, email, name, transaction id or gateway reference (case-insensitive substring). */
  search?: string;
  status?: PurchaseStatusFilter;
  /** Inclusive, `YYYY-MM-DD` in UTC. */
  from?: string;
  /** Inclusive, `YYYY-MM-DD` in UTC. */
  to?: string;
  sort?: PurchaseSort;
  dir?: 'asc' | 'desc';
}

/** A row joined with what the wallet knows about the person, for search and display. */
export interface PurchaseRowWithUser extends PurchaseRow {
  email: string;
  name: string;
}

function dayStartMs(day: string | undefined): number | null {
  const s = str(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

export function filterPurchases(rows: readonly PurchaseRowWithUser[], q: PurchaseQuery): PurchaseRowWithUser[] {
  const search = str(q.search).toLowerCase();
  const status = q.status ?? 'all';
  const fromMs = dayStartMs(q.from);
  const toEnd = dayStartMs(q.to);
  const toMs = toEnd === null ? null : toEnd + 24 * 60 * 60 * 1000 - 1;
  return rows.filter((r) => {
    if (status === 'revenue' && !r.revenue) return false;
    if (status === 'success' && r.status !== 'SUCCESS') return false;
    if (status === 'pending' && r.status !== 'PENDING') return false;
    if (status === 'failed' && r.status !== 'FAILED') return false;
    if (status === 'free' && !(r.status === 'SUCCESS' && !r.revenue)) return false;
    if (fromMs !== null && r.atMs < fromMs) return false;
    if (toMs !== null && r.atMs > toMs) return false;
    if (search) {
      const hay = `${r.userId} ${r.email} ${r.name} ${r.transactionId} ${r.gatewayReference} ${r.product}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/**
 * Default order: latest first, and among rows at the same instant the revenue row first — the
 * admin's stated default is "latest successful purchases first".
 */
export function sortPurchases<T extends PurchaseRow>(rows: readonly T[], sort: PurchaseSort = 'date', dir: 'asc' | 'desc' = 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let d = 0;
    if (sort === 'amount') d = a.amountInr - b.amountInr;
    else if (sort === 'tokens') d = a.tokens - b.tokens;
    else d = a.atMs - b.atMs;
    // Ties: the row that is MONEY outranks the one that is not (a PENDING order for the same amount
    // sits under the paid one), then the later row, then a stable id order.
    if (d === 0) d = Number(a.revenue) - Number(b.revenue);
    if (d === 0) d = a.atMs - b.atMs;
    if (d === 0) d = a.id.localeCompare(b.id);
    return sign * d;
  });
}
