// AgentV3 — Subresource-Integrity (SRI) analysis (additive evaluate dimension).
//
// A real, deterministic scan over the GENERATED app's HTML for a specific, high-value supply-chain gap that
// no other analyzer covers: a third-party `<script src="https://cdn…">` loaded WITHOUT an `integrity=`
// hash. Server security headers (SecurityHeadersAnalysis) protect the app's OWN responses; this protects the
// app from a compromised or hijacked CDN.
//
// Why it matters: a cross-origin script runs with full page privileges. If the CDN (or its DNS/BGP) is
// compromised and serves tampered JS, the browser runs it — stealing tokens, keylogging, injecting content.
// Subresource Integrity pins a cryptographic hash on the tag (`integrity="sha384-…" crossorigin`), so the
// browser REFUSES any file whose hash doesn't match. It is the standard, one-attribute defence.
//
// Read-only and HIGH PRECISION by design (never nag a correct app):
//   • Only `<script>` subresources are flagged — JS execution is the genuine XSS/supply-chain risk. Stylesheet
//     `<link>`s are deliberately NOT flagged: many legitimate CSS CDNs (e.g. font services) serve varying
//     content that SRI would break, and CSS-injection risk is far lower — flagging them would produce noise.
//   • Only ABSOLUTE cross-origin http(s) srcs are flagged. Relative / same-origin / `data:` / `blob:` scripts
//     are first-party (bundled by the build) and carry no third-party-tamper risk, so they are skipped.
//   • A tag that ALREADY has an `integrity=` attribute is correct and never flagged.
// No HTML ⇒ zero findings. The `evaluate` tool surfaces the summary so the agent can add the hash — never a
// synthetic "looks secure".

export interface SriIssue {
  file: string;
  /** The external script URL missing an integrity hash. */
  url: string;
  severity: 'medium';
  kind: 'missing-sri';
}

/** HTML files carry the `<script src>` tags a browser loads at page start. */
const HTML_EXT = /\.html?$/i;
/** Generated / vendored / test trees never represent the app's shipped entry HTML. */
const SKIP_PATH =
  /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

/** Every `<script …>` opening tag (attributes captured), case-insensitive, across newlines. */
const SCRIPT_TAG_RE = /<script\b([^>]*)>/gi;
/** `src="…"` / `src='…'` inside a tag's attribute text. */
const SRC_RE = /\bsrc\s*=\s*(["'])(.*?)\1/i;
/** An `integrity=` attribute present anywhere in the tag ⇒ already protected. */
const HAS_INTEGRITY_RE = /\bintegrity\s*=/i;
/** An absolute cross-origin http(s) URL (a first-party bundle uses a relative or root-absolute path). */
const ABSOLUTE_HTTP_RE = /^https?:\/\//i;

/** Scan one HTML file's text for external `<script>` tags without SRI. Pure + deterministic. */
export function scanSri(path: string, html: string): SriIssue[] {
  if (typeof html !== 'string' || !html) return [];
  const out: SriIssue[] = [];
  for (const m of html.matchAll(SCRIPT_TAG_RE)) {
    const attrs = m[1] ?? '';
    const src = SRC_RE.exec(attrs)?.[2]?.trim();
    if (!src || !ABSOLUTE_HTTP_RE.test(src)) continue; // inline or first-party script — not a third-party risk
    if (HAS_INTEGRITY_RE.test(attrs)) continue;         // already hash-pinned — correct
    out.push({ file: path, url: src, severity: 'medium', kind: 'missing-sri' });
  }
  return out;
}

/** Scan a whole project's HTML files. Returns [] when no HTML has an unprotected external script. */
export function scanProjectSri(files: Record<string, string>): SriIssue[] {
  const out: SriIssue[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!HTML_EXT.test(path) || SKIP_PATH.test(path)) continue;
    out.push(...scanSri(path, content));
  }
  return out;
}

/** A concise, honest SRI report for the agent. */
export function sriSummary(issues: SriIssue[]): string {
  if (issues.length === 0) return 'Subresource-Integrity scan: ✓ No unprotected third-party scripts.';
  const body = issues.map((x) => `  - [${x.severity}] ${x.file} — external script without integrity: ${x.url}`);
  return [
    `Subresource-Integrity scan: ${issues.length} third-party <script> without an integrity hash — a compromised CDN could inject code. Add integrity="sha384-…" crossorigin="anonymous" (or self-host/bundle it).`,
    ...body,
  ].join('\n');
}
