import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, CheckCircle2, HelpCircle, Loader2, RefreshCw } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { readAnswer, isRecord } from '../../lib/serverAnswer';
import { cn } from '../../lib/utils';
import { aiSpendSummary, formatInr } from '../../lib/aiSpendSummary';
import {
  HISTORY_FILTERS, HISTORY_FILTER_LABEL, HISTORY_PAGE_SIZE, HISTORY_RANGES, HISTORY_RANGE_LABEL,
  countByFilter, filterHistory, pageOf, toHistoryItems,
  type HistoryFilter, type HistoryRange, type HistoryRowInput,
} from '../../lib/walletHistoryView';

/**
 * PAGE 3 — TOKEN HISTORY: every credit and every charge, and whether it adds up.
 *
 * Admin, 2026-09-15: *"ek ek paise ka sahi sahi hisab hona chahiye … aur user ke current balance se
 * match hona chahiye."* The statement route is the ONE reconciled source (`walletStatement.ts`), so this
 * page is a reading of it — never a second ledger: `walletHistoryView.ts` only sorts, filters and labels
 * the rows the server returned, and every row belongs to exactly one filter so a filter can never hide
 * money.
 *
 * 🔒 IT SHOWS THE ANSWER EVEN WHEN THE ANSWER IS BAD. A history that could only ever say "balanced"
 * would be decoration, and decoration on a money screen is worse than nothing. If the entries do not add
 * up, this says so, in rupees, to the user.
 *
 * 🔒 AND "UNKNOWN" IS A THIRD, HONEST STATE. An older account whose oldest rows rolled off before opening
 * balances were recorded genuinely cannot be checked. Calling that a mismatch would frighten people whose
 * money is perfectly fine; calling it balanced would be a lie. It says what it is.
 *
 * 🔒 A FAILED LOAD IS NOT AN EMPTY HISTORY. An unreachable statement says so, with a retry — rendering
 * "no entries" would read as "your history was lost", the most alarming possible way to be wrong.
 */
interface StatementRow extends HistoryRowInput {
  rupees: number;
  runningRupees: number;
}

interface Statement {
  ok: boolean;
  exists?: boolean;
  openingRupees?: number;
  openingIsAssumed?: boolean;
  hiddenRows?: number;
  rows?: StatementRow[];
  creditTokens?: number;
  debitTokens?: number;
  differenceRupees?: number;
  verdict?: 'balanced' | 'off' | 'unknown';
  actualRupees?: number;
  actualTokens?: number;
  notes?: string[];
}

/** The statement route's answer — a refusal (`{ error }`) is not a statement with no rows (Q-680). */
export function isStatement(b: unknown): b is Statement {
  return isRecord(b) && b.ok === true && Array.isArray(b.rows);
}

const inr = (n: number | undefined): string =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tokens = (n: number): string => Math.abs(n).toLocaleString('en-IN');

/** A date a person reads, not an ISO string. Falls back to the raw value rather than showing nothing. */
function when(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const WalletStatementPanel: React.FC<{ userId: string; wallet?: unknown }> = ({ userId, wallet }) => {
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [range, setRange] = useState<HistoryRange>('all');
  const [shown, setShown] = useState(HISTORY_PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wallet/${encodeURIComponent(userId)}/statement`, { headers: await authedHeaders() });
      const a = await readAnswer(res, isStatement);
      setData(a.ok ? a.value : { ok: false, notes: [a.sentence] });
    } catch (e) {
      setData({ ok: false, notes: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const verdict = data?.verdict;
  const all = useMemo(() => toHistoryItems(data?.rows ?? []), [data]);
  const counts = useMemo(() => countByFilter(all), [all]);
  const visible = useMemo(() => filterHistory(all, filter, range, Date.now()), [all, filter, range]);
  const page = pageOf(visible, shown);
  const spend = useMemo(() => aiSpendSummary(wallet as never), [wallet]);

  // A new filter or range starts the list from its top again.
  const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setShown(HISTORY_PAGE_SIZE); };

  return (
    <div className="space-y-4">
      {!data ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your history…
        </p>
      ) : !data.ok ? (
        <div role="alert" className="space-y-3 rounded-2xl border border-line bg-card p-5">
          <p className="text-sm font-semibold text-danger">Could not load your history right now.</p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-raised px-4 text-sm font-bold text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Try again
          </button>
        </div>
      ) : data.exists === false ? (
        <p className="rounded-2xl border border-line bg-card p-5 text-sm font-semibold text-muted">
          This account has no token activity yet.
        </p>
      ) : (
        <>
          {/* THE RECONCILIATION — the point of the page, kept to a few lines. */}
          <div className={cn(
            'rounded-2xl border p-4',
            verdict === 'balanced' ? 'border-success/30 bg-success/10'
              : verdict === 'off' ? 'border-danger/30 bg-danger/10'
              : 'border-warn/30 bg-warn/10',
          )}>
            <div className="flex items-start gap-3">
              {verdict === 'balanced' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                : verdict === 'off' ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
                : <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />}
              <div className="min-w-0">
                <p className={cn('text-sm font-bold', verdict === 'balanced' ? 'text-success' : verdict === 'off' ? 'text-danger' : 'text-warn')}>
                  {verdict === 'balanced' ? 'Everything adds up'
                    : verdict === 'off' ? `These entries do not match your balance — a difference of ${inr(Math.abs(data.differenceRupees ?? 0))}`
                    : 'Part of this history is older than our records'}
                </p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-muted">
                  {verdict === 'balanced'
                    ? `Opening ${inr(data.openingRupees)} + credits − charges = ${inr(data.actualRupees)}, which is exactly your balance.`
                    : verdict === 'off'
                      ? 'Please send us a report from this screen — we will look at it and put it right.'
                      : 'The entries below are correct; we simply cannot check them against your balance, because the oldest ones are no longer stored.'}
                </p>
                {(data.notes ?? []).map((n) => (
                  <p key={n} className="mt-1.5 text-xs font-semibold leading-relaxed text-muted">{n}</p>
                ))}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-line bg-card p-3.5">
              <dt className="text-xs font-semibold text-muted">Total added</dt>
              <dd className="mt-0.5 text-lg font-extrabold text-success">+{tokens(data.creditTokens ?? 0)}</dd>
            </div>
            <div className="rounded-2xl border border-line bg-card p-3.5">
              <dt className="text-xs font-semibold text-muted">Total used</dt>
              <dd className="mt-0.5 text-lg font-extrabold text-danger">−{tokens(data.debitTokens ?? 0)}</dd>
            </div>
          </dl>
          {spend.ledgerAvailable && spend.chargeCount > 0 && (
            <p className="text-xs font-semibold text-muted">
              Spent on: app building ₹{formatInr(spend.buildInr)} · assistants ₹{formatInr(spend.assistantInr)}
            </p>
          )}

          {/* FILTERS — each row sits under exactly one, so the counts always add up to "All". */}
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => pick(setFilter)(f)}
                className={cn(
                  'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors',
                  filter === f ? 'border-accent bg-accent text-on-accent' : 'border-line bg-card text-ink hover:bg-raised',
                )}
              >
                {HISTORY_FILTER_LABEL[f]}
                {/* inherits the chip's own label colour when selected — a solid fill names its ink once, on the fill */}
                <span className={cn('text-xs font-semibold', filter !== f && 'text-muted')}>{counts[f]}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-ink">Token history</h3>
            <label htmlFor="wallet-history-range" className="sr-only">Time range</label>
            <select
              id="wallet-history-range"
              value={range}
              onChange={(e) => pick(setRange)(e.target.value as HistoryRange)}
              className="min-h-[44px] rounded-xl border border-line bg-card px-3 text-sm font-semibold text-ink"
            >
              {HISTORY_RANGES.map((r) => <option key={r} value={r}>{HISTORY_RANGE_LABEL[r]}</option>)}
            </select>
          </div>

          {all.length === 0 ? (
            <p className="rounded-2xl border border-line bg-card p-5 text-sm font-semibold text-muted">No entries yet.</p>
          ) : visible.length === 0 ? (
            <p className="rounded-2xl border border-line bg-card p-5 text-sm font-semibold text-muted">
              Nothing matches this filter. Try “All” or a longer time range.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {page.rows.map((it) => (
                <li key={it.key} className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-card p-3.5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        it.credit ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
                      )}
                      aria-hidden
                    >
                      {it.credit ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-ink">{it.title}</p>
                      {it.detail && it.detail !== it.title && (
                        <p className="break-words text-xs font-semibold text-muted">{it.detail}</p>
                      )}
                      <p className="mt-0.5 text-xs font-semibold text-muted">{when(it.timestamp)}</p>
                      {it.balanceAfter !== null && (
                        <p className="text-xs font-semibold text-muted">Balance after: {it.balanceAfter.toLocaleString('en-IN')}</p>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('text-sm font-extrabold', it.credit ? 'text-success' : 'text-danger')}>
                      {it.credit ? '+' : '−'}{tokens(it.tokens)}
                    </p>
                    <p className="text-xs font-semibold text-muted">tokens</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {page.more > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + HISTORY_PAGE_SIZE)}
              className="min-h-[48px] w-full rounded-2xl border border-line bg-raised text-sm font-bold text-ink hover:bg-raised-hover"
            >
              Show {Math.min(page.more, HISTORY_PAGE_SIZE)} more ({page.more} left)
            </button>
          )}

          <p className="text-xs font-semibold leading-relaxed text-muted">
            Charges smaller than ₹0.01 are carried to your next charge rather than rounded up, and a day&rsquo;s
            small assistant charges are grouped into one line so your history stays readable.
            {(data.hiddenRows ?? 0) > 0 && ` ${data.hiddenRows} older entries are included in the opening balance.`}
          </p>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-bold text-accent-text disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh history
          </button>
        </>
      )}
    </div>
  );
};
