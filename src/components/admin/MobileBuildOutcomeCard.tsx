import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminGet, adminFailed } from '../../lib/adminFetch';

/**
 * DOES A USER'S APP BUILD REALLY FAIL 80% OF THE TIME, AND OF WHAT? (admin 2026-09-22.)
 *
 * 🔴 THE NUMBER WAS BEING WRITTEN AND NEVER READ. `routes/mobileShip.ts` classifies every real failure
 * and calls `setOutcome(uid, owner, repo, 'failure', diag.code)` — and `failureCode` appeared in this
 * repository at four places, all four inside `AppBuildStore.ts` itself. Nothing read it, so "80%" was an
 * impression, and a plan built on an impression can spend a week on the wrong lever.
 *
 * 🔑 NOT the same card as `FailureCategoryCard` beside it, and they must not be read as one. That one
 * groups AgentV3 **app builds** (does the generated app compile?) by domain. This one is the **GitHub
 * packaging pipeline** — the .apk / .aab / .ipa a user actually presses for.
 *
 * 🔒 THE SAMPLE AND THE GAP ARE ALWAYS SHOWN, never a bare percentage — the same rule
 * `FailureCategoryCard` and `ReferralCostCard` already follow. Two of them here:
 *   • the failure RATE states how many runs it is out of;
 *   • the CLASS breakdown states how many failures carry a diagnosis, because a class is recorded when
 *     the automatic failure report lands and a user who closes the tab is in the rate and in no class.
 */
type Cure = 'repairable' | 'user-credentials' | 'unclassified';

interface LaneRow {
  lane: string;
  success: number;
  failure: number;
  cancelled: number;
  finished: number;
  failureRatePct: number | null;
}
interface CodeRow {
  code: string;
  count: number;
  sharePct: number;
  cure?: Cure;
  lanes?: Record<string, number>;
}
interface OutcomeData {
  days: number;
  requestedDays?: number;
  success: number;
  failure: number;
  cancelled: number;
  finished: number;
  failureRatePct: number | null;
  byLane: LaneRow[];
  topCodes: CodeRow[];
  diagnosed: number;
  diagnosisGap: number;
  cures?: Record<Cure, number>;
}

const LANE_LABEL: Record<string, string> = {
  apk: 'Installable .apk',
  aab: 'Play bundle .aab',
  ipa: 'iOS .ipa',
  other: 'Other',
};

/** What the admin should DO about this class — the whole reason the card splits them. */
const CURE_NOTE: Record<Cure, string> = {
  repairable: 'a better repair loop is the right lever',
  'user-credentials': 'no repair loop can help — show the user the button',
  unclassified: 'the classifier is blind here — give it an eye first',
};
const CURE_TONE: Record<Cure, string> = {
  repairable: 'text-info',
  'user-credentials': 'text-warn',
  unclassified: 'text-muted',
};

export function MobileBuildOutcomeCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<OutcomeData | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminGet<OutcomeData>('/api/admin/mobile-build-outcomes', { token: adminToken });
      if (adminFailed(r)) {
        setFailReason(r.message);
        setData(null);
      } else {
        setFailReason(null);
        setData(r.data);
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const lanes = data?.byLane ?? [];
  const codes = data?.topCodes ?? [];
  const cures = data?.cures;

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-ink">Phone build outcomes</h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            How often a user&rsquo;s .apk / .aab / .ipa build really fails, and of what — counted per run, not estimated.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {failReason ? (
        <p className="mt-4 text-[11px] font-semibold text-warn">Could not read the build counters: {failReason}</p>
      ) : !data ? (
        <p className="mt-4 text-[11px] font-semibold text-muted">Loading…</p>
      ) : data.finished === 0 ? (
        /* 🔒 NOT "0% fail". Nothing has been counted yet, which is a different statement, and the card
           says which — a zero presented as a measurement is the dishonesty this whole change removes. */
        <p className="mt-4 text-[11px] font-semibold text-muted">
          No finished phone build has been counted yet. The counter starts with the next build a user runs;
          nothing before today is in it, because the old record could not answer this question.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <span className="text-2xl font-black text-ink">
                {data.failureRatePct === null ? '—' : `${data.failureRatePct}%`}
              </span>
              <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-muted">failed</span>
            </div>
            <p className="text-[11px] font-semibold text-muted">
              {data.failure} of {data.finished} finished runs, over {data.days} day{data.days === 1 ? '' : 's'}
              {data.cancelled > 0 && <> · {data.cancelled} cancelled, not counted either way</>}
            </p>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted">By build</p>
            <div className="space-y-1">
              {lanes.map((l) => (
                <div key={l.lane} className="flex items-center justify-between gap-3 rounded-lg bg-well px-3 py-2">
                  <span className="text-[11px] font-bold text-body">{LANE_LABEL[l.lane] ?? l.lane}</span>
                  <span className="text-[11px] font-semibold text-muted">
                    {l.failureRatePct === null ? '—' : `${l.failureRatePct}%`} · {l.failure} of {l.finished}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted">Why they failed</p>
            {/* THE HONESTY LINE. It sits ABOVE the breakdown, not under it, because a reader who has
                already read the list has already formed the impression this sentence exists to bound. */}
            <p className="mb-2 text-[10px] font-semibold text-muted">
              {data.diagnosed} of {data.failure} failures carry a class.
              {data.diagnosisGap > 0 && (
                <> The other {data.diagnosisGap} ended while nobody was watching the screen, so no class was recorded — they are in the rate above and not in this list.</>
              )}
            </p>
            {codes.length === 0 ? (
              <p className="text-[11px] font-semibold text-muted">No failure has been classified yet.</p>
            ) : (
              <div className="space-y-1">
                {codes.map((c) => (
                  <div key={c.code} className="rounded-lg bg-well px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[11px] font-bold text-body">{c.code}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-muted">{c.count} · {c.sharePct}%</span>
                    </div>
                    {c.cure && (
                      <p className={`mt-0.5 text-[10px] font-semibold ${CURE_TONE[c.cure]}`}>{CURE_NOTE[c.cure]}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {cures && (
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted">What would cure them</p>
              <div className="grid grid-cols-3 gap-2">
                {(['repairable', 'user-credentials', 'unclassified'] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-well px-3 py-2">
                    <p className={`text-base font-black ${CURE_TONE[k]}`}>{cures[k] ?? 0}</p>
                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                      {k === 'user-credentials' ? 'their key' : k === 'unclassified' ? 'unknown' : 'repairable'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
