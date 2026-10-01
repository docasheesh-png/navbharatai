// App Mart social — the routes (admin 2026-09-30: "app mart me ek social media banana hai!").
//
// Every rule lives in `lib/appMartSocialRules.ts` and every read/write in `lib/appMartSocialStore.ts`;
// these handlers only check WHO is asking and pass the facts through. The shape of the checks:
//
//   · Reading counts, comments and profiles needs NO sign-in — "sabhi users ko like aur dislike dikhe".
//   · Every write (react, comment, report, block) needs a VERIFIED sign-in, taken from the token and
//     never from the body — "only login user like dislike comment kar sakta hai".
//   · The likers list answers only the app's own creator and an admin. There is no dislikers route.
//   · Nothing here returns an email or an account id. People travel as `PublicPerson`.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity, verifyFirebaseToken, rateLimiter } from '../lib/authMiddleware';
import { routeParam } from '../lib/expressCompat';
import { isStoreAdmin } from './navStore';
import { listMyWebApps, listWebAppsByOwners, getWebAppsByIds, toPublicWebApp, type WebStoreApp } from '../lib/navStoreWeb';
import { listAppsByUid, listAppsByOwners, getAppsByIds, toPublic, type StoreApp } from '../lib/navStoreStore';
import { resolveCreators, realCreatorLookupDeps } from '../lib/storeCreator';
import { userProfileStore } from '../lib/UserProfileStore';
import { adultPreferenceFrom, hiddenFromBrowse } from '../../lib/adultContent';
import { isNativeRequest } from '../lib/cors';
import { publicCreatorId } from '../lib/storeCreator';
import { uidForCreatorId } from '../lib/appMartCreatorIndex';
import {
  parseAppKey, parseAppKeyList, parseReaction, cleanCommentText, publicComments, pageOfComments,
  orderComments, canRemoveComment, removedBy, isCreatorIdShape, ZERO_COUNTS, commentAbuse,
  followRefusal, parseFeedView, newestFirstCapped, FEED_APP_LIMIT, FOLLOW_NOTIFICATION_KEY,
  type PublicComment, type StoredComment,
} from '../lib/appMartSocialRules';
import {
  resolveTarget, resolvePeople, countsFor, myReactions, pressReaction, likersOf, getComment,
  listComments, addComment, removeComment, reportComment, openCommentReports, resolveReportsFor,
  blockedUids, setBlocked, notifySocial, SocialUnavailable, followCounts, isFollowing, setFollow,
  endFollowBothWays, followersOf, followedUids, likedAppKeys,
} from '../lib/appMartSocialStore';

const COMMENTS_PAGE = 30;

function unavailable(res: Response, e: unknown): Response {
  if (e instanceof SocialUnavailable) return res.status(503).json({ error: 'App Mart is busy right now — nothing was saved. Please try again in a moment.' });
  console.warn('[APP_MART_SOCIAL]', e instanceof Error ? e.message : String(e));
  return res.status(502).json({ error: 'That did not save. Please try again.' });
}

async function viewerOf(req: Request): Promise<{ uid: string | null; isAdmin: boolean }> {
  const me = await verifyFirebaseIdentity(req).catch(() => null);
  return { uid: me?.uid ?? null, isAdmin: isStoreAdmin(me?.email ?? null) };
}

/** Comments as a viewer may see them — people resolved, blocked authors dropped. */
async function presentComments(
  rows: StoredComment[], ownerUid: string, viewer: { uid: string | null; isAdmin: boolean },
): Promise<PublicComment[]> {
  const blocked = await blockedUids(viewer.uid);
  const people = await resolvePeople(rows.filter((r) => r.visible).map((r) => r.uid));
  return publicComments(rows, {
    people, creatorIdOf: publicCreatorId, viewerUid: viewer.uid, appOwnerUid: ownerUid,
    isAdmin: viewer.isAdmin, blockedUids: blocked,
  });
}

export function registerAppMartSocialRoutes(app: Express): void {
  const reactLimiter = rateLimiter({ name: 'app-mart-react', authed: 600, anon: 60, noun: 'likes', durable: false });
  const commentLimiter = rateLimiter({ name: 'app-mart-comment', authed: 60, anon: 30, noun: 'comments' });
  const reportLimiter = rateLimiter({ name: 'app-mart-comment-report', authed: 30, anon: 30, noun: 'reports' });

  /** Counts for many apps at once (one Browse page), plus the viewer's own 👍/👎 when signed in. */
  app.post('/api/app-mart/social/batch', async (req: Request, res: Response) => {
    const keys = parseAppKeyList((req.body as { keys?: unknown })?.keys).map((k) => k.key);
    if (keys.length === 0) return res.json({ counts: {}, mine: {} });
    const uid = await verifyFirebaseToken(req).catch(() => null);
    const [counts, mine] = await Promise.all([countsFor(keys), uid ? myReactions(keys, uid) : Promise.resolve({})]);
    res.json({ counts, mine });
  });

  /** Press 👍 or 👎 (pressing the same one again takes it back). */
  app.post('/api/app-mart/social/react', reactLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to like or dislike apps.', needsSignIn: true });
    const body = (req.body ?? {}) as { key?: unknown; reaction?: unknown };
    const k = parseAppKey(body.key);
    const reaction = parseReaction(body.reaction);
    if (!k || !reaction) return res.status(400).json({ error: 'That is not an app on App Mart.' });
    const target = await resolveTarget(k);
    if (!target || !target.live) return res.status(404).json({ error: 'This app is no longer on App Mart.' });
    try {
      const { mine, newLike } = await pressReaction(k.key, me.uid, reaction);
      if (newLike) void notifySocial({ recipientUid: target.ownerUid, kind: 'like', appKey: k.key, appName: target.name, actorUid: me.uid });
      const counts = (await countsFor([k.key]))[k.key] ?? null;
      res.json({ mine, counts });
    } catch (e) {
      unavailable(res, e);
    }
  });

  /** Comments on an app (newest first), or the replies under one comment (oldest first). */
  app.get('/api/app-mart/social/comments', async (req: Request, res: Response) => {
    const k = parseAppKey(req.query.key);
    if (!k) return res.status(400).json({ error: 'That is not an app on App Mart.' });
    const target = await resolveTarget(k);
    if (!target || !target.live) return res.status(404).json({ error: 'This app is no longer on App Mart.' });
    const viewer = await viewerOf(req);
    const parent = typeof req.query.parent === 'string' ? req.query.parent : '';
    const before = Number(req.query.before);
    const all = await listComments(k.key, parent);
    let rows: StoredComment[];
    let hasMore = false;
    if (parent) {
      rows = orderComments(all, true);
    } else {
      const page = pageOfComments(all, Number.isFinite(before) && before > 0 ? before : null, COMMENTS_PAGE);
      rows = page.page;
      hasMore = page.hasMore;
    }
    const comments = await presentComments(rows, target.ownerUid, viewer);
    const counts = (await countsFor([k.key]))[k.key] ?? null;
    res.json({
      comments, hasMore, counts,
      viewer: { signedIn: !!viewer.uid, isOwner: !!viewer.uid && viewer.uid === target.ownerUid, isAdmin: viewer.isAdmin },
    });
  });

  /** Write a comment, or reply to one. */
  app.post('/api/app-mart/social/comments', commentLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to comment.', needsSignIn: true });
    const body = (req.body ?? {}) as { key?: unknown; text?: unknown; parentId?: unknown };
    const k = parseAppKey(body.key);
    if (!k) return res.status(400).json({ error: 'That is not an app on App Mart.' });
    const cleaned = cleanCommentText(body.text);
    if (!cleaned.ok) return res.status(400).json({ error: cleaned.error });
    // Abuse is refused BEFORE anything is stored or anybody is notified (admin 2026-10-01).
    const abuse = commentAbuse(cleaned.text);
    if (abuse) return res.status(400).json({ error: abuse, code: 'abusive' });
    const target = await resolveTarget(k);
    if (!target || !target.live) return res.status(404).json({ error: 'This app is no longer on App Mart.' });

    // A reply to a reply joins the same thread, one level deep.
    let parent: StoredComment | null = null;
    if (typeof body.parentId === 'string' && body.parentId) {
      const p = await getComment(body.parentId);
      const top = p && p.parentId ? await getComment(p.parentId) : p;
      if (!top || top.appKey !== k.key || !top.visible) {
        return res.status(404).json({ error: 'That comment is no longer there, so the reply was not posted.' });
      }
      parent = top;
    }
    try {
      const saved = await addComment({ appKey: k.key, uid: me.uid, text: cleaned.text, parent });
      if (parent) void notifySocial({ recipientUid: parent.uid, kind: 'reply', appKey: k.key, appName: target.name, actorUid: me.uid, text: cleaned.text });
      if (!parent || parent.uid !== target.ownerUid) {
        void notifySocial({ recipientUid: target.ownerUid, kind: 'comment', appKey: k.key, appName: target.name, actorUid: me.uid, text: cleaned.text });
      }
      const [comment] = await presentComments([saved], target.ownerUid, { uid: me.uid, isAdmin: isStoreAdmin(me.email) });
      const counts = (await countsFor([k.key]))[k.key] ?? null;
      res.json({ comment, counts });
    } catch (e) {
      unavailable(res, e);
    }
  });

  /** Take a comment down — its author, the app's creator, or an admin. */
  app.post('/api/app-mart/social/comments/:id/remove', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in.', needsSignIn: true });
    const c = await getComment(String(routeParam(req.params.id) || ''));
    if (!c || !c.visible) return res.json({ ok: true });
    const k = parseAppKey(c.appKey);
    const target = k ? await resolveTarget(k) : null;
    const facts = { viewerUid: me.uid, authorUid: c.uid, appOwnerUid: target?.ownerUid ?? null, isAdmin: isStoreAdmin(me.email) };
    if (!canRemoveComment(facts)) return res.status(403).json({ error: 'Only the person who wrote this, the app’s creator or an admin can remove it.' });
    try {
      await removeComment(c, removedBy(facts));
      const counts = (await countsFor([c.appKey]))[c.appKey] ?? null;
      res.json({ ok: true, counts });
    } catch (e) {
      unavailable(res, e);
    }
  });

  /** Report a comment to the App Mart team. */
  app.post('/api/app-mart/social/comments/:id/report', reportLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to report a comment.', needsSignIn: true });
    const c = await getComment(String(routeParam(req.params.id) || ''));
    if (!c || !c.visible) return res.json({ ok: true });
    if (c.uid === me.uid) return res.status(400).json({ error: 'That is your own comment — you can delete it instead.' });
    try {
      await reportComment(c, me.uid, String((req.body as { reason?: unknown })?.reason ?? ''));
      res.json({ ok: true, message: 'Thanks — the App Mart team will look at this comment.' });
    } catch (e) {
      unavailable(res, e);
    }
  });

  /** Admin: reported comments waiting for a decision. */
  app.get('/api/app-mart/social/admin/reports', async (req: Request, res: Response) => {
    const viewer = await viewerOf(req);
    if (!viewer.isAdmin) return res.status(403).json({ error: 'Not allowed.' });
    const reports = await openCommentReports();
    const people = await resolvePeople(reports.map((r) => r.authorUid));
    const names = new Map<string, string>();
    await Promise.all([...new Set(reports.map((r) => r.appKey))].map(async (key) => {
      const k = parseAppKey(key);
      const t = k ? await resolveTarget(k) : null;
      names.set(key, t?.name ?? 'An app no longer on App Mart');
    }));
    res.json({
      reports: reports.map((r) => ({
        id: r.id, commentId: r.commentId, appKey: r.appKey, appName: names.get(r.appKey) ?? '',
        reason: r.reason, text: r.textSnapshot, at: r.at,
        author: people.get(r.authorUid) ?? { name: 'NavBharatAI user', photoUrl: '', creatorId: publicCreatorId(r.authorUid) },
      })),
    });
  });

  /** Admin: the reported comment is fine — close its reports without removing it. */
  app.post('/api/app-mart/social/comments/:id/keep', async (req: Request, res: Response) => {
    const viewer = await viewerOf(req);
    if (!viewer.isAdmin) return res.status(403).json({ error: 'Not allowed.' });
    await resolveReportsFor(String(routeParam(req.params.id) || ''), 'kept').catch(() => undefined);
    res.json({ ok: true });
  });

  /**
   * Who liked this app — for its CREATOR (and an admin) only. The dislike number comes back with it,
   * but never a name: "dislike kisne kiya hai yeh na dikhe bas number dikhe".
   */
  app.get('/api/app-mart/social/likers', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in.', needsSignIn: true });
    const k = parseAppKey(req.query.key);
    const target = k ? await resolveTarget(k) : null;
    if (!k || !target) return res.status(404).json({ error: 'This app is no longer on App Mart.' });
    if (target.ownerUid !== me.uid && !isStoreAdmin(me.email)) {
      return res.status(403).json({ error: 'Only the app’s creator can see who liked it.' });
    }
    const [likers, counts] = await Promise.all([likersOf(k.key), countsFor([k.key])]);
    res.json({ likers, counts: counts[k.key] ?? null });
  });

  /** Stop (or start) seeing someone's comments. */
  app.post('/api/app-mart/social/block', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in.', needsSignIn: true });
    const body = (req.body ?? {}) as { creatorId?: unknown; blocked?: unknown };
    if (!isCreatorIdShape(body.creatorId)) return res.status(400).json({ error: 'That person could not be found.' });
    const targetUid = await uidForCreatorId(body.creatorId);
    if (!targetUid) return res.status(404).json({ error: 'That person could not be found.' });
    if (targetUid === me.uid) return res.status(400).json({ error: 'You cannot block yourself.' });
    try {
      await setBlocked(me.uid, targetUid, body.blocked !== false);
      // Blocking someone ends any follow between the two, both ways — the way every social app behaves.
      if (body.blocked !== false) await endFollowBothWays(me.uid, targetUid);
      res.json({ ok: true, blocked: body.blocked !== false });
    } catch (e) {
      unavailable(res, e);
    }
  });

  /** The people this viewer has blocked — so they can be unblocked. */
  app.get('/api/app-mart/social/blocked', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in.', needsSignIn: true });
    const people = await resolvePeople([...(await blockedUids(me.uid))]);
    res.json({ people: [...people.values()] });
  });

  /**
   * A person's App Mart profile: name, photo, and the apps they have on the store. Opened by the public
   * creator code, or `me`. No email, no account id, no unlisted or removed app.
   */
  app.get('/api/app-mart/profile/:creatorId', async (req: Request, res: Response) => {
    const raw = String(routeParam(req.params.creatorId) || '');
    const viewerUid = await verifyFirebaseToken(req).catch(() => null);
    let uid: string | null = null;
    if (raw === 'me') {
      if (!viewerUid) return res.status(401).json({ error: 'Please sign in.', needsSignIn: true });
      uid = viewerUid;
    } else if (isCreatorIdShape(raw)) {
      uid = await uidForCreatorId(raw);
    }
    if (!uid) return res.status(404).json({ error: 'This profile could not be found.' });

    try {
      const [people, web, apk, viewerPref, blocked, follows, followingThem] = await Promise.all([
        resolvePeople([uid]),
        listMyWebApps(uid, 50).catch(() => []),
        listAppsByUid(uid, 50).catch(() => []),
        viewerUid
          ? userProfileStore.get(viewerUid).then((p) => adultPreferenceFrom({ optedIn: p?.adultOptIn, optedInAt: p?.adultOptInAt })).catch(() => adultPreferenceFrom(null))
          : Promise.resolve(adultPreferenceFrom(null)),
        blockedUids(viewerUid),
        followCounts(uid),
        isFollowing(viewerUid, uid),
      ]);
      const isNative = isNativeRequest(req);
      const apps = [
        ...web
          .filter((a) => a.status === 'listed')
          .filter((a) => !hiddenFromBrowse({ contentClass: a.contentClass }, { optedIn: viewerPref.optedIn, isNative }))
          .map((a) => ({
            key: `web:${a.id}`, kind: 'web' as const, id: a.id, name: a.name, description: a.description,
            iconDataUrl: a.iconDataUrl, publishedAt: a.publishedAt, runs: a.runs ?? 0, requiresPassword: a.visibility === 'private',
          })),
        ...apk
          .filter((a) => a.status === 'approved')
          .map((a) => ({
            key: `apk:${a.id}`, kind: 'apk' as const, id: a.id, name: a.appName, description: a.shortDescription,
            iconDataUrl: a.iconDataUrl, publishedAt: a.reviewedAt || a.submittedAt, runs: a.downloads ?? 0, requiresPassword: false,
          })),
      ].sort((x, y) => (y.publishedAt || 0) - (x.publishedAt || 0));
      const counts = await countsFor(apps.map((a) => a.key));
      const totalLikes = apps.reduce((n, a) => n + (counts[a.key]?.likes ?? 0), 0);
      const person = people.get(uid) ?? { name: 'NavBharatAI user', photoUrl: '', creatorId: publicCreatorId(uid) };
      res.json({
        person,
        isMe: viewerUid === uid,
        blockedByMe: blocked.has(uid),
        apps: apps.map((a) => ({ ...a, counts: counts[a.key] ?? ZERO_COUNTS })),
        totals: { apps: apps.length, likes: totalLikes },
        // The NUMBER of followers is public; who they are is the creator's alone (see /followers).
        follow: { followers: follows?.followers ?? null, following: follows?.following ?? null, isFollowing: followingThem },
      });
    } catch (e) {
      console.warn('[APP_MART_SOCIAL] profile', e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: 'This profile could not be loaded. Please try again.' });
    }
  });

  // ─── Following (admin 2026-10-01) ──────────────────────────────────────────────────────────────

  const followLimiter = rateLimiter({ name: 'app-mart-follow', authed: 300, anon: 30, noun: 'follows', durable: false });

  /** Follow (or unfollow) a creator, by their public creator code. */
  app.post('/api/app-mart/social/follow', followLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to follow creators.', needsSignIn: true });
    const body = (req.body ?? {}) as { creatorId?: unknown; follow?: unknown };
    if (!isCreatorIdShape(body.creatorId)) return res.status(400).json({ error: 'That person could not be found.' });
    const creatorUid = await uidForCreatorId(body.creatorId);
    if (!creatorUid) return res.status(404).json({ error: 'That person could not be found.' });
    const follow = body.follow !== false;
    try {
      if (follow) {
        const [mine, theirs, already, counts] = await Promise.all([
          blockedUids(me.uid), blockedUids(creatorUid), isFollowing(me.uid, creatorUid), followCounts(me.uid),
        ]);
        if (mine.has(creatorUid)) return res.status(400).json({ error: 'You blocked this person. Unblock them first to follow.' });
        // Somebody who blocked you is not told you tried, and is not followed: the same generic answer
        // as a missing profile, so a block cannot be probed for.
        if (theirs.has(me.uid)) return res.status(404).json({ error: 'That person could not be found.' });
        const refusal = followRefusal({ followerUid: me.uid, creatorUid, followingNow: counts?.following ?? 0, alreadyFollowing: already });
        if (refusal) return res.status(400).json({ error: refusal });
      }
      const r = await setFollow(me.uid, creatorUid, follow);
      if (r.newFollow) {
        void notifySocial({ recipientUid: creatorUid, kind: 'follow', appKey: FOLLOW_NOTIFICATION_KEY, appName: '', actorUid: me.uid });
      }
      const counts = await followCounts(creatorUid);
      res.json({ following: r.following, followers: counts?.followers ?? null });
    } catch (e) {
      unavailable(res, e);
    }
  });

  /**
   * Who follows the viewer — for the creator's own eyes only (and an admin, who may name a creator).
   * Like likes and unlike dislikes: the NUMBER is public on every profile, the PEOPLE are not.
   */
  app.get('/api/app-mart/social/followers', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in.', needsSignIn: true });
    let uid = me.uid;
    const asked = req.query.creatorId;
    if (typeof asked === 'string' && asked && asked !== 'me') {
      const other = isCreatorIdShape(asked) ? await uidForCreatorId(asked) : null;
      if (!other) return res.status(404).json({ error: 'That person could not be found.' });
      if (other !== me.uid && !isStoreAdmin(me.email)) return res.status(403).json({ error: 'Only a creator can see who follows them.' });
      uid = other;
    }
    const [followers, counts] = await Promise.all([followersOf(uid), followCounts(uid)]);
    res.json({ followers, counts });
  });

  /**
   * The two personal Browse views (admin 2026-10-01): apps by creators you FOLLOW, newest first, and
   * apps you LIKED, most recently liked first. Both are private to the viewer and need a sign-in.
   * The apps come back in exactly the shapes the General view's lists use, filtered by the same rules
   * (listed / approved only, 18+ hidden unless the viewer opted in, never on the native shell).
   */
  app.get('/api/app-mart/feed', async (req: Request, res: Response) => {
    const view = parseFeedView(req.query.view);
    if (!view) return res.status(400).json({ error: 'Unknown view.' });
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) {
      return res.status(401).json({ error: view === 'following' ? 'Sign in to see apps from creators you follow.' : 'Sign in to see the apps you liked.', needsSignIn: true });
    }
    try {
      const viewerPref = await userProfileStore.get(me.uid)
        .then((p) => adultPreferenceFrom({ optedIn: p?.adultOptIn, optedInAt: p?.adultOptInAt }))
        .catch(() => adultPreferenceFrom(null));
      const isNative = isNativeRequest(req);
      const showWeb = (a: WebStoreApp) => a.status === 'listed'
        && !hiddenFromBrowse({ contentClass: a.contentClass }, { optedIn: viewerPref.optedIn, isNative });

      let webRows: Array<{ app: WebStoreApp; at: number }> = [];
      let apkRows: Array<{ app: StoreApp; at: number }> = [];
      let followingCount: number | null = null;

      if (view === 'following') {
        const creators = await followedUids(me.uid);
        followingCount = creators.length;
        const [web, apk] = await Promise.all([
          listWebAppsByOwners(creators).catch(() => []),
          listAppsByOwners(creators).catch(() => []),
        ]);
        webRows = web.map((a) => ({ app: a, at: a.publishedAt || 0 }));
        apkRows = apk.map((a) => ({ app: a, at: a.reviewedAt || a.submittedAt || 0 }));
      } else {
        const liked = await likedAppKeys(me.uid);
        const when = new Map(liked.map((l) => [l.key, l.at]));
        const webIds = liked.filter((l) => l.key.startsWith('web:')).map((l) => l.key.slice(4));
        const apkIds = liked.filter((l) => l.key.startsWith('apk:')).map((l) => l.key.slice(4));
        const [web, apk] = await Promise.all([getWebAppsByIds(webIds).catch(() => []), getAppsByIds(apkIds).catch(() => [])]);
        webRows = web.map((a) => ({ app: a, at: when.get(`web:${a.id}`) ?? 0 }));
        apkRows = apk.map((a) => ({ app: a, at: when.get(`apk:${a.id}`) ?? 0 }));
      }

      const webShown = newestFirstCapped(webRows.filter((r) => showWeb(r.app)), FEED_APP_LIMIT);
      const apkShown = newestFirstCapped(apkRows.filter((r) => r.app.status === 'approved'), FEED_APP_LIMIT);
      const creatorInfo = await resolveCreators(webShown.map((r) => r.app.uid), realCreatorLookupDeps).catch(() => new Map());
      res.json({
        view,
        webApps: webShown.map((r) => toPublicWebApp(r.app, creatorInfo.get(r.app.uid))),
        apps: apkShown.map((r) => toPublic(r.app)),
        ...(followingCount !== null ? { followingCount } : {}),
      });
    } catch (e) {
      console.warn('[APP_MART_SOCIAL] feed', e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: 'These apps could not be loaded. Please try again.' });
    }
  });
}
