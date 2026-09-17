// The published-apps list, built ONCE and shown on two screens: a person's own My Profile, and the
// admin's account sheet for that person (admin 2026-09-17).
//
// 🔒 ONE COMPONENT, TWO SCREENS, ON PURPOSE. The admin decides things about an account by reading
// this list; the owner reads the same list about themselves. If the two were built separately they
// would drift, and the drift would be invisible — an admin would see six apps where the owner sees
// four and neither would know which screen was wrong. The differences that are REAL (an admin also
// sees apps that are no longer live, and whose they are) are props, not a second component.
//
// ⚠️ OPENING IS `openExternalUrl`, NEVER A BARE `target="_blank"`. Three reasons, and the first is
// the admin's actual request: on the Android shell a bare `_blank` opens inside the app's own
// WebView (or silently does nothing), and what was asked for is *"chrome ke new page me"* — that
// helper passes `_system`, which hands the link to the real browser. It also validates the scheme
// again at the moment of opening, and on the web it passes `noopener,noreferrer` — which matters
// most exactly here, because an admin is being invited to open a page somebody else wrote.

import React from 'react';
import { Globe, ExternalLink, AlertTriangle } from 'lucide-react';
import { openExternalUrl } from '../../lib/mobileNative';
import { statusWords, type PublishedAppRow } from '../../lib/publishedAppsView';

export interface PublishedAppsCardProps {
  rows: readonly PublishedAppRow[];
  loading?: boolean;
  /** An honest failure — "we could not read this", which is NOT the same as "there are none". */
  error?: string;
  /** How many slots the plan allows, when the screen knows. Omitted rather than guessed. */
  used?: number;
  cap?: number;
  planName?: string | null;
  /** Admin view: show the status badge and non-live apps. The owner's own list is live apps only. */
  showStatus?: boolean;
  /**
   * The authoritative live count, when the caller has one the rows cannot give.
   *
   * 🔴 The admin sheet truncates its list to 20 rows, so counting what is ON SCREEN would under-report
   * a heavy account — the server counts every record and sends the number. Absent, the rows are the
   * whole truth and counting them is right (the owner's own endpoint returns all of them).
   */
  liveCount?: number;
  /** Total records behind a truncated list, so the screen can say it is showing only some. */
  totalCount?: number;
  /** What to say when the list is genuinely empty. */
  emptyText: string;
  /** Compact spacing for the admin sheet, which is a dense panel. */
  dense?: boolean;
}

function whenWords(at: number | null): string {
  if (at === null) return '';
  try { return new Date(at).toLocaleDateString(); } catch { return ''; }
}

export const PublishedAppsCard: React.FC<PublishedAppsCardProps> = ({
  rows, loading, error, used, cap, planName, showStatus, emptyText, dense, liveCount, totalCount,
}) => {
  const live = typeof liveCount === 'number' ? liveCount : rows.filter((r) => r.status === 'active').length;
  // "Showing 20 of 43" — an admin must never read a capped list as the whole account.
  const truncated = typeof totalCount === 'number' && totalCount > rows.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className={`font-bold text-white ${dense ? 'text-[12px]' : 'text-sm'}`}>
          {/* The NUMBER is the thing the admin asked to see, so it leads rather than sitting in a
              corner. "Live" is said out loud because the list below can also contain apps that are
              not — and a count that silently means something different from its label is how the
              admin sheet came to report taken-down apps as live. */}
          {live} published app{live === 1 ? '' : 's'} live
        </p>
        {typeof used === 'number' && typeof cap === 'number' && cap > 0 && (
          <span className="text-[11px] text-[#8b949e]">
            {used} of {cap} {planName ? `${planName} slots` : 'free slots'} used
          </span>
        )}
      </div>

      {error && <p className="text-[11.5px] text-amber-300 leading-relaxed">{error}</p>}
      {loading && !error && <p className="text-[11.5px] text-[#8b949e]">Loading…</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-[11.5px] text-[#8b949e] leading-relaxed">{emptyText}</p>
      )}

      <ul className="flex flex-col gap-1.5" role="list">
        {rows.map((app) => (
          <li
            key={app.workspaceId}
            className={`rounded-xl border border-white/10 bg-white/[0.03] flex items-center gap-2.5 ${dense ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
          >
            <span className="shrink-0 rounded-lg border border-emerald-500/25 bg-emerald-500/15 p-1.5">
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-white truncate">{app.label}</span>
              <span className="block text-[10.5px] text-[#8b949e] truncate">
                {showStatus ? statusWords(app.status) : null}
                {showStatus && (app.sizeMb !== null || app.updatedAt !== null) ? ' · ' : ''}
                {app.sizeMb !== null ? `${app.sizeMb.toFixed(1)} MB` : 'size unknown'}
                {app.updatedAt !== null ? ` · updated ${whenWords(app.updatedAt)}` : ''}
              </span>
              {app.orphaned && (
                <span className="flex items-center gap-1 text-[10.5px] text-amber-300/90 mt-0.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Its chat was deleted — still live, but it cannot be reopened for editing
                </span>
              )}
            </span>
            {app.openable ? (
              <button
                type="button"
                onClick={() => openExternalUrl(app.url)}
                // The address is in the label, but a screen reader lands on the button alone — so it
                // has to say WHICH app it opens, not just "Open".
                aria-label={`Open ${app.label} in a new tab`}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-500/20 transition-colors touch-manipulation"
              >
                Open <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              // An app that is not live has no working address. A greyed-out control that SAYS why
              // is honest; a button that opens a dead page is not.
              <span className="shrink-0 text-[10.5px] text-[#8b949e] px-2">
                {app.status === 'active' ? 'No link' : statusWords(app.status)}
              </span>
            )}
          </li>
        ))}
      </ul>

      {truncated && (
        <p className="text-[10.5px] text-[#8b949e]">Showing the {rows.length} most recent of {totalCount} records.</p>
      )}
    </div>
  );
};
