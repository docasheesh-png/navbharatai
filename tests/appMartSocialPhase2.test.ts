// App Mart social, phase 2 (admin 2026-10-01): "teeno kaam karo — push tap se app ka page, comments me
// gaali-filter, creator ko follow … browser me 3 button: general, follower, likes app … sabhi page me
// upar play instantly aur apk filter".
//
// Rules are tested directly; the promises that live in routes and screens are tested against the
// SOURCE, the way tests/appMartSocial.test.ts does — removing one line must fail here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppMartTarget, isAppMartTarget, pushTapAction, FOLLOWERS_TARGET } from '../src/lib/appMartTarget';
import {
  commentAbuse, COMMENT_ABUSE_MESSAGE, followDocId, followRefusal, MAX_FOLLOWING, repeatIsNews, foldActor,
  socialNotificationMessage, socialNotificationTarget, FOLLOW_NOTIFICATION_KEY, parseFeedView, newestFirstCapped,
  chunk, socialNotificationDocId,
} from '../src/server/lib/appMartSocialRules';
import { scanPollinationsPrompt } from '../src/server/lib/pollinationsGuard';
import { kindFilterOptions, shelvesFor, emptyViewMessage, viewNeedsSignIn, BROWSE_VIEWS } from '../src/components/ide/appMart/browseViews';
import { USER_SCOPED_COLLECTIONS } from '../src/server/lib/DataRetentionManager';
import { toPublic, type StoreApp } from '../src/server/lib/navStoreStore';
import { publicCreatorId } from '../src/server/lib/storeCreator';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const routes = code(read('src/server/routes/appMartSocial.ts'));
const store = code(read('src/server/lib/appMartSocialStore.ts'));
const ui = code(read('src/components/ide/appMart/AppMartSocial.tsx'));
const mart = code(read('src/components/ide/NavAppStore.tsx'));

/** The body of one route handler, from its registration to the next registration. */
function handler(start: string): string {
  const i = routes.indexOf(start);
  expect(i, start).toBeGreaterThan(-1);
  const next = routes.indexOf('\n  app.', i + start.length);
  return routes.slice(i, next === -1 ? undefined : next);
}

describe('1 · where a notification leads — one grammar for the bell, a phone push and App Mart', () => {
  it('reads an app, a profile and your followers, and nothing else', () => {
    expect(parseAppMartTarget('web:abcd1234')).toEqual({ type: 'app', kind: 'web', id: 'abcd1234', key: 'web:abcd1234' });
    expect(parseAppMartTarget('apk:Zz_9-xy1')?.type).toBe('app');
    expect(parseAppMartTarget('profile:me')).toEqual({ type: 'profile', creatorId: 'me' });
    expect(parseAppMartTarget('profile:abc0123xyz')).toEqual({ type: 'profile', creatorId: 'abc0123xyz' });
    expect(parseAppMartTarget(FOLLOWERS_TARGET)).toEqual({ type: 'followers' });
    for (const bad of ['', 'https://evil.example', 'javascript:alert(1)', 'web:ab', 'profile:ABC', 'profile:short', 'followers:other', 'ios:abcd1234', 42, null]) {
      expect(isAppMartTarget(bad), String(bad)).toBe(false);
    }
  });

  it('a tapped App Mart push opens that app — new pushes (target) and the first ones (appKey) alike', () => {
    expect(pushTapAction({ type: 'app-mart', target: 'web:abcd1234' }, 'https://play')).toEqual({ kind: 'open-app-mart', target: 'web:abcd1234' });
    expect(pushTapAction({ type: 'app-mart', appKey: 'apk:abcd1234' }, 'https://play')).toEqual({ kind: 'open-app-mart', target: 'apk:abcd1234' });
    expect(pushTapAction({ type: 'app-mart', target: 'javascript:x' }, 'https://play')).toBeNull();
    expect(pushTapAction({ action: 'open_store' }, 'https://play')).toEqual({ kind: 'open-url', url: 'https://play' });
    expect(pushTapAction({ action: 'open_store', storeUrl: 'https://x.example/app' }, 'https://play')).toEqual({ kind: 'open-url', url: 'https://x.example/app' });
    expect(pushTapAction({}, 'https://play')).toBeNull();
    expect(pushTapAction(undefined, 'https://play')).toBeNull();
  });

  it('the push handler follows the decision through the same event the bell uses', () => {
    const push = code(read('src/lib/pushNotifications.ts'));
    expect(push).toContain('pushTapAction(data, PLAY_STORE_URL)');
    expect(push).toContain("detail: { view: 'appstore', storeSocialKey: action.target }");
    const bell = code(read('src/components/NotificationBell.tsx'));
    expect(bell).toContain('isAppMartTarget(n.target)');
    expect(bell).not.toMatch(/\^\(web\|apk\)/);
  });

  it('every target the server writes is one the client will follow', () => {
    expect(isAppMartTarget(socialNotificationTarget({ kind: 'follow', appKey: FOLLOW_NOTIFICATION_KEY }))).toBe(true);
    for (const kind of ['like', 'comment', 'reply', 'new-app'] as const) {
      expect(isAppMartTarget(socialNotificationTarget({ kind, appKey: 'web:abcd1234' })), kind).toBe(true);
    }
    expect(store).toContain('target: socialNotificationTarget(d)');
    expect(store).toContain("data: { type: 'app-mart', appKey: input.appKey, target: input.appKey }");
  });

  it('App Mart opens an app, a profile or your followers list from a target', () => {
    expect(mart).toContain('parseAppMartTarget(socialTarget?.key)');
    expect(mart).toContain("setProfileId(target.creatorId)");
    expect(mart).toContain('setFollowersOpen(true)');
  });
});

describe('2 · the comment word filter', () => {
  it('refuses abuse, including the disguises people type', () => {
    for (const bad of [
      'madarchod app', 'Bhenchod!!', 'bkl kya bakwas hai', 'chutiya app', 'ch*tiya', 'm c b c', 'mc bc',
      'f u c k this', 'what the fuck', 'this is shit', 'भोसड़ी के', 'मादरचोद', 'bsdk', 'randi',
    ]) {
      expect(commentAbuse(bad), bad).toBe(COMMENT_ABUSE_MESSAGE);
    }
  });

  it('lets ordinary comments through — including "bc" for because, and an app that names a sensitive topic', () => {
    for (const ok of [
      'Great app, bc it saves me time',
      'mc donalds menu app is nice',
      'A sex-education app for schools — very useful',
      'Shiitake recipe section is great',
      'Bahut badhiya app hai, dhanyavaad!',
      'Scunthorpe bus timings are correct',
      'बहुत अच्छा ऐप है',
    ]) {
      expect(commentAbuse(ok), ok).toBeNull();
    }
  });

  it('is ONE list: a word refused in a comment is refused by the image generator too', () => {
    for (const w of ['bkl', 'chutiya', 'madarchod']) expect(scanPollinationsPrompt(w).ok, w).toBe(false);
    const rules = read('src/server/lib/appMartSocialRules.ts');
    expect(rules).toContain("import { scanProfanity } from './pollinationsGuard';");
  });

  it('is checked BEFORE the comment is stored or anybody is notified', () => {
    const h = handler("app.post('/api/app-mart/social/comments',");
    const check = h.indexOf('commentAbuse(cleaned.text)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(h.indexOf('addComment('));
    expect(check).toBeLessThan(h.indexOf('notifySocial('));
    expect(h).toContain("code: 'abusive'");
  });
});

describe('3 · following', () => {
  it('one follow per pair, and nobody follows themselves or past the cap', () => {
    expect(followDocId('a', 'b')).toBe('a__b');
    expect(followDocId('a', 'b')).not.toBe(followDocId('b', 'a'));
    expect(followRefusal({ followerUid: 'u', creatorUid: 'u', followingNow: 0, alreadyFollowing: false })).toMatch(/yourself/);
    expect(followRefusal({ followerUid: 'u', creatorUid: 'c', followingNow: MAX_FOLLOWING, alreadyFollowing: false })).toMatch(/Unfollow someone first/);
    expect(followRefusal({ followerUid: 'u', creatorUid: 'c', followingNow: MAX_FOLLOWING, alreadyFollowing: true })).toBeNull();
    expect(followRefusal({ followerUid: 'u', creatorUid: 'c', followingNow: 3, alreadyFollowing: false })).toBeNull();
  });

  it('follow, unfollow, follow again rings the creator once; a new comment is always news', () => {
    expect(repeatIsNews('follow')).toBe(false);
    expect(repeatIsNews('new-app')).toBe(false);
    expect(repeatIsNews('like')).toBe(false);
    expect(repeatIsNews('comment')).toBe(true);
    const input = { recipientUid: 'c', kind: 'follow' as const, appKey: FOLLOW_NOTIFICATION_KEY, appName: '', day: '2026-10-01', actorUid: 'f', actorName: 'Asha', now: 1 };
    const first = foldActor(null, input);
    expect(first.changed).toBe(true);
    expect(foldActor(first.doc, { ...input, now: 2 }).changed).toBe(false);
  });

  it('says it in plain words, and never names an account id', () => {
    const msg = socialNotificationMessage({ kind: 'follow', appName: '', actorNames: ['Asha', 'Ravi'], count: 4, latestText: '' });
    expect(msg).toBe('👤 Asha and 3 others started following you on App Mart.');
    expect(socialNotificationMessage({ kind: 'new-app', appName: 'Kirana', actorNames: ['Asha'], count: 1, latestText: '' }))
      .toBe('🆕 Asha published a new app "Kirana" on App Mart.');
    expect(socialNotificationDocId('c-uid-1234', 'follow', FOLLOW_NOTIFICATION_KEY, '2026-10-01')).not.toContain('c-uid-1234');
  });

  it('following needs a verified sign-in, is refused across a block both ways, and blocking ends it', () => {
    const h = handler("app.post('/api/app-mart/social/follow'");
    expect(h).toContain('verifyFirebaseIdentity(req)');
    expect(h).toMatch(/if \(!me\?\.uid\) return res\.status\(401\)/);
    expect(h).toContain('mine.has(creatorUid)');
    expect(h).toContain('theirs.has(me.uid)');
    expect(h).toContain('followRefusal(');
    expect(h).toContain("kind: 'follow'");
    expect(handler("app.post('/api/app-mart/social/block'")).toContain('endFollowBothWays(me.uid, targetUid)');
  });

  it('the follower NUMBER is public; WHO follows is the creator’s alone', () => {
    const list = handler("app.get('/api/app-mart/social/followers'");
    expect(list).toMatch(/if \(!me\?\.uid\) return res\.status\(401\)/);
    expect(list).toContain('other !== me.uid && !isStoreAdmin(identityGrantEmail(me))');
    expect(list).toContain('status(403)');
    const state = handler("app.get('/api/app-mart/social/follow-state'");
    expect(state).not.toContain('followersOf(');
    const profile = handler("app.get('/api/app-mart/profile/:creatorId'");
    expect(profile).toContain('followCounts(uid)');
    expect(profile).not.toContain('followersOf(');
    expect(ui).toContain('Only you can see this list.');
  });

  it('a new app reaches its creator’s followers — on BOTH approval paths, bounded, never twice a day', () => {
    const nav = code(read('src/server/routes/navStore.ts'));
    expect(nav).toContain("notifyFollowersOfNewApp({ creatorUid: found.uid, appKey: `apk:${found.id}`, appName: found.appName })");
    expect(nav).toContain("notifyFollowersOfNewApp({ creatorUid: found.uid, appKey: `web:${found.id}`, appName: found.name })");
    expect(store).toContain('.limit(MAX_NEW_APP_FANOUT)');
    expect(store).toContain('writer.create(ref, doc)');
  });

  it('a deleted account leaves no follow behind, from either end', () => {
    const follows = USER_SCOPED_COLLECTIONS.filter((c) => c.collection === 'app_mart_follows').map((c) => (typeof c.key === 'object' ? c.key.field : c.key));
    expect(follows.sort()).toEqual(['creatorUid', 'followerUid']);
  });

  it('an Android app carries its creator’s public code, never the account id', () => {
    const app = { id: 'apk1', uid: 'secret-uid-1', appName: 'X', packageName: 'p', versionName: '1', shortDescription: '', description: '', category: 'Tools',
      sizeBytes: 1, permissions: [], highRisk: [], downloads: 0, sha256: 's', developer: { name: 'Dev', email: 'dev@example.com' }, submittedAt: 1 } as unknown as StoreApp;
    const pub = toPublic(app) as unknown as Record<string, unknown>;
    expect(pub.creatorId).toBe(publicCreatorId('secret-uid-1'));
    expect(JSON.stringify(pub)).not.toContain('secret-uid-1');
    expect(JSON.stringify(pub)).not.toContain('dev@example.com');
  });
});

describe('4 · the Browse views and the kind filter', () => {
  it('three views, and the personal two need a sign-in', () => {
    expect(BROWSE_VIEWS.map((v) => v.label)).toEqual(['General', 'Following', 'Liked apps']);
    expect(viewNeedsSignIn('general')).toBe(false);
    expect(viewNeedsSignIn('following')).toBe(true);
    expect(viewNeedsSignIn('liked')).toBe(true);
  });

  it('All · Play instantly · APK — and on an iPhone no row at all, and never an Android shelf', () => {
    expect(kindFilterOptions(false).map((f) => f.label)).toEqual(['All', 'Play instantly', 'APK']);
    expect(kindFilterOptions(true)).toEqual([]);
    expect(shelvesFor('all', false)).toEqual({ web: true, apk: true });
    expect(shelvesFor('web', false)).toEqual({ web: true, apk: false });
    expect(shelvesFor('apk', false)).toEqual({ web: false, apk: true });
    for (const f of ['all', 'web', 'apk'] as const) expect(shelvesFor(f, true)).toEqual({ web: true, apk: false });
  });

  it('an empty view says why it is empty', () => {
    expect(emptyViewMessage({ view: 'following', filter: 'all', signedIn: false, followingCount: null }).title).toMatch(/Sign in/);
    expect(emptyViewMessage({ view: 'following', filter: 'all', signedIn: true, followingCount: 0 }).title).toBe('You do not follow anyone yet.');
    expect(emptyViewMessage({ view: 'following', filter: 'apk', signedIn: true, followingCount: 4 }).title).toBe('The creators you follow have no Android apps yet.');
    expect(emptyViewMessage({ view: 'liked', filter: 'all', signedIn: true, followingCount: null }).title).toBe('You have not liked any apps yet.');
    expect(emptyViewMessage({ view: 'liked', filter: 'web', signedIn: true, followingCount: null }).title).toBe('You have not liked any instant apps yet.');
    expect(emptyViewMessage({ view: 'liked', filter: 'all', signedIn: true, followingCount: null }).hint).toMatch(/Only you can see this list/);
  });

  it('the feed is private, needs a sign-in, and applies the General view’s own filters', () => {
    const feed = handler("app.get('/api/app-mart/feed'");
    expect(feed).toMatch(/if \(!me\?\.uid\) \{\s*return res\.status\(401\)/);
    expect(feed).toContain("a.status === 'listed'");
    expect(feed).toContain('hiddenFromBrowse(');
    expect(feed).toContain("r.app.status === 'approved'");
    expect(feed).toContain('toPublicWebApp(');
    expect(feed).toContain('toPublic(r.app)');
    expect(parseFeedView('following')).toBe('following');
    expect(parseFeedView('liked')).toBe('liked');
    expect(parseFeedView('general')).toBeNull();
  });

  it('newest first, capped; and owners are read 30 at a time (Firestore’s `in` limit)', () => {
    expect(newestFirstCapped([{ at: 1 }, { at: 3 }, { at: 2 }], 2)).toEqual([{ at: 3 }, { at: 2 }]);
    expect(chunk(Array.from({ length: 65 }, (_, i) => i)).map((c) => c.length)).toEqual([30, 30, 5]);
    for (const f of ['src/server/lib/navStoreWeb.ts', 'src/server/lib/navStoreStore.ts']) {
      expect(read(f), f).toMatch(/where\('uid', 'in', owners\.slice\(i, i \+ 30\)\)/);
    }
  });

  it('the screen draws the views and the filter, and an Android shelf never appears on an iPhone', () => {
    expect(mart).toContain('BROWSE_VIEWS.map((v)');
    expect(mart).toContain('kindFilterOptions(HIDE_ANDROID_INSTALLS)');
    expect(mart).toContain('!HIDE_ANDROID_INSTALLS && shelves.apk && anyInView');
    expect(mart).toContain('visibleAndroidApps(feed.apps, STORE_PLATFORM)');
    expect(mart).toContain('fetchFeed<WebApp, PublicApp>(view)');
  });

  it('a Follow button sits beside the creator on both app pages, and on the profile', () => {
    expect(mart).toContain('<FollowButton key={detailApp.creatorId} creatorId={detailApp.creatorId} compact />');
    expect(mart).toContain('<FollowButton key={openApp.creatorId} creatorId={openApp.creatorId} compact />');
    expect(ui).toContain('<FollowButton');
    expect(mart).toContain('<FollowersSheet');
  });
});
