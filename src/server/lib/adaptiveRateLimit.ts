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
}

// Per-IP behavioural state. Self-pruned to stay bounded.
const _clients = new Map<string, ClientState>();
const DECAY_MS = 5 * 60 * 1000; // a client idle this long has its violation count reset

function pruneClients(now: number) {
  if (_clients.size <= 10_000) return;
  for (const [k, v] of _clients) {
    if (now - v.lastSeen > DECAY_MS) _clients.delete(k);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Express middleware. Records per-IP request cadence + UA, flags bot-like / bursty callers,
 * and applies a progressive delay (then a short hard block for repeat offenders). Composes
 * IN FRONT of the existing static rate limiters — it never replaces them.
 */
export function adaptiveGuard(options: AdaptiveGuardOptions = {}) {
  const windowMs = options.windowMs ?? 10_000;
  const maxInWindow = options.maxInWindow ?? 25;
  const botThreshold = options.botThreshold ?? 0.8;
  const blockAfter = options.blockAfter ?? 5;
  const blockMs = options.blockMs ?? 60_000;
  const shouldGuard = options.shouldGuard ?? ((req: Request) => req.path.startsWith('/api/'));

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }
    if (!shouldGuard(req)) { next(); return; }

    const now = Date.now();
    const key = req.ip || 'anon';
    pruneClients(now);

    let state = _clients.get(key);
    if (!state) {
      state = { history: [], violations: 0, blockedUntil: 0, lastSeen: now };
      _clients.set(key, state);
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

    // Record + trim history.
    state.history.push(now);
    const cutoff = now - windowMs;
    while (state.history.length && state.history[0] < cutoff) state.history.shift();

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
