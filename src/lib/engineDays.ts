/**
 * The admin Build Engines panel's per-day engine stats, shape-checked at the one place the server body enters state.
 * A row that is not the shape is dropped, never guessed; an unreadable list is `null` ("could not read"), which the
 * screen must never show the same as "nothing ran".
 */
export interface EngineDayRow {
  engine: string;
  builds: number;
  requests: number;
  answered: number;
  failed: number;
  timedAnswers: number;
  avgAnswerMs: number | null;
  reasons: Record<string, number>;
  carriedBy: Record<string, number>;
}
export interface EngineDays {
  /** Newest first. null = the server could not read the days. */
  days: Array<{ day: string; engines: EngineDayRow[] }> | null;
  reasonText: Record<string, string>;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (n(x) > 0) out[k] = n(x);
  return out;
}
function row(v: unknown): EngineDayRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.engine !== 'string' || !r.engine) return null;
  const answered = n(r.answered), failed = n(r.failed);
  return {
    engine: r.engine, builds: n(r.builds), answered, failed, requests: answered + failed, timedAnswers: n(r.timedAnswers),
    avgAnswerMs: typeof r.avgAnswerMs === 'number' && Number.isFinite(r.avgAnswerMs) && r.avgAnswerMs >= 0 ? r.avgAnswerMs : null,
    reasons: counts(r.reasons), carriedBy: counts(r.carriedBy),
  };
}

/** `/api/admin/engines` → its `engineDays`, or undefined when the server sent none (an older server). */
export function engineDaysOf(body: unknown): EngineDays | undefined {
  const raw = body && typeof body === 'object' ? (body as { engineDays?: unknown }).engineDays : undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { days?: unknown; reasonText?: unknown };
  const reasonText: Record<string, string> = {};
  if (r.reasonText && typeof r.reasonText === 'object') {
    for (const [k, t] of Object.entries(r.reasonText as Record<string, unknown>)) if (typeof t === 'string') reasonText[k] = t;
  }
  if (!Array.isArray(r.days)) return { days: null, reasonText };
  const days = r.days.flatMap((d) => {
    if (!d || typeof d !== 'object' || typeof (d as { day?: unknown }).day !== 'string') return [];
    const engines = Array.isArray((d as { engines?: unknown }).engines) ? ((d as { engines: unknown[] }).engines.map(row).filter(Boolean) as EngineDayRow[]) : [];
    return [{ day: (d as { day: string }).day, engines }];
  });
  return { days, reasonText };
}
