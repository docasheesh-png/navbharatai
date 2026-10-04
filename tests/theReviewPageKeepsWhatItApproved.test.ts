// APP MART ADMIN (admin 2026-10-04): "admin jab kisi user ki app ko app mart me approve karta hai to
// 'review' page pura khali ho jata hai" — and "admin kabhi bhi kisi bhi app ko app mart se hata sake,
// button sabhi apps ke info me".
//
// Root cause: the web (instant-app) review list asked only for apps WAITING for a listing, so the app an
// admin had just listed left the only screen that showed it. With no other request waiting the page read
// "No apps waiting for review" — empty. The APK lane was fixed for exactly this on 2026-08-21
// (mergeReviewQueue); the web lane was the sibling nobody hunted. Both lanes now share one rule.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeReviewQueue, pendingReviewCount, reviewStatusLabel, reviewActionsFor, isLiveOnStore } from '../src/components/ide/storeReviewQueue';

const ROUTE = readFileSync('src/server/routes/navStore.ts', 'utf8');
const UI = readFileSync('src/components/ide/NavAppStore.tsx', 'utf8');

describe('one rule for both lanes: an app on the store stays on the review page', () => {
  it('a listed web app is live, labelled, and offers only removal', () => {
    expect(isLiveOnStore('listed')).toBe(true);
    expect(isLiveOnStore('approved')).toBe(true);
    expect(isLiveOnStore('unlisted')).toBe(false);
    expect(isLiveOnStore(undefined)).toBe(false);
    expect(reviewStatusLabel('listed')).toBe('On the store');
    expect(reviewActionsFor('listed')).toBe('remove');
    expect(reviewActionsFor('unlisted')).toBe('decide');
  });
  it('after listing, the request list is empty but the page is not', () => {
    const merged = mergeReviewQueue([], [{ id: 'w1', status: 'listed' }]);
    expect(merged).toHaveLength(1);
    expect(pendingReviewCount(merged)).toBe(0); // the badge does not count work already done
  });
});

describe('the server answers both questions', () => {
  it('the web admin queue returns the listed apps when asked', () => {
    const start = ROUTE.indexOf("app.get('/api/nav-store/web/admin/queue'");
    const h = ROUTE.slice(start, ROUTE.indexOf("app.post('/api/nav-store/web/admin/review'", start));
    expect(h).toContain("isStoreAdmin(");
    expect(h).toMatch(/req\.query\.status[\s\S]{0,80}=== 'listed'/);
    expect(h).toContain('listListedWebApps(');
    expect(h).toContain('listUnlistedWebApps(');
  });
});

describe('the review page asks for both and keeps what it approved', () => {
  it('loads listing requests AND listed apps, merged with the shared rule', () => {
    expect(UI).toContain("fetch('/api/nav-store/web/admin/queue?status=listed'");
    expect(UI).toMatch(/setWebQueue\(mergeReviewQueue<WebApp>\(/);
  });
  it('a listed app is not offered "List on the store" again', () => {
    expect(UI).toMatch(/reviewActionsFor\(a\.status\) === 'decide' && \(\s*<button\s*onClick=\{\(\) => void decideWeb\(a\.id, 'listed'\)\}/);
  });
});

describe('an admin can remove ANY app from its own page', () => {
  it('both info sheets carry the admin remove button, behind the server-reported admin flag', () => {
    expect(UI.match(/\{status\?\.isAdmin && \(\s*<AdminStoreRemove/g)?.length).toBe(2);
    expect(UI).toContain("adminRemoveFromStore('web', detailApp.id, detailApp.name)");
    expect(UI).toContain("adminRemoveFromStore('apk', openApp.id, openApp.appName)");
  });
  it('every removal is confirmed first — no bare remove call is left', () => {
    expect(UI).toMatch(/const adminRemoveFromStore = useCallback\(async[\s\S]{0,200}window\.confirm\(/);
    expect(UI).not.toMatch(/void decide\([^)]*'removed'\)/);
    expect(UI).not.toMatch(/void decideWeb\([^)]*'removed'\)/);
  });
  it('a refused or failed decision is shown, never silent', () => {
    for (const name of ['decideWeb', 'decide']) {
      const start = UI.indexOf(`const ${name} = useCallback(`);
      const body = UI.slice(start, start + 1500);
      expect(body, name).toContain('if (!res.ok)');
      expect(body, name).toContain('setReviewError(');
    }
    expect(UI).toMatch(/reviewError && \(\s*<p role="alert"/);
  });
});
