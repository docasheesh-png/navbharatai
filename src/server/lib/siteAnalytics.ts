/**
 * SITE ANALYTICS — "kitne log aaye?" for an app published on NavBharatAI hosting (ROADMAP §13, 1.1).
 *
 * The first thing a person asks after publishing is how many people came. Until now the platform
 * could not answer: a published app is static files on a host we do not see traffic for. This
 * module is the PURE half of the answer — the beacon that goes into the page, the validation of
 * what comes back, the privacy hash, the sharded document layout, and the summary. The I/O half is
 * `siteAnalyticsStore.ts`; the beacon is stamped into the bundle at publish time beside the
 * "Made with NavBharatAI" badge (`DeploymentStore.withDeploymentPersistence`), which is the one
 * choke point every first-party publish flows through.
 *
 * 🔒 WHAT IS COLLECTED, AND WHY EACH THING IS SAFE TO COLLECT. The Privacy Policy states these in
 * §12 and `privacyPolicyTruth.test.ts` holds it to them — change the list here and the test fails
 * until the policy says so too.
 *   • the page PATH (never the query string — it can carry tokens and search terms);
 *   • the REFERRING SITE's hostname only (never the full referrer URL);
 *   • a HASH of ip+browser keyed by a secret that ROTATES DAILY, so the same visitor counts once
 *     per day and nothing stored can be turned back into a person or joined across days.
 * No cookie, no localStorage, nothing on the visitor's device. A browser that sends Do Not Track or
 * Global Privacy Control is not counted at all — respected on BOTH ends, in the beacon and again on
 * the server, because a client-side check alone is one edited script away from meaningless.
 *
 * 🔒 SHARDED FROM DAY ONE. ROADMAP §SCALE-PLAN item 1: one Firestore document per app per day is a
 * wall at one sustained write per second. So a day is `shardCount` documents, and a visitor is
 * assigned to a shard by their hash — deterministically, so "unique per day" stays EXACT (the same
 * visitor always lands on the same document) rather than approximate across shards.
 *
 * 🔒 HONEST ABOUT ABSENCE. A summary is `available: false` when the store could not be read. A flat
 * zero drawn over a broken read would tell a user nobody visited, which is a fake result.
 *
 * PURE. No I/O, no clock reads — every function takes what it needs.
 */
import { createHmac } from 'node:crypto';
import { parseEnvFlag } from './envFlag';

/** Idempotency marker on the injected script. Present ⇒ this HTML already carries the beacon. */
export const SITE_ANALYTICS_MARKER = 'data-nbai-analytics';
/** The public endpoint the beacon posts to. One constant: the route and the beacon cannot drift. */
export const HIT_PATH = '/api/site-analytics/hit';
/** Public app id shape — `siteIdForWorkspace` output. Anything else is refused before any work. */
export const APP_ID_RE = /^nbai-[a-f0-9]{20}$/;
/** Longest path we keep. Longer paths are truncated, never dropped — a hit is still a hit. */
export const MAX_PATH_CHARS = 120;
/** Distinct paths / referrers tracked per shard document per day; the rest fold into `_other`. */
export const MAX_KEYS_PER_SHARD = 200;
/** How far back the summary looks. 30 days keeps a read at 30 × shards documents, which is bounded. */
export const MAX_SUMMARY_DAYS = 30;

/**
 * The exact phrases the Privacy Policy must contain for the collection above to be disclosed.
 * `privacyPolicyTruth.test.ts` asserts each one, so adding a collected field here without updating
 * the policy fails CI. That guard exists because the previous drift (2026-09-02) failed nothing.
 */
export const POLICY_PHRASES = [
  'the page path',
  'the referring site',
  'rotates daily',
  'Do Not Track',
] as const;

export function siteAnalyticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_SITE_ANALYTICS) ?? true;
}

/**
 * Where the beacon posts to. `PUBLIC_BASE_URL` is the same env `routes/bots.ts` uses for its
 * public URLs; the literal is the platform's canonical origin, the one the badge links to.
 */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/.test(v) ? v : 'https://navbharatai.com';
}

// ── The beacon ─────────────────────────────────────────────────────────────────────────────────

/**
 * The script stamped into every published HTML page.
 *
 * Deliberately tiny and dependency-free. `sendBeacon` with a `text/plain` body is a CORS "simple
 * request", so there is no preflight and the send survives the tab closing; `fetch({keepalive})`
 * is the fallback. The referrer is reduced to a hostname IN THE BROWSER, so the full URL never
 * leaves the visitor's device — and an internal navigation (same host) sends nothing, because a
 * page linking to itself is not a "source".
 */
export function beaconHtml(appId: string, origin: string): string {
  const url = `${origin.replace(/\/+$/, '')}${HIT_PATH}`;
  return `<script ${SITE_ANALYTICS_MARKER}="beacon">(function(){try{
var n=navigator;if(n.doNotTrack=="1"||window.doNotTrack=="1"||n.globalPrivacyControl===true)return;
var r="";try{if(document.referrer){var h=new URL(document.referrer).hostname;if(h&&h!==location.hostname)r=h;}}catch(e){}
var b=JSON.stringify({a:${JSON.stringify(appId)},p:location.pathname,r:r});
if(n.sendBeacon){n.sendBeacon(${JSON.stringify(url)},new Blob([b],{type:"text/plain"}));}
else{fetch(${JSON.stringify(url)},{method:"POST",body:b,headers:{"Content-Type":"text/plain"},keepalive:true,mode:"no-cors"}).catch(function(){});}
}catch(e){}})();</script>`;
}

function looksLikeHtmlDocument(html: string): boolean {
  return /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html) || /<!doctype\s+html/i.test(html);
}

/** Stamp one HTML document. Idempotent; a non-document string is returned unchanged. */
export function injectBeacon(html: string, appId: string, origin: string): string {
  if (typeof html !== 'string' || !html) return html;
  if (html.includes(SITE_ANALYTICS_MARKER)) return html;
  if (!looksLikeHtmlDocument(html)) return html;
  const tag = beaconHtml(appId, origin);
  const close = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  if (close >= 0) return html.slice(0, close) + tag + '\n' + html.slice(close);
  return html + '\n' + tag;
}

/**
 * Stamp every HTML file in a publish bundle IN PLACE — the deploy pipeline's `Map<path, Buffer>`,
 * the same shape `injectBadgeIntoFiles` takes. Returns how many files were stamped.
 */
export function injectBeaconIntoFiles(
  files: Map<string, Buffer>,
  opts: { appId: string; origin: string; env?: NodeJS.ProcessEnv },
): number {
  if (!siteAnalyticsEnabled(opts.env) || !APP_ID_RE.test(opts.appId)) return 0;
  let stamped = 0;
  for (const [path, buf] of files) {
    if (!/\.html?$/i.test(path)) continue;
    const html = buf.toString('utf8');
    const out = injectBeacon(html, opts.appId, opts.origin);
    if (out !== html) {
      files.set(path, Buffer.from(out, 'utf8'));
      stamped++;
    }
  }
  return stamped;
}

// ── What comes back ────────────────────────────────────────────────────────────────────────────

export interface ParsedHit {
  appId: string;
  /** Path only, `/`-prefixed, query and fragment stripped, at most MAX_PATH_CHARS. */
  path: string;
  /** Referring hostname, lowercase, or '' for a direct visit. */
  ref: string;
}

/**
 * Validate a raw beacon body. Returns null for anything that is not exactly the shape the beacon
 * sends — this endpoint is public and unauthenticated, so the only defence is accepting nothing
 * that was not asked for. Never throws.
 */
export function parseHit(raw: unknown): ParsedHit | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2_000) return null;
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const { a, p, r } = body as { a?: unknown; p?: unknown; r?: unknown };
  if (typeof a !== 'string' || !APP_ID_RE.test(a)) return null;
  const path = normalizePath(p);
  if (!path) return null;
  const ref = normalizeReferrerHost(r);
  return { appId: a, path, ref };
}

/** `/x?y#z` → `/x`; missing/odd → '' (the caller refuses). Always `/`-prefixed and bounded. */
export function normalizePath(p: unknown): string {
  if (typeof p !== 'string') return '';
  let s = p.split(/[?#]/)[0].trim();
  if (!s.startsWith('/')) s = '/' + s;
  // Control characters and whitespace cannot be part of a real path; hyphens and dots can.
  s = s.replace(/[\x00-\x20\x7f]/g, '');
  return s.length > MAX_PATH_CHARS ? s.slice(0, MAX_PATH_CHARS) : s;
}

/** A hostname, or ''. Anything with a scheme, path, port or whitespace is not a hostname. */
export function normalizeReferrerHost(r: unknown): string {
  if (typeof r !== 'string') return '';
  const h = r.trim().toLowerCase();
  if (!h || h.length > 80) return '';
  return /^[a-z0-9.-]+$/.test(h) && !h.startsWith('.') && !h.endsWith('.') ? h : '';
}

/** True when the request itself asks not to be tracked. Checked on the server too — see header. */
export function requestOptsOut(headers: Record<string, unknown>): boolean {
  const dnt = String(headers['dnt'] ?? '').trim();
  const gpc = String(headers['sec-gpc'] ?? '').trim();
  return dnt === '1' || gpc === '1';
}

// ── Identity, without identity ────────────────────────────────────────────────────────────────

/** UTC calendar day. The server's clock, never the visitor's — a device clock cannot move a count. */
export function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The per-day visitor hash. HMAC keyed by `secret + day`, so the key itself rotates: two hashes of
 * the same visitor on different days share nothing, and without the secret the hash cannot be
 * brute-forced from an IP list. 16 hex chars is 64 bits — enough that a collision inside one app's
 * one day is not a realistic event, and short enough to sit as a map key in a shard document.
 */
export function visitorHash(ip: string, userAgent: string, day: string, secret: string): string {
  return createHmac('sha256', `${secret}|${day}`)
    .update(`${ip ?? ''}|${userAgent ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

/** Shards per app-day. Env-tunable, clamped, default 8 — the same reasoning as `metricsTimeline`. */
export function shardCountFor(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SITE_ANALYTICS_SHARDS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(64, Math.max(1, Math.floor(raw))) : 8;
}

/**
 * Which shard a visitor lands on — from their hash, so it is the SAME shard on every hit that day.
 * That determinism is what keeps uniques exact: the dedup set for a visitor lives in one document.
 */
export function shardForVisitor(hash: string, shards: number): number {
  const n = Math.max(1, Math.floor(shards));
  return parseInt(hash.slice(0, 8), 16) % n;
}

export function hitDocId(appId: string, day: string, shard: number): string {
  return `${appId}_${day}_s${Math.max(0, Math.floor(shard))}`;
}

/**
 * A Firestore map key must not contain `.` (a field path) or start with `__`, and long keys waste
 * document space. Encoded, not stripped, so `/a.b` and `/a_b` stay distinct.
 */
export function fieldKey(s: string): string {
  // encodeURIComponent never emits `_`, so after it every `_` is an ORIGINAL one: escape those as
  // `_u` first, then the `%` of each `%XX` as `_p`. Every `_` in the result is followed by u or p,
  // which is what makes the decode a single unambiguous pass. `.` is a Firestore field path, so it
  // is percent-encoded before that step.
  const enc = encodeURIComponent(s).replace(/\./g, '%2E').replace(/_/g, '_u').replace(/%/g, '_p');
  return enc || 'k';
}
export function decodeFieldKey(k: string): string {
  if (k === 'k') return '';
  const raw = k.replace(/_(u|p)/g, (_m, c: string) => (c === 'u' ? '_' : '%'));
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** The `_other` bucket a shard folds new keys into once it holds MAX_KEYS_PER_SHARD of them. */
export const OTHER_KEY = '_other';

// ── The shard document, and the summary read from many of them ───────────────────────────────

/** One shard document's stored shape. All counters additive so `FieldValue.increment` sums them. */
export interface ShardDoc {
  appId: string;
  day: string;
  views: number;
  /** encoded path → views */
  paths?: Record<string, number>;
  /** encoded referrer host → views ('' direct visits are not stored here) */
  refs?: Record<string, number>;
  /** visitor hash → true. Its key count is that shard's unique visitors for the day. */
  uniq?: Record<string, boolean>;
}

export interface DayPoint { day: string; views: number; uniques: number }

export type SiteAnalyticsSummary =
  | {
      available: true;
      /** One point per day, oldest first, every day present (zero-filled) so a chart has no gaps. */
      days: DayPoint[];
      totalViews: number;
      totalUniques: number;
      todayViews: number;
      topPaths: Array<{ path: string; views: number }>;
      topReferrers: Array<{ host: string; views: number }>;
      /** First day in the window, for the "since" label. */
      sinceDay: string;
    }
  | { available: false; reason: 'store-unavailable' | 'disabled' };

/** The list of UTC days ending at `today`, oldest first. `n` is clamped to [1, MAX_SUMMARY_DAYS]. */
export function dayWindow(todayMs: number, n: number): string[] {
  const count = Math.min(MAX_SUMMARY_DAYS, Math.max(1, Math.floor(n)));
  const out: string[] = [];
  const dayMs = 86_400_000;
  const end = Math.floor(todayMs / dayMs) * dayMs;
  for (let i = count - 1; i >= 0; i--) out.push(dayKey(end - i * dayMs));
  return out;
}

/**
 * Fold shard documents into what the Publish sheet shows. PURE — the store hands it whatever it
 * read; a document for a day outside the window is ignored rather than trusted.
 */
export function summarize(
  docs: ReadonlyArray<Partial<ShardDoc> | null | undefined>,
  opts: { todayMs: number; days: number; topN?: number },
): Extract<SiteAnalyticsSummary, { available: true }> {
  const window = dayWindow(opts.todayMs, opts.days);
  const inWindow = new Set(window);
  const byDay = new Map<string, DayPoint>(window.map((d) => [d, { day: d, views: 0, uniques: 0 }]));
  const paths = new Map<string, number>();
  const refs = new Map<string, number>();

  for (const d of docs) {
    if (!d || typeof d.day !== 'string' || !inWindow.has(d.day)) continue;
    const point = byDay.get(d.day)!;
    point.views += Math.max(0, Number(d.views) || 0);
    point.uniques += d.uniq ? Object.keys(d.uniq).length : 0;
    for (const [k, v] of Object.entries(d.paths ?? {})) paths.set(k, (paths.get(k) ?? 0) + (Number(v) || 0));
    for (const [k, v] of Object.entries(d.refs ?? {})) refs.set(k, (refs.get(k) ?? 0) + (Number(v) || 0));
  }

  const topN = Math.max(1, opts.topN ?? 5);
  const top = (m: Map<string, number>) =>
    [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, topN);
  const days = window.map((d) => byDay.get(d)!);
  const today = dayKey(opts.todayMs);

  return {
    available: true,
    days,
    totalViews: days.reduce((s, p) => s + p.views, 0),
    totalUniques: days.reduce((s, p) => s + p.uniques, 0),
    todayViews: byDay.get(today)?.views ?? 0,
    topPaths: top(paths).map(([k, views]) => ({ path: k === OTHER_KEY ? OTHER_KEY : decodeFieldKey(k), views })),
    topReferrers: top(refs).map(([k, views]) => ({ host: k === OTHER_KEY ? OTHER_KEY : decodeFieldKey(k), views })),
    sinceDay: window[0],
  };
}
