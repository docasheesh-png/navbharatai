// App Mart social — the client's side of the conversation with /api/app-mart/*.
//
// One place for every call, so the screens never build a URL or a header themselves, and one hook
// (`useSocialStats`) that holds the counts for a whole Browse page and applies a press instantly
// (then corrects to what the server confirmed).

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../lib/firebase';
import { authHeader, authJsonHeaders } from '../../../lib/authHeaders';
import { optimisticReact } from './socialFormat';

export type Reaction = 'like' | 'dislike';
export interface SocialCounts { likes: number; dislikes: number; comments: number }
export const NO_COUNTS: SocialCounts = { likes: 0, dislikes: 0, comments: 0 };

export interface PublicPerson { name: string; photoUrl: string; creatorId: string }

export interface PublicComment {
  id: string;
  text: string;
  createdAt: number;
  parentId: string;
  replyCount: number;
  author: PublicPerson;
  isCreator: boolean;
  isMine: boolean;
  canRemove: boolean;
  removedNote?: string;
}

export interface ProfileApp {
  key: string;
  kind: 'web' | 'apk';
  id: string;
  name: string;
  description: string;
  iconDataUrl?: string;
  publishedAt: number;
  runs: number;
  requiresPassword: boolean;
  counts: SocialCounts;
}

export interface Profile {
  person: PublicPerson;
  isMe: boolean;
  blockedByMe: boolean;
  apps: ProfileApp[];
  totals: { apps: number; likes: number };
  /** Counts are public; `null` means the number could not be read (drawn as "—", never as 0). */
  follow?: { followers: number | null; following: number | null; isFollowing: boolean };
}

/** A failure the screen can print as-is: the server's own sentence, or an honest generic one. */
export class SocialError extends Error {
  constructor(message: string, readonly needsSignIn = false) { super(message); }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new SocialError(typeof data.error === 'string' ? data.error : 'That did not work. Please try again.', data.needsSignIn === true || res.status === 401);
  }
  return data;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: 'POST', headers: await authJsonHeaders(), body: JSON.stringify(body ?? {}) });
  return readJson(res);
}

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, { headers: await authHeader() });
  return readJson(res);
}

export const webKey = (id: string) => `web:${id}`;
export const apkKey = (id: string) => `apk:${id}`;

export async function fetchBatch(keys: string[]): Promise<{ counts: Record<string, SocialCounts>; mine: Record<string, Reaction> }> {
  const d = await post('/api/app-mart/social/batch', { keys });
  return { counts: (d.counts ?? {}) as Record<string, SocialCounts>, mine: (d.mine ?? {}) as Record<string, Reaction> };
}

export async function react(key: string, reaction: Reaction): Promise<{ mine: Reaction | null; counts: SocialCounts | null }> {
  const d = await post('/api/app-mart/social/react', { key, reaction });
  return { mine: (d.mine as Reaction | null) ?? null, counts: (d.counts as SocialCounts | null) ?? null };
}

export async function fetchComments(key: string, opts: { parent?: string; before?: number } = {}): Promise<{
  comments: PublicComment[]; hasMore: boolean; counts: SocialCounts | null;
  viewer: { signedIn: boolean; isOwner: boolean; isAdmin: boolean };
}> {
  const q = new URLSearchParams({ key });
  if (opts.parent) q.set('parent', opts.parent);
  if (opts.before) q.set('before', String(opts.before));
  const d = await get(`/api/app-mart/social/comments?${q.toString()}`);
  return {
    comments: Array.isArray(d.comments) ? (d.comments as PublicComment[]) : [],
    hasMore: d.hasMore === true,
    counts: (d.counts as SocialCounts | null) ?? null,
    viewer: (d.viewer as { signedIn: boolean; isOwner: boolean; isAdmin: boolean }) ?? { signedIn: false, isOwner: false, isAdmin: false },
  };
}

export async function postComment(key: string, text: string, parentId?: string): Promise<{ comment: PublicComment; counts: SocialCounts | null }> {
  const d = await post('/api/app-mart/social/comments', { key, text, parentId });
  return { comment: d.comment as PublicComment, counts: (d.counts as SocialCounts | null) ?? null };
}

export async function removeComment(id: string): Promise<SocialCounts | null> {
  const d = await post(`/api/app-mart/social/comments/${encodeURIComponent(id)}/remove`, {});
  return (d.counts as SocialCounts | null) ?? null;
}

export async function reportComment(id: string, reason: string): Promise<string> {
  const d = await post(`/api/app-mart/social/comments/${encodeURIComponent(id)}/report`, { reason });
  return typeof d.message === 'string' ? d.message : 'Thanks — the App Mart team will look at this comment.';
}

export async function keepComment(id: string): Promise<void> {
  await post(`/api/app-mart/social/comments/${encodeURIComponent(id)}/keep`, {});
}

export async function setBlocked(creatorId: string, blocked: boolean): Promise<void> {
  await post('/api/app-mart/social/block', { creatorId, blocked });
}

export async function fetchBlocked(): Promise<PublicPerson[]> {
  const d = await get('/api/app-mart/social/blocked');
  return Array.isArray(d.people) ? (d.people as PublicPerson[]) : [];
}

export async function fetchLikers(key: string): Promise<{ likers: Array<PublicPerson & { at: number }>; counts: SocialCounts | null }> {
  const d = await get(`/api/app-mart/social/likers?key=${encodeURIComponent(key)}`);
  return { likers: Array.isArray(d.likers) ? (d.likers as Array<PublicPerson & { at: number }>) : [], counts: (d.counts as SocialCounts | null) ?? null };
}

export async function fetchProfile(creatorId: string): Promise<Profile> {
  const d = await get(`/api/app-mart/profile/${encodeURIComponent(creatorId)}`);
  return d as unknown as Profile;
}

/** Follow or unfollow a creator. Returns the state now held and the creator's follower count. */
export async function setFollow(creatorId: string, follow: boolean): Promise<{ following: boolean; followers: number | null }> {
  const d = await post('/api/app-mart/social/follow', { creatorId, follow });
  return { following: d.following === true, followers: typeof d.followers === 'number' ? d.followers : null };
}

export async function fetchFollowState(creatorId: string): Promise<{ followers: number | null; following: boolean; isMe: boolean }> {
  const d = await get(`/api/app-mart/social/follow-state?creatorId=${encodeURIComponent(creatorId)}`);
  return { followers: typeof d.followers === 'number' ? d.followers : null, following: d.following === true, isMe: d.isMe === true };
}

/** Who follows the signed-in creator. Only they (and an admin) can see this list. */
export async function fetchFollowers(): Promise<{ followers: Array<PublicPerson & { at: number }>; counts: { followers: number; following: number } | null }> {
  const d = await get('/api/app-mart/social/followers');
  return {
    followers: Array.isArray(d.followers) ? (d.followers as Array<PublicPerson & { at: number }>) : [],
    counts: (d.counts as { followers: number; following: number } | null) ?? null,
  };
}

export type FeedView = 'following' | 'liked';

/**
 * The two personal Browse views. The apps come back in exactly the shapes the General view's lists
 * use, so the same tiles draw them. `T`/`U` are the caller's web-app and Android-app types.
 */
export async function fetchFeed<T, U>(view: FeedView): Promise<{ webApps: T[]; apps: U[]; followingCount: number | null }> {
  const d = await get(`/api/app-mart/feed?view=${view}`);
  return {
    webApps: Array.isArray(d.webApps) ? (d.webApps as T[]) : [],
    apps: Array.isArray(d.apps) ? (d.apps as U[]) : [],
    followingCount: typeof d.followingCount === 'number' ? d.followingCount : null,
  };
}

export interface CommentReportRow {
  id: string; commentId: string; appKey: string; appName: string; reason: string; text: string; at: number; author: PublicPerson;
}

export async function fetchCommentReports(): Promise<CommentReportRow[]> {
  const d = await get('/api/app-mart/social/admin/reports');
  return Array.isArray(d.reports) ? (d.reports as CommentReportRow[]) : [];
}

/** Open the sign-in screen — the same event every other surface uses to ask for it. */
export function askToSignIn(): void {
  window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { signIn: 'phone' } }));
}

/** Is somebody signed in right now? Follows sign-in and sign-out live. */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(() => !!auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, (u) => setSignedIn(!!u)), []);
  return signedIn;
}

/**
 * Counts and the viewer's own reactions for a set of apps. A press updates the screen at once and is
 * then replaced by what the server confirmed; a refused press is rolled back and reported.
 */
export function useSocialStats(keys: string[]): {
  counts: Record<string, SocialCounts>;
  mine: Record<string, Reaction>;
  press: (key: string, reaction: Reaction) => Promise<void>;
  setCounts: (key: string, counts: SocialCounts) => void;
  error: string;
} {
  const [counts, setCountsState] = useState<Record<string, SocialCounts>>({});
  const [mine, setMine] = useState<Record<string, Reaction>>({});
  const [error, setError] = useState('');
  const signedIn = useSignedIn();
  const joined = keys.join('|');
  const busy = useRef(new Set<string>());

  useEffect(() => {
    if (!joined) return;
    let live = true;
    fetchBatch(joined.split('|'))
      .then((d) => { if (live) { setCountsState((p) => ({ ...p, ...d.counts })); setMine(d.mine); } })
      .catch(() => { /* no numbers is honest; a wrong number would not be */ });
    return () => { live = false; };
  }, [joined, signedIn]);

  const setCounts = useCallback((key: string, c: SocialCounts) => setCountsState((p) => ({ ...p, [key]: c })), []);

  const press = useCallback(async (key: string, reaction: Reaction) => {
    if (!auth.currentUser) { askToSignIn(); return; }
    if (busy.current.has(key)) return;
    busy.current.add(key);
    const before = { counts: counts[key] ?? NO_COUNTS, mine: mine[key] ?? null };
    const guess = optimisticReact(before.counts, before.mine, reaction);
    setCountsState((p) => ({ ...p, [key]: guess.counts }));
    setMine((p) => { const n = { ...p }; if (guess.mine) n[key] = guess.mine; else delete n[key]; return n; });
    setError('');
    try {
      const r = await react(key, reaction);
      if (r.counts) setCountsState((p) => ({ ...p, [key]: r.counts! }));
      setMine((p) => { const n = { ...p }; if (r.mine) n[key] = r.mine; else delete n[key]; return n; });
    } catch (e) {
      setCountsState((p) => ({ ...p, [key]: before.counts }));
      setMine((p) => { const n = { ...p }; if (before.mine) n[key] = before.mine; else delete n[key]; return n; });
      if (e instanceof SocialError && e.needsSignIn) askToSignIn();
      else setError(e instanceof Error ? e.message : 'That did not work. Please try again.');
    } finally {
      busy.current.delete(key);
    }
  }, [counts, mine]);

  return { counts, mine, press, setCounts, error };
}
