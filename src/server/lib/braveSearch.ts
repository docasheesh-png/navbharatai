// ONE SEARCH CLIENT, AND THE THREE THINGS THAT KEEP ITS BILL SMALL.
//
// ── WHY THIS FILE EXISTS AT ALL (the root cause, not the symptom) ─────────────────────────────────
// The Brave Search call was written TWICE — `AgentV3/WebSearch.ts` and `EngineerAI/WebSearchClient.ts`
// each carried their own private `braveSearch()`, byte-for-byte the same request with two slightly
// different error styles. That is the exact duplicated-code class the fourth absolute rule says to
// CENTRALIZE rather than patch: with two copies there is no single place to put a cache, a counter, or
// a price, so every cost control would have had to be written twice and would have drifted the first
// time somebody touched one of them. Now there is one door, and everything below hangs on it.
//
// ── WHAT IT COSTS, WHICH IS THE WHOLE POINT ──────────────────────────────────────────────────────
// Brave's Search plan bills **per request**, not per result: $5.00 per 1,000 searches (~₹0.44 each),
// with $5 of credit applied free every month — i.e. the first ~1,000 searches of each month are free.
// Asking for more results in one request is therefore FREE, and asking the same question twice is not.
// So the only honest levers are: do not repeat a call, and do not make two identical calls at once.
//
// ── THE THREE LEVERS, IN ORDER OF HOW MUCH THEY SAVE AND HOW LITTLE THEY COST ────────────────────
// 1. **In-flight coalescing** — two users asking the same thing in the same second share ONE HTTP
//    call. This is a pure win with NO staleness whatsoever: the second caller receives the very same
//    live response the first one is already waiting for. Nothing is traded away.
// 2. **A short, freshness-aware cache** — a repeat of the same question inside a few minutes reuses
//    the answer. This one DOES trade something, so the trade is made explicitly and small: anything
//    that moves ball-by-ball or tick-by-tick (a score, a live match, a share price) gets ONE MINUTE,
//    and everything else gets ten. Ten-minute-old search results for "aaj ka gold rate" or "latest
//    iPhone price" are not stale in any sense a user could perceive — but ten minutes is long enough
//    to collapse the burst of identical questions that a trending topic actually produces.
// 3. **Normalisation** — "Aaj Ka Gold Rate" and "aaj ka gold rate  " are one search, because Brave
//    treats them as one search. Free saving, zero risk.
//
// 🔒 THE STANDING RULE THIS OBEYS (CLAUDE.md, admin 2026-09-12): *"latest information aur correct
// information jyada important hai, time se jyada."* Cost is NOT allowed to buy staleness the user can
// feel. That is why the volatile class exists, why an EMPTY or FAILED response is never cached (a
// transient failure must not be remembered as an answer), and why nothing here shortens a fetch budget
// or reads fewer sources — the savings come only from not repeating work.
//
// ── FREE FIRST WHERE IT IS SAFE, PAID FIRST WHERE IT MATTERS (admin 2026-09-12) ─────────────────
// The admin asked whether Brave and DuckDuckGo could work together, with DuckDuckGo used wherever
// Brave is not really needed. They can, and `searchOrder()` below is that rule — but NOT as a merge of
// both engines on every query, which would pay Brave EVERY time and cost strictly MORE than today.
// What actually saves money is asking the FREE engine first wherever its answer is good enough, and
// paying only where the paid one earns its fee:
//
//   • `reference` — a build or Engineer AI looking up a package version, a framework doc, an error
//     message. Stable, keyword-shaped queries; nobody is watching a spinner (a build already runs for
//     minutes). DuckDuckGo FIRST, Brave only if DuckDuckGo comes back with nothing. Note what this
//     really is: DuckDuckGo alone is EXACTLY today's behaviour on this path, since there is no key in
//     production yet — so this is not a downgrade of anything, it is today plus a paid rescue.
//   • `live` — a chat question the user is waiting on, about something that changes (a rate, a score,
//     the news). Freshness and result quality are the entire product here, and this is the class Brave
//     is being bought for. Brave FIRST, DuckDuckGo as the free rescue if Brave fails or finds nothing.
//
// So the split is by WHO IS WAITING and WHETHER THE ANSWER MOVES, not by a guess about quality. Both
// directions rescue each other, so neither engine being down can leave a caller with nothing.
//
// 🔒 AND IT CANNOT BECOME A SURPRISE BILL. Brave's Search plan is PREPAID: without credits on the
// account there is nothing to overspend, and when a call fails for any reason — no credit, a rate
// limit, a network blip — both callers already fall back to the key-free DuckDuckGo path. The failure
// mode is "today's behaviour", never a broken chat and never an invoice nobody approved. The
// authoritative ceiling therefore lives on Brave's own dashboard (Usage limits), which is the one
// place a cap cannot be wrong; this module's job is to need it less often.

/**
 * Why this search is being run — which decides which engine is asked FIRST. See the header.
 *
 * `reference` is the default everywhere on purpose: a caller that has not thought about it is, by
 * definition, not a user-facing live question, and the safe default is the one that costs nothing.
 */
export type SearchIntent = 'live' | 'reference';

/** Which engines to try, in order. PURE. */
export function searchOrder(intent: SearchIntent, hasBraveKey: boolean): Array<'brave' | 'duck'> {
  if (!hasBraveKey) return ['duck'];
  return intent === 'live' ? ['brave', 'duck'] : ['duck', 'brave'];
}

/** One web result, in the shape both callers already use. */
export interface BraveResult {
  title: string;
  url: string;
  snippet: string;
}

/** How long a fast-moving query's results may be reused. A score changes between overs. */
export const VOLATILE_TTL_MS = 60_000;

/** How long an ordinary query's results may be reused. */
export const STANDARD_TTL_MS = 10 * 60_000;

/** Most entries a single instance keeps, so a busy day cannot grow the heap without bound. */
export const MAX_CACHE_ENTRIES = 500;

const SEARCH_TIMEOUT_MS = 10_000;

/** HTTP statuses already reported, so one bad key logs one line rather than one per search. */
const loggedStatuses = new Set<number>();

/**
 * Words that mean the answer moves faster than the ordinary cache window. PURE.
 *
 * Deliberately narrow. A word added here costs money (that class re-searches ten times as often); a
 * word missing from it costs at most sixty-second-to-ten-minute freshness on one kind of question. So
 * the list is the genuinely tick-by-tick things — live sport and live markets — and nothing else.
 */
const VOLATILE_PATTERN =
  /\b(score|scorecard|live|match|innings|wicket|sensex|nifty|stock|share price|bitcoin|crypto|exit poll)\b/i;

/** How long results for this query may be reused. PURE. */
export function cacheTtlMs(query: string): number {
  return VOLATILE_PATTERN.test(String(query ?? '')) ? VOLATILE_TTL_MS : STANDARD_TTL_MS;
}

/**
 * The cache key for a query. PURE.
 *
 * Case and spacing are collapsed because Brave itself does not distinguish them — so treating them as
 * one search loses nothing and saves a real proportion of calls. `count` is part of the key because a
 * request for three results cannot serve one for ten.
 */
export function cacheKey(query: string, count: number): string {
  const q = String(query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${n}:${q}`;
}

/**
 * The subscription token, or `undefined` when there is not a usable one. PURE.
 *
 * 🔴 THE TRIM IS THE WHOLE POINT, AND IT IS NOT TIDINESS. The key goes straight into the
 * `X-Subscription-Token` header. A value pasted into a console with a trailing space or a newline —
 * the single most likely way a key is entered by hand — would be sent WITH that whitespace, Brave
 * would reject it, and both callers' `.catch()` would quietly fall back to DuckDuckGo. The result is
 * the worst failure shape there is: the console shows the key configured, nothing errors, no user
 * sees a problem, and the paid engine simply never runs. Same class as the malformed `ALERT_EMAIL_FROM`
 * that read as configured for a day — so it is refused at the door instead, and a key that is only
 * whitespace is treated exactly like an unset one.
 */
export function braveApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = String(env.BRAVE_API_KEY ?? '').trim();
  return raw ? raw : undefined;
}

/** The kill switch. Unset ⇒ the cache is ON, because a repeat call costs money for nothing. */
export function braveCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.BRAVE_SEARCH_CACHE ?? '').trim().toLowerCase() !== 'off';
}

interface CacheEntry {
  at: number;
  results: BraveResult[];
}

const cache = new Map<string, CacheEntry>();

/**
 * A call that is genuinely still in the air.
 *
 * 🔴 `settled` is not bookkeeping — it is the fix for a real bug this module shipped with for exactly
 * one test run. The entry used to be removed in a detached `.finally()`, which runs a microtask LATER
 * than the caller's own continuation. So a second caller arriving immediately after the first one
 * returned could still find the entry, "coalesce" onto an ALREADY-SETTLED promise, and be handed a
 * result that was deliberately not cached — an empty one, or an outage. Coalescing is only ever safe
 * while the request is still live; the flag is what makes that condition explicit instead of leaving
 * it to promise-resolution ordering nobody should have to reason about.
 */
interface InFlight {
  p: Promise<BraveResult[]>;
  settled: boolean;
}

const inFlight = new Map<string, InFlight>();

/** What the meter has seen since this instance booted — honest about being per-instance. */
const meter = { calls: 0, cacheHits: 0, coalesced: 0, freeServed: 0, rescues: 0 };

/** A search the free engine answered while a paid key was available — money not spent. */
export function noteFreeServed(): void {
  meter.freeServed += 1;
}

/** The first engine found nothing and the second had to be asked. */
export function noteRescue(): void {
  meter.rescues += 1;
}

/**
 * What this instance has spent and saved since boot.
 *
 * `calls` is the only number that costs money. `saved` is how many searches would have been billed
 * without this module — so the pair is what tells the admin whether the cache is earning its keep
 * rather than merely existing.
 */
export function braveMeter(): {
  calls: number; cacheHits: number; coalesced: number; freeServed: number; rescues: number;
  saved: number; savedPct: number;
} {
  const saved = meter.cacheHits + meter.coalesced + meter.freeServed;
  const total = meter.calls + saved;
  return { ...meter, saved, savedPct: total > 0 ? Math.round((saved / total) * 100) : 0 };
}

/** Test seam — a fresh instance's state, without restarting the process. */
export function __resetBraveSearch(): void {
  cache.clear();
  inFlight.clear();
  meter.calls = 0;
  meter.cacheHits = 0;
  meter.coalesced = 0;
  meter.freeServed = 0;
  meter.rescues = 0;
  loggedStatuses.clear();
}

function readCache(key: string, ttl: number, now: number): BraveResult[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.results;
}

function writeCache(key: string, results: BraveResult[], now: number): void {
  // An empty result is never remembered: it is far more often a blocked/odd response than a true
  // "the web has nothing", and caching it would turn one bad minute into ten.
  if (!results.length) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: now, results });
}

/** The raw request. Kept byte-identical to the two copies it replaces, including the header shape. */
async function requestBrave(query: string, count: number, apiKey: string): Promise<BraveResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
    });
    if (!res.ok) {
      // 🔒 ADMIN-ONLY server log, never a user surface (the White-Label Law governs what USERS see).
      // Once per status, because a wrong key fails on every single call and would otherwise flood the
      // log — and because a silent fall back to the free engine is precisely how a misconfigured key
      // stays invisible. 401/403 names the key; 429 names the quota. Both are actionable in one line.
      if (!loggedStatuses.has(res.status)) {
        loggedStatuses.add(res.status);
        console.warn(
          `[BRAVE] search rejected — HTTP ${res.status}` +
            (res.status === 401 || res.status === 403
              ? ' (the key is missing, wrong, or the plan is not subscribed — check BRAVE_API_KEY)'
              : res.status === 429
                ? ' (rate limit or credits exhausted — the free engine is serving these searches)'
                : '') +
            '. Falling back to the free engine; nothing is broken for users.',
        );
      }
      throw new Error(`Brave Search: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    const items = data?.web?.results || [];
    return items.slice(0, count).map((item) => ({
      title: String(item.title || ''),
      url: String(item.url || ''),
      snippet: String(item.description || ''),
    }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search Brave, paying for it as rarely as honestly possible.
 *
 * THROWS on failure, exactly as the two private copies did — that contract is what makes the callers'
 * `.catch(() => duckDuckGo(...))` fall back to the free path instead of returning nothing. Do not
 * "improve" this into returning an empty array: an empty array is a valid answer meaning "the web has
 * nothing", and swallowing an outage into it would silently remove the free fallback.
 */
export async function braveSearch(query: string, count: number, apiKey: string): Promise<BraveResult[]> {
  const key = cacheKey(query, count);
  const now = Date.now();
  const caching = braveCacheEnabled();

  if (caching) {
    const cached = readCache(key, cacheTtlMs(query), now);
    if (cached) {
      meter.cacheHits += 1;
      return cached;
    }
    // Someone is already asking this exact question right now — wait for THEIR live answer rather than
    // buying a second copy of it. Nothing is stale here: it is the same in-flight request.
    const running = inFlight.get(key);
    if (running && !running.settled) {
      meter.coalesced += 1;
      return running.p;
    }
  }

  meter.calls += 1;
  const pending = requestBrave(query, count, apiKey);
  if (caching) {
    const entry: InFlight = { p: pending, settled: false };
    inFlight.set(key, entry);
    // Registered before the caller can attach its own, and it marks the entry settled in the SAME hop
    // it clears it — so there is no instant in which a settled promise is still advertised as live.
    // Detached with `void` so a rejection here can never become an unhandled rejection, and so the
    // caller's own error path is exactly the one it had before this module existed.
    void pending.then(
      (results) => {
        entry.settled = true;
        inFlight.delete(key);
        writeCache(key, results, Date.now());
      },
      () => {
        entry.settled = true;
        inFlight.delete(key);
      },
    );
  }
  return pending;
}
