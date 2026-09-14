/**
 * "Kon aya v/s kitne aye" — NavBharatAI's own website and app (admin, 2026-09-14).
 *
 * The admin asked four things. Three have honest answers and one does not, and the whole value of this
 * feature is that the difference is visible rather than smoothed over:
 *   • how many came to the website — YES, counted by our own server;
 *   • how many opened the app — YES, but an OPEN is not a Play Store install;
 *   • who came — only people who SIGNED IN; an anonymous visitor cannot be named, by design;
 *   • how many installs — NO. Google Play holds that, and nothing here can reach it.
 *
 * These tests pin the properties that make those answers trustworthy. The most important one is the
 * last group: a counter that cannot be read must never render as zero.
 */
import { describe, it, expect } from 'vitest';
import {
  OWN_WEBSITE_ID, OWN_APP_ID, cannotCollideWithAppId, isPageView, looksLikeCrawler, isAppOpen,
  websiteCountDecision, audienceView, peopleAudience, startOfDayUtc, PEOPLE_LIST_CAP,
} from '../src/server/lib/ownAudience';

describe('the reserved ids cannot be mistaken for a user’s app', () => {
  it('neither id can be produced by siteIdForWorkspace', () => {
    // siteIdForWorkspace returns `nbai-` + exactly 20 lowercase HEX characters. A collision would mix
    // our own traffic into a user's analytics and theirs into ours — so this is asserted, not assumed.
    expect(cannotCollideWithAppId(OWN_WEBSITE_ID)).toBe(true);
    expect(cannotCollideWithAppId(OWN_APP_ID)).toBe(true);
  });

  it('and it really would catch a workspace-shaped id', () => {
    expect(cannotCollideWithAppId('nbai-0123456789abcdef0123')).toBe(false);
  });

  it('the two audiences are separate ids', () => {
    expect(OWN_WEBSITE_ID).not.toBe(OWN_APP_ID);
  });
});

describe('what counts as a page somebody looked at', () => {
  it.each(['/', '/pricing', '/settings/app', '/grievance'])('counts %s', (p) => {
    expect(isPageView(p)).toBe(true);
  });

  it('does not count a missing asset that fell through to the SPA', () => {
    // A request for /logo.png lands on the catch-all too, and counting it would inflate the figure
    // with files nobody visited.
    for (const p of ['/logo.png', '/assets/index-abc123.js', '/favicon.ico']) expect(isPageView(p)).toBe(false);
  });

  it('never counts an API call', () => {
    expect(isPageView('/api/admin/audience')).toBe(false);
  });
});

describe('crawlers, kept narrow on purpose', () => {
  it.each(['Googlebot/2.1', 'curl/8.4.0', 'python-requests/2.31', 'facebookexternalhit/1.1', 'node-fetch'])
    ('excludes %s', (ua) => { expect(looksLikeCrawler(ua)).toBe(true); });

  it('an absent user-agent is a script, not a person', () => {
    expect(looksLikeCrawler('')).toBe(true);
    expect(looksLikeCrawler(undefined)).toBe(true);
  });

  it('🔒 a REAL phone and a REAL laptop are counted', () => {
    // A wide filter under-reports real people, and an under-report is the failure this feature exists
    // to end — so these must pass however tempting a broader regex looks.
    const real = [
      'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    for (const ua of real) expect(looksLikeCrawler(ua), ua).toBe(false);
  });
});

describe('an app OPEN must be declared, never inferred', () => {
  it('counts a declared native platform', () => {
    expect(isAppOpen('android')).toBe(true);
    expect(isAppOpen('ios')).toBe(true);
    expect(isAppOpen(' Android ')).toBe(true);
  });

  it('🔒 does NOT count a caller that declares nothing — anyone can curl that route', () => {
    for (const v of [undefined, '', 'web', 'curl', 'true', null]) expect(isAppOpen(v), String(v)).toBe(false);
  });
});

describe('the website decision says WHY it declined', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36';

  it('counts a real page view', () => {
    expect(websiteCountDecision({ path: '/', userAgent: ua, headers: {} })).toEqual({ count: true, reason: 'ok' });
  });

  it('honours Do Not Track', () => {
    expect(websiteCountDecision({ path: '/', userAgent: ua, headers: { dnt: '1' } }).reason).toBe('opted-out');
  });

  it('names the filter that dropped it, rather than a bare false', () => {
    expect(websiteCountDecision({ path: '/x.png', userAgent: ua, headers: {} }).reason).toBe('not-a-page');
    expect(websiteCountDecision({ path: '/', userAgent: 'Googlebot', headers: {} }).reason).toBe('crawler');
  });

  it('🔒 opt-out is checked BEFORE the crawler test, so a DNT browser is never mislabelled a bot', () => {
    expect(websiteCountDecision({ path: '/', userAgent: 'curl/8', headers: { dnt: '1' } }).reason).toBe('opted-out');
  });
});

describe('🔴 a counter that could not be read is NEVER a zero', () => {
  const summary = {
    available: true, todayViews: 12, totalViews: 400, totalUniques: 210, sinceDay: '2026-08-15',
    days: [{ day: '2026-09-13', views: 30, uniques: 20 }, { day: '2026-09-14', views: 12, uniques: 9 }],
  };

  it('reads today, the window and the lifetime when all are present', () => {
    const v = audienceView(summary, { views: 5000, lastSeenMs: 123 });
    expect(v.today).toEqual({ views: 12, people: 9 });
    expect(v.window).toEqual({ days: 30, views: 400, people: 210, since: '2026-08-15' });
    expect(v.allTime).toEqual({ views: 5000, lastSeenMs: 123 });
    expect(v.unavailable).toBeUndefined();
  });

  it('an unreadable daily counter is null and says so — not 0', () => {
    const v = audienceView(null, { views: 5000, lastSeenMs: null });
    expect(v.today).toBeNull();
    expect(v.window).toBeNull();
    expect(v.unavailable).toMatch(/daily counter could not be read/i);
  });

  it('an unreadable lifetime total is null and says so — not 0', () => {
    const v = audienceView(summary, null);
    expect(v.allTime).toBeNull();
    expect(v.unavailable).toMatch(/lifetime total could not be read/i);
  });

  it('a store that reports unavailable is treated as unreadable, not as empty', () => {
    const v = audienceView({ available: false }, null);
    expect(v.today).toBeNull();
    expect(v.unavailable).toMatch(/neither/i);
  });

  it('🔒 there is NO all-time people field to fill in', () => {
    // The visitor code rotates daily so an all-time headcount cannot exist. A field for it would
    // invite somebody to populate it with the sum of daily counts, which is visits, not people.
    const v = audienceView(summary, { views: 5000, lastSeenMs: null });
    expect(Object.keys(v.allTime ?? {})).toEqual(['views', 'lastSeenMs']);
  });

  it('a genuinely quiet day IS zero — the honest case still works', () => {
    const quiet = { ...summary, todayViews: 0, days: [{ day: '2026-09-14', views: 0, uniques: 0 }] };
    const v = audienceView(quiet, { views: 5000, lastSeenMs: null });
    expect(v.today).toEqual({ views: 0, people: 0 });
    expect(v.unavailable).toBeUndefined();
  });
});

describe('WHO came — the only half that can name anybody', () => {
  const DAY = Date.UTC(2026, 8, 14);          // 2026-09-14T00:00:00Z
  const now = DAY + 10 * 3600_000;             // 10:00 UTC that day
  const yesterday = DAY - 3600_000;

  const person = (over: Partial<Parameters<typeof peopleAudience>[0][number]>) => ({
    userId: 'u', name: 'A', email: 'a@b.c', joinedMs: yesterday, lastActiveMs: yesterday, ...over,
  });

  it('midnight UTC is the day boundary', () => {
    expect(startOfDayUtc(now)).toBe(DAY);
    expect(startOfDayUtc(DAY)).toBe(DAY);
  });

  it('counts who signed in today, and names them newest first', () => {
    const r = peopleAudience([
      person({ userId: '1', name: 'Early', lastActiveMs: DAY + 1000 }),
      person({ userId: '2', name: 'Late', lastActiveMs: DAY + 9 * 3600_000 }),
      person({ userId: '3', name: 'Old', lastActiveMs: yesterday }),
    ], now);
    expect(r.registered).toBe(3);
    expect(r.activeToday).toBe(2);
    expect(r.today.map((u) => u.name)).toEqual(['Late', 'Early']);
  });

  it('counts accounts created today separately from visits', () => {
    const r = peopleAudience([
      person({ userId: '1', joinedMs: DAY + 60_000, lastActiveMs: yesterday }),
      person({ userId: '2', joinedMs: yesterday, lastActiveMs: yesterday }),
    ], now);
    expect(r.joinedToday).toBe(1);
    expect(r.activeToday).toBe(0);
  });

  it('🔴 an UNKNOWN last-active is counted as unknown, never as "did not come"', () => {
    // Firebase Auth holds "last signed in" and can be unreachable or capped. Folding an unknown into
    // "not today" would render an outage as a quiet day — the same lie in a different costume.
    const r = peopleAudience([
      person({ userId: '1', lastActiveMs: null }),
      person({ userId: '2', lastActiveMs: null }),
      person({ userId: '3', lastActiveMs: DAY + 1000 }),
    ], now);
    expect(r.lastActiveUnknown).toBe(2);
    expect(r.activeToday).toBe(1);
    expect(r.registered).toBe(3);
  });

  it('the COUNT stays exact even when the named list is capped', () => {
    const many = Array.from({ length: PEOPLE_LIST_CAP + 7 }, (_, i) =>
      person({ userId: String(i), name: `U${i}`, lastActiveMs: DAY + i * 1000 }));
    const r = peopleAudience(many, now);
    expect(r.activeToday).toBe(PEOPLE_LIST_CAP + 7);   // the number is never cut
    expect(r.today).toHaveLength(PEOPLE_LIST_CAP);     // only the list is
    expect(r.todayTruncated).toBe(true);
  });

  it('does not claim truncation when everybody fits', () => {
    const r = peopleAudience([person({ lastActiveMs: DAY + 1 })], now);
    expect(r.todayTruncated).toBe(false);
  });

  it('a nameless account still gets a readable row rather than a blank', () => {
    const r = peopleAudience([person({ name: '', email: '', lastActiveMs: DAY + 1 })], now);
    expect(r.today[0]).toMatchObject({ name: 'NavBharat User', email: '\u2014' });
  });

  it('no users at all is a real zero, not a failure', () => {
    const r = peopleAudience([], now);
    expect(r).toMatchObject({ registered: 0, activeToday: 0, joinedToday: 0, lastActiveUnknown: 0, todayTruncated: false });
  });
});
