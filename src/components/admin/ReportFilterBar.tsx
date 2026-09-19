import { DATE_OPTIONS, TIER_OPTIONS, hasActiveFilters, type ListFilterState, type ListStatusFilter } from '../../lib/reportListFilter';

/**
 * The ONE filter bar both admin build-report lists render (admin 2026-09-14: "filter bhi all build
 * report wala chahiye dono me!!").
 *
 * The All-builds bar was the better of the two — status chips with live counts, a date range, a
 * per-user picker, a search box and a Clear — and the user-submitted inbox had no date range at all,
 * so "is this still happening?" could not be asked of the list where users actually complain.
 *
 * The controls live here; what each one MEANS lives in reportListFilter.ts. That split is deliberate:
 * a shared component keeps the two bars looking identical, and a shared pure module keeps them
 * AGREEING — the second is the one a test can hold.
 *
 * ⚠️ Wraps at every width and carries no fixed-width child, because the screen this replaces already
 * overflowed a 393 px phone by 513 px.
 */
export function ReportFilterBar({
  value, onChange, counts, users, searchPlaceholder, trailing, onSubmitSearch,
}: {
  value: ListFilterState;
  onChange: (next: ListFilterState) => void;
  counts?: { all: number; failed: number; succeeded: number; unknown: number } | null;
  users?: ReadonlyArray<{ uid: string; count: number; label: string }>;
  searchPlaceholder?: string;
  /** Anything list-specific (a Load button, a sort toggle) — rendered at the end of the bar. */
  trailing?: React.ReactNode;
  /** Fired on Enter in the search box, for a list that fetches server-side. */
  onSubmitSearch?: () => void;
}) {
  const set = (patch: Partial<ListFilterState>) => onChange({ ...value, ...patch });

  const chips: ReadonlyArray<readonly [ListStatusFilter, string, number | undefined]> = [
    ['all', 'All', counts?.all],
    ['failed', 'Failed', counts?.failed],
    ['succeeded', 'Worked', counts?.succeeded],
    // Shown only when there ARE any — otherwise the bar reads "All 100 · Failed 25 · Worked 70" and
    // those five builds are reachable by no filter at all.
    ...(counts?.unknown ? ([['unknown', 'No outcome', counts.unknown]] as const) : []),
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={value.query}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmitSearch?.(); }}
          placeholder={searchPlaceholder || 'Search: name, email, workspace, prompt words…'}
          className="flex-1 min-w-0 bg-surface border border-line rounded-xl px-3 py-2 text-[12px] text-ink placeholder:text-muted focus:outline-none focus:border-indigo-500"
        />
        {trailing}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map(([v, label, count]) => (
          <button
            key={v}
            type="button"
            onClick={() => set({ status: v })}
            className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border ${
              value.status === v
                ? v === 'failed' ? 'border-rose-500/60 bg-rose-500/15 text-danger'
                  : v === 'succeeded' ? 'border-emerald-500/60 bg-emerald-500/15 text-success'
                  // Amber, not indigo — indigo is "All", and two chips that look identical when
                  // selected is how an admin loses track of what they are looking at.
                  : v === 'unknown' ? 'border-amber-500/60 bg-amber-500/15 text-warn'
                  : 'border-indigo-500/60 bg-indigo-500/15 text-accent-text'
                : 'border-line text-muted hover:text-ink hover:border-line'
            }`}
          >
            {label}{typeof count === 'number' ? ` ${count}` : ''}
          </button>
        ))}

        <span className="w-px h-5 bg-raised mx-1" aria-hidden="true" />

        {/* PAID / FREE (admin 2026-09-14: "filter me paid/free user wala filter nhi lagaya — woh
            lagao!! jis user ne real ₹ se token purchase kiye hai, woh paid user hai").

            It lives HERE, in the shared bar, rather than being passed in per list — that is the whole
            point of the ask. It had existed on the user-submitted inbox alone, and even there it
            answered a different question: `billing.userTier` describes how one BUILD was routed, and
            a user turns that to "free" simply by choosing the Weak engine. A customer who had paid
            ₹500 and picked Weak was listed as Free. See server/lib/accountTier.ts. */}
        <select
          value={value.tier ?? 'all'}
          onChange={(e) => set({ tier: e.target.value as ListFilterState['tier'] })}
          className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:border-indigo-500"
          aria-label="Filter by paid or free user"
          title="Paid = this account has bought tokens with real ₹"
        >
          {TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={value.date}
          onChange={(e) => set({ date: e.target.value as ListFilterState['date'] })}
          className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:border-indigo-500"
          aria-label="Filter by date"
        >
          {DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {users && users.length > 0 && (
          <select
            value={value.uid}
            onChange={(e) => set({ uid: e.target.value })}
            className="bg-surface border border-line rounded-lg px-2 py-1.5 text-[11px] text-ink max-w-[16rem] focus:outline-none focus:border-indigo-500"
            aria-label="Filter by user"
          >
            <option value="">Every user</option>
            {/* ⚠️ DELIBERATELY NOT PAGED. A native <select> renders its options lazily and scrolls
                them itself; paging would make a user outside the first twelve UNREACHABLE, so the
                control would silently stop doing its job. "Show 12 then a button" is for lists people
                READ, never for a picker. */}
            {users.map((u) => <option key={u.uid} value={u.uid}>{u.label} ({u.count})</option>)}
          </select>
        )}

        {hasActiveFilters(value) && (
          <button
            type="button"
            onClick={() => onChange({ query: '', status: 'all', date: 'all', uid: '', tier: 'all' })}
            className="text-[10px] font-bold px-2 py-1.5 rounded-lg text-muted hover:text-ink underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default ReportFilterBar;
