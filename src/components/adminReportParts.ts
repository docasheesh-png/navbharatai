// Admin build-report PARTS — the "1st / 2nd / 3rd … / All" selector and its payloads.
//
// ADMIN 2026-08-09: "jab koi user app bana kar report kare, to puri report, sabhi edit sath 0 to 100
// admin ko send ho. Admin ke pas option ho kitne part download/copy karne hai — 1st, 2nd, 3rd … all.
// Aur sirf download ka option aa raha hai, copy bhi add karo! Aur build report JSON me hi copy hi,
// text me nahi."
//
// A reported record now carries the WHOLE session (every build/edit). This module turns that into the
// list of choosable parts and the exact JSON each choice yields. PURE — no DOM, no clipboard — so the
// numbering, the labels and (most importantly) the payload boundaries are unit-testable. The UI does
// only two things with it: render `label`, and hand `json` to the clipboard or a download blob.

/** A report record as the admin dashboard holds it (only the fields this module needs). */
export interface ReportLike {
  meta?: { id?: string; appLabel?: string | null; sessionParts?: number } | null;
  report?: unknown;
  session?: { builds?: unknown[]; count?: number; omittedBuilds?: number } | null;
}

export interface ReportPart {
  /** 'all' or the zero-based index of one build, as a string — stable for a <select> value. */
  key: string;
  /** What the admin reads: "All 5 parts", "1st part", "2nd part"… */
  label: string;
  /** Filename stem for a download (no extension). */
  filename: string;
}

/** English ordinal for a 1-based position: 1st, 2nd, 3rd, 4th, 11th, 21st… PURE. */
export function ordinal(n: number): string {
  const v = Math.trunc(n);
  const mod100 = Math.abs(v) % 100;
  const mod10 = Math.abs(v) % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${v}${suffix}`;
}

/** How many parts a record actually carries (never 0 — a record always has at least its focused build). */
export function partCount(rec: ReportLike | null | undefined): number {
  const n = rec?.session?.builds?.length ?? 0;
  return n > 0 ? n : 1;
}

/**
 * The choosable parts: "All" first (the common case — the admin wants everything), then each build.
 * A single-build record yields ONLY "All", because "All" and "1st part" would be the same bytes and
 * offering both is a decision with no difference behind it. PURE.
 */
export function reportParts(rec: ReportLike | null | undefined): ReportPart[] {
  const total = partCount(rec);
  const stem = (rec?.meta?.id ? String(rec.meta.id) : 'build-report').replace(/[^A-Za-z0-9_-]/g, '');
  const all: ReportPart = {
    key: 'all',
    label: total > 1 ? `All ${total} parts` : 'Full report',
    filename: total > 1 ? `${stem}-all-${total}-parts` : stem,
  };
  if (total <= 1) return [all];
  const each = Array.from({ length: total }, (_, i) => ({
    key: String(i),
    label: `${ordinal(i + 1)} part`,
    filename: `${stem}-part-${i + 1}`,
  }));
  return [all, ...each];
}

/**
 * The JSON for a chosen part.
 *  • 'all'  → the ENTIRE record (meta + focused report + every session build) — nothing hidden.
 *  • '0','1',… → that ONE build, wrapped with the identifying meta so a pasted part is never an
 *    anonymous blob: the admin can always see which report and which position it came from.
 * Returns '' when there is nothing to give (no record), so a caller can disable the button honestly.
 * PURE.
 */
export function partJson(rec: ReportLike | null | undefined, key: string): string {
  if (!rec) return '';
  try {
    if (key === 'all') return JSON.stringify(rec, null, 2);
    const idx = Number.parseInt(key, 10);
    const builds = rec.session?.builds;
    if (!Array.isArray(builds) || !Number.isInteger(idx) || idx < 0 || idx >= builds.length) return '';
    return JSON.stringify(
      {
        meta: rec.meta ?? null,
        part: { index: idx + 1, of: builds.length, label: `${ordinal(idx + 1)} part` },
        report: builds[idx],
      },
      null,
      2,
    );
  } catch {
    return ''; // an unserialisable record must disable the button, never copy "undefined"
  }
}

/** One honest line about what the record contains — including builds dropped by the size cap. */
export function partsSummary(rec: ReportLike | null | undefined): string {
  const total = partCount(rec);
  const omitted = rec?.session?.omittedBuilds ?? 0;
  // A session too large to store keeps ONE part (the focused build) but is not a single-build session —
  // saying "Single build" there would hide the fact that earlier builds existed and were dropped.
  if (total <= 1) {
    return omitted > 0
      ? `Only the reported build could be stored · ${omitted} earlier build(s) omitted — session too large`
      : 'Single build';
  }
  const base = `${total} parts (every build/edit of this session)`;
  return omitted > 0 ? `${base} · ${omitted} older build(s) omitted — too large to store` : base;
}
