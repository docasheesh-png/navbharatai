// App Mart social — the screens (admin 2026-09-30: "app mart me ek social media banana hai!").
//
//  • SocialBar        — 👍 · 👎 · 💬 under every app, with the numbers everyone can see.
//  • CommentsSection  — the conversation on an app: newest first, replies one level deep, the creator
//                       marked, and on every comment the three things a reader needs: delete (own),
//                       report, and block the person.
//  • LikersSheet      — who liked the app. Only its creator can open it; the server enforces that too.
//                       There is no dislikers sheet — nobody may see who disliked.
//  • ProfileSheet     — a person's name, photo and the apps they have on App Mart. Never an email.
//  • FollowButton     — follow a creator (2026-10-01). The follower NUMBER is public; who follows is
//                       the creator's alone (FollowersSheet), the same split as likes.
//  • CommentReportsAdmin — the admin's queue of reported comments.
//
// Colours are theme TOKENS only (tests/themeTokensOnly.test.ts): a new file has a literal baseline of 0.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ThumbsUp, ThumbsDown, MessageCircle, Loader2, Flag, Trash2, UserX, Reply, MoreHorizontal, X,
  Heart, Store, Globe, Package, Send, ShieldCheck, UserPlus, UserCheck, Pencil,
} from 'lucide-react';
import { ProfileEditForm } from '../../profile/ProfileEditForm';
import {
  type Reaction, type SocialCounts, type PublicComment, type PublicPerson, type Profile, type CommentReportRow,
  NO_COUNTS, fetchComments, postComment, removeComment, reportComment, setBlocked, fetchLikers,
  fetchProfile, fetchCommentReports, keepComment, askToSignIn, useSignedIn, SocialError,
  setFollow, fetchFollowState, fetchFollowers,
} from './appMartSocialApi';
import { compactCount, timeAgo, initialOf } from './socialFormat';

// ─── Small pieces ────────────────────────────────────────────────────────────────────────────────

export function Avatar({ person, size = 32 }: { person: Pick<PublicPerson, 'name' | 'photoUrl'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (person.photoUrl && !broken) {
    return (
      <img
        src={person.photoUrl}
        alt=""
        style={style}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="rounded-full object-cover flex-shrink-0 bg-raised border border-line"
      />
    );
  }
  return (
    <span style={style} aria-hidden className="rounded-full flex-shrink-0 bg-raised border border-line flex items-center justify-center text-xs font-bold text-muted">
      {initialOf(person.name)}
    </span>
  );
}

/** 👍 · 👎 · 💬 — the row under every app. Everyone sees the numbers; pressing needs a sign-in. */
export function SocialBar({ counts, mine, onReact, onComment, compact = false }: {
  counts: SocialCounts | undefined;
  mine: Reaction | undefined;
  onReact: (r: Reaction) => void;
  onComment: () => void;
  compact?: boolean;
}) {
  const c = counts ?? NO_COUNTS;
  const pill = `flex items-center justify-center gap-1 rounded-lg transition-colors ${compact ? 'px-1.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} font-semibold`;
  const icon = compact ? 13 : 15;
  return (
    <div className={`flex items-center ${compact ? 'justify-between gap-1' : 'gap-2'}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => onReact('like')}
        aria-pressed={mine === 'like'}
        aria-label={`Like — ${c.likes} like${c.likes === 1 ? '' : 's'}`}
        className={`${pill} ${mine === 'like' ? 'bg-accent/15 text-accent-text' : 'text-muted hover:text-body hover:bg-raised'}`}
      >
        <ThumbsUp size={icon} className={mine === 'like' ? 'fill-current' : ''} /> {compactCount(c.likes)}
      </button>
      <button
        type="button"
        onClick={() => onReact('dislike')}
        aria-pressed={mine === 'dislike'}
        aria-label={`Dislike — ${c.dislikes} dislike${c.dislikes === 1 ? '' : 's'}`}
        className={`${pill} ${mine === 'dislike' ? 'bg-rose-500/10 text-danger' : 'text-muted hover:text-body hover:bg-raised'}`}
      >
        <ThumbsDown size={icon} className={mine === 'dislike' ? 'fill-current' : ''} /> {compactCount(c.dislikes)}
      </button>
      <button
        type="button"
        onClick={onComment}
        aria-label={`Comments — ${c.comments}`}
        className={`${pill} text-muted hover:text-body hover:bg-raised`}
      >
        <MessageCircle size={icon} /> {compactCount(c.comments)}
      </button>
    </div>
  );
}

function PersonName({ person, onOpen, badge }: { person: PublicPerson; onOpen?: (creatorId: string) => void; badge?: React.ReactNode }) {
  const clickable = !!onOpen && !!person.creatorId;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {clickable ? (
        <button type="button" onClick={() => onOpen!(person.creatorId)} className="font-semibold text-ink hover:underline truncate text-left">
          {person.name}
        </button>
      ) : (
        <span className="font-semibold text-ink truncate">{person.name}</span>
      )}
      {badge}
    </span>
  );
}

const CreatorBadge = () => (
  <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-accent/15 text-accent-text text-[9px] font-black uppercase tracking-wide">Creator</span>
);

const REPORT_REASONS = ['Spam', 'Abusive or hateful', 'Sexual content', 'Harassment', 'Something else'];

// ─── One comment ─────────────────────────────────────────────────────────────────────────────────

function CommentRow({ c, now, onOpenProfile, onReply, onRemoved, onBlocked, isReply = false }: {
  c: PublicComment;
  now: number;
  onOpenProfile: (creatorId: string) => void;
  onReply?: (c: PublicComment) => void;
  onRemoved: (c: PublicComment, counts: SocialCounts | null) => void;
  onBlocked: (creatorId: string) => void;
  isReply?: boolean;
}) {
  const signedIn = useSignedIn();
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  if (c.removedNote) {
    return <p className={`text-xs italic text-faint py-2 ${isReply ? 'pl-9' : ''}`}>{c.removedNote}</p>;
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setNote('');
    try { await fn(); } catch (e) {
      if (e instanceof SocialError && e.needsSignIn) askToSignIn();
      else setNote(e instanceof Error ? e.message : 'That did not work.');
    } finally { setBusy(false); }
  };

  return (
    <div className={`flex gap-2.5 py-2.5 ${isReply ? 'pl-9' : ''}`}>
      <button type="button" onClick={() => c.author.creatorId && onOpenProfile(c.author.creatorId)} aria-label={`Open ${c.author.name}'s profile`}>
        <Avatar person={c.author} size={isReply ? 26 : 32} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <PersonName person={c.author} onOpen={onOpenProfile} badge={c.isCreator ? <CreatorBadge /> : null} />
          <span className="text-faint flex-shrink-0">{timeAgo(c.createdAt, now)}</span>
          {signedIn && (
            <button type="button" onClick={() => { setMenu((m) => !m); setReporting(false); }} aria-label="More options" className="ml-auto p-1 rounded text-faint hover:text-body hover:bg-raised">
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        <p className="text-sm text-body whitespace-pre-wrap break-words mt-0.5">{c.text}</p>
        {onReply && (
          <button type="button" onClick={() => onReply(c)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-body">
            <Reply size={12} /> Reply
          </button>
        )}

        {menu && (
          <div className="mt-2 rounded-lg border border-line bg-card p-1.5 space-y-0.5">
            {c.canRemove && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(c.isMine ? 'Delete your comment?' : 'Remove this comment from your app?')) void act(async () => { const counts = await removeComment(c.id); onRemoved(c, counts); }); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-danger hover:bg-rose-500/10 disabled:opacity-50">
                <Trash2 size={13} /> {c.isMine ? 'Delete' : 'Remove from my app'}
              </button>
            )}
            {!c.isMine && (
              <button type="button" disabled={busy} onClick={() => setReporting((r) => !r)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-body hover:bg-raised disabled:opacity-50">
                <Flag size={13} /> Report comment
              </button>
            )}
            {!c.isMine && c.author.creatorId && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(`Block ${c.author.name}? You will no longer see their comments, and they will not notify you.`)) void act(async () => { await setBlocked(c.author.creatorId, true); onBlocked(c.author.creatorId); }); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-body hover:bg-raised disabled:opacity-50">
                <UserX size={13} /> Block {c.author.name}
              </button>
            )}
            {reporting && (
              <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-1">
                {REPORT_REASONS.map((r) => (
                  <button key={r} type="button" disabled={busy}
                    onClick={() => void act(async () => { const msg = await reportComment(c.id, r); setReporting(false); setMenu(false); setNote(msg); })}
                    className="px-2 py-1 rounded-full border border-line text-[11px] text-body hover:bg-raised disabled:opacity-50">{r}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {note && <p className="text-[11px] text-muted mt-1">{note}</p>}
      </div>
    </div>
  );
}

// ─── The conversation on one app ─────────────────────────────────────────────────────────────────

export function CommentsSection({ appKey, onOpenProfile, onCounts, onOpenLikers }: {
  appKey: string;
  onOpenProfile: (creatorId: string) => void;
  /** Keeps the bar on the card in step with what happened here. */
  onCounts?: (c: SocialCounts) => void;
  /** Shown to the app's creator only. */
  onOpenLikers?: () => void;
}) {
  const signedIn = useSignedIn();
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [viewer, setViewer] = useState({ signedIn: false, isOwner: false, isAdmin: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<PublicComment | null>(null);
  const [posting, setPosting] = useState(false);
  const [replies, setReplies] = useState<Record<string, PublicComment[]>>({});
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());

  // 🔴 THE CALLBACK IS READ THROUGH A REF, NEVER LISTED AS A DEPENDENCY (admin 2026-10-05: "comment ke liye
  // click kare to screen vibrate hoti rehti hai, jabki loading ke liye kuch hai hi nahi"). The parent passes
  // `onCounts` as an inline arrow, so it is a NEW function on every parent render. With it in `load`'s
  // dependencies the screen looped for ever: load → onCounts → the parent's counts change → it re-renders →
  // a new onCounts → a new `load` → the effect below runs again → the spinner comes back → fetch → … Each
  // turn of the loop was one request to the server and one flash of "loading". The comments load when the
  // APP changes (or the viewer signs in), never because a parent re-rendered.
  // `tests/aParentRenderIsNotAReload.test.ts` fails on any client hook that does this again.
  const onCountsRef = useRef(onCounts);
  useEffect(() => { onCountsRef.current = onCounts; }, [onCounts]);

  const load = useCallback(async (before?: number) => {
    setLoading(true); setError('');
    try {
      const d = await fetchComments(appKey, { before });
      setComments((prev) => (before ? [...prev, ...d.comments] : d.comments));
      setHasMore(d.hasMore);
      setViewer(d.viewer);
      if (d.counts) onCountsRef.current?.(d.counts);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comments could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [appKey]);

  useEffect(() => { void load(); }, [load, signedIn]);

  const loadReplies = async (parentId: string) => {
    setOpenReplies((o) => ({ ...o, [parentId]: !o[parentId] }));
    if (replies[parentId]) return;
    try {
      const d = await fetchComments(appKey, { parent: parentId });
      setReplies((r) => ({ ...r, [parentId]: d.comments }));
    } catch { setReplies((r) => ({ ...r, [parentId]: [] })); }
  };

  const submit = async () => {
    if (!signedIn) { askToSignIn(); return; }
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true); setError('');
    try {
      const r = await postComment(appKey, body, replyTo?.id);
      if (replyTo) {
        const parentId = replyTo.parentId || replyTo.id;
        setReplies((m) => ({ ...m, [parentId]: [...(m[parentId] ?? []), r.comment] }));
        setOpenReplies((o) => ({ ...o, [parentId]: true }));
        setComments((cs) => cs.map((c) => (c.id === parentId ? { ...c, replyCount: c.replyCount + 1 } : c)));
      } else {
        setComments((cs) => [r.comment, ...cs]);
      }
      setText(''); setReplyTo(null);
      if (r.counts && onCounts) onCounts(r.counts);
      setNow(Date.now());
    } catch (e) {
      if (e instanceof SocialError && e.needsSignIn) askToSignIn();
      else setError(e instanceof Error ? e.message : 'Your comment was not posted.');
    } finally {
      setPosting(false);
    }
  };

  const removed = (c: PublicComment, counts: SocialCounts | null) => {
    if (c.parentId) {
      setReplies((m) => ({ ...m, [c.parentId]: (m[c.parentId] ?? []).filter((x) => x.id !== c.id) }));
      setComments((cs) => cs.map((x) => (x.id === c.parentId ? { ...x, replyCount: Math.max(0, x.replyCount - 1) } : x)));
    } else {
      setComments((cs) => cs.flatMap((x) => (x.id !== c.id ? [x] : x.replyCount > 0 ? [{ ...x, text: '', removedNote: 'This comment was removed.' }] : [])));
    }
    if (counts && onCounts) onCounts(counts);
  };

  const blocked = (creatorId: string) => {
    setComments((cs) => cs.filter((c) => c.author.creatorId !== creatorId));
    setReplies((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.filter((c) => c.author.creatorId !== creatorId)])));
  };

  return (
    <section aria-label="Comments" className="mt-4 pt-4 border-t border-line">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-ink flex items-center gap-1.5"><MessageCircle size={15} /> Comments</p>
        {viewer.isOwner && onOpenLikers && (
          <button type="button" onClick={onOpenLikers} className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text hover:underline">
            <Heart size={12} /> See who liked
          </button>
        )}
      </div>

      {/* The composer. Signed out, it is a real invitation rather than a dead box. */}
      {signedIn ? (
        <div className="rounded-xl border border-line bg-card p-2">
          {replyTo && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted px-1 pb-1.5">
              <Reply size={11} /> Replying to <b className="text-body">{replyTo.author.name}</b>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="ml-auto text-faint hover:text-body"><X size={12} /></button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1000))}
              rows={2}
              placeholder={replyTo ? 'Write a reply…' : 'Say something about this app…'}
              aria-label={replyTo ? 'Write a reply' : 'Write a comment'}
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint outline-none resize-none px-1"
            />
            <button type="button" onClick={() => void submit()} disabled={posting || !text.trim()}
              aria-label="Post"
              className="flex-shrink-0 p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-on-accent">
              {posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          {text.length > 900 && <p className="text-[10px] text-faint text-right px-1">{text.length}/1000</p>}
        </div>
      ) : (
        <button type="button" onClick={askToSignIn} className="w-full py-2.5 rounded-xl border border-line bg-card text-sm text-muted hover:text-body">
          Sign in to like, dislike and comment
        </button>
      )}

      {error && <p className="text-xs text-warn mt-2">{error}</p>}

      <div className="mt-1 divide-y divide-line">
        {comments.map((c) => (
          <div key={c.id}>
            <CommentRow c={c} now={now} onOpenProfile={onOpenProfile} onReply={signedIn && !c.removedNote ? (x) => setReplyTo(x) : undefined} onRemoved={removed} onBlocked={blocked} />
            {c.replyCount > 0 && (
              <button type="button" onClick={() => void loadReplies(c.id)} className="ml-10 mb-2 text-[11px] font-semibold text-accent-text hover:underline">
                {openReplies[c.id] ? 'Hide replies' : `View ${c.replyCount} repl${c.replyCount === 1 ? 'y' : 'ies'}`}
              </button>
            )}
            {openReplies[c.id] && (replies[c.id] ?? []).map((r) => (
              <CommentRow key={r.id} c={r} now={now} isReply onOpenProfile={onOpenProfile} onReply={signedIn ? () => setReplyTo(c) : undefined} onRemoved={removed} onBlocked={blocked} />
            ))}
          </div>
        ))}
      </div>

      {loading && <p className="flex items-center justify-center gap-2 text-xs text-faint py-4"><Loader2 size={13} className="animate-spin" /> Loading comments…</p>}
      {!loading && comments.length === 0 && !error && <p className="text-xs text-faint text-center py-4">No comments yet — be the first to say something.</p>}
      {!loading && hasMore && (
        <button type="button" onClick={() => void load(comments[comments.length - 1]?.createdAt)} className="w-full py-2 text-xs font-semibold text-accent-text hover:underline">
          Show older comments
        </button>
      )}
    </section>
  );
}

// ─── Sheets ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Rendered into the body, never in place: an ancestor with a transform, a filter or a backdrop blur
 * becomes the containing block of a `fixed` child, and the sheet would open inside that strip
 * (tests/theSheetOpensOverTheScreenNotInsideAFooter.test.ts).
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="nb-sheet-overlay-flush fixed inset-0 z-[60] bg-scrim flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="nb-sheet w-full sm:max-w-lg bg-surface border border-line rounded-t-2xl sm:rounded-2xl p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-muted hover:text-body hover:bg-raised"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Who liked an app — the creator's view. Dislikes are a number here, never a list of people. */
export function LikersSheet({ appKey, appName, onClose, onOpenProfile }: {
  appKey: string; appName: string; onClose: () => void; onOpenProfile: (creatorId: string) => void;
}) {
  const [data, setData] = useState<{ likers: Array<PublicPerson & { at: number }>; counts: SocialCounts | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetchLikers(appKey).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load likes.'));
  }, [appKey]);
  const now = Date.now();
  return (
    <Sheet title={`Likes on “${appName}”`} onClose={onClose}>
      {error && <p className="text-sm text-warn">{error}</p>}
      {!data && !error && <p className="flex items-center gap-2 text-xs text-faint py-6 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
      {data && (
        <>
          <div className="flex gap-4 mb-3 text-sm">
            <span className="flex items-center gap-1.5 text-accent-text font-semibold"><ThumbsUp size={15} /> {compactCount(data.counts?.likes ?? data.likers.length)} likes</span>
            <span className="flex items-center gap-1.5 text-muted font-semibold"><ThumbsDown size={15} /> {compactCount(data.counts?.dislikes ?? 0)} dislikes</span>
          </div>
          <p className="text-[11px] text-faint mb-2">Dislikes are private: you see how many, never who.</p>
          {data.likers.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">No likes yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.likers.map((p) => (
                <li key={`${p.creatorId}-${p.at}`} className="flex items-center gap-3 py-2">
                  <button type="button" onClick={() => onOpenProfile(p.creatorId)} aria-label={`Open ${p.name}'s profile`}><Avatar person={p} size={34} /></button>
                  <PersonName person={p} onOpen={onOpenProfile} />
                  <span className="ml-auto text-[11px] text-faint">{timeAgo(p.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

/**
 * Follow / Following. Pressing it signed out asks for a sign-in; on your own profile it is not drawn.
 * `initial` skips the lookup when the caller already knows the state (the profile sheet does).
 */
export function FollowButton({ creatorId, initial, onChange, compact = false }: {
  creatorId: string;
  initial?: { following: boolean; isMe: boolean };
  onChange?: (state: { following: boolean; followers: number | null }) => void;
  compact?: boolean;
}) {
  const signedIn = useSignedIn();
  const [state, setState] = useState<{ following: boolean; isMe: boolean } | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (initial) { setState(initial); return; }
    let live = true;
    fetchFollowState(creatorId).then((d) => { if (live) setState({ following: d.following, isMe: d.isMe }); }).catch(() => { /* drawn as Follow */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId, signedIn, initial?.following, initial?.isMe]);

  if (!creatorId || state?.isMe) return null;
  const following = state?.following === true;

  const press = async () => {
    if (!signedIn) { askToSignIn(); return; }
    if (busy) return;
    if (following && !window.confirm('Unfollow this creator? Their new apps will no longer appear in your Following view.')) return;
    setBusy(true); setNote('');
    try {
      const r = await setFollow(creatorId, !following);
      setState((st) => ({ isMe: st?.isMe ?? false, following: r.following }));
      onChange?.(r);
    } catch (e) {
      if (e instanceof SocialError && e.needsSignIn) askToSignIn();
      else setNote(e instanceof Error ? e.message : 'That did not work.');
    } finally { setBusy(false); }
  };

  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={() => void press()}
        disabled={busy}
        aria-pressed={following}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 ${compact ? 'px-2.5 py-1 text-[11px]' : 'px-4 py-1.5 text-xs'} ${
          following ? 'border border-line text-body hover:bg-raised' : 'bg-accent text-on-accent hover:opacity-90'
        }`}
      >
        {busy ? <Loader2 size={compact ? 11 : 13} className="animate-spin" /> : following ? <UserCheck size={compact ? 11 : 13} /> : <UserPlus size={compact ? 11 : 13} />}
        {following ? 'Following' : 'Follow'}
      </button>
      {note && <span className="text-[10px] text-warn mt-1 max-w-[14rem] text-center">{note}</span>}
    </span>
  );
}

/** Who follows you — your eyes only. Everyone else sees a number, never this list. */
export function FollowersSheet({ onClose, onOpenProfile }: { onClose: () => void; onOpenProfile: (creatorId: string) => void }) {
  const [data, setData] = useState<{ followers: Array<PublicPerson & { at: number }>; counts: { followers: number; following: number } | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetchFollowers().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load your followers.'));
  }, []);
  const now = Date.now();
  return (
    <Sheet title="Your followers" onClose={onClose}>
      {error && <p className="text-sm text-warn">{error}</p>}
      {!data && !error && <p className="flex items-center gap-2 text-xs text-faint py-6 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
      {data && (
        <>
          <p className="text-[11px] text-faint mb-2">Only you can see this list. Other people see how many followers you have, never who.</p>
          {data.followers.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">No followers yet. People who follow you see your new apps first.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.followers.map((p) => (
                <li key={`${p.creatorId}-${p.at}`} className="flex items-center gap-3 py-2">
                  <button type="button" onClick={() => onOpenProfile(p.creatorId)} aria-label={`Open ${p.name}'s profile`}><Avatar person={p} size={34} /></button>
                  <PersonName person={p} onOpen={onOpenProfile} />
                  <span className="ml-auto text-[11px] text-faint">{timeAgo(p.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

const countLabel = (n: number | null | undefined) => (typeof n === 'number' ? compactCount(n) : '—');

/** A person's App Mart profile: photo, name, creator code and their apps. No email, ever. */
export function ProfileSheet({ creatorId, onClose, onOpenApp, hideAndroid, onOpenFollowers }: {
  creatorId: string;
  onClose: () => void;
  onOpenApp: (app: { kind: 'web' | 'apk'; id: string }) => void;
  /** On an iPhone an .apk cannot install, so those apps are not listed (appStoreCompliance.ts). */
  hideAndroid: boolean;
  /** Your own profile only: open the list of who follows you. */
  onOpenFollowers?: () => void;
}) {
  const signedIn = useSignedIn();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Your own profile is editable in place — the same editor Settings → Profile uses (admin 2026-10-01).
  const [editing, setEditing] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    if (reloadTick === 0) setProfile(null);
    setError('');
    fetchProfile(creatorId).then(setProfile).catch((e) => setError(e instanceof Error ? e.message : 'This profile could not be loaded.'));
  }, [creatorId, reloadTick]);


  const apps = (profile?.apps ?? []).filter((a) => !(hideAndroid && a.kind === 'apk'));

  const toggleBlock = async () => {
    if (!profile) return;
    const next = !profile.blockedByMe;
    if (next && !window.confirm(`Block ${profile.person.name}? You will no longer see their comments, they will not notify you, and any follow between you ends.`)) return;
    setBusy(true);
    try {
      await setBlocked(profile.person.creatorId, next);
      // Blocking ends any follow between you (the server does it too); the screen must not keep saying "Following".
      setProfile({ ...profile, blockedByMe: next, follow: next && profile.follow ? { ...profile.follow, isFollowing: false } : profile.follow });
    } catch (e) {
      if (e instanceof SocialError && e.needsSignIn) askToSignIn();
      else setError(e instanceof Error ? e.message : 'That did not work.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="Profile" onClose={onClose}>
      {error && <p className="text-sm text-warn">{error}</p>}
      {!profile && !error && <p className="flex items-center gap-2 text-xs text-faint py-8 justify-center"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
      {profile && (
        <>
          <div className="flex flex-col items-center text-center">
            <Avatar person={profile.person} size={84} />
            <h3 className="mt-3 text-lg font-bold text-ink">{profile.person.name}</h3>
            <p className="text-[11px] font-mono text-faint" title="Creator code">{profile.person.creatorId}</p>
            {profile.bio && <p className="mt-2 text-sm text-body max-w-xs whitespace-pre-line">{profile.bio}</p>}
            {profile.isMe && !editing && (
              <button type="button" onClick={() => setEditing(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-xs font-semibold text-ink hover:bg-raised">
                <Pencil size={13} /> Edit profile
              </button>
            )}
            <div className="flex gap-5 mt-3">
              <div><p className="text-lg font-bold text-ink">{compactCount(apps.length)}</p><p className="text-[11px] text-muted">app{apps.length === 1 ? '' : 's'}</p></div>
              <div><p className="text-lg font-bold text-ink">{compactCount(apps.reduce((n, a) => n + (a.counts?.likes ?? 0), 0))}</p><p className="text-[11px] text-muted">likes</p></div>
              {profile.isMe && onOpenFollowers ? (
                <button type="button" onClick={onOpenFollowers} className="hover:underline" aria-label="See who follows you">
                  <p className="text-lg font-bold text-ink">{countLabel(profile.follow?.followers)}</p><p className="text-[11px] text-accent-text">followers</p>
                </button>
              ) : (
                <div><p className="text-lg font-bold text-ink">{countLabel(profile.follow?.followers)}</p><p className="text-[11px] text-muted">followers</p></div>
              )}
              <div><p className="text-lg font-bold text-ink">{countLabel(profile.follow?.following)}</p><p className="text-[11px] text-muted">following</p></div>
            </div>
            {!profile.isMe && !profile.blockedByMe && (
              <div className="mt-3">
                <FollowButton
                  creatorId={profile.person.creatorId}
                  initial={{ following: profile.follow?.isFollowing === true, isMe: profile.isMe }}
                  onChange={(r) => setProfile((p) => (p ? {
                    ...p,
                    follow: { followers: r.followers ?? p.follow?.followers ?? null, following: p.follow?.following ?? null, isFollowing: r.following },
                  } : p))}
                />
              </div>
            )}
            {signedIn && !profile.isMe && (
              <button type="button" onClick={() => void toggleBlock()} disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-xs font-semibold text-body hover:bg-raised disabled:opacity-50">
                <UserX size={13} /> {profile.blockedByMe ? 'Unblock' : 'Block'}
              </button>
            )}
            {profile.isMe && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted"><ShieldCheck size={12} /> This is how others see you. Your email is never shown.</p>
            )}
          </div>
          {profile.isMe && editing && (
            <div className="mt-4 p-4 rounded-2xl bg-card border border-line text-left">
              <ProfileEditForm
                idPrefix="app-mart-profile"
                // What the person saved — never the anonymous label the public sees when no name is set.
                initial={profile.mine ?? { displayName: '', bio: profile.bio ?? '', phone: '', photoUrl: profile.person.photoUrl }}
                onPhotoChange={() => setReloadTick((n) => n + 1)}
                onSaved={() => { setEditing(false); setReloadTick((n) => n + 1); }}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}

          <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-wider text-faint flex items-center gap-1.5"><Store size={12} /> Apps on App Mart</p>
          {apps.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">No apps on App Mart yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {apps.map((a) => (
                <button key={a.key} type="button" onClick={() => onOpenApp({ kind: a.kind, id: a.id })}
                  className="flex flex-col items-start gap-1.5 p-2.5 rounded-xl bg-card border border-line text-left hover:border-line">
                  <div className="w-11 h-11 rounded-xl bg-raised flex items-center justify-center overflow-hidden">
                    {a.iconDataUrl ? <img src={a.iconDataUrl} alt="" className="w-full h-full object-cover" /> : a.kind === 'web' ? <Globe size={18} className="text-faint" /> : <Package size={18} className="text-faint" />}
                  </div>
                  <p className="text-xs font-semibold text-ink line-clamp-2 w-full">{a.name}</p>
                  <p className="text-[10px] text-faint flex items-center gap-2">
                    <span className="flex items-center gap-0.5"><ThumbsUp size={10} /> {compactCount(a.counts?.likes)}</span>
                    <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {compactCount(a.counts?.comments)}</span>
                    <span>{a.kind === 'web' ? 'Instant' : 'Android'}</span>
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** The admin's queue of reported comments: remove it, or keep it and close the reports. */
export function CommentReportsAdmin({ onOpenProfile }: { onOpenProfile: (creatorId: string) => void }) {
  const [rows, setRows] = useState<CommentReportRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { fetchCommentReports().then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows || rows.length === 0) return null;
  const decide = async (r: CommentReportRow, remove: boolean) => {
    setBusy(r.id);
    try {
      if (remove) await removeComment(r.commentId); else await keepComment(r.commentId);
      setRows((rs) => (rs ?? []).filter((x) => x.commentId !== r.commentId));
    } catch { /* stays in the queue */ } finally { setBusy(''); }
  };
  return (
    <div className="mb-5">
      <p className="text-xs font-bold uppercase tracking-wider text-danger mb-2 flex items-center gap-1.5">
        <Flag size={12} /> Reported comments ({rows.length})
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="p-3 rounded-xl bg-card border border-line">
            <div className="flex items-center gap-2 text-xs">
              <Avatar person={r.author} size={24} />
              <PersonName person={r.author} onOpen={onOpenProfile} />
              <span className="ml-auto text-faint">{new Date(r.at).toLocaleDateString()}</span>
            </div>
            <p className="text-sm text-body mt-1.5 whitespace-pre-wrap break-words">{r.text || '—'}</p>
            <p className="text-[11px] text-faint mt-1">On “{r.appName}” · reason: {r.reason}</p>
            <div className="flex gap-2 mt-2.5">
              <button type="button" disabled={busy === r.id} onClick={() => void decide(r, true)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-[11px] text-on-accent font-semibold">Remove comment</button>
              <button type="button" disabled={busy === r.id} onClick={() => void decide(r, false)}
                className="px-3 py-1.5 rounded-lg bg-raised hover:bg-raised-hover disabled:opacity-40 text-[11px] text-body">Keep it</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
