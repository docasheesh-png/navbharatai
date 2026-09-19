// ModePickerSheet — the sheet the footer's Mode button opens (admin 2026-08-25). See modePicker.ts for
// the composition rules; this file is only the surface. It navigates via the SAME onPick contract the
// Professionals hub uses, so selecting an expert lands in that expert's real chat — same engine, same
// disclaimers, same gating.

import { useMemo, useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import { modePickerEntries, filterModeEntries, activeModeId, type ModeEntry } from './modePicker';

export function ModePickerSheet({
  activeView,
  hideMedical,
  onPick,
  onClose,
}: {
  /** The current view id — decides which row carries the ✓. */
  activeView: string;
  /** Native-shell Play compliance: hides the medical-class experts (same rule as the hub). */
  hideMedical: boolean;
  /**
   * The id of the row that was tapped. The CALLER navigates; this sheet only reports.
   *
   * ⚠️ Deliberately NOT a list of the possible values — that list lives in modePicker.ts (`ModeEntry`)
   * and the copy that used to stand here still said `free_new` months after the row was renamed. A
   * restated fact is a fact that goes stale where no compiler can see it.
   */
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useMemo(() => modePickerEntries({ hideMedical, activeView }), [hideMedical, activeView]);
  const visible = useMemo(() => filterModeEntries(entries, query), [entries, query]);
  const current = activeModeId(activeView);

  // Emoji logos (admin 2026-08-25: "emoji logo bhi sath me hon, maja aa jayega") — every expert
  // carries its own, from the completeness-tested map in modePicker.ts. Rendered in a fixed-width
  // rounded chip so 70+ rows line up whatever each emoji's natural width is.
  const rowIcon = (e: ModeEntry) => (
    <span aria-hidden className="w-8 h-8 rounded-lg bg-raised border border-line flex items-center justify-center text-[16px] leading-none shrink-0">
      {e.emoji}
    </span>
  );

  // 'navbharatai "free" — free bold me alag style me dikhe' (admin 2026-08-25). The styling belongs to
  // the WORD, so the recent row gets it too when the open AI happens to be the free chat — otherwise the
  // same name would be painted two different ways in one list.
  const rowLabel = (e: ModeEntry) => {
    if (e.name === 'NavBharatAI FREE') {
      return (
        <span className="text-[13px] text-ink">
          NavBharatAI{' '}
          <span className="font-black italic tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">FREE</span>
        </span>
      );
    }
    return <span className="text-[13px] font-semibold text-ink">{e.name}</span>;
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Choose AI mode">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-scrim backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-md bg-surface border-t sm:border border-line sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(72dvh, 40rem)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-[13px] font-black uppercase tracking-widest text-ink">Choose AI mode</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-raised">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2">
            <Search className="w-3.5 h-3.5 text-faint shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search an expert…"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-faint outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="text-faint hover:text-ink">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {visible.map((e, i) => (
            <div key={e.id}>
              {/* One divider between the FREE rows and the experts — the list reads as two groups. */}
              {e.kind === 'professional' && i > 0 && visible[i - 1].kind !== 'professional' && (
                <div className="mx-2 my-1.5 flex items-center gap-2">
                  <span className="h-px flex-1 bg-raised" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-faint">Experts</span>
                  <span className="h-px flex-1 bg-raised" />
                </div>
              )}
              <button
                onClick={() => onPick(e.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${current === e.id ? 'bg-indigo-600/15 border border-indigo-500/30' : 'hover:bg-raised border border-transparent'}`}
              >
                {rowIcon(e)}
                <span className="flex-1 min-w-0 truncate">{rowLabel(e)}</span>
                {/* THE TAGS ARE WHAT SEPARATE THE TWO ROWS OF ONE AI. With Teacher AI open the list holds
                    "Teacher AI · Recent" (go back) and "Teacher AI · New chat" (start over) — identical
                    names, opposite actions, so an unlabelled pair would be a coin flip. */}
                {e.kind === 'recent' && <span className="text-[9px] font-bold uppercase tracking-wider text-accent-text shrink-0">Recent</span>}
                {(e.kind === 'free' || e.kind === 'professional') && <span className="text-[9px] font-bold uppercase tracking-wider text-muted shrink-0">New chat</span>}
                {current === e.id && <Check className="w-4 h-4 text-accent-text shrink-0" aria-label="Current mode" />}
              </button>
            </div>
          ))}
          {visible.every((e) => e.kind !== 'professional') && (
            <p className="px-3 py-4 text-[12px] text-muted">No expert matches that search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
