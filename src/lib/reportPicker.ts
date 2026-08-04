/**
 * The build-report PICKER list — which past build the user is choosing to report.
 *
 * WHY THIS EXISTS (admin 2026-08-04): "Report" could only ever send the LATEST build. So a bug the
 * user hit three edits ago was unreportable — they clicked Report, and we received a report about a
 * completely different, working build. The picker lets them point at the build that actually broke.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. On 2026-07-29 the admin made the build report ADMIN-ONLY: the
 * user submits it, never reads it. A picker is only compatible with that if it shows nothing FROM
 * the report — so an item carries exactly three things, all of which the user already knows because
 * they were there: when the build ran, what they asked for (their own words), and whether it
 * succeeded. No summary, no root cause, no issue counts, and — the White-Label Law — nothing that
 * could name a provider or a model. That is why the label is built from `prompt` and never from
 * `summary`/`rootCause`: those are OUR analysis, and our analysis is admin-only.
 *
 * Pure and isomorphic on purpose: the server builds the list from the durable history, the client
 * renders it, and one tested function decides what a user-facing row may contain.
 */

/** One selectable past build. Everything here is information the user already has. */
export interface ReportPickerItem {
  /** History id — what the submit call sends back so the RIGHT report is delivered. */
  id: string;
  /**
   * The build's own id, when it has one. Carried ONLY so the client can key "already sent" counts on
   * the same identity the header button uses — the history id is the build's `startedAt`, so without
   * this the same build would be counted under two different keys and the duplicate-report guard
   * would miss. Never used to fetch: the submit call always sends the history `id`.
   */
  buildId?: string;
  startedAt: number;
  endedAt?: number;
  /** Whether that build succeeded. A plain fact the user watched happen. */
  ok?: boolean;
  /** A short label from the user's OWN prompt. Never our description of the build. */
  label: string;
}

/** What the picker is built from. A subset of DiagnosticsHistoryEntry, so the server can pass one straight in. */
export interface ReportPickerSource {
  id: string;
  buildId?: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  prompt?: string;
}

/** Long enough to tell two edits apart, short enough to read in a dropdown row. */
export const PICKER_LABEL_MAX = 90;

/**
 * Turn the user's prompt into one readable line.
 *
 * A build prompt is often many lines with blank runs and trailing context; collapsed to a single
 * line it is instantly recognisable ("add a dark mode toggle…"). An empty prompt is not hidden or
 * invented — it becomes an honest "Untitled build", because an edit turn genuinely can carry no
 * stored prompt and pretending otherwise would mislabel the row the user is choosing.
 */
export function reportLabel(prompt: string | undefined | null): string {
  const flat = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'Untitled build';
  return flat.length > PICKER_LABEL_MAX ? `${flat.slice(0, PICKER_LABEL_MAX - 1).trimEnd()}…` : flat;
}

/**
 * Strip a history entry down to a picker row.
 *
 * Written as an explicit CONSTRUCTION, never a spread-and-delete: a spread would silently carry any
 * field later added to the history entry (a new `rootCause`-shaped field, a provider label) straight
 * onto a user's screen. Adding a field here has to be a deliberate decision.
 */
export function toPickerItem(entry: ReportPickerSource): ReportPickerItem {
  return {
    id: entry.id,
    buildId: entry.buildId,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    ok: entry.ok,
    label: reportLabel(entry.prompt),
  };
}

/**
 * The full list: newest first, one row per build, nothing unusable.
 *
 * Entries without an id are dropped — an id is what the submit call sends back, so a row that cannot
 * be submitted must not be offered. Duplicate ids keep the first (newest) occurrence.
 */
export function pickerItems(entries: ReportPickerSource[] | null | undefined): ReportPickerItem[] {
  const seen = new Set<string>();
  const out: ReportPickerItem[] = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(toPickerItem(e));
  }
  return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
