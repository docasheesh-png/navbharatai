// App Mart social (admin 2026-09-30): "app mart me ek social media banana hai! … like, dislike,
// comment … only login user … creator ke pas notifications jaye … creator dekh sake kisne like kiya
// hai (dislike kisne kiya hai yeh na dikhe bas number dikhe) … comment wale user ke naam par click kare
// to profile … user ki email nahi dikhani hai!!"
//
// The RULES are tested directly; the promises that live in the routes (sign-in on every write, no
// dislikers list, no email in a response) are tested against the ROUTE SOURCE, the way the other access
// tests in this repo do — they are broken by adding or removing a line, which exercising today's
// behaviour would not catch.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseAppKey, parseAppKeyList, MAX_BATCH_KEYS, parseReaction, nextReaction, reactionDocId,
  cleanCommentText, MAX_COMMENT_CHARS, canRemoveComment, removedBy, removedLabel, publicComments,
  pageOfComments, orderComments, safePhotoUrl, isCreatorIdShape, socialNotificationDocId, socialInboxId,
  parseSocialInboxId, isSocialInboxId, foldActor, socialNotificationMessage, socialPushBody, inboxState,
  applyBlock, MAX_BLOCKED, MAX_REMEMBERED_ACTORS, type StoredComment, type PublicPerson,
} from '../src/server/lib/appMartSocialRules';
import { creatorDisplayName, publicCreatorId } from '../src/server/lib/storeCreator';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Source with comments removed — a file's own explanation quotes what it refuses to do. */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const routes = code(read('src/server/routes/appMartSocial.ts'));
const store = code(read('src/server/lib/appMartSocialStore.ts'));

function comment(over: Partial<StoredComment> = {}): StoredComment {
  return { id: 'c1', appKey: 'web:app0001', uid: 'u-author', text: 'Nice app', parentId: '', createdAt: 1000, visible: true, replyCount: 0, ...over };
}
const person = (name: string): PublicPerson => ({ name, photoUrl: '', creatorId: 'abcdefghij' });

describe('which app a social action is about', () => {
  it('reads web and apk keys and refuses anything else', () => {
    expect(parseAppKey('web:abc_DEF-123')).toEqual({ kind: 'web', id: 'abc_DEF-123', key: 'web:abc_DEF-123' });
    expect(parseAppKey('apk:0123abcd')?.kind).toBe('apk');
    for (const bad of ['', 'web:', 'ios:abcd1234', 'web:ab', 'web:../x', 'web:a/b/c/d', 'web:a b cdef', 42, null, 'web:x'.padEnd(90, 'y')]) {
      expect(parseAppKey(bad as unknown)).toBeNull();
    }
  });

  it('a batch keeps distinct valid keys and is capped', () => {
    expect(parseAppKeyList(['web:aaaa1', 'web:aaaa1', 'nope', 'apk:bbbb2']).map((k) => k.key)).toEqual(['web:aaaa1', 'apk:bbbb2']);
    const many = Array.from({ length: MAX_BATCH_KEYS + 50 }, (_, i) => `web:app${String(i).padStart(4, '0')}`);
    expect(parseAppKeyList(many)).toHaveLength(MAX_BATCH_KEYS);
    expect(parseAppKeyList('web:aaaa1')).toEqual([]);
  });
});

describe('👍 / 👎 behave like every social app', () => {
  it('pressing the same one takes it back; pressing the other switches', () => {
    expect(nextReaction(null, 'like')).toBe('like');
    expect(nextReaction('like', 'like')).toBeNull();
    expect(nextReaction('like', 'dislike')).toBe('dislike');
    expect(nextReaction('dislike', 'dislike')).toBeNull();
  });
  it('only like and dislike exist, and one person holds one reaction per app', () => {
    expect(parseReaction('like')).toBe('like');
    expect(parseReaction('love')).toBeNull();
    expect(reactionDocId('web:aaaa1', 'u1')).toBe(reactionDocId('web:aaaa1', 'u1'));
    expect(reactionDocId('web:aaaa1', 'u1')).not.toBe(reactionDocId('web:aaaa1', 'u2'));
  });
});

describe('a comment is cleaned, never trusted', () => {
  it('trims, drops invisible padding and collapses blank runs', () => {
    const r = cleanCommentText('  Great​ app!\r\n\r\n\r\n\r\nLoved it\u0007  ');
    expect(r).toEqual({ ok: true, text: 'Great app!\n\nLoved it' });
  });
  it('refuses empty and oversize comments with a reason', () => {
    expect(cleanCommentText('   \n ').ok).toBe(false);
    expect(cleanCommentText(undefined).ok).toBe(false);
    const long = cleanCommentText('a'.repeat(MAX_COMMENT_CHARS + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(String(MAX_COMMENT_CHARS));
    expect(cleanCommentText('a'.repeat(MAX_COMMENT_CHARS)).ok).toBe(true);
  });
});

describe('who may take a comment down', () => {
  const base = { authorUid: 'author', appOwnerUid: 'owner', isAdmin: false };
  it('its author, the app’s creator and an admin — nobody else', () => {
    expect(canRemoveComment({ ...base, viewerUid: 'author' })).toBe(true);
    expect(canRemoveComment({ ...base, viewerUid: 'owner' })).toBe(true);
    expect(canRemoveComment({ ...base, viewerUid: 'stranger', isAdmin: true })).toBe(true);
    expect(canRemoveComment({ ...base, viewerUid: 'stranger' })).toBe(false);
    expect(canRemoveComment({ ...base, viewerUid: null })).toBe(false);
  });
  it('the note left behind says honestly who removed it', () => {
    expect(removedBy({ ...base, viewerUid: 'author' })).toBe('author');
    expect(removedBy({ ...base, viewerUid: 'owner' })).toBe('creator');
    expect(removedBy({ ...base, viewerUid: 'x', isAdmin: true })).toBe('admin');
    expect(removedLabel('creator')).toMatch(/creator/);
  });
});

describe('what a viewer is sent', () => {
  const ctx = (over: Partial<Parameters<typeof publicComments>[1]> = {}) => ({
    people: new Map([['u-author', person('Asha')], ['owner', person('Ravi')]]),
    creatorIdOf: () => 'zzzzzzzzzz', viewerUid: 'viewer', appOwnerUid: 'owner', isAdmin: false,
    blockedUids: new Set<string>(), ...over,
  });

  it('a blocked author’s comments are not sent at all', () => {
    expect(publicComments([comment()], ctx({ blockedUids: new Set(['u-author']) }))).toEqual([]);
  });

  it('a removed comment disappears — unless it has replies, and then its text is still never sent', () => {
    expect(publicComments([comment({ visible: false, text: 'secret' })], ctx())).toEqual([]);
    const [kept] = publicComments([comment({ visible: false, text: 'secret', replyCount: 2, removedBy: 'creator' })], ctx());
    expect(kept.text).toBe('');
    expect(kept.removedNote).toMatch(/creator/);
    expect(JSON.stringify(kept)).not.toContain('secret');
    expect(kept.author.creatorId).toBe('');
  });

  it('marks the creator, the viewer’s own comment, and what the viewer may remove', () => {
    const [byOwner] = publicComments([comment({ uid: 'owner' })], ctx());
    expect(byOwner.isCreator).toBe(true);
    const [mine] = publicComments([comment({ uid: 'viewer' })], ctx());
    expect(mine.isMine).toBe(true);
    expect(mine.canRemove).toBe(true);
    const [other] = publicComments([comment()], ctx());
    expect(other.canRemove).toBe(false);
    expect(publicComments([comment()], ctx({ viewerUid: 'owner' }))[0].canRemove).toBe(true);
  });

  it('an unknown author still shows, under a neutral name and their code', () => {
    const [c] = publicComments([comment({ uid: 'ghost' })], ctx());
    expect(c.author).toEqual({ name: 'NavBharatAI user', photoUrl: '', creatorId: 'zzzzzzzzzz' });
  });

  it('🔒 no email can become a name — the people map is built through creatorDisplayName', () => {
    expect(creatorDisplayName('ravi@example.com', 'ravi.k@gmail.com')).not.toMatch(/@/);
    expect(store).toContain('creatorDisplayName(');
  });

  it('pages newest first, replies oldest first', () => {
    const rows = [comment({ id: 'a', createdAt: 1 }), comment({ id: 'b', createdAt: 3 }), comment({ id: 'c', createdAt: 2 })];
    expect(pageOfComments(rows, null, 2)).toEqual({ page: [rows[1], rows[2]], hasMore: true });
    expect(pageOfComments(rows, 2, 5).page.map((c) => c.id)).toEqual(['a']);
    expect(orderComments(rows, true).map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('people', () => {
  it('only an https photo is shown', () => {
    expect(safePhotoUrl('https://lh3.googleusercontent.com/a/x')).toBe('https://lh3.googleusercontent.com/a/x');
    for (const bad of ['http://x.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', 'not a url', `https://x.com/${'a'.repeat(1100)}`]) {
      expect(safePhotoUrl(bad)).toBe('');
    }
  });
  it('a profile address is the public creator code, which has a fixed shape', () => {
    expect(isCreatorIdShape(publicCreatorId('some-uid'))).toBe(true);
    expect(isCreatorIdShape('me')).toBe(false);
    expect(isCreatorIdShape('ABCDEFGHIJ')).toBe(false);
  });
});

describe('creator notifications are grouped, and new activity comes back unread', () => {
  const input = { recipientUid: 'owner', kind: 'like' as const, appKey: 'web:aaaa1', appName: 'Todo Pro', day: '2026-09-30', now: 10 };

  it('the document id is short, stable and carries no account id', () => {
    const id = socialNotificationDocId('owner-uid-123', 'like', 'web:aaaa1', '2026-09-30');
    expect(id).toBe(socialNotificationDocId('owner-uid-123', 'like', 'web:aaaa1', '2026-09-30'));
    expect(id).not.toContain('owner-uid-123');
    expect(id.length).toBeLessThan(40);
    expect(socialNotificationDocId('owner-uid-123', 'like', 'web:aaaa1', '2026-10-01')).not.toBe(id);
  });

  it('the inbox id carries the version, and is told apart from the admin inbox’s own ids', () => {
    const doc = socialNotificationDocId('o', 'comment', 'web:aaaa1', '2026-09-30');
    const inbox = socialInboxId(doc, 3);
    expect(parseSocialInboxId(inbox)).toEqual({ docId: doc, version: 3 });
    expect(isSocialInboxId(inbox)).toBe(true);
    expect(isSocialInboxId('1727712000000_ab12cd')).toBe(false);
    expect(isSocialInboxId(`${doc}.x`)).toBe(false);
  });

  it('liking twice does not ring twice; a new comment always does', () => {
    const first = foldActor(null, { ...input, actorUid: 'a', actorName: 'Asha' });
    expect(first.changed).toBe(true);
    expect(foldActor(first.doc, { ...input, actorUid: 'a', actorName: 'Asha', now: 20 }).changed).toBe(false);
    const c1 = foldActor(null, { ...input, kind: 'comment', actorUid: 'a', actorName: 'Asha', text: 'hi' });
    const c2 = foldActor(c1.doc, { ...input, kind: 'comment', actorUid: 'a', actorName: 'Asha', text: 'again', now: 20 });
    expect(c2.changed).toBe(true);
    expect(c2.doc.count).toBe(1);
    expect(c2.doc.version).toBe(2);
    expect(c2.doc.latestText).toBe('again');
  });

  it('reads like a person wrote it', () => {
    let d = foldActor(null, { ...input, actorUid: 'a', actorName: 'Asha' }).doc;
    expect(socialNotificationMessage(d)).toBe('👍 Asha liked your app "Todo Pro" on App Mart.');
    d = foldActor(d, { ...input, actorUid: 'b', actorName: 'Ravi' }).doc;
    expect(socialNotificationMessage(d)).toBe('👍 Ravi and Asha liked your app "Todo Pro" on App Mart.');
    d = foldActor(d, { ...input, actorUid: 'c', actorName: 'Meera' }).doc;
    expect(socialNotificationMessage(d)).toBe('👍 Meera and 2 others liked your app "Todo Pro" on App Mart.');
    const r = foldActor(null, { ...input, kind: 'reply', actorUid: 'a', actorName: 'Asha', text: 'thanks!' }).doc;
    expect(socialNotificationMessage(r)).toBe('↩️ Asha replied to your comment on "Todo Pro": “thanks!”');
    expect(socialPushBody('comment', 'Asha', 'Todo Pro', 'love it')).toBe('Asha commented on "Todo Pro": love it');
  });

  it('remembers a bounded number of people', () => {
    let d = foldActor(null, { ...input, actorUid: 'a0', actorName: 'A0' }).doc;
    for (let i = 1; i < MAX_REMEMBERED_ACTORS + 20; i++) d = foldActor(d, { ...input, actorUid: `a${i}`, actorName: `A${i}` }).doc;
    expect(d.actorUids.length).toBe(MAX_REMEMBERED_ACTORS);
    expect(d.count).toBe(MAX_REMEMBERED_ACTORS + 20);
  });

  it('read and dismissed are per version — activity after the look is unread again', () => {
    expect(inboxState({ version: 3, readVersion: 3, dismissedVersion: 0 })).toEqual({ shown: true, read: true });
    expect(inboxState({ version: 4, readVersion: 3, dismissedVersion: 0 })).toEqual({ shown: true, read: false });
    expect(inboxState({ version: 4, readVersion: 0, dismissedVersion: 4 }).shown).toBe(false);
    expect(inboxState({ version: 5, readVersion: 0, dismissedVersion: 4 }).shown).toBe(true);
  });
});

describe('blocking', () => {
  it('adds, removes and is bounded', () => {
    expect(applyBlock(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(applyBlock(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(applyBlock(['a'], 'a', true)).toEqual(['a']);
    const full = Array.from({ length: MAX_BLOCKED }, (_, i) => `u${i}`);
    expect(applyBlock(full, 'new', true)).toHaveLength(MAX_BLOCKED);
  });
});

describe('🔒 the promises that live in the routes', () => {
  function handler(start: string): string {
    const i = routes.indexOf(start);
    expect(i, `route not found: ${start}`).toBeGreaterThan(-1);
    const next = routes.indexOf('app.', i + start.length);
    return routes.slice(i, next === -1 ? undefined : next);
  }

  it('every write needs a verified sign-in, checked before anything is stored', () => {
    for (const r of [
      "app.post('/api/app-mart/social/react'",
      "app.post('/api/app-mart/social/comments',",
      "app.post('/api/app-mart/social/comments/:id/remove'",
      "app.post('/api/app-mart/social/comments/:id/report'",
      "app.post('/api/app-mart/social/block'",
    ]) {
      const h = handler(r);
      expect(h, r).toContain('verifyFirebaseIdentity(req)');
      expect(h, r).toMatch(/if \(!me\?\.uid\) return res\.status\(401\)/);
    }
  });

  it('reading counts and comments needs no sign-in', () => {
    expect(handler("app.post('/api/app-mart/social/batch'")).not.toContain('status(401)');
    expect(handler("app.get('/api/app-mart/social/comments'")).not.toContain('status(401)');
  });

  it('only the creator (or an admin) may see who liked, and nothing anywhere lists who disliked', () => {
    const likers = handler("app.get('/api/app-mart/social/likers'");
    expect(likers).toContain('target.ownerUid !== me.uid && !isStoreAdmin(me.email)');
    expect(likers).toContain('status(403)');
    expect(routes).not.toMatch(/dislikers/i);
    expect(store).not.toMatch(/dislikers/i);
    expect(store).toMatch(/\['appKey', appKey\], \['kind', 'like'\]/);
  });

  it('no response carries an email — `email` is used only to ask whether the caller is an admin', () => {
    const uses = routes.split('\n').filter((l) => /email/i.test(l));
    for (const l of uses) expect(l, l).toMatch(/isStoreAdmin\((me\?\.email \?\? null|me\.email)\)/);
  });

  it('the likers list and profile hand out public people, never account ids', () => {
    // Every `res.json(...)` body, bracket-matched, must be free of any account id field.
    const bodies: string[] = [];
    for (let i = routes.indexOf('res.json('); i !== -1; i = routes.indexOf('res.json(', i + 1)) {
      let depth = 0;
      let j = i + 'res.json'.length;
      for (; j < routes.length; j++) {
        if (routes[j] === '(') depth++;
        else if (routes[j] === ')' && --depth === 0) break;
      }
      bodies.push(routes.slice(i, j + 1));
    }
    expect(bodies.length).toBeGreaterThan(8);
    for (const b of bodies) expect(b, b).not.toMatch(/[{,]\s*(uid|ownerUid|authorUid|reporterUid|recipientUid|email)\s*[:,}]/);
    expect(routes).toContain('resolvePeople(');
  });

  it('App Mart notifications ride the existing inbox but keep their own store and read state', () => {
    const n = code(read('src/server/routes/notifications.ts'));
    expect(n).toContain('listSocialInbox(uid)');
    expect(n).toContain("updateSocialInbox(uid, social, 'readVersion')");
    expect(n).toContain("updateSocialInbox(uid, social, 'dismissedVersion')");
    expect(n).toContain('markNotificationsRead(uid, admin)');
    expect(n).toContain('dismissNotifications(uid, admin)');
  });

  it('nobody is notified of their own act, and a like only notifies when it is new', () => {
    expect(store).toContain('input.recipientUid === input.actorUid) return');
    expect(handler("app.post('/api/app-mart/social/react'")).toContain('if (newLike) void notifySocial(');
  });

  it('counts are counted from the records, not kept as a tally that can drift', () => {
    expect(store).toContain('.count().get()');
    expect(store).not.toMatch(/FieldValue\.increment\([^)]*\)[\s\S]{0,80}(likes|dislikes)/);
  });

  it('a creator’s name on a card makes their profile reachable', () => {
    const sc = code(read('src/server/lib/storeCreator.ts'));
    expect(sc).toContain('deps.remember?.(info.id, uid)');
    expect(sc).toContain('remember: rememberCreatorId');
  });
});
