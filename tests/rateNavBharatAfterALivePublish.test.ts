// RATE NAVBHARATAI (admin 2026-10-05): "rating system banao! jab bhi user ki app badhiya bane, user usko
// deploy kare successfully, tabhi rating ka notification aa jaye! jis user ne rating nahi kari hai, uske
// liye!!"
//
// Three promises, each locked here:
//   1. THE MOMENT — the card is offered only after a publish that went live, after the user has seen
//      their link (the celebration card closes first), from every surface that publishes.
//   2. THE PERSON — a user who has rated is never asked again; "Not now" pauses (3 days, 7, then 30);
//      a store that cannot answer means "do not ask".
//   3. REAL — a rating is saved in Firestore and read by the admin on Users → Ratings; nothing thanks the
//      user for a rating that was not saved, and the admin never sees an average built from fallbacks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  shouldAskForRating, afterDismiss, hasRated, parseRatingSubmission, summarizeRatings, snoozeAfter,
  cleanRatingComment, MAX_RATING_COMMENT_CHARS, SNOOZE_LADDER_MS,
} from '../src/server/lib/platformRatingRules';
import {
  isRatingMoment, readRatingStatus, offeredThisSession, markOfferedThisSession, readRatingsOverview,
  barPercent, starLabel, commentPrompt, RATING_COMMENT_MAX, RATING_SESSION_KEY,
} from '../src/lib/platformRating';
import { registerPlatformRatingRoutes } from '../src/server/routes/platformRating';

const ROOT = join(__dirname, '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

describe('the person: who is asked', () => {
  it('a user with no record is asked; a user who rated is never asked again, however long ago', () => {
    expect(shouldAskForRating(null, NOW)).toBe(true);
    expect(shouldAskForRating({}, NOW)).toBe(true);
    for (const stars of [1, 3, 5]) {
      expect(shouldAskForRating({ stars, ratedAt: NOW - 400 * DAY }, NOW)).toBe(false);
    }
  });

  it('"Not now" pauses for 3 days, then 7, then 30 for every later one — never "never"', () => {
    expect(SNOOZE_LADDER_MS).toEqual([3 * DAY, 7 * DAY, 30 * DAY]);
    let rec = afterDismiss(null, NOW);
    expect(rec).toMatchObject({ dismissCount: 1, snoozedUntil: NOW + 3 * DAY });
    expect(shouldAskForRating(rec, NOW + 3 * DAY - 1)).toBe(false);
    expect(shouldAskForRating(rec, NOW + 3 * DAY + 1)).toBe(true);
    rec = afterDismiss(rec, NOW);
    expect(rec.snoozedUntil).toBe(NOW + 7 * DAY);
    rec = afterDismiss(rec, NOW);
    expect(rec.snoozedUntil).toBe(NOW + 30 * DAY);
    rec = afterDismiss(rec, NOW);
    expect(rec).toMatchObject({ dismissCount: 4, snoozedUntil: NOW + 30 * DAY });
    expect(snoozeAfter(0)).toBe(3 * DAY);
  });

  it('a stale card closing after the user rated cannot pause or undo the rating', () => {
    const rated = { stars: 4, ratedAt: NOW };
    expect(afterDismiss(rated, NOW)).toEqual(rated);
    expect(hasRated(afterDismiss(rated, NOW))).toBe(true);
  });

  it('only a whole 1–5 counts as rated', () => {
    for (const stars of [0, 6, 2.5, NaN, undefined]) expect(hasRated({ stars: stars as number })).toBe(false);
  });
});

describe('a rating body is read, never invented', () => {
  it('accepts 1–5 (a form string too), keeps the platform, cleans and caps the note', () => {
    expect(parseRatingSubmission({ stars: 5, comment: '  Great!  ', platform: 'android' })).toEqual({ stars: 5, comment: 'Great!', platform: 'android' });
    expect(parseRatingSubmission({ stars: '4' })).toEqual({ stars: 4, comment: '', platform: 'web' });
    expect(parseRatingSubmission({ stars: 3, platform: 'windows-phone' })?.platform).toBe('web');
    const long = parseRatingSubmission({ stars: 2, comment: 'x'.repeat(2000) });
    expect(long?.comment.length).toBe(MAX_RATING_COMMENT_CHARS);
    expect(cleanRatingComment('a\u0000b\r\n\n\n\nc')).toBe('ab\n\nc');
  });

  it('refuses 0, 6, 4.5, words, missing stars and non-objects', () => {
    for (const body of [{ stars: 0 }, { stars: 6 }, { stars: 4.5 }, { stars: 'great' }, { stars: '10' }, {}, null, 'five', 5]) {
      expect(parseRatingSubmission(body)).toBeNull();
    }
  });

  it('the client box and the server cap agree', () => {
    expect(RATING_COMMENT_MAX).toBe(MAX_RATING_COMMENT_CHARS);
  });
});

describe('the admin summary is arithmetic, not fallbacks', () => {
  it('no ratings is "no average", never 0.0', () => {
    expect(summarizeRatings([0, 0, 0, 0, 0])).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
  });
  it('average and count from per-star counts', () => {
    expect(summarizeRatings([1, 0, 0, 0, 3])).toEqual({ count: 4, average: 4, distribution: [1, 0, 0, 0, 3] });
    expect(summarizeRatings([0, 1, 1, 0, 1]).average).toBe(3.3);
  });
  it('the card refuses a body that is not the overview (an auth error must not become "0 ratings")', () => {
    expect(readRatingsOverview({ error: 'Admin session expired' })).toBeNull();
    expect(readRatingsOverview({ count: 1, average: 5, distribution: [0, 0, 0, 0], recent: [] })).toBeNull();
    const ok = readRatingsOverview({
      count: 2, average: 3, distribution: [1, 0, 0, 0, 1],
      recent: [{ uid: 'u1', email: 'a@b.c', stars: 5, comment: 'nice', platform: 'ios', ratedAt: NOW }, { stars: 9 }, 'junk'],
    });
    expect(ok?.recent).toEqual([{ uid: 'u1', email: 'a@b.c', stars: 5, comment: 'nice', platform: 'ios', ratedAt: NOW }]);
    expect(barPercent(1, [1, 0, 0, 0, 4])).toBe(25);
    expect(barPercent(0, [0, 0, 0, 0, 0])).toBe(0);
  });
});

describe('the moment: only a publish that went live', () => {
  it('ok + a link + not proven dead', () => {
    expect(isRatingMoment({ ok: true, url: 'https://a.nbai.app', linkLive: true })).toBe(true);
    expect(isRatingMoment({ ok: true, url: 'https://a.nbai.app', linkLive: null })).toBe(true);
    expect(isRatingMoment({ ok: true, url: 'https://a.nbai.app', linkLive: false })).toBe(false);
    expect(isRatingMoment({ ok: true, url: '', linkLive: true })).toBe(false);
    expect(isRatingMoment({ ok: false, url: 'https://a.nbai.app', linkLive: true })).toBe(false);
  });

  it('the status body is shape-checked; once per session in this browser', () => {
    expect(readRatingStatus({ ask: true, rated: false })).toEqual({ ask: true, rated: false });
    expect(readRatingStatus({ error: 'x' })).toBeNull();
    expect(readRatingStatus({ ask: 'yes', rated: false })).toBeNull();
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(offeredThisSession(store)).toBe(false);
    markOfferedThisSession(store);
    expect(mem.get(RATING_SESSION_KEY)).toBe('1');
    expect(offeredThisSession(store)).toBe(true);
    expect(offeredThisSession({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });

  it('every star has a word, and a low rating asks what to fix', () => {
    expect([1, 2, 3, 4, 5].map(starLabel)).toEqual(['Poor', 'Not great', 'Okay', 'Good', 'Excellent']);
    expect(commentPrompt(2)).toMatch(/fix/);
    expect(commentPrompt(5)).toMatch(/like/);
  });
});

describe('the wiring (source guards — the publish surfaces are network-backed)', () => {
  it('the Publish sheet asks only when its celebration card closes, and only for a live publish', () => {
    const panel = src('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('rateAfter: isRatingMoment({ ok: true, url: data.url, linkLive })');
    expect(panel).toMatch(/onClose=\{\(\) => \{\s*\/\/[^\n]*\n\s*if \(celebration\.rateAfter\) announceRatingMoment\(\);\s*setCelebration\(null\);/);
    expect(panel.match(/announceRatingMoment\(\)/g)?.length).toBe(1);
  });

  it('Connect my website asks after its own successful publish', () => {
    const p = src('src/components/panels/ConnectMyWebsitePanel.tsx');
    expect(p).toMatch(/Your app is live at[\s\S]{0,400}if \(isRatingMoment\(\{ ok: true, url: data\?\.url, linkLive: null \}\)\) announceRatingMoment\(\);/);
  });

  it('one host at the app root; it opens only when the server says ask, and closing records "Not now"', () => {
    expect(src('src/main.tsx')).toContain('<PlatformRatingHost />');
    const host = src('src/components/PlatformRatingHost.tsx');
    expect(host).toContain("fetch('/api/platform-rating/status'");
    expect(host).toMatch(/if \(status\?\.ask\) \{\s*markOfferedThisSession\(\);\s*setOpen\(true\);/);
    expect(host).toContain("fetch('/api/platform-rating/dismiss'");
    // A rating is thanked only when the server confirmed it.
    expect(host).toMatch(/if \(res\.ok && body\?\.ok === true\) \{\s*setThanked\(true\);/);
  });

  it('the Play store card is NOT chained to our stars (Play forbids asking for an opinion first, and gating)', () => {
    const host = src('src/components/PlatformRatingHost.tsx');
    expect(host).not.toMatch(/InAppReview|requestReview|maybeRequestReview/);
  });

  it('the server registers the routes; writes need a verified sign-in; the summary is admin-only', () => {
    expect(src('server.ts')).toContain('registerPlatformRatingRoutes(app);');
    const r = src('src/server/routes/platformRating.ts');
    expect(r).toContain("app.get('/api/admin/platform-ratings', requireAdmin,");
    expect(r.match(/const me = await verifyFirebaseIdentity\(req\)/g)?.length).toBe(3);
  });

  it('the admin finds them on Users → Ratings', () => {
    expect(src('src/lib/adminTabs.ts')).toContain("{ id: 'ratings', label: 'Ratings' }");
    expect(src('src/components/AdminDashboard.tsx')).toMatch(/activeTab === 'ratings' && \(\s*<div className="space-y-4">\s*<PlatformRatingsCard adminToken=\{adminToken\} \/>/);
  });
});

describe('the routes, end to end over HTTP (no database in tests → every answer is the safe one)', () => {
  let base = '';
  let server: import('node:http').Server;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerPlatformRatingRoutes(app);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('a signed-out visitor is never asked', async () => {
    const r = await fetch(`${base}/api/platform-rating/status`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ask: false, rated: false });
  });

  it('a signed-out visitor cannot rate or dismiss', async () => {
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/platform-rating', { stars: 5 })).status).toBe(401);
    expect((await post('/api/platform-rating/dismiss', {})).status).toBe(401);
  });

  it('the admin summary refuses a request without an admin session', async () => {
    const r = await fetch(`${base}/api/admin/platform-ratings`);
    expect(r.status).toBe(401);
  });
});
