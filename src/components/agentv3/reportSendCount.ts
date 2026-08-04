// How many times THIS build's report has already been submitted to the admin (admin 2026-08-04:
// "report (1), report (2) aise — jisse duplicate report na ho").
//
// THE PROBLEM: the "Report" action gave a 4-second "Report sent" flash and then went back to plain
// "Report". A user who was not watching at that moment had no way to tell whether their report had
// already gone through, so the same build got reported two or three times — noise in the admin inbox
// and no signal about which builds actually hurt. The count makes the state VISIBLE and durable.
//
// KEYED PER BUILD, not per session: a new build genuinely deserves a new report, so the count resets
// on its own when the build changes. Persisted in localStorage so a page reload (the exact case where
// a user re-reports out of doubt) still shows the truth. Bounded so the key never grows without limit.
//
// PURE + storage-guarded: every function is safe on a server render and never throws.

const KEY = 'nbv3:report-send-counts';
/** Keep the most recent N builds' counts — plenty for one device, never unbounded. */
const MAX_TRACKED = 40;

/** Stable identity for "this build's report". Empty when there is nothing to report yet. */
export function reportKey(workspaceId: string | null | undefined, buildId: string | null | undefined): string {
  const ws = (workspaceId || '').trim();
  const build = (buildId || '').trim();
  if (!ws && !build) return '';
  return `${ws}#${build}`;
}

type CountMap = Record<string, number>;

function readAll(): CountMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: CountMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** Trim to the newest MAX_TRACKED entries (insertion order = recency, since we re-insert on bump). */
function trim(map: CountMap): CountMap {
  const keys = Object.keys(map);
  if (keys.length <= MAX_TRACKED) return map;
  const keep = keys.slice(keys.length - MAX_TRACKED);
  const out: CountMap = {};
  for (const k of keep) out[k] = map[k];
  return out;
}

/** How many times this build's report has been sent from this device. 0 when never. */
export function reportSendCount(key: string): number {
  if (!key) return 0;
  return readAll()[key] ?? 0;
}

/** Record one more successful submission and return the NEW count. Never throws. */
export function bumpReportSendCount(key: string): number {
  if (!key) return 0;
  const map = readAll();
  const next = (map[key] ?? 0) + 1;
  delete map[key];   // re-insert so this key counts as the most recent for trimming
  map[key] = next;
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(KEY, JSON.stringify(trim(map))); } catch { /* quota/private mode — the count degrades to in-session only */ }
  }
  return next;
}

/**
 * The label the Report button shows. PURE — the single source of truth for every surface, so the
 * desktop pill and the mobile More sheet can never drift apart.
 */
export function reportButtonLabel(opts: { sending: boolean; justSent: boolean; count: number }): string {
  if (opts.sending) return 'Sending…';
  if (opts.justSent) return opts.count > 1 ? `Report sent (${opts.count})` : 'Report sent';
  return opts.count > 0 ? `Report (${opts.count})` : 'Report';
}

/** Honest hint under a report that has already been sent — tells the user re-sending is not needed. */
export function reportAlreadySentHint(count: number): string {
  if (count <= 0) return '';
  return count === 1
    ? 'Already sent once for this build — no need to send it again.'
    : `Already sent ${count} times for this build — no need to send it again.`;
}
