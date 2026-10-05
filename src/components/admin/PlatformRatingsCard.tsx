/**
 * RATINGS — what users say about NavBharatAI (admin 2026-10-05, the rating system).
 *
 * Every user whose app goes live is asked once (PlatformRatingHost); this card is where those answers
 * land: the average over EVERY rating (exact per-star counts from the server, not a sample), the spread,
 * and the newest ratings with their notes — low ones first in the filter, because a one-star note is the
 * one that names something to fix.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Star } from 'lucide-react';
import { readRatingsOverview, barPercent, starLabel, type RatingsOverviewView } from '../../lib/platformRating';

type Filter = 'all' | 'low' | 'notes';

export function PlatformRatingsCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<RatingsOverviewView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/admin/platform-ratings', { headers: { 'x-admin-token': adminToken } });
      const body = await r.json().catch(() => null);
      const read = r.ok ? readRatingsOverview(body) : null;
      if (!read) {
        setData(null);
        const msg = body && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : '';
        setError(msg || (r.ok ? 'The server answered in a shape this screen does not know.' : `Could not read ratings (HTTP ${r.status}).`));
      } else {
        setData(read);
      }
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const rows = (data?.recent ?? []).filter((r) => (filter === 'low' ? r.stars <= 3 : filter === 'notes' ? r.comment.trim() !== '' : true));

  return (
    <div className="rounded-2xl border border-line bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-tight text-ink">
            <Star size={14} /> Ratings
          </h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            Asked once, after a user&apos;s app goes live. A user who has rated is never asked again.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}

      {data && (
        <>
          {data.count === 0 ? (
            <p className="text-[12px] text-muted">No ratings yet. They arrive as users publish apps.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-3xl font-black tabular-nums text-ink">{data.average?.toFixed(1)}</div>
                <div className="flex gap-0.5 text-warn" aria-label={`${data.average} out of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={12} fill={data.average !== null && n <= Math.round(data.average) ? 'currentColor' : 'none'} />
                  ))}
                </div>
                <div className="mt-1 text-[10px] font-semibold text-muted">{data.count} rating{data.count === 1 ? '' : 's'}</div>
              </div>
              <div className="min-w-[180px] flex-1 space-y-1">
                {[5, 4, 3, 2, 1].map((s) => {
                  const n = data.distribution[s - 1];
                  return (
                    <div key={s} className="flex items-center gap-2 text-[11px]">
                      <span className="w-6 tabular-nums text-muted">{s}★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${barPercent(n, data.distribution)}%` }} />
                      </div>
                      <span className="w-8 text-right tabular-nums text-muted">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.recent.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter ratings">
                {([['all', 'Newest'], ['low', '1–3 stars'], ['notes', 'With a note']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={filter === id}
                    onClick={() => setFilter(id)}
                    className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${filter === id ? 'bg-accent text-on-accent' : 'bg-raised text-muted hover:text-ink'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {rows.length === 0 && <p className="text-[11px] text-muted">Nothing in this view among the newest {data.recent.length}.</p>}
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={`${r.uid}-${r.ratedAt}`} className="rounded-xl border border-line bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-warn" aria-label={`${r.stars} stars, ${starLabel(r.stars)}`}>
                        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={11} fill={n <= r.stars ? 'currentColor' : 'none'} />)}
                        <span className="ml-1 text-[10px] font-bold text-body">{starLabel(r.stars)}</span>
                      </span>
                      <span className="text-[10px] text-faint">
                        {r.email || r.uid} · {r.platform} · {r.ratedAt ? new Date(r.ratedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                      </span>
                    </div>
                    {r.comment && <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] text-body">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
