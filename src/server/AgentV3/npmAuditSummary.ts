// AgentV3 — read the vulnerability count npm ALREADY reported, instead of asking a network API for it.
//
// ROOT CAUSE (admin report 2026-08-12, the dukaan stock app). The build's own install command printed:
//
//     added 182 packages, and audited 183 packages in 16s
//     8 vulnerabilities (4 moderate, 4 high)
//     To address issues that do not require attention, run:  npm audit fix
//
// Four HIGH-severity vulnerabilities went into a shop owner's inventory app, and the build report said
// NOTHING about it. Not "we checked and it's fine", not "we couldn't check" — nothing at all.
//
// The platform does have a dependency-health gate (AGENTV3_DEPHEALTH_GATE, on in production). It asks
// the OSV API over the network, and — by its own documentation — returns '' (clean) when that API is
// unreachable. So "no vulnerabilities" and "we never found out" produce byte-identical output, which is
// the exact class of dishonesty the wallet rules forbid elsewhere ("free" and "unmeasured" must stay
// separate outcomes). On this build it produced nothing, and nothing is what the report showed.
//
// Meanwhile npm had already run the audit, already printed the answer, and we had already captured the
// output. This module reads it: no network call, no model call, no extra command — the measurement was
// sitting in a log nobody parsed.

export interface NpmAuditSummary {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
}

/** npm 7+: "8 vulnerabilities (4 moderate, 4 high)" · npm 6: "found 8 vulnerabilities (…)". */
const GROUPED_RE = /(?:found\s+)?(\d+)\s+vulnerabilit(?:y|ies)\s*\(([^)]*)\)/gi;
/** The singular/simple forms: "found 0 vulnerabilities", "1 high severity vulnerability". */
const SIMPLE_RE = /(?:found\s+)?(\d+)\s+(critical|high|moderate|low|info)\s+severity\s+vulnerabilit(?:y|ies)/gi;
const ZERO_RE = /(?:found\s+)?0\s+vulnerabilit(?:y|ies)/i;

const LEVELS = ['critical', 'high', 'moderate', 'low', 'info'] as const;
type Level = (typeof LEVELS)[number];

const empty = (): NpmAuditSummary => ({ total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 });

/**
 * Parse npm's own audit summary out of an install (or `npm audit`) log.
 *
 * Returns null when the log carries no audit summary at all — which is NOT the same as zero
 * vulnerabilities, and the caller must not conflate them. A clean tree returns a summary whose totals
 * are 0; a log we could not read anything from returns null.
 *
 * The LAST summary in the log wins: a build that installs twice prints two, and only the final one
 * describes the tree the app actually ships with. PURE.
 */
export function parseNpmAuditSummary(output: string | undefined | null): NpmAuditSummary | null {
  const text = typeof output === 'string' ? output : '';
  if (!text) return null;

  let last: NpmAuditSummary | null = null;

  // Grouped form first — it carries the per-severity breakdown, which is the whole point.
  GROUPED_RE.lastIndex = 0;
  for (let m = GROUPED_RE.exec(text); m; m = GROUPED_RE.exec(text)) {
    const s = empty();
    s.total = Number(m[1]);
    for (const part of m[2].split(',')) {
      const pm = /(\d+)\s*(critical|high|moderate|low|info)/i.exec(part);
      if (pm) s[pm[2].toLowerCase() as Level] = Number(pm[1]);
    }
    last = s;
  }
  if (last) return last;

  // Singular form: "1 high severity vulnerability". Several lines can appear together.
  SIMPLE_RE.lastIndex = 0;
  const simple = empty();
  let sawSimple = false;
  for (let m = SIMPLE_RE.exec(text); m; m = SIMPLE_RE.exec(text)) {
    simple[m[2].toLowerCase() as Level] += Number(m[1]);
    sawSimple = true;
  }
  if (sawSimple) {
    simple.total = LEVELS.reduce((n, l) => n + simple[l], 0);
    return simple;
  }

  // An explicit clean result is a REAL measurement and must be reported as one.
  if (ZERO_RE.test(text)) return empty();
  return null;
}

/** Whether this command's output is worth scanning for an audit summary at all. PURE. */
export function looksLikeDependencyInstall(command: string | undefined | null): boolean {
  const c = String(command ?? '');
  if (!c) return false;
  return /\b(?:npm|pnpm|yarn|bun)\b[^\n]*\b(?:install|i|add|ci|audit)\b/.test(c);
}

/**
 * The honest report line, or null when there is nothing worth saying.
 *
 * A clean tree gets no line — a build that says "0 vulnerabilities" on every run trains people to stop
 * reading. Only a real finding speaks up.
 *
 * WHITE-LABEL: names the user's own package manager (which is theirs, not a vendor of ours) and the one
 * command npm itself recommends. `npm audit fix` WITHOUT --force is SemVer-compatible by npm's own
 * contract — it is the safe half of npm's advice, and the reason `--force` is deliberately not
 * suggested here is that it applies breaking major upgrades that can take a working app down.
 */
export function npmAuditNote(s: NpmAuditSummary | null): string | null {
  if (!s || s.total <= 0) return null;
  const parts = LEVELS.filter((l) => s[l] > 0).map((l) => `${s[l]} ${l}`);
  const serious = s.critical + s.high;
  const head = `${s.total} known ${s.total === 1 ? 'vulnerability' : 'vulnerabilities'} in this app's dependencies (${parts.join(', ')}).`;
  const action = ' Running `npm audit fix` applies the compatible fixes; it does not upgrade across a major version, so it will not change how the app behaves.';
  return serious > 0
    ? `${head} ${serious} of ${serious === 1 ? 'them is' : 'them are'} high or critical.${action}`
    : `${head}${action}`;
}

/** High/critical present ⇒ worth a warning on the health card. Anything milder is informational. PURE. */
export function auditSeverity(s: NpmAuditSummary | null): 'warning' | 'info' | null {
  if (!s || s.total <= 0) return null;
  return s.critical + s.high > 0 ? 'warning' : 'info';
}
