// WHO COMES TO NAVBHARATAI ITSELF — the website, and the app.
//
// ADMIN 2026-09-14: *"hamara app kitne mobiles me install hai … kitne user hamari website par aye …
// kon aya v/s kitne aye (all time and today)"*.
//
// 🔴 THE FINDING THAT MADE THIS ONE SMALL FILE INSTEAD OF A NEW SUBSYSTEM. NavBharatAI already owns a
// complete, privacy-safe visitor counter — `siteAnalytics.ts` / `siteAnalyticsStore.ts`: per-day views
// and unique visitors, a visitor code that ROTATES DAILY so it cannot be reversed or joined across
// days, no cookie, nothing stored on the device, Do-Not-Track honoured, and sharded documents so it
// survives scale. We built it, tested it, disclosed it — and gave it to our USERS for the apps they
// publish. **It was never pointed at our own site.** So this module does not count anything; it
// decides WHAT is worth counting and hands it to that store under two reserved ids.
//
// 🔒 WHY COUNTING HAPPENS ON THE SERVER, NOT IN A SCRIPT. The page request already carries the IP and
// user-agent to us — counting it collects nothing new, cannot be blocked by an ad-blocker (which would
// quietly under-report and make the number a lie), and adds no request to the visitor's page.
//
// ⚠️ WHAT THESE NUMBERS ARE NOT, and the panel must say so:
//   • App opens are NOT Play Store installs. Google Play holds installs; we can only see a device that
//     actually opened the app and reached us. Someone who installs and never opens is invisible here,
//     and an install we cannot see is not one we may claim.
//   • ALL-TIME UNIQUE VISITORS CANNOT EXIST, by construction. The visitor code rotates every day
//     precisely so the same person cannot be recognised tomorrow. All-time VIEWS is a running total and
//     is real; all-time "people" would require keeping a permanent per-person identifier, which is the
//     thing the daily rotation exists to refuse.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { siteAnalyticsStore } from './siteAnalyticsStore';
import { requestOptsOut } from './siteAnalytics';

/**
 * The two reserved ids, and why they can never collide with a user's app.
 *
 * `siteIdForWorkspace` returns `nbai-` followed by exactly 20 lowercase HEX characters. Both ids below
 * contain letters outside `[0-9a-f]`, so no workspace can ever hash into one. Asserted in tests rather
 * than trusted — a collision would mix our own traffic into a user's analytics, and theirs into ours.
 */
export const OWN_WEBSITE_ID = 'nbai-own-website';
export const OWN_APP_ID = 'nbai-own-app';

/** Lifetime totals, one document per audience. Written by the flush, never per request. */
const TOTALS_COLLECTION = 'own_audience_totals';

/** PURE. True when `id` cannot be produced by `siteIdForWorkspace` (`nbai-` + 20 hex). */
export function cannotCollideWithAppId(id: string): boolean {
  return !/^nbai-[0-9a-f]{20}$/.test(String(id ?? ''));
}

/**
 * PURE. Is this request a PAGE somebody is looking at, rather than a file the page pulled in?
 *
 * The SPA catch-all only ever answers with `index.html`, so anything reaching it is page-shaped
 * already — but a request for a missing asset (`/logo.png`) lands there too and would inflate the
 * count with things nobody visited. A final path segment carrying a dot is a file, not a page.
 */
export function isPageView(path: unknown): boolean {
  const p = String(path ?? '');
  if (!p.startsWith('/')) return false;
  if (p.startsWith('/api/')) return false;
  const last = p.split('?')[0].split('/').pop() ?? '';
  return !last.includes('.');
}

/**
 * PURE. Conservative crawler check.
 *
 * ⚠️ DELIBERATELY NARROW. A wide filter that catches a real phone under-reports real people, and an
 * under-report is the failure this feature exists to end — so this matches only self-declared bots.
 * A crawler that lies about its user-agent is counted, and the panel says so rather than implying a
 * precision nobody has.
 */
export function looksLikeCrawler(userAgent: unknown): boolean {
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua) return true; // no user-agent at all is a script, never a browser
  return /(bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|headlesschrome|python-requests|curl\/|wget\/|axios\/|node-fetch|go-http-client|okhttp)/.test(ua);
}

/** PURE. Only a caller that DECLARES a native platform counts as an app open. */
export function isAppOpen(platformHeader: unknown): boolean {
  const p = String(platformHeader ?? '').trim().toLowerCase();
  return p === 'android' || p === 'ios';
}

export interface AudienceRequest {
  path: string;
  ip: string;
  userAgent: string;
  headers: Record<string, unknown>;
  nowMs: number;
}

/**
 * PURE. Should this website request be counted, and why not when it should not?
 *
 * Returns a REASON rather than a bare false so the decision can be tested — and so nobody later has to
 * guess which of the three filters dropped a request they expected to see.
 */
export function websiteCountDecision(req: Pick<AudienceRequest, 'path' | 'userAgent' | 'headers'>):
  { count: boolean; reason: 'ok' | 'not-a-page' | 'crawler' | 'opted-out' } {
  if (!isPageView(req.path)) return { count: false, reason: 'not-a-page' };
  if (requestOptsOut(req.headers)) return { count: false, reason: 'opted-out' };
  if (looksLikeCrawler(req.userAgent)) return { count: false, reason: 'crawler' };
  return { count: true, reason: 'ok' };
}

// ── Recording ────────────────────────────────────────────────────────────────

/** Lifetime views buffered in memory and flushed on a timer — one write per instance, never per hit. */
const lifetimePending = new Map<string, number>();
let flushTimer: NodeJS.Timeout | null = null;

/** How often the lifetime totals are written. One minute matches the analytics store's own cadence. */
const LIFETIME_FLUSH_MS = 60_000;

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/** Write the buffered lifetime increments. Never throws — a counter must not break a page. */
export async function flushLifetime(): Promise<void> {
  if (lifetimePending.size === 0) return;
  const batch = [...lifetimePending.entries()];
  lifetimePending.clear();
  const d = db();
  if (!d) return;
  await Promise.all(batch.map(async ([id, views]) => {
    try {
      await d.collection(TOTALS_COLLECTION).doc(id).set({
        views: admin.firestore.FieldValue.increment(views),
        lastSeenMs: Date.now(),
        firstSeenMs: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch {
      // Put them back so a transient failure defers the count rather than losing it.
      lifetimePending.set(id, (lifetimePending.get(id) ?? 0) + views);
    }
  }));
}

function arm(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLifetime();
  }, LIFETIME_FLUSH_MS);
  flushTimer.unref?.();
}

/** Count one visit to OUR OWN website. Never throws — a counter must never break the page. */
export function noteWebsiteVisit(req: AudienceRequest): { counted: boolean; reason: string } {
  try {
    const decision = websiteCountDecision(req);
    if (!decision.count) return { counted: false, reason: decision.reason };
    siteAnalyticsStore.record({
      appId: OWN_WEBSITE_ID, path: req.path.split('?')[0], ref: '',
      ip: req.ip, userAgent: req.userAgent, nowMs: req.nowMs,
    });
    lifetimePending.set(OWN_WEBSITE_ID, (lifetimePending.get(OWN_WEBSITE_ID) ?? 0) + 1);
    arm();
    return { counted: true, reason: 'ok' };
  } catch {
    return { counted: false, reason: 'error' };
  }
}

/** Count one OPEN of the native app. Not an install — see the header. Never throws. */
export function noteAppOpen(req: AudienceRequest & { platform: unknown }): { counted: boolean; reason: string } {
  try {
    if (!isAppOpen(req.platform)) return { counted: false, reason: 'not-native' };
    if (requestOptsOut(req.headers)) return { counted: false, reason: 'opted-out' };
    siteAnalyticsStore.record({
      appId: OWN_APP_ID, path: '/app-open', ref: '',
      ip: req.ip, userAgent: req.userAgent, nowMs: req.nowMs,
    });
    lifetimePending.set(OWN_APP_ID, (lifetimePending.get(OWN_APP_ID) ?? 0) + 1);
    arm();
    return { counted: true, reason: 'ok' };
  } catch {
    return { counted: false, reason: 'error' };
  }
}

/** Lifetime totals for one audience, or null when they cannot be read (never a zero standing in). */
export async function lifetimeViews(id: string): Promise<{ views: number; lastSeenMs: number | null } | null> {
  const d = db();
  if (!d) return null;
  try {
    const snap = await d.collection(TOTALS_COLLECTION).doc(id).get();
    if (!snap.exists) return { views: 0, lastSeenMs: null };
    const data = snap.data() as { views?: number; lastSeenMs?: number } | undefined;
    return { views: Number(data?.views ?? 0), lastSeenMs: Number(data?.lastSeenMs ?? 0) || null };
  } catch {
    return null;
  }
}

// ── The shape the admin screen reads ─────────────────────────────────────────

export interface AudienceView {
  /** Today so far. `null` when the counter could not be read — never a zero standing in for that. */
  today: { views: number; people: number } | null;
  /** The rolling window the day-documents cover. */
  window: { days: number; views: number; people: number; since: string } | null;
  /**
   * Lifetime. `people` is deliberately ABSENT rather than null: the daily-rotating visitor code makes
   * an all-time person count impossible by design, so a field for it would invite somebody to fill it.
   */
  allTime: { views: number; lastSeenMs: number | null } | null;
  /** Why a section is null, in words, so a dashboard never has to guess. */
  unavailable?: string;
}

/**
 * PURE. Fold the day-window summary and the lifetime counter into what the screen shows.
 *
 * 🔒 A MISSING READ IS NOT A ZERO. Both inputs are nullable and each maps to `null` with a reason,
 * because "nobody came" and "we could not look" are different facts and a dashboard that prints 0 for
 * both is the same class of lie as a screen saying "no credentials saved" over a full vault.
 */
export function audienceView(
  summary: { available: boolean; days?: Array<{ day: string; views: number; uniques: number }>; totalViews?: number; totalUniques?: number; todayViews?: number; sinceDay?: string } | null,
  lifetime: { views: number; lastSeenMs: number | null } | null,
  windowDays = 30,
): AudienceView {
  const ok = !!summary && summary.available === true;
  const days = ok ? (summary!.days ?? []) : [];
  const last = days.length ? days[days.length - 1] : null;
  return {
    today: ok ? { views: Number(summary!.todayViews ?? 0), people: Number(last?.uniques ?? 0) } : null,
    window: ok
      ? {
          days: windowDays,
          views: Number(summary!.totalViews ?? 0),
          // ⚠️ NOT a distinct-people figure across the window: the code rotates daily, so this is the
          // sum of daily counts. Somebody who visited on three days counts three times, and the screen
          // labels it "visits by day" rather than implying it is a headcount.
          people: Number(summary!.totalUniques ?? 0),
          since: String(summary!.sinceDay ?? ''),
        }
      : null,
    allTime: lifetime ? { views: lifetime.views, lastSeenMs: lifetime.lastSeenMs } : null,
    ...(ok && lifetime ? {} : { unavailable: !ok && !lifetime
      ? 'Neither the daily counter nor the lifetime total could be read.'
      : !ok
        ? 'The daily counter could not be read, so today and the last 30 days are not shown.'
        : 'The lifetime total could not be read.' }),
  };
}
