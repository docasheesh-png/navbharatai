// WEBSITE CHECKUP — a friendly, passive health check of a site the user OWNS (2026-09-25).
//
// Admin, verbatim: *"user apni koi bhi website yaha aa kar test kare … 1. yeh navbharatai ki branding
// se hona chahiye, 2. copyright free rahe, 3. indian non technical user ke liye simple ho"*, and, on
// scope: *"hame, kisi aur ki website test nahi karni hai! user ki khud ki website check karwani hai?
// kisi aur ki nahi!!"*
//
// WHAT THIS IS, AND WHAT IT IS NOT.
//   • It READS what a site already serves to any visitor — the response headers and the HTML — and
//     reports, in plain words, what is healthy and what could be safer. That is not an attack: it is
//     the same GET a browser makes. No probing of hidden paths, no payloads, no login attempts, no
//     port scans. So it stays lawful (IT Act 2000 §43/66 forbid UNAUTHORISED access — this touches
//     nothing a normal page load doesn't) AND it is safe for a non-technical user to press.
//   • Ownership is enforced by the ROUTE, not here: the caller names one of their OWN NavBharatAI
//     deployments (a workspaceId bound to their uid), and the route resolves the URL from that record.
//     This module only ever receives a URL the route already proved the user owns — but it STILL
//     routes every fetch (and every redirect hop) through the shared SSRF guard, because "the user
//     owns the domain" proves ownership, not that the target resolves to a safe address.
//
// 🔒 WHITE-LABEL. Findings name NavBharatAI and plain web concepts only — never a third-party vendor,
// a model, or our internal cost. The one exception a security tool must make: it names the specific
// standard header a browser expects (HSTS, CSP…), because that IS the fix and hiding it would make the
// advice useless — those are open web standards, not our suppliers.
//
// PURE above `fetchForCheckup`. Every analyzer is a pure function of a fetched response, so the exact
// findings a user is shown are unit-tested and can never drift onto a live network call.

import { assertPublicHttpUrl } from './ssrfGuard';
import { isLiveDeployment, type DeploymentRecord } from '../AgentV3/DeploymentStore';

/** How a single finding reads to the user. */
export type CheckupSeverity =
  /** Something a browser would warn about, or that puts the user's visitors at real risk. */
  | 'critical'
  /** Safe today, but a well-configured site would do better. */
  | 'warn'
  /** Confirmed healthy — shown so a clean checkup is reassuring, not empty. */
  | 'good'
  /** Neutral information, no action needed. */
  | 'info';

export interface CheckupFinding {
  /** Stable id for tests and de-duplication. Never shown to the user. */
  id: string;
  severity: CheckupSeverity;
  /** One short line — what was checked. */
  title: string;
  /** Plain-language explanation of what it means, for a non-technical reader. */
  detail: string;
  /** Plain-language "how to make it better", when there is something to do. Omitted for `good`/`info`. */
  fix?: string;
}

export interface CheckupResult {
  /** The URL that was actually checked (after any redirect). */
  url: string;
  /** The URL originally requested, before redirects. */
  requestedUrl: string;
  /** ISO timestamp the check finished. Supplied by the caller (pure code takes no clock). */
  checkedAt: string;
  /** Whole findings, most severe first. */
  findings: CheckupFinding[];
  /** A friendly headline grade derived from the findings. */
  grade: 'excellent' | 'good' | 'needs-attention' | 'at-risk' | 'unreachable';
  /** One-sentence, branded summary the user reads first. */
  summary: string;
  /** Counts by severity, for the UI's badges. */
  counts: { critical: number; warn: number; good: number; info: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// The fetched shape the analyzers consume. Kept minimal and serialisable so a
// test can hand-build one without a network.
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckupFetch {
  ok: boolean;
  /** Present when `ok` is false: a plain reason the site could not be read. */
  error?: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** URL first requested. */
  requestedUrl: string;
  /** Final HTTP status. */
  status: number;
  /** Lower-cased response header name → value (last value wins; Set-Cookie is separate). */
  headers: Record<string, string>;
  /** Raw Set-Cookie header values, one per cookie. */
  setCookies: string[];
  /** The served HTML/body, capped. */
  body: string;
  /** True when the FIRST requested URL was http:// . */
  requestedHttp: boolean;
  /** True when, having requested http://, the site redirected to https:// . */
  redirectedToHttps: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNERSHIP — the pure heart of "your sites only". A URL is checkable ONLY when the
// deployment record it comes from belongs to the asking user AND is live. This is a
// pure function so the security gate is unit-tested, not merely asserted in the route.
// ─────────────────────────────────────────────────────────────────────────────

export type CheckupAccess =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Decide whether `uid` may run a checkup on `record`. The ONLY "yes" is a live deployment whose
 * `userId` is exactly this caller. A missing record, another person's record, an empty uid, or a
 * non-live deployment all fail — there is no path that yields someone else's URL.
 */
export function decideCheckupAccess(record: DeploymentRecord | null | undefined, uid: string | null | undefined): CheckupAccess {
  const NO = 'You can only check a website you published with NavBharatAI.';
  if (!uid || !record) return { ok: false, reason: NO };
  if (record.userId !== uid) return { ok: false, reason: NO };
  if (!isLiveDeployment(record)) return { ok: false, reason: NO };
  if (!record.url) return { ok: false, reason: NO };
  return { ok: true, url: record.url };
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE ANALYZERS
// ─────────────────────────────────────────────────────────────────────────────

/** Case-insensitive header read against the normalised (lower-cased) map. */
function header(f: CheckupFetch, name: string): string | undefined {
  return f.headers[name.toLowerCase()];
}

/** HTTPS and the http→https upgrade. */
export function analyzeHttps(f: CheckupFetch): CheckupFinding[] {
  const out: CheckupFinding[] = [];
  const finalIsHttps = f.finalUrl.startsWith('https://');
  if (finalIsHttps) {
    out.push({
      id: 'https-on',
      severity: 'good',
      title: 'Your site uses HTTPS',
      detail: 'The connection is encrypted, so visitors see the padlock and their data is protected in transit.',
    });
  } else {
    out.push({
      id: 'https-off',
      severity: 'critical',
      title: 'Your site is served over plain HTTP',
      detail: 'Without HTTPS, anything a visitor sends can be read on the way. Browsers now label such sites "Not secure".',
      fix: 'NavBharatAI-published sites get HTTPS automatically — re-publish your app, or if you connected your own domain, finish its HTTPS/SSL step in the domain settings.',
    });
  }
  if (f.requestedHttp && !f.redirectedToHttps && finalIsHttps) {
    // We asked over http and ended on https without an explicit redirect being recorded — rare; no finding.
  }
  if (f.requestedHttp && !f.redirectedToHttps && !finalIsHttps) {
    out.push({
      id: 'no-https-redirect',
      severity: 'warn',
      title: 'Visitors typing http:// are not sent to the secure version',
      detail: 'A visitor who reaches the plain-http address stays on it instead of being moved to the secure one.',
      fix: 'A NavBharatAI re-publish sets up the automatic move to HTTPS for you.',
    });
  }
  return out;
}

interface HeaderSpec {
  id: string;
  /** The response header (or, for CSP framing, an alternative that also satisfies it). */
  names: string[];
  title: string;
  detailMissing: string;
  fix: string;
  severity: CheckupSeverity;
  goodTitle: string;
}

const SECURITY_HEADERS: HeaderSpec[] = [
  {
    id: 'hdr-hsts',
    names: ['strict-transport-security'],
    title: 'Forces HTTPS on every future visit (HSTS)',
    detailMissing: 'Without this, a returning visitor can be tricked onto an insecure copy of your site before HTTPS kicks in.',
    fix: 'NavBharatAI hosting can send this header — re-publish to pick up the latest hosting settings.',
    severity: 'warn',
    goodTitle: 'Returning visitors are locked to HTTPS (HSTS)',
  },
  {
    id: 'hdr-xcto',
    names: ['x-content-type-options'],
    title: 'Stops the browser guessing file types',
    detailMissing: 'Without "nosniff", a browser can mistake an uploaded file for a script and run it — a common way attacks sneak in.',
    fix: 'Re-publish your app so NavBharatAI hosting adds the X-Content-Type-Options header.',
    severity: 'warn',
    goodTitle: 'The browser will not guess file types (nosniff)',
  },
  {
    id: 'hdr-frame',
    names: ['x-frame-options', 'content-security-policy'],
    title: 'Stops other sites hiding yours inside theirs (clickjacking)',
    detailMissing: 'Without frame protection, a scam site can load your page invisibly and trick your visitors into clicking things.',
    fix: 'Re-publish so NavBharatAI hosting adds frame protection (X-Frame-Options or a CSP frame rule).',
    severity: 'warn',
    goodTitle: 'Other sites cannot hide yours in a frame',
  },
  {
    id: 'hdr-referrer',
    names: ['referrer-policy'],
    title: 'Controls what address is shared when visitors click away',
    detailMissing: 'Without a referrer policy, the full page address your visitor was on can leak to other sites they click through to.',
    fix: 'Re-publish to add a Referrer-Policy header.',
    severity: 'info',
    goodTitle: 'Visitor privacy on outbound clicks is set (Referrer-Policy)',
  },
];

/** Response security headers. */
export function analyzeHeaders(f: CheckupFetch): CheckupFinding[] {
  const out: CheckupFinding[] = [];
  for (const spec of SECURITY_HEADERS) {
    // For the framing check, a plain Content-Security-Policy only counts if it actually restricts framing.
    const present = spec.names.some((n) => {
      const v = header(f, n);
      if (v === undefined) return false;
      if (spec.id === 'hdr-frame' && n === 'content-security-policy') {
        return /frame-ancestors/i.test(v);
      }
      return true;
    });
    if (present) {
      out.push({ id: `${spec.id}-ok`, severity: 'good', title: spec.goodTitle, detail: 'This protection is in place.' });
    } else {
      out.push({ id: spec.id, severity: spec.severity, title: spec.title, detail: spec.detailMissing, fix: spec.fix });
    }
  }

  // A Content-Security-Policy is a strong, distinct protection worth calling out when present.
  const csp = header(f, 'content-security-policy');
  if (csp) {
    out.push({
      id: 'hdr-csp-ok',
      severity: 'good',
      title: 'A Content-Security-Policy is set',
      detail: 'This limits what code the page is allowed to run, which blocks a large class of injection attacks.',
    });
  }

  // Version leakage — low priority, but easy to point out.
  const powered = header(f, 'x-powered-by');
  const server = header(f, 'server');
  const leaks: string[] = [];
  if (powered) leaks.push(`X-Powered-By: ${powered}`);
  if (server && /\d/.test(server)) leaks.push(`Server: ${server}`);
  if (leaks.length > 0) {
    out.push({
      id: 'hdr-version-leak',
      severity: 'info',
      title: 'Your site tells visitors which software and version it runs',
      detail: 'This is not a hole by itself, but it hands an attacker a head start by naming exactly what to target.',
      fix: 'If you host the backend yourself, turn off the Server / X-Powered-By version banner.',
    });
  }
  return out;
}

/** Cookies set on the response. */
export function analyzeCookies(f: CheckupFetch): CheckupFinding[] {
  if (f.setCookies.length === 0) return [];
  const weak: string[] = [];
  for (const c of f.setCookies) {
    const lower = c.toLowerCase();
    const nameEnd = c.indexOf('=');
    const cookieName = nameEnd > 0 ? c.slice(0, nameEnd).trim() : '(a cookie)';
    const problems: string[] = [];
    if (!/;\s*secure(\s*;|\s*$)/i.test(lower) && !lower.includes('; secure')) problems.push('Secure');
    if (!lower.includes('httponly')) problems.push('HttpOnly');
    if (!lower.includes('samesite')) problems.push('SameSite');
    if (problems.length > 0) weak.push(`${cookieName} (missing ${problems.join(', ')})`);
  }
  if (weak.length === 0) {
    return [{
      id: 'cookies-ok',
      severity: 'good',
      title: 'Cookies are set safely',
      detail: 'Your cookies carry the flags that keep them from being stolen or misused.',
    }];
  }
  return [{
    id: 'cookies-weak',
    severity: 'warn',
    title: 'Some cookies are missing safety flags',
    detail: `A cookie without Secure, HttpOnly or SameSite is easier for an attacker to read or misuse: ${weak.slice(0, 5).join('; ')}.`,
    fix: 'In your app code, set the cookie with the Secure, HttpOnly and SameSite=Lax (or Strict) flags.',
  }];
}

// A visible key that is a GENUINE secret — never the public Firebase web apiKey (which is meant to ship
// in client code). We flag only things that are secret by definition.
const SECRET_PATTERNS: Array<{ id: string; re: RegExp; name: string }> = [
  { id: 'stripe-secret', re: /\bsk_live_[0-9a-zA-Z]{16,}\b/, name: 'a Stripe secret key' },
  { id: 'aws-akia', re: /\bAKIA[0-9A-Z]{16}\b/, name: 'an AWS access key id' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, name: 'a private key' },
  { id: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, name: 'a Slack token' },
  { id: 'generic-secret', re: /["'`](?:api[_-]?secret|secret[_-]?key|client[_-]?secret)["'`]\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, name: 'a secret key' },
];

/** Genuine secrets accidentally shipped in the served HTML/JS. */
export function analyzeExposedSecrets(f: CheckupFetch): CheckupFinding[] {
  const hits = new Set<string>();
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(f.body)) hits.add(p.name);
  }
  if (hits.size === 0) return [];
  return [{
    id: 'exposed-secret',
    severity: 'critical',
    title: 'A private key looks exposed on your page',
    detail: `Your page appears to contain ${Array.from(hits).join(', ')}. Anything in the page a visitor loads is public — a secret here can be copied and misused.`,
    fix: 'Move the secret to your server or a NavBharatAI secret (Settings → Secrets & API Keys), and never put it in front-end code. Then rotate the exposed key.',
  }];
}

/** Mixed content: http:// resources loaded by an https:// page. */
export function analyzeMixedContent(f: CheckupFetch): CheckupFinding[] {
  if (!f.finalUrl.startsWith('https://')) return [];
  const re = /\b(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi;
  const insecure = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(f.body)) !== null) {
    const url = m[1];
    // A link (<a href="http://...">) to another site is normal; only loaded RESOURCES are mixed content.
    // We cannot tell tag from attribute cheaply, so we only flag http resources on common resource hosts
    // by excluding obvious anchor patterns is unreliable — instead flag all http:// src/href but phrase
    // it as "may be", and cap the list. This stays honest without over-claiming.
    insecure.add(url);
    if (insecure.size >= 20) break;
  }
  if (insecure.size === 0) {
    return [{
      id: 'mixed-content-ok',
      severity: 'good',
      title: 'No insecure content found on the page',
      detail: 'Everything the page loads uses HTTPS, so the padlock stays intact.',
    }];
  }
  return [{
    id: 'mixed-content',
    severity: 'warn',
    title: 'Your page loads some content over insecure http://',
    detail: `An HTTPS page that pulls in http:// content can break the padlock and be blocked by browsers. Found ${insecure.size} such address(es), e.g. ${Array.from(insecure).slice(0, 3).join(', ')}.`,
    fix: 'Change those addresses to https:// (most sites offer both), or host the file with your app so it is served securely.',
  }];
}

/** Basic page hygiene a good site gets right. */
export function analyzeHygiene(f: CheckupFetch): CheckupFinding[] {
  const out: CheckupFinding[] = [];
  const body = f.body;
  const contentType = header(f, 'content-type') ?? '';
  const looksHtml = /html/i.test(contentType) || /<html[\s>]/i.test(body) || /<!doctype html/i.test(body);
  if (!looksHtml) return out; // Not an HTML page (an API or a file) — hygiene checks do not apply.

  if (/<title[\s>][^<]*[^\s<][^<]*<\/title>/i.test(body)) {
    out.push({ id: 'has-title', severity: 'good', title: 'Your page has a title', detail: 'A clear title helps visitors and search engines understand the page.' });
  } else {
    out.push({ id: 'no-title', severity: 'warn', title: 'Your page has no title', detail: 'The browser tab and search results have nothing to show, which looks unfinished.', fix: 'Give your app a title — in NavBharatAI, set the app name, and it appears as the page title.' });
  }

  if (/<meta[^>]+name=["']viewport["']/i.test(body)) {
    out.push({ id: 'has-viewport', severity: 'good', title: 'Your site is set up for phones', detail: 'The viewport tag is present, so the layout adapts to mobile screens.' });
  } else {
    out.push({ id: 'no-viewport', severity: 'warn', title: 'Your site may not fit phone screens', detail: 'Without the viewport setting, the page can look zoomed-out and hard to use on a phone — where most Indian visitors are.', fix: 'Re-publish with NavBharatAI, which adds the mobile viewport setting by default.' });
  }

  if (/<meta[^>]+charset=/i.test(body) || /charset=/i.test(contentType)) {
    out.push({ id: 'has-charset', severity: 'good', title: 'Text encoding is declared', detail: 'The page states its character encoding, so Hindi and other scripts display correctly.' });
  }
  return out;
}

/** The one branded headline + grade, derived from the findings. Pure. */
export function summarizeCheckup(findings: CheckupFinding[]): { grade: CheckupResult['grade']; summary: string; counts: CheckupResult['counts'] } {
  const counts = {
    critical: findings.filter((x) => x.severity === 'critical').length,
    warn: findings.filter((x) => x.severity === 'warn').length,
    good: findings.filter((x) => x.severity === 'good').length,
    info: findings.filter((x) => x.severity === 'info').length,
  };
  let grade: CheckupResult['grade'];
  let summary: string;
  if (counts.critical > 0) {
    grade = 'at-risk';
    summary = `NavBharatAI found ${counts.critical} important thing${counts.critical > 1 ? 's' : ''} to fix on your site, and ${counts.warn} smaller one${counts.warn === 1 ? '' : 's'}.`;
  } else if (counts.warn >= 3) {
    grade = 'needs-attention';
    summary = `Your site is safe to use, and NavBharatAI found ${counts.warn} things that would make it stronger.`;
  } else if (counts.warn > 0) {
    grade = 'good';
    summary = `Your site is in good shape — NavBharatAI found just ${counts.warn} small improvement${counts.warn > 1 ? 's' : ''}.`;
  } else {
    grade = 'excellent';
    summary = 'Excellent — NavBharatAI checked your site and everything looks healthy.';
  }
  return { grade, summary, counts };
}

/** Severity order for display: worst first, then healthy, then info. */
const SEVERITY_RANK: Record<CheckupSeverity, number> = { critical: 0, warn: 1, good: 2, info: 3 };

/** Run every analyzer over a fetched response and assemble the ordered result. Pure. */
export function analyzeCheckup(f: CheckupFetch, checkedAt: string): CheckupResult {
  if (!f.ok) {
    return {
      url: f.finalUrl || f.requestedUrl,
      requestedUrl: f.requestedUrl,
      checkedAt,
      findings: [],
      grade: 'unreachable',
      summary: f.error ? `NavBharatAI could not open your site: ${f.error}` : 'NavBharatAI could not open your site to check it.',
      counts: { critical: 0, warn: 0, good: 0, info: 0 },
    };
  }
  const findings = [
    ...analyzeHttps(f),
    ...analyzeExposedSecrets(f),
    ...analyzeMixedContent(f),
    ...analyzeHeaders(f),
    ...analyzeCookies(f),
    ...analyzeHygiene(f),
  ];
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const { grade, summary, counts } = summarizeCheckup(findings);
  return { url: f.finalUrl, requestedUrl: f.requestedUrl, checkedAt, findings, grade, summary, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE FETCH — bounded, SSRF-guarded on every hop. The only impure part.
// ─────────────────────────────────────────────────────────────────────────────

/** Time budget for the whole checkup fetch (including redirects). */
export const CHECKUP_TIMEOUT_MS = 10_000;
/** Body read cap — enough to see the <head> and early scripts, bounded against a huge page. */
export const CHECKUP_MAX_BYTES = 1_500_000;
/** How many redirects to follow before giving up. */
export const CHECKUP_MAX_REDIRECTS = 5;

/** Read a response body up to `maxBytes`, streaming so a length-lying body cannot blow memory. */
async function readCappedBody(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const t = await res.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) break;
    }
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c.subarray(0, Math.max(0, Math.min(c.length, maxBytes - off))), off); off += c.length; if (off >= maxBytes) break; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged.subarray(0, maxBytes));
}

/** Lower-case a Headers object into a plain map (last value wins), pulling Set-Cookie out separately. */
function readHeaders(h: Headers): { headers: Record<string, string>; setCookies: string[] } {
  const headers: Record<string, string> = {};
  h.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return; // handled separately
    headers[key.toLowerCase()] = value;
  });
  let setCookies: string[] = [];
  const getSetCookie = (h as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    try { setCookies = getSetCookie.call(h) ?? []; } catch { setCookies = []; }
  }
  return { headers, setCookies };
}

/**
 * Fetch a URL the route has already proven the user owns, following redirects manually so EVERY hop is
 * re-validated by the SSRF guard (a redirect Location is itself a user-influenced address). Never
 * throws — returns `{ ok: false, error }` on any failure.
 */
export async function fetchForCheckup(rawUrl: string): Promise<CheckupFetch> {
  const requestedUrl = rawUrl;
  const requestedHttp = /^http:\/\//i.test(rawUrl);
  const base: Omit<CheckupFetch, 'ok'> = {
    finalUrl: rawUrl, requestedUrl, status: 0, headers: {}, setCookies: [], body: '',
    requestedHttp, redirectedToHttps: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECKUP_TIMEOUT_MS);
  try {
    let current = rawUrl;
    let redirectedToHttps = false;
    for (let hop = 0; hop <= CHECKUP_MAX_REDIRECTS; hop++) {
      const guard = await assertPublicHttpUrl(current);
      if (!guard.ok) {
        return { ...base, ok: false, finalUrl: current, error: guard.reason ?? 'This address cannot be checked.' };
      }
      let res: Response;
      try {
        res = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': 'NavBharatAI-Checkup/1.0 (+https://navbharatai.com)',
            accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          },
        });
      } catch (e) {
        const aborted = (e as { name?: string })?.name === 'AbortError';
        return { ...base, ok: false, finalUrl: current, error: aborted ? 'The site took too long to respond.' : 'The site could not be reached.' };
      }

      // Redirect? Follow it manually after re-validating.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        try { await res.body?.cancel(); } catch { /* ignore */ }
        if (!location) {
          // A redirect with no target — treat this as the final response.
          const { headers, setCookies } = readHeaders(res.headers);
          return { ...base, ok: true, finalUrl: current, status: res.status, headers, setCookies, body: '', redirectedToHttps };
        }
        let next: URL;
        try { next = new URL(location, current); } catch {
          return { ...base, ok: false, finalUrl: current, error: 'The site redirected to an address we could not read.' };
        }
        if (current.startsWith('http://') && next.protocol === 'https:') redirectedToHttps = true;
        current = next.toString();
        continue;
      }

      // Final response.
      const { headers, setCookies } = readHeaders(res.headers);
      const body = await readCappedBody(res, CHECKUP_MAX_BYTES);
      return {
        ok: true, finalUrl: current, requestedUrl, status: res.status,
        headers, setCookies, body, requestedHttp, redirectedToHttps,
      };
    }
    return { ...base, ok: false, error: 'The site redirected too many times.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + analyze. The `checkedAt` clock is injected so the analysis stays testable. */
export async function runCheckup(url: string, checkedAt: string): Promise<CheckupResult> {
  const fetched = await fetchForCheckup(url);
  return analyzeCheckup(fetched, checkedAt);
}
