// Build-report failure analytics (M8-S8.1) — turn the admin Build-Reports inbox into a data-driven
// signal: WHICH failure class recurs most, so the roadmap is prioritised from real evidence instead of
// guesswork. Pure + isomorphic (no server deps) so the admin dashboard computes it client-side from the
// already-fetched report list, and it is unit-testable without any network.

/** The minimal report shape this analysis needs (a structural subset of the admin report row). */
export interface FailureAnalyticsInput {
  ok: boolean | null;
  rootCause: string | null;
  appLabel?: string | null;
}

export interface FailurePattern {
  /** A short, human category label (e.g. "React Rules-of-Hooks violation"). */
  label: string;
  /** How many failed builds fall into this pattern. */
  count: number;
  /** One representative rootCause line (verbatim, capped) for the admin to eyeball. */
  sample: string;
  /** Up to 3 distinct app labels that hit this pattern. */
  apps: string[];
}

export interface FailureSummary {
  totalReports: number;
  totalFailed: number;
  patterns: FailurePattern[];
}

/**
 * Known failure categories, matched against a failed build's rootCause. Ordered most-specific first so
 * a rootCause that could match two rules lands in the more precise bucket. A rootCause matching none
 * falls back to a normalised signature (below), so nothing is silently dropped.
 */
const CATEGORY_RULES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'React Rules-of-Hooks violation', re: /rules[- ]of[- ]hooks|hook.*(conditional|after an early return|in a loop)/i },
  { label: 'Reviewer critical not resolved', re: /reviewer \[critical\]|\[critical\] finding|reviewer .*not verifiably/i },
  { label: 'Build hit the wall-clock time cap', re: /wall-clock|exceeded the \d+s|time (cap|limit)|build timeout/i },
  { label: 'Unresolved / missing imports', re: /unresolved import|cannot find module|missing (local )?module|undefined (jsx )?component/i },
  { label: 'Syntax / compile error', re: /syntax error|does not parse|already been declared|typecheck failed|tsc/i },
  { label: 'Missing dependency in package.json', re: /missing dependenc|not in package\.json|undeclared package/i },
  { label: 'Sandbox / preview did not come up', re: /sandbox|dev server did not|preview.*(blank|not render|failed)|port/i },
  { label: 'Empty build (no files produced)', re: /empty build|produced zero|no files were written/i },
  { label: 'All AI providers failed', re: /all .*providers failed|provider.*unavailable/i },
];

/** Collapse a rootCause into a stable signature (strip numbers, file paths, quotes) for the fallback bucket. */
function normalizeSignature(rootCause: string): string {
  return rootCause
    .split('\n')[0] // first line only — the headline cause
    .replace(/[a-zA-Z0-9_./-]+@[a-zA-Z0-9_./-]+:\d+/g, '<loc>') // file@path:line
    .replace(/[a-zA-Z0-9_./-]+\.(tsx?|jsx?|css|json|vue|svelte)\b/gi, '<file>') // file names
    .replace(/["'`][^"'`]*["'`]/g, '<x>') // quoted specifics
    .replace(/\d+/g, '#') // any number
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function categoryFor(rootCause: string): string {
  for (const rule of CATEGORY_RULES) if (rule.re.test(rootCause)) return rule.label;
  const sig = normalizeSignature(rootCause);
  return sig || 'Other failure';
}

/**
 * Summarise the recurring failure patterns across a set of build reports. Only FAILED builds
 * (ok === false) with a rootCause are counted; the result is sorted by frequency, then capped.
 * Pure — never throws, tolerant of junk input.
 */
export function summarizeFailurePatterns(reports: FailureAnalyticsInput[], topN = 8): FailureSummary {
  const list = Array.isArray(reports) ? reports : [];
  const failed = list.filter((r) => r && r.ok === false && typeof r.rootCause === 'string' && r.rootCause.trim());
  const buckets = new Map<string, { count: number; sample: string; apps: Set<string> }>();
  for (const r of failed) {
    const cause = (r.rootCause as string).trim();
    const label = categoryFor(cause);
    const b = buckets.get(label) ?? { count: 0, sample: cause.split('\n')[0].slice(0, 160), apps: new Set<string>() };
    b.count += 1;
    if (r.appLabel && b.apps.size < 3) b.apps.add(r.appLabel);
    buckets.set(label, b);
  }
  const patterns: FailurePattern[] = [...buckets.entries()]
    .map(([label, b]) => ({ label, count: b.count, sample: b.sample, apps: [...b.apps] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, Math.max(1, topN));
  return { totalReports: list.length, totalFailed: failed.length, patterns };
}
