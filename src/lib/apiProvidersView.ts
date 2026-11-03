/**
 * The client's view of `/api/admin/api-providers`, and the ONE shape check it passes before it is shown
 * (PRODUCT_POLICY: a server body is not the answer until it is checked). PURE.
 */
export type ApiProviderBalanceView =
  | { kind: 'live'; amount: number; currency: string; level: 'ok' | 'low' | 'empty'; checkedAt: number }
  | { kind: 'failed'; reason: string; checkedAt: number }
  | { kind: 'manual'; reason: string }
  | { kind: 'not_configured' };

export interface ApiProviderRowView {
  id: string;
  name: string;
  group: 'ai' | 'service' | 'registered';
  configured: boolean;
  configuredKeys: string[];
  usedFor: string[];
  /** The login the admin recorded for this account, or null. */
  accountEmail: string | null;
  billingUrl: string | null;
  billingHint: string;
  balance: ApiProviderBalanceView;
}

export interface ApiProviderDirectoryView {
  rows: ApiProviderRowView[];
  lowBalanceUsd: number;
  checkedAt: number;
  /** False when the saved logins could not be read (the balances still are). */
  accountsAvailable: boolean;
  counts: { total: number; configured: number; live: number; low: number; empty: number; failed: number; manual: number };
}

const str = (v: unknown): v is string => typeof v === 'string';
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isBalance(b: unknown): b is ApiProviderBalanceView {
  if (!b || typeof b !== 'object') return false;
  const x = b as Record<string, unknown>;
  if (x.kind === 'live') return fin(x.amount) && str(x.currency) && (x.level === 'ok' || x.level === 'low' || x.level === 'empty') && fin(x.checkedAt);
  if (x.kind === 'failed') return str(x.reason) && fin(x.checkedAt);
  if (x.kind === 'manual') return str(x.reason);
  return x.kind === 'not_configured';
}

/** A billing link is only ever an https URL — anything else is not rendered as a link. */
function isLink(v: unknown): v is string | null {
  if (v === null) return true;
  if (!str(v)) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
}

export function isApiProviderDirectory(v: unknown): v is ApiProviderDirectoryView {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  const c = d.counts as Record<string, unknown> | undefined;
  if (!Array.isArray(d.rows) || !fin(d.lowBalanceUsd) || !fin(d.checkedAt) || typeof d.accountsAvailable !== 'boolean' || !c) return false;
  if (!['total', 'configured', 'live', 'low', 'empty', 'failed', 'manual'].every((k) => fin(c[k]))) return false;
  return d.rows.every((r) => {
    if (!r || typeof r !== 'object') return false;
    const x = r as Record<string, unknown>;
    return str(x.id) && str(x.name) && (x.group === 'ai' || x.group === 'service' || x.group === 'registered')
      && typeof x.configured === 'boolean' && Array.isArray(x.configuredKeys) && x.configuredKeys.every(str)
      && Array.isArray(x.usedFor) && x.usedFor.every(str) && (x.accountEmail === null || str(x.accountEmail))
      && isLink(x.billingUrl) && str(x.billingHint) && isBalance(x.balance);
  });
}

/** Attention first: empty, then low, then could-not-check, then manual, then healthy, then not configured. */
export function sortProvidersForAttention(rows: readonly ApiProviderRowView[]): ApiProviderRowView[] {
  const rank = (r: ApiProviderRowView): number => {
    const b = r.balance;
    if (b.kind === 'live') return b.level === 'empty' ? 0 : b.level === 'low' ? 1 : 4;
    if (b.kind === 'failed') return 2;
    if (b.kind === 'manual') return 3;
    return 5;
  };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
}
