// AgentV3 — Trust, Safety & Compliance analysis (additive eighth evaluate dimension).
//
// Layer 77 ("Bharosa"). Real, deterministic static scanning of the USER's app for
// DATA-PROTECTION / PRIVACY defects that block a safe public launch — oriented to
// India's DPDP Act and the EU GDPR. This is intentionally DISTINCT from
// SecurityAnalysis (which catches injection, hardcoded secrets, unsafe eval): here
// we look at how the app treats *people's data* — PII written to logs, sensitive
// values kept in browser storage, third-party trackers running without consent,
// cookies set without SameSite, personal data sent over plain http, and an app
// that collects personal data with no privacy policy at all.
//
// Every rule is computed from real file content (single-line, tag/expression-local)
// so precision stays high and the agent is never sent chasing false positives. The
// dimension also issues an honest "launch-safe certificate" derived only from what
// was actually found — never a synthetic "looks compliant".

export type ComplianceSeverity = 'high' | 'medium' | 'low';

export interface ComplianceIssue {
  file: string;
  line: number;
  kind: string;
  severity: ComplianceSeverity;
  snippet: string;
}

/** Generated / vendored / test code is never the user's product surface. */
export const SKIP_PATH = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;
/** Source files whose content we scan. */
export const CODE_EXT = /\.(tsx?|jsx?|vue|svelte|astro|html?|mjs|cjs)$/i;

const SNIPPET_MAX = 120;

// Sensitive tokens that must never be logged or stored in plaintext on the client.
// Deliberately high-precision (no bare "email"/"phone" — too noisy) so a hit is a
// real data-protection problem, not a guess.
const SENSITIVE = /\b(password|passwd|aadhaar|aadhar|\bpan\b|cvv|\bssn\b|credit[_-]?card|card[_-]?number|otp|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|private[_-]?key|passport)\b/i;

// A client-side console.* sink — the sink that must never receive a credential/token.
export const CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug)\s*\(/;

/**
 * True when this single line logs a sensitive credential/token to the console — the EXACT
 * condition behind the high-severity `pii-in-logs` compliance finding. Exported so the
 * deterministic credential-log redaction heal (`credentialLogRedaction.ts`) heals precisely
 * what this detector flags — one shared definition, so the two can never drift (rule 2).
 */
export function lineLogsCredential(line: string): boolean {
  return CONSOLE_CALL.test(line) && SENSITIVE.test(line);
}

// PII form-field signals — used to decide whether the app collects personal data
// (and therefore needs a privacy policy). Names/types a real form would use.
const PII_FIELD = /\b(name\s*=\s*['"`{]?\s*)?(email|e-mail|phone|mobile|aadhaar|aadhar|\bpan\b|passport|address|dob|date[_-]?of[_-]?birth|credit[_-]?card|card[_-]?number|ssn)\b/i;
const PII_INPUT_TYPE = /type\s*=\s*['"{]?\s*(email|tel|password)\b/i;
// Geolocation access — precise location is sensitive personal data (DPDP/GDPR), so an
// app reading it is collecting PII and needs consent + a privacy policy.
const GEOLOCATION = /navigator\.geolocation|\b(?:getCurrentPosition|watchPosition)\s*\(/;

// Known third-party analytics / trackers that set cookies or fingerprint users.
const TRACKER = /(google-analytics\.com|googletagmanager\.com|\bgtag\s*\(|\bga\s*\(\s*['"](send|create)|analytics\.track\s*\(|mixpanel|hotjar|\bfbq\s*\(|facebook[^\n]*pixel|cdn\.segment\.com|amplitude\.com|clarity\.ms|matomo|plausible\.io)/i;

// A cookie-consent / CMP surface that legitimises trackers.
const CONSENT_UI = /(cookie[\s-]?consent|cookie[\s-]?banner|consent[_-]?manager|gdpr[_-]?consent|CookieConsent|onetrust|cookiebot|tarteaucitron|usercentrics|\bconsent(Given|State|Mode)\b)/i;

/** Does a file's content collect personal data (PII form fields / inputs / geolocation)? */
export function detectsPiiCollection(content: string): boolean {
  return PII_INPUT_TYPE.test(content) || PII_FIELD.test(content) || GEOLOCATION.test(content);
}

/** Does a file load a known third-party tracker? */
export function detectsTracker(content: string): boolean {
  return TRACKER.test(content);
}

/** Does a file implement a cookie/consent surface? */
export function detectsConsentUI(content: string): boolean {
  return CONSENT_UI.test(content);
}

/** Does this file look like a privacy policy / data-protection notice? */
export function looksLikePrivacyPolicy(file: string, content: string): boolean {
  if (/privacy|data[_-]?protection|gdpr|dpdp/i.test(file)) return true;
  return /privacy policy|data protection|how we (use|handle|process) your data|personal (data|information) we collect/i.test(content);
}

function trimSnippet(line: string): string {
  const t = line.trim();
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX) + '…' : t;
}

/**
 * Scan one file for FILE-LOCAL privacy/compliance defects. Project-level rules
 * (missing privacy policy, trackers without consent) are decided by the caller
 * using the exported detectors above, because they need the whole project.
 * Returns [] for skipped/non-code/clean files.
 */
/** The full `res.cookie(...)` call text starting at `lines[i]`, extended across following lines until
 *  its parentheses balance (bounded window). Express cookies are routinely written multi-line —
 *  `res.cookie('sid', v, {\n httpOnly: true,\n secure: true,\n })` — so the httpOnly/secure/sameSite
 *  options live on LATER lines. Evaluating the flags line-locally false-flagged fully-secure cookies
 *  as missing them. PURE. */
function cookieCallText(lines: string[], i: number): string {
  let depth = 0;
  let started = false;
  let text = '';
  for (let j = i; j < lines.length && j < i + 12; j++) {
    text += lines[j] + '\n';
    for (const ch of lines[j]) {
      if (ch === '(') { depth++; started = true; }
      else if (ch === ')') depth--;
    }
    if (started && depth <= 0) break;
  }
  return text;
}

export function scanCompliance(file: string, content: string): ComplianceIssue[] {
  if (!CODE_EXT.test(file) || SKIP_PATH.test(file)) return [];
  const issues: ComplianceIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // skip minified/huge lines
    const push = (kind: string, severity: ComplianceSeverity) =>
      issues.push({ file, line: i + 1, kind, severity, snippet: trimSnippet(line) });

    // ── high: personal data / secrets written to logs (DPDP minimisation, GDPR) ──
    if (lineLogsCredential(line)) {
      push('pii-in-logs', 'high');
    }

    // ── medium: sensitive value kept in browser storage (readable by any script) ─
    if (/\b(localStorage|sessionStorage)\.setItem\s*\(/.test(line) && SENSITIVE.test(line)) {
      push('sensitive-in-browser-storage', 'medium');
    }

    // A cookie being DELETED (logout / clear) does not need SameSite/Secure/httpOnly — the
    // browser is removing it, not storing it. Detect the clear-cookie signals (Max-Age 0/-1,
    // a 1970/past expiry) so logout code is not falsely flagged.
    const isCookieDeletion = /\bmax-?age\s*[:=]\s*-?0\b|expires\s*[:=][^;,)]*(?:1970|Thu,\s*0?1\s*Jan)/i.test(line);

    // ── medium: cookie set without SameSite (cross-site leakage / CSRF surface) ──
    if (/document\.cookie\s*=/.test(line) && !/samesite/i.test(line) && !isCookieDeletion) {
      push('cookie-no-samesite', 'medium');
    }

    // ── medium: server cookie set without httpOnly / Secure. Evaluate the flags over the WHOLE
    // res.cookie(...) call (its options object usually spans several lines) so a fully-secure
    // multi-line cookie isn't false-flagged as missing them (which could downgrade the app to
    // CONDITIONAL). Only compute the window when this line actually opens a res.cookie( call. ───────
    const isResCookie = /\bres(?:ponse)?\.cookie\s*\(/.test(line);
    if (isResCookie) {
      const call = cookieCallText(lines, i);
      const cookieDeleted =
        /\bmax-?age\s*[:=]\s*-?0\b|expires\s*[:=][^;,)]*(?:1970|Thu,\s*0?1\s*Jan)/i.test(call);
      if (!/httponly/i.test(call) && !cookieDeleted) push('cookie-no-httponly', 'medium');
      // XSS can steal a non-httpOnly session/auth token (DPDP/GDPR security-of-processing).
      if (!/\bsecure\b/i.test(call) && !cookieDeleted) push('cookie-no-secure', 'medium');
    }

    // ── medium: a secret/credential carried in a URL query string — it leaks into
    // server access logs, browser history and the Referer header. Use the
    // Authorization header or a POST body instead. ─────────────────────────────────
    if (/[?&](?:password|passwd|token|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|otp|cvv)\s*=/i.test(line)) {
      push('secret-in-url', 'medium');
    }

    // ── high: personal data over plain http:// (in the clear on the network) ─────
    // Only flag a real network call to a non-local host.
    if (/(fetch|axios|\.(get|post|put|patch)|url\s*:)\s*\(?\s*['"`]http:\/\//i.test(line) &&
        !/http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(line)) {
      push('insecure-http-endpoint', 'medium');
    }
  }
  return issues;
}

/** The honest "launch-safe" certificate, derived only from real findings. */
export function launchSafeCertificate(issues: ComplianceIssue[]): string {
  const high = issues.filter((x) => x.severity === 'high').length;
  const medium = issues.filter((x) => x.severity === 'medium').length;
  if (high === 0 && medium === 0) {
    return '🏅 Launch-safe certificate: CERTIFIED — no privacy/compliance blockers found (DPDP/GDPR-oriented checks).';
  }
  if (high > 0) {
    return `⛔ Launch-safe certificate: NOT CERTIFIED — ${high} high-severity privacy/compliance blocker(s) must be fixed before public launch.`;
  }
  return `⚠️ Launch-safe certificate: CONDITIONAL — ${medium} medium issue(s) to review before launch (no hard blockers).`;
}

/** A concise, honest compliance report for the agent, ending with the certificate. */
export function complianceSummary(issues: ComplianceIssue[]): string {
  const cert = launchSafeCertificate(issues);
  if (issues.length === 0) {
    return `Trust & compliance scan: ✓ No privacy/compliance issues detected.\n${cert}`;
  }
  const order: Record<ComplianceSeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = issues.reduce(
    (acc, x) => ((acc[x.severity] = (acc[x.severity] || 0) + 1), acc),
    {} as Record<ComplianceSeverity, number>,
  );
  const head = `Trust & compliance scan: ${issues.length} issue(s) — ` +
    (['high', 'medium', 'low'] as ComplianceSeverity[])
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') + '.';
  const shown = sorted.slice(0, 15);
  const body = shown.map((x) => `  - [${x.severity}] ${x.file}:${x.line} — ${x.kind}: ${x.snippet}`);
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  return [head, ...body, ...more, cert].join('\n');
}
