/**
 * P-SEC.8 — Adaptive rate limiting + bot detection.
 *
 * The static per-IP counters (express-rate-limit in `server.ts`) catch raw VOLUME but not
 * BEHAVIOUR: a distributed bot pacing itself just under the limit, or a scraper hammering
 * with a machine-cadence, slips through. This module adds a behavioural layer that runs in
 * FRONT of those counters:
 *
 *   - Bot fingerprinting from the User-Agent + request shape (missing UA, known scraper UAs).
 *   - Burst detection: many requests inside a very short window = machine cadence, not human.
 *   - Progressive backoff: a flagged caller is slowed by an escalating delay; a repeat
 *     offender is briefly blocked (429 + Retry-After). Good behaviour decays the penalty.
 *
 * Everything here is real and self-contained — no external service, no new dependency. The
 * pure scoring/penalty functions are exported and unit-tested; the middleware is VITEST-
 * skipped (like the other limiters) so the test suite never sleeps.
 *
 * NOTE: hCaptcha and third-party IP-reputation (AbuseIPDB / IPQualityScore) are intentionally
 * NOT implemented here — they require external accounts/keys (infrastructure that does not yet
 * exist for this project), and faking them would violate the "real features only" rule. They
 * remain open sub-items; the behavioural layer below is the part that is fully buildable today.
 */
import type { Request, Response, NextFunction } from 'express';
import { errorTracker } from '../observability/ErrorTracker';
import { BoundedCache } from './boundedCache';
import { addressRateKey } from './clientAddress';

/** Substrings that, in a User-Agent, strongly indicate an automated client. */
const BOT_UA_SIGNATURES = [
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client', 'okhttp',
  'scrapy', 'httpclient', 'java/', 'libwww-perl', 'aiohttp', 'axios/', 'node-fetch',
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'bot', 'spider', 'crawler',
];

/** Substrings of legitimate crawlers we don't want to penalise as malicious bots. */
const BENIGN_BOT_SIGNATURES = ['googlebot', 'bingbot', 'uptimerobot', 'pingdom', 'slackbot'];

/**
 * Score a User-Agent from 0 (clearly a real browser) to 1 (clearly an automated client).
 * Pure + deterministic so it can be unit-tested. Missing UA scores high; a recognised
 * browser token ("mozilla/") with no bot signature scores low.
 */
export function scoreUserAgent(ua?: string | null): number {
  if (!ua || ua.trim() === '') return 0.9; // no UA at all → very likely a script
  const s = ua.toLowerCase();
  if (BENIGN_BOT_SIGNATURES.some((sig) => s.includes(sig))) return 0.2; // known good crawler
  if (BOT_UA_SIGNATURES.some((sig) => s.includes(sig))) return 0.95;
  // Real browsers always send a "mozilla/..." token; its absence is mildly suspicious.
  if (!s.includes('mozilla/')) return 0.6;
  return 0.05;
}

/**
 * Burst detection: true when more than `maxInWindow` of the supplied timestamps fall inside
 * the trailing `windowMs` ending at `now`. Pure — caller owns the timestamp history.
 */
export function isBurst(timestamps: number[], now: number, windowMs: number, maxInWindow: number): boolean {
  const cutoff = now - windowMs;
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] >= cutoff) count++;
    else break; // timestamps are appended in order → older ones are all out of window
  }
  return count > maxInWindow;
}

/**
 * Progressive penalty in milliseconds for the Nth violation: 0, 0.5s, 1s, 2s, 4s, 8s …
 * capped at `capMs`. Exponential backoff so a persistent abuser is throttled hard while a
 * one-off blip is barely affected.
 */
export function computePenaltyMs(violations: number, capMs = 30_000): number {
  if (violations <= 0) return 0;
  return Math.min(capMs, 250 * 2 ** violations); // v1=500, v2=1000, v3=2000, …
}

/**
 * Default path predicate for the behavioural guard: protect the abuse-prone /api/ surface, but
 * EXEMPT the authenticated, credit-metered, interactive NavBharatAI Pro endpoints. A single
 * legitimate build fires a BURST of /api/agentv3/* calls (the SSE build stream + reconnects, plus
 * status / preview-status / workspace-files / conversations / diagnostics polling) that easily
 * exceeds a behavioural burst threshold — so the guard was hard-blocking real users mid-build with
 * "Too many automated requests. Try again in Ns.". Those endpoints are already protected by auth,
 * per-build credit/budget limits and the static per-IP limiters, so the bot-burst layer is both
 * unnecessary and harmful there. Pure + exported so the exemption is unit-tested.
 */
export function isGuardedPath(path: string): boolean {
  if (!path.startsWith('/api/')) return false;
  if (path.startsWith('/api/agentv3/')) return false; // interactive v5.0 build surface — exempt
  return true;
}

/**
 * What the admin Errors view is told when this guard STARTS a hard block (queue Q-013, 2026-10-04).
 *
 * 🔴 WHY: an iPhone's App Mart was answered with an `{ error }` body instead of the store status, and
 * nothing on the server could say which guard sent it. This guard is one of only two candidates (the
 * other is the global 500 handler, which already reports itself), and its blocks were silent. Now the
 * first refusal of every block is recorded once, naming the reason, the path and the client kind, so the
 * next occurrence answers the question without a screenshot.
 *
 * The IP is deliberately NOT recorded (it is personal data and is not needed to name the guard). The
 * User-Agent is kept, truncated, because "an iPhone app was blocked" and "curl was blocked" are the two
 * answers the admin needs to tell apart. PURE.
 */
export function blockReport(input: {
  reason: 'bot-user-agent' | 'burst';
  method: string;
  path: string;
  userAgent?: string | null;
  requestsInWindow: number;
  windowMs: number;
  blockMs: number;
}): { message: string; meta: Record<string, unknown> } {
  const why = input.reason === 'burst'
    ? `${input.requestsInWindow} requests in ${Math.round(input.windowMs / 1000)}s from one address`
    : 'its User-Agent looks automated';
  const ua = (input.userAgent || '').trim().slice(0, 160) || '(none)';
  return {
    message: `Adaptive guard blocked a caller for ${Math.round(input.blockMs / 1000)}s (${why}); the request that tipped it: ${input.method} ${input.path}`,
    meta: { guard: 'adaptive-rate-limit', reason: input.reason, userAgent: ua, requestsInWindow: input.requestsInWindow },
  };
}

interface ClientState {
  /** Recent request timestamps (trimmed to the detection window). */
  history: number[];
  /** Running count of suspicious events; decays over time on good behaviour. */
  violations: number;
  /** Epoch ms until which the client is hard-blocked (0 = not blocked). */
  blockedUntil: number;
  /** Last time we saw this client (for pruning + decay). */
  lastSeen: number;
}

export interface AdaptiveGuardOptions {
  /** Burst window in ms (default 10s). */
  windowMs?: number;
  /** Max requests allowed in the window before it counts as a burst (default 25). */
  maxInWindow?: number;
  /** UA score at/above which a request is treated as bot-like (default 0.8). */
  botThreshold?: number;
  /** Violations at/above which the client is hard-blocked instead of just delayed (default 5). */
  blockAfter?: number;
  /** How long a hard block lasts, in ms (default 60s). */
  blockMs?: number;
  /** Only guard requests whose path passes this test (default: paths starting with /api/). */
  shouldGuard?: (req: Request) => boolean;
  /**
   * The VERIFIED uid of a signed-in request, or null (a forged or expired token is not an identity). Consulted
   * only when the caller's ADDRESS is already hot — at its burst ceiling or blocked — so the cost of a token
   * check is paid only there.
   *
   * 🔴 WHY (audit 2026-10-11, F3): measured, one address at a steady 20 req/s → 39 succeeded, 345 got 429, then
   * a 60 s block. Indian mobile carriers and offices put many people behind ONE address; when strangers there
   * were busy at once, every signed-in person behind it was blocked with them. A verified account now gets its
   * own bucket with the same rules, so it is judged on its own traffic. Anonymous traffic stays on the address.
   */
  verifyUid?: (req: Request) => Promise<string | null>;
  /** Run under vitest too (the guard is skipped there by default so suites never sleep). Tests only. */
  runInTests?: boolean;
}

/**
 * Per-caller behavioural state, keyed by `addressRateKey` (or `uid:<uid>`, see `verifyUid` below).
 *
 * 🔴 BOUNDED AND O(1) PER REQUEST (performance audit 2026-10-11). This was a plain Map pruned by walking ALL of
 * it on every request once it held 10,000 entries — and the walk only dropped callers idle for 5 minutes, so a
 * busy instance (or anyone with an IPv6 range) kept it above 10,000 and paid the full walk on every `/api`
 * request: measured 1,162 → 486 req/s, ~38% of CPU in that loop, memory 304 → 750 MB in 60 s. Now the least
 * recently seen caller is evicted when the cap is reached, and idle decay stays lazy (checked on the caller's
 * own next request). An evicted abuser simply starts again from zero, which is all a fresh address would get.
 */
export const MAX_TRACKED_CALLERS = 20_000;
const _clients = new BoundedCache<string, ClientState>({ maxEntries: MAX_TRACKED_CALLERS });
const DECAY_MS = 5 * 60 * 1000; // a client idle this long has its violation count reset

/** How many callers the guard currently tracks (tests and the admin monitor). */
export function trackedCallerCount(): number {
  return _clients.size;
}

/** Test hook: forget every caller. */
export function resetAdaptiveGuardState(): void {
  _clients.clear();
}

/** Timestamps inside the trailing window (history is in arrival order). PURE. */
function inWindow(history: number[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (let i = history.length - 1; i >= 0 && history[i] >= cutoff; i--) count++;
  return count;
}

function hasBearerToken(req: Request): boolean {
  const h = req.headers.authorization;
  return typeof h === 'string' && h.startsWith('Bearer ') && h.length > 7;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Express middleware. Records per-IP request cadence + UA, flags bot-like / bursty callers,
 * and applies a progressive delay (then a short hard block for repeat offenders). Composes
 * IN FRONT of the existing static rate limiters — it never replaces them.
 */
export function adaptiveGuard(options: AdaptiveGuardOptions = {}) {
  const windowMs = options.windowMs ?? 10_000;
  // Burst ceiling per window. 25/10s was far too low for a logged-in user driving an interactive
  // app (chat + polling legitimately bursts past it); a real scraper does hundreds/sec, so 120/10s
  // still catches genuine hammering while never tripping on normal interactive use.
  const maxInWindow = options.maxInWindow ?? 120;
  const botThreshold = options.botThreshold ?? 0.8;
  const blockAfter = options.blockAfter ?? 5;
  const blockMs = options.blockMs ?? 60_000;
  const shouldGuard = options.shouldGuard ?? ((req: Request) => isGuardedPath(req.path));

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST && !options.runInTests) { next(); return; }
    if (!shouldGuard(req)) { next(); return; }

    const now = Date.now();
    const addressKey = addressRateKey(req);
    const stateFor = (key: string): ClientState => {
      let st = _clients.get(key, now);
      if (!st) {
        st = { history: [], violations: 0, blockedUntil: 0, lastSeen: now };
        _clients.set(key, st, now);
      }
      return st;
    };

    let state = stateFor(addressKey);
    // A hot address (blocked, or one request from its burst ceiling) with a VERIFIED account on this
    // request: judge the account, not the address it shares with strangers.
    if (options.verifyUid && hasBearerToken(req) && (state.blockedUntil > now || inWindow(state.history, now, windowMs) >= maxInWindow)) {
      const uid = await options.verifyUid(req).catch(() => null);
      if (uid) state = stateFor(`uid:${uid}`);
    }

    // Hard block still in effect → reject immediately.
    if (state.blockedUntil > now) {
      const retryAfterSec = Math.ceil((state.blockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: `Too many automated requests. Try again in ${retryAfterSec}s.` });
      return;
    }

    // Decay violations if the client has been quiet for a while.
    if (now - state.lastSeen > DECAY_MS) state.violations = 0;
    state.lastSeen = now;

    // Record + trim history. Only the newest `maxInWindow + 1` timestamps can decide a burst, so nothing older
    // is kept: one caller's state stays a few hundred bytes however hard it hammers.
    state.history.push(now);
    const cutoff = now - windowMs;
    while (state.history.length && state.history[0] < cutoff) state.history.shift();
    if (state.history.length > maxInWindow + 1) state.history.splice(0, state.history.length - (maxInWindow + 1));

    const botScore = scoreUserAgent(req.headers['user-agent'] as string | undefined);
    const bursty = isBurst(state.history, now, windowMs, maxInWindow);
    const suspicious = botScore >= botThreshold || bursty;

    if (!suspicious) {
      // Reward good behaviour: gently decay any accumulated violations.
      if (state.violations > 0) state.violations--;
      next();
      return;
    }

    state.violations++;

    // Repeat offender → hard block.
    if (state.violations >= blockAfter) {
      state.blockedUntil = now + blockMs;
      try {
        const ua = req.headers['user-agent'] as string | undefined;
        const report = blockReport({
          reason: bursty ? 'burst' : 'bot-user-agent',
          method: req.method,
          path: req.path,
          userAgent: ua,
          requestsInWindow: state.history.length,
          windowMs,
          blockMs,
        });
        errorTracker.capture(new Error(report.message), {
          source: 'middleware', httpMethod: req.method, httpUrl: req.path, httpStatus: 429, meta: report.meta,
        });
      } catch { /* reporting a block must never change it */ }
      const retryAfterSec = Math.ceil(blockMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: `Too many automated requests. Try again in ${retryAfterSec}s.` });
      return;
    }

    // Otherwise: progressive slow-down, then allow through to the static limiter.
    const penalty = computePenaltyMs(state.violations, blockMs);
    if (penalty > 0) await sleep(penalty);
    next();
  };
}
