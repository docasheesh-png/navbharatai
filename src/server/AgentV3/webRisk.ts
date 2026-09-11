// IS THIS HOST KNOWN-BAD? — Google Web Risk, asked about the places an app POINTS AT.
//
// Pairs with `outboundUrls.ts` (which finds them). See that file's header for why asking about the
// app's OWN url would be worthless, and why this is the question that can actually catch something.
//
// 🔒 WEB RISK, NOT SAFE BROWSING — and this is a licensing fact, not a preference. The Safe Browsing
// API is free but **non-commercial only**, and NavBharatAI is a commercial product. Web Risk is the
// commercial equivalent: free to 100,000 lookups/month, then $0.50/1k. The cache below is what keeps
// us inside the free tier — the same `api.stripe.com` appears across hundreds of apps and is asked
// about once.
//
// 🔒 THE THREE-STATE VERDICT IS THE WHOLE POINT. `clean` and `unknown` are DIFFERENT answers and must
// never be collapsed: "Google says this host is not on its lists" and "we could not ask Google" look
// identical to a caller that only has a boolean, and treating the second as the first is how a safety
// check becomes reassurance. A missing API key, a disabled API, a timeout and a rate limit are ALL
// `unknown`, and an `unknown` never takes an app down.
//
// NOTHING HERE EVER BLOCKS A PUBLISH. It runs after the publish has returned (slice 4's ordering: the
// user never waits on a network call), so its only outputs are a record and, on a genuine listing, a
// takedown the admin can see and reverse.

export const WEB_RISK_API = 'https://webrisk.googleapis.com/v1';

/**
 * What we ask about. `SOCIAL_ENGINEERING` is the phishing one and the reason this exists;
 * `MALWARE` and `UNWANTED_SOFTWARE` ride along at no extra cost — one lookup covers all three.
 */
export const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'] as const;

export type UrlVerdict =
  /** Google answered, and named at least one threat type. The only state that may act. */
  | 'listed'
  /** Google answered, with no threat. */
  | 'clean'
  /** We could not get an answer — no key, API off, timeout, rate limit, unparseable body. */
  | 'unknown';

export interface OriginVerdict {
  origin: string;
  verdict: UrlVerdict;
  /** The threat types Google named, when it named any. */
  threats: string[];
}

export interface WebRiskRequest { url: string; method: 'GET'; headers: Record<string, string> }

/** Is the Web Risk lookup switched on at all? Default OFF — the network path stays inert until asked. */
export function webRiskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NAVBHARAT_WEB_RISK ?? '').trim().toLowerCase() === 'on';
}

/**
 * The lookup for ONE origin. PURE.
 *
 * `uris:search` is the hosted lookup — one request, one origin, no local hash database to maintain.
 */
export function buildWebRiskRequest(token: string, origin: string): WebRiskRequest {
  const params = new URLSearchParams({ uri: origin });
  for (const t of THREAT_TYPES) params.append('threatTypes', t);
  return {
    url: `${WEB_RISK_API}/uris:search?${params.toString()}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${String(token ?? '').trim()}` },
  };
}

/**
 * Read Google's answer. PURE.
 *
 * 🔒 AN EMPTY BODY `{}` IS GOOGLE'S "NOT ON ANY LIST" — that is the API's documented shape for a clean
 * uri, and it is the ONE case where absence genuinely means clean, because the request itself
 * succeeded. Anything we cannot parse at all is `unknown`, never clean: the difference between "Google
 * said no threat" and "we did not understand Google" is exactly the distinction this module exists to
 * keep.
 */
export function parseWebRiskVerdict(raw: unknown): { verdict: UrlVerdict; threats: string[] } {
  if (raw === null || raw === undefined || typeof raw !== 'object') return { verdict: 'unknown', threats: [] };
  const r = raw as Record<string, unknown>;
  // An error envelope is an answer about our REQUEST, not about the uri.
  if (r.error) return { verdict: 'unknown', threats: [] };
  const threat = r.threat as Record<string, unknown> | undefined;
  if (!threat) return { verdict: 'clean', threats: [] };
  const types = Array.isArray(threat.threatTypes)
    ? threat.threatTypes.filter((t): t is string => typeof t === 'string')
    : [];
  // A `threat` object with no readable types still means Google flagged it — the listing is the
  // signal, and losing it because the label was unfamiliar would be the wrong direction to fail.
  return { verdict: 'listed', threats: types };
}

/**
 * Origins whose verdict we already hold, so the free tier is spent on DISTINCT hosts rather than on
 * publishes. Process-local on purpose: a wrong or stale entry cannot outlive a deploy, and Web Risk's
 * own answers carry an expiry we are not trying to reimplement.
 */
const cache = new Map<string, { verdict: UrlVerdict; threats: string[]; at: number }>();

/** How long a cached verdict is reused. Short enough that a newly-listed host is caught the same day. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Test seam — the cache is module state, and a test must be able to start from empty. */
export function clearWebRiskCache(): void { cache.clear(); }

/**
 * 🔒 ONLY A `clean` VERDICT IS EVER CACHED.
 *
 * An `unknown` cached would turn one timeout into six hours of not asking, and a `listed` cached would
 * keep an app down for six hours after Google delisted it. Both errors point the wrong way, and
 * neither is worth the lookup it saves.
 */
function remember(origin: string, verdict: UrlVerdict, threats: string[], now: number): void {
  if (verdict === 'clean') cache.set(origin, { verdict, threats, at: now });
}

function cached(origin: string, now: number): { verdict: UrlVerdict; threats: string[] } | null {
  const hit = cache.get(origin);
  if (!hit || now - hit.at > CACHE_TTL_MS) return null;
  return { verdict: hit.verdict, threats: hit.threats };
}

export interface WebRiskScan {
  results: OriginVerdict[];
  /** Origins Google named a threat for — the only ones a caller may act on. */
  listed: OriginVerdict[];
  /** True when at least one origin could not be checked, so "no listings" is not a clean bill. */
  incomplete: boolean;
  /** How many lookups actually went to Google (the rest were cached) — for the free-tier budget. */
  lookups: number;
  /**
   * Origins left unchecked because the month's lookup budget was spent (see `webRiskBudget.ts`).
   *
   * These are `unknown` like any other unchecked origin, and deliberately so: running out of budget
   * tells us nothing about the host, so it must produce the same honest verdict as a timeout.
   */
  skippedForBudget: number;
}

/**
 * Check every origin, cheapest-first: cache, then one bounded request each.
 *
 * Sequential rather than parallel on purpose — this runs in the background after a publish has already
 * returned, so nothing is waiting on it, and a burst of parallel requests is how a free tier's rate
 * limit turns every verdict into `unknown` at once.
 */
export async function scanOrigins(opts: {
  origins: readonly string[];
  token: string | null;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * The most lookups this scan may send to Google. Omitted means unlimited; `webRiskBudget.ts` is what
   * normally supplies it. Cache hits are free and are NOT counted against it — that is the point of
   * checking the cache first.
   */
  maxLookups?: number;
}): Promise<WebRiskScan> {
  const now = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const doFetch = opts.fetchImpl ?? fetch;
  const budget = Number.isFinite(opts.maxLookups) ? Math.max(0, Math.floor(Number(opts.maxLookups))) : Infinity;
  const results: OriginVerdict[] = [];
  let lookups = 0;
  let skippedForBudget = 0;
  for (const origin of opts.origins ?? []) {
    const hit = cached(origin, now);
    if (hit) { results.push({ origin, ...hit }); continue; }
    if (!opts.token) { results.push({ origin, verdict: 'unknown', threats: [] }); continue; }
    if (lookups >= budget) { skippedForBudget++; results.push({ origin, verdict: 'unknown', threats: [] }); continue; }
    let answer: { verdict: UrlVerdict; threats: string[] } = { verdict: 'unknown', threats: [] };
    try {
      const req = buildWebRiskRequest(opts.token, origin);
      lookups++;
      const res = await doFetch(req.url, {
        method: req.method,
        headers: req.headers,
        signal: AbortSignal.timeout(Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : 8_000),
      });
      // A non-2xx is a statement about our request (API off, quota, auth) — never about the uri.
      answer = res.ok ? parseWebRiskVerdict(await res.json().catch(() => null)) : { verdict: 'unknown', threats: [] };
    } catch {
      answer = { verdict: 'unknown', threats: [] };
    }
    remember(origin, answer.verdict, answer.threats, now);
    results.push({ origin, ...answer });
  }
  return {
    results,
    listed: results.filter((r) => r.verdict === 'listed'),
    incomplete: results.some((r) => r.verdict === 'unknown'),
    lookups,
    skippedForBudget,
  };
}

/**
 * One line for the admin's build/deployment record. Never shown to an end user (White-Label Law §3 —
 * it names a third party).
 */
export function webRiskSummary(scan: WebRiskScan): string {
  if (scan.results.length === 0) return 'No outbound hosts to check.';
  if (scan.listed.length > 0) {
    const named = scan.listed.map((l) => `${l.origin}${l.threats.length ? ` (${l.threats.join(', ')})` : ''}`).join('; ');
    return `⚠️ FLAGGED: ${named}. Checked ${scan.results.length} outbound host(s).`;
  }
  const unknowns = scan.results.filter((r) => r.verdict === 'unknown').length;
  if (!scan.incomplete) return `All ${scan.results.length} outbound host(s) checked and clean.`;
  // Said plainly, because "no listings found" over hosts nobody could check is the reassurance this
  // module refuses to give. The budget clause is separate on purpose: "we ran out of allowance" is an
  // admin ACTION (raise the ceiling), while a timeout is weather.
  const why = scan.skippedForBudget > 0
    ? ` ${scan.skippedForBudget} of them were skipped because this month's lookup budget is spent — raise NAVBHARAT_WEB_RISK_MAX_LOOKUPS to check more.`
    : '';
  return `No listings found, but ${unknowns} of ${scan.results.length} outbound host(s) could NOT be checked — this is not a clean bill.${why}`;
}
