// AgentV3 — Content-Security-Policy (CSP) meta analysis (additive evaluate dimension).
//
// A real, deterministic scan for a distinct hardening gap that no other analyzer covers: a STATIC SPA
// (no server in the build) that loads a third-party `<script src="https://…">` but ships NO
// `<meta http-equiv="Content-Security-Policy">`. It complements the other two script-security passes:
//   • SriAnalysis pins the integrity HASH of a specific known CDN script (defends the KNOWN script).
//   • SecurityHeadersAnalysis checks a SERVER for a CSP *header* (defends server-rendered responses).
//   • This pass covers the case both miss — a serverless static SPA has no place to set a CSP header, so
//     the ONLY way it can restrict where scripts load from / what injected script may do is a CSP <meta>.
//
// Why it matters: CSP is defense-in-depth against XSS. Even with SRI on every known tag, an injected
// inline `<script>` (from a reflected/stored XSS or a compromised dependency) runs freely without a CSP.
// A `default-src`/`script-src` policy in a meta tag lets a static SPA constrain script origins with no
// server. It is the standard, one-tag defence for a static single-page app.
//
// Read-only and HIGH PRECISION by design (never nag a correct or inapplicable app):
//   • Only fires for a STATIC SPA — a build with NO backend files (server/API/route/etc.). If the build
//     HAS a server, CSP belongs in an HTTP header (SecurityHeadersAnalysis owns that), so flagging a meta
//     tag would be wrong — that whole class is skipped here to avoid double-reporting/noise.
//   • Only fires when the HTML loads at least one ABSOLUTE cross-origin `<script src="https://…">`. A SPA
//     with only first-party bundled scripts has no external-origin execution risk, so it is never nagged.
//   • An HTML that ALREADY has a `<meta http-equiv="Content-Security-Policy">` is correct and never flagged.
//   • Advisory only (severity 'low') — a static SPA without a CSP is a hardening opportunity, not a defect;
//     it lowers the score gently and NEVER blocks a build.
// No HTML / no third-party script / any backend present ⇒ zero findings.

import { partitionFrontendBackend } from './frontendBackendPartition';

export interface CspIssue {
  file: string;
  /** How many absolute cross-origin `<script src>` tags this HTML loads (the exposure a CSP would fence). */
  externalScriptCount: number;
  severity: 'low';
  kind: 'missing-csp-meta';
}

/** HTML files carry the `<meta>` and `<script>` tags a browser reads at page start. */
const HTML_EXT = /\.html?$/i;
/** Generated / vendored / test trees never represent the app's shipped entry HTML. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/** Every `<script …>` opening tag (attributes captured), case-insensitive, across newlines. */
const SCRIPT_TAG_RE = /<script\b([^>]*)>/gi;
/** `src="…"` / `src='…'` inside a tag's attribute text. */
const SRC_RE = /\bsrc\s*=\s*(["'])(.*?)\1/i;
/** An absolute cross-origin http(s) URL (a first-party bundle uses a relative or root-absolute path). */
const ABSOLUTE_HTTP_RE = /^https?:\/\//i;
/** A `<meta http-equiv="Content-Security-Policy" …>` tag anywhere in the document ⇒ already protected. */
const CSP_META_RE = /<meta\b[^>]*\bhttp-equiv\s*=\s*(["'])\s*content-security-policy\s*\1[^>]*>/i;

/** Count absolute cross-origin `<script src>` tags in one HTML file's text. Pure + deterministic. */
function externalScriptCount(html: string): number {
  let n = 0;
  for (const m of html.matchAll(SCRIPT_TAG_RE)) {
    const src = SRC_RE.exec(m[1] ?? '')?.[2]?.trim();
    if (src && ABSOLUTE_HTTP_RE.test(src)) n += 1;
  }
  return n;
}

/**
 * Scan one HTML file for the missing-CSP-meta gap. Returns a single issue iff the file loads ≥1 absolute
 * cross-origin script AND has no CSP meta tag; otherwise []. The static-SPA precondition is enforced at the
 * project level (`scanProjectCsp`) — this per-file helper is exported for focused testing. Pure.
 */
export function scanCsp(path: string, html: string): CspIssue[] {
  if (typeof html !== 'string' || !html) return [];
  if (CSP_META_RE.test(html)) return []; // already has a CSP policy — correct
  const count = externalScriptCount(html);
  if (count === 0) return []; // no third-party script origin to fence — no meaningful gap
  return [{ file: path, externalScriptCount: count, severity: 'low', kind: 'missing-csp-meta' }];
}

/**
 * Scan a whole project's HTML for the static-SPA CSP gap. Returns [] when the build has ANY backend file
 * (a server should set a CSP *header* — SecurityHeadersAnalysis owns that) or when no HTML loads a
 * third-party script without a CSP meta. Pure + deterministic.
 */
export function scanProjectCsp(files: Record<string, string>): CspIssue[] {
  const paths = Object.keys(files);
  // Static SPA only: if a server exists, CSP belongs in an HTTP header, not a meta tag — skip entirely.
  if (partitionFrontendBackend(paths).backend.length > 0) return [];
  const out: CspIssue[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!HTML_EXT.test(path) || SKIP_PATH.test(path)) continue;
    out.push(...scanCsp(path, content));
  }
  return out;
}

/** A concise, honest CSP report for the agent. Pure. */
export function cspSummary(issues: CspIssue[]): string {
  if (issues.length === 0) return 'Content-Security-Policy scan: ✓ No unfenced static-SPA script origins.';
  const body = issues.map(
    (x) => `  - [${x.severity}] ${x.file} — ${x.externalScriptCount} third-party <script> with no CSP policy`,
  );
  return [
    `Content-Security-Policy scan: ${issues.length} static-SPA page(s) load third-party scripts without a Content-Security-Policy. Add <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://trusted-cdn.example"> to fence script origins (defense-in-depth against injected/inline script).`,
    ...body,
  ].join('\n');
}
