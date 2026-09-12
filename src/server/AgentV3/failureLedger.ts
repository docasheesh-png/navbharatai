// WHY DO BUILDS FAIL? — the platform-level answer (admin: "mera paisa kam kharch ho").
//
// 🔴 THE GAP THIS CLOSES, and it is a gap in what the admin can ACT on rather than in what we measure.
// The dashboard already shows a failure RATE and flags a bad day (`buildFailureAnalytics`), and each
// failed build already gets a classified retrospective (`BuildRetrospectiveEngine`) — but that
// retrospective is written into the WORKSPACE'S OWN memory and nowhere else. So the platform can say
// "29% of builds failed" and cannot say WHY, or what it cost. "29% fail" is a number nobody can act on;
// "dependency resolution: 41 builds, ₹180 of our own money" is a Monday morning's work.
//
// 🔒 THE RUPEES HERE ARE OURS, NOT A USER'S, and that distinction is the whole reason this is
// admin-only. A failed build is NEVER charged — that law is not touched by this file. What is recorded
// is what NavBharatAI itself spent producing nothing: the same real provider cost the billing model
// computes, plus the VM. It is the number that answers "what is the 29% costing me", and it must never
// appear on a user-facing surface (White-Label Law §3).
//
// 🔒 `unknown` IS A CATEGORY, NOT A GAP TO TIDY AWAY. The classifier is honest by design: an error it
// does not recognise is `unknown` rather than a confident wrong label. If `unknown` turns out to be the
// largest bucket, that IS the finding — it means the classifier needs a pattern, and hiding it behind a
// plausible label would hide the most useful thing the ledger can tell us.
//
// PURE — folds in, ranking out. No clock, no I/O.

import type { FailureCategory } from '../lib/BuildRetrospectiveEngine';

/** One failed build, as the settle path observes it. */
export interface FailureEntry {
  category: FailureCategory;
  /** The framework the build was working in, when known. */
  framework?: string;
  /** What NavBharatAI really spent on this build, in USD. ADMIN-only. */
  realUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Wall-clock the build burned before failing. */
  ms: number;
}

export interface CategoryTotals {
  builds: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

export interface FailureDay {
  date: string;
  builds: number;
  usd: number;
  categories: Record<string, CategoryTotals>;
  /** Which frameworks the failures happened in — a count only; no money, to keep the doc small. */
  frameworks: Record<string, number>;
}

const EMPTY: CategoryTotals = { builds: 0, usd: 0, inputTokens: 0, outputTokens: 0, ms: 0 };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * A Firestore map key must not contain `.` or start with `__`. A framework name is free text from a
 * build, so it is normalised rather than trusted — and truncated, because an unbounded key set is how
 * a one-document-per-day rollup grows into something that cannot be written.
 */
export function frameworkKey(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9+-]+/g, '-').replace(/^-+|-+$/g, '');
  return s ? s.slice(0, 40) : 'unknown';
}

/** The most frameworks one day's document will name. Beyond this everything lands in `other`. */
export const MAX_FRAMEWORK_KEYS = 40;

/** Fold one failed build into a day. Returns a NEW document; never mutates its input. PURE. */
export function foldFailure(existing: FailureDay | null | undefined, date: string, entry: FailureEntry): FailureDay {
  const day: FailureDay = {
    date,
    builds: num(existing?.builds),
    usd: num(existing?.usd),
    categories: { ...(existing?.categories ?? {}) },
    frameworks: { ...(existing?.frameworks ?? {}) },
  };

  const cat = String(entry?.category ?? 'unknown') || 'unknown';
  const prev = day.categories[cat] ?? EMPTY;
  const usd = num(entry?.realUsd);
  day.categories[cat] = {
    builds: prev.builds + 1,
    // Six decimals, matching hostingCost: a build can genuinely cost a fraction of a cent, and
    // rounding those to zero would make the cheapest-but-most-frequent failure look free.
    usd: Math.round((prev.usd + usd) * 1e6) / 1e6,
    inputTokens: prev.inputTokens + num(entry?.inputTokens),
    outputTokens: prev.outputTokens + num(entry?.outputTokens),
    ms: prev.ms + num(entry?.ms),
  };

  const fw = frameworkKey(entry?.framework);
  // A new framework only gets its own key while there is room; past the cap it joins `other`, so the
  // document cannot grow without bound on a day of unusual builds.
  const key = (day.frameworks[fw] !== undefined || Object.keys(day.frameworks).length < MAX_FRAMEWORK_KEYS) ? fw : 'other';
  day.frameworks[key] = num(day.frameworks[key]) + 1;

  day.builds += 1;
  day.usd = Math.round((day.usd + usd) * 1e6) / 1e6;
  return day;
}

export interface RankedCause {
  category: string;
  builds: number;
  usd: number;
  /** Share of the window's failed builds, 0-1. */
  shareOfBuilds: number;
  /** Share of the window's wasted money, 0-1. 0 when nothing measurable was spent. */
  shareOfUsd: number;
  /** Average wall-clock burned per failure, in seconds. */
  avgSeconds: number;
}

export interface FailureRanking {
  days: number;
  builds: number;
  usd: number;
  /** Ranked by money wasted, then by count. The first row is where a fix is worth the most. */
  causes: RankedCause[];
  /** The frameworks these failures happened in, most first. */
  frameworks: Array<{ framework: string; builds: number }>;
  /**
   * 🔒 HONEST HEADLINE, and it is deliberately not a reassuring one.
   *
   * When `unknown` leads the ranking it says so in as many words, because that is a statement about
   * OUR classifier rather than about the builds — and a reader who is not told will read the second
   * row as the biggest problem.
   */
  headline: string;
}

/** Rank the causes across a window of days. PURE. */
export function rankFailures(days: ReadonlyArray<FailureDay | null | undefined>): FailureRanking {
  const totals = new Map<string, CategoryTotals>();
  const frameworks = new Map<string, number>();
  let builds = 0;
  let usd = 0;
  let counted = 0;

  for (const d of days || []) {
    if (!d || typeof d.date !== 'string') continue;
    counted++;
    builds += num(d.builds);
    usd += num(d.usd);
    for (const [cat, t] of Object.entries(d.categories ?? {})) {
      const prev = totals.get(cat) ?? EMPTY;
      totals.set(cat, {
        builds: prev.builds + num(t?.builds),
        usd: Math.round((prev.usd + num(t?.usd)) * 1e6) / 1e6,
        inputTokens: prev.inputTokens + num(t?.inputTokens),
        outputTokens: prev.outputTokens + num(t?.outputTokens),
        ms: prev.ms + num(t?.ms),
      });
    }
    for (const [fw, n] of Object.entries(d.frameworks ?? {})) {
      frameworks.set(fw, (frameworks.get(fw) ?? 0) + num(n));
    }
  }

  usd = Math.round(usd * 1e6) / 1e6;
  const causes: RankedCause[] = [...totals.entries()]
    .map(([category, t]) => ({
      category,
      builds: t.builds,
      usd: t.usd,
      shareOfBuilds: builds > 0 ? t.builds / builds : 0,
      shareOfUsd: usd > 0 ? t.usd / usd : 0,
      avgSeconds: t.builds > 0 ? Math.round(t.ms / t.builds / 100) / 10 : 0,
    }))
    // Money first, because that is the question being asked. Count breaks the tie, which matters on a
    // day when nothing measurable was spent — otherwise the order would be arbitrary.
    .sort((a, b) => (b.usd - a.usd) || (b.builds - a.builds) || a.category.localeCompare(b.category));

  return {
    days: counted,
    builds,
    usd,
    causes,
    frameworks: [...frameworks.entries()]
      .map(([framework, n]) => ({ framework, builds: n }))
      .sort((a, b) => (b.builds - a.builds) || a.framework.localeCompare(b.framework)),
    headline: headlineFor(causes, builds, usd),
  };
}

function headlineFor(causes: RankedCause[], builds: number, usd: number): string {
  if (builds === 0) return 'No failed builds recorded in this window.';
  const top = causes[0];
  if (!top) return `${builds} failed build(s) recorded, with no cause recorded against any of them.`;
  const pct = Math.round(top.shareOfBuilds * 100);
  const money = usd > 0 ? ` and $${top.usd.toFixed(4)} of the $${usd.toFixed(4)} spent on builds that produced nothing` : '';
  if (top.category === 'unknown') {
    return `The largest group is UNCLASSIFIED — ${top.builds} of ${builds} failures (${pct}%)${money}. `
      + 'That is a statement about our classifier, not about the builds: it needs a pattern for whatever these errors are, '
      + 'and until it has one the next row is not the biggest real problem.';
  }
  return `The largest cause is ${top.category} — ${top.builds} of ${builds} failures (${pct}%)${money}.`;
}
