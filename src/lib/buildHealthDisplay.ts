// buildHealthDisplay — the USER-FACING simplifier for Build-health card lines (admin 2026-08-02:
// "isko itna bada aur complex likhne ki need nahi hai — simple aur short karo").
//
// The readiness engine's lines are deliberately FORENSIC ("hardcoded-secret @ server/index.js:24 —
// Hardcoded credential — load it from an environment variable instead. | …") because the repair loop
// and the admin report need file:line specifics ("you can't fix what you can't see"). But the CARD is
// a user surface: a non-technical builder just needs to know WHAT kind of problem and HOW MANY, in one
// short line each. So this module is the single display choke point: it maps each technical line to a
// short plain-language line, de-duplicates repeats (the same "Security config (wildcard-cors)" used to
// show twice), and the full detail stays available in the Report. Pure + unit-tested.

/** Friendly names for the security rules a user is most likely to see. */
const RULE_LABELS: Record<string, string> = {
  'hardcoded-secret': 'secret keys are written in the code',
  'connection-string-credentials': 'a database password is written in the code',
  'hardcoded-provider-token': 'an API token is written in the code',
  'insecure-random-token': 'a token is generated insecurely',
  'wildcard-cors': 'an open CORS setting',
  'unsafe-target-blank': 'an unsafe external link',
  'dangerously-set-html': 'unsafe HTML rendering',
  'eval-usage': 'unsafe eval() usage',
};

function ruleLabel(rule: string): string {
  return RULE_LABELS[rule.trim()] ?? rule.trim().replace(/-/g, ' ');
}

/** First security rule named inside a "…: rule @ file:line — msg | …" detail tail. */
function firstRule(detail: string): string | null {
  const m = detail.match(/([a-z0-9-]+) @ /i);
  return m ? m[1] : null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * One technical readiness line → one short, plain user line. Unrecognized lines pass through with
 * their technical tail (everything after the first ":", "—" code frames, file paths) trimmed off.
 */
export function simplifyHealthLine(line: string): string {
  const l = String(line || '').trim();

  let m = l.match(/^(\d+) high-severity security issue\(s\):(.*)$/s);
  if (m) {
    const n = Number(m[1]);
    const rule = firstRule(m[2]);
    return `${n} security ${plural(n, 'issue', 'issues')} to fix${rule ? ` — ${ruleLabel(rule)}` : ''}`;
  }
  m = l.match(/^(\d+) (?:medium|low)-severity security issue\(s\):(.*)$/s);
  if (m) {
    const n = Number(m[1]);
    const rule = firstRule(m[2]);
    return `${n} smaller security ${plural(n, 'warning', 'warnings')}${rule ? ` — ${ruleLabel(rule)}` : ''}`;
  }
  m = l.match(/^Security config \(([^)]+)\)$/);
  if (m) return `A security setting needs tightening — ${ruleLabel(m[1])}`;
  m = l.match(/^(\d+) fake\/incomplete code issue/);
  if (m) return `${m[1]} incomplete ${plural(Number(m[1]), 'feature', 'features')} (placeholder code)`;
  if (/^the live preview will not compile/i.test(l)) {
    return `The app won't open yet — one code error still needs fixing`;
  }
  m = l.match(/^(\d+) unresolved import\(s\)/);
  if (m) return `${m[1]} broken ${plural(Number(m[1]), 'import', 'imports')} — the app won't build yet`;
  m = l.match(/^(\d+) component\(s\) created but never used/);
  if (m) return `${m[1]} ${plural(Number(m[1]), 'part is', 'parts are')} built but not connected yet`;
  m = l.match(/^(\d+) server-only Node builtin import\(s\)/);
  if (m) return `${m[1]} server-only ${plural(Number(m[1]), 'import', 'imports')} used in the app screen — won't run in the browser`;
  m = l.match(/^(\d+) import cycle\(s\)/);
  if (m) return `${m[1]} circular ${plural(Number(m[1]), 'dependency', 'dependencies')}`;
  if (/^readiness score \d+\/100 is below/.test(l)) return 'Overall quality is below the bar — needs a bit more work';

  // Unknown line: keep only the head before any technical detail (": …", "— …", code frames).
  const head = l.split(/\s+[—|]\s+|:\s/)[0].trim();
  return head.length >= 8 ? head : l.slice(0, 80);
}

/**
 * Simplify a full list for the card: map each line, DE-DUPLICATE the results (repeat findings used to
 * render as identical rows), and cap the count — the Report keeps every detail.
 */
export function simplifyHealthLines(lines: string[], max: number): { lines: string[]; more: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const s = simplifyHealthLine(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  const shown = out.slice(0, Math.max(1, max));
  return { lines: shown, more: Math.max(0, out.length - shown.length) };
}
