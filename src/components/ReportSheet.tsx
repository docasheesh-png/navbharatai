// "Something is wrong" — the one place a user says so, from anywhere in NavBharatAI.
//
// ADMIN 2026-08-21: report anything, anywhere, by shaking the phone, with a screenshot.
//
// THREE DEPARTURES FROM THE OBVIOUS BUILD, each one deliberate:
//
//   1. SHAKE IS NOT THE ONLY WAY IN. Nobody discovers an invisible gesture, and iOS refuses motion
//      access until the user grants it — so a shake-only feature would be unreachable for a large
//      share of the people who most need it. The same sheet opens from a visible menu entry; shake is
//      a shortcut for people who know it, not the door.
//   2. THE SCREENSHOT IS PICKED, NOT CAPTURED. Capturing the app's own screen needs either a native
//      plugin we do not ship or a DOM-painting library that renders the page WRONG often enough to
//      mislead the person reading the report. Attaching a real screenshot the user took is honest and
//      works everywhere. It is shrunk here so a report is never refused for being large.
//   3. WE ATTACH THE FACTS THE USER SHOULD NOT HAVE TO TYPE. Most reports say "it doesn't work"; the
//      context is what makes those actionable.
//
// ADMIN 2026-09-12, holding a report they could not act on — "App is not responsive and sometimes it
// does not work in Mobile phones. Some content goes outside the mobile." — *"problem hi samajh nahi aa
// rahi fix kya karu?"* Departure 3 was right and far too thin: we attached the screen name and the
// platform, and asked a non-technical person to supply the rest from memory. So the sheet now asks ONE
// tap for the KIND of problem (which decides the question the box asks), and measures for itself what
// it can see — screen size, which element reaches past the edge, the running build, and any error the
// browser had just recorded. The footer names every one of those, because the previous footer's
// promise stopped being true the moment this was added.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Image as ImageIcon, Check, Loader2, MessageSquare, ChevronLeft, AlertCircle } from 'lucide-react';
import { authedHeaders } from '../lib/authHeaders';
import {
  MESSAGE_MAX, PROBLEM_KINDS, REPLY_MAX, problemKindAsk, problemKindLabel, validateReplyPayload,
  hasUnreadAdminReply, unreadReportCount,
  type ProblemKind, type ReportMessage, type ReportTargetKind,
} from '../lib/userReport';
import { compressForReport } from '../lib/reportImage';
import { collectDiagnostics } from '../lib/reportDiagnostics';
import { ReportShot } from './ReportShot';
import { recentErrors } from '../lib/recentErrors';
import { nativeAppBuild } from '../lib/appBuildId';

/** Above the app, and above the App Mart player (which sits at 200) — see WebAppPlayer. */
const SHEET_Z = 400;

export interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the user is reporting. Defaults to a general problem report. */
  target?: { kind: ReportTargetKind; id?: string };
  /** The screen they were on, for the admin. */
  view?: string;
  /**
   * Which screen the sheet opens on.
   *
   * `list` is what a tapped "New message from NavBharatAI" notification passes: the person already
   * knows what they want, and making them pass through a menu to reach it is the notification failing
   * to do the one job it had. Everything else opens on the chooser.
   */
  initialMode?: 'choose' | 'list';
}

/** One of the reporter's own reports, as `/api/report/mine` returns it (never the screenshot). */
interface MyReport {
  id: string;
  at: number;
  status: string;
  problemKind?: ProblemKind;
  message: string;
  messages: ReportMessage[];
}

/**
 * The three screens this sheet is, since 2026-09-17.
 *
 * ADMIN: *"jab user report a problem par click kare, to popup me 2 option dikhe"*. Before this, the
 * running conversations and the new-report form were stacked in ONE scroll — so somebody with three
 * open threads had to scroll past all of them to file a fourth, and somebody filing their first
 * report saw an empty list they had no use for. One sheet was doing two unrelated jobs.
 */
type SheetMode = 'choose' | 'new' | 'list';

export function ReportSheet({ open, onClose, target, view, initialMode }: ReportSheetProps) {
  const [mode, setMode] = useState<SheetMode>('choose');
  const [kind, setKind] = useState<ProblemKind | ''>('');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  /**
   * THE CONVERSATIONS ALREADY RUNNING (admin 2026-09-12, the other half of "jisse uski help ho sake").
   *
   * They live at the TOP of this sheet rather than behind a separate screen, because the moment a
   * person wants to talk to us about a problem is the moment they open this — asking them to find a
   * second place is how an answer goes unread and the reporter concludes nobody listened.
   */
  const [mine, setMine] = useState<MyReport[] | null>(null);
  const [openThread, setOpenThread] = useState<string>('');
  const [reply, setReply] = useState('');
  const [replyShot, setReplyShot] = useState('');
  const [replying, setReplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

  /**
   * How many conversations carry a reply this person has not seen — the number behind the dot on the
   * "Old reports" door. Derived from `mine` with the SAME function the sidebar and each row use, so
   * the three dots cannot disagree with one another.
   */
  const unread = unreadReportCount(mine ?? []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // A fresh sheet every time it opens: a half-typed complaint from an hour ago is not what the user
  // means to send now.
  useEffect(() => {
    if (open) {
      setKind(''); setMessage(''); setShot(''); setNote(''); setDone(false);
      setOpenThread(''); setReply(''); setReplyShot(''); setMine(null);
      // A sheet opened ABOUT something (an app, a person) is already a decision — showing a menu
      // whose two answers are "the thing you just chose" and "something else" is a step for nobody.
      setMode(target ? 'new' : (initialMode ?? 'choose'));
      void (async () => {
        try {
          const res = await fetch('/api/report/mine', { headers: await authedHeaders() });
          const data = await res.json().catch(() => null);
          // An empty list and a failed fetch are BOTH rendered as "nothing here" — but only the empty
          // list is true, so a failure leaves `mine` as [] rather than inventing a cheerful state.
          setMine(Array.isArray(data?.reports) ? (data.reports as MyReport[]) : []);
        } catch {
          setMine([]);
        }
      })();
    }
  }, [open, target, initialMode]);

  /**
   * OPEN ONE CONVERSATION, AND MARK IT SEEN.
   *
   * ⚠️ THE DOT CLEARS ON *OPEN*, NEVER ON FETCH. Clearing it when the list loads would mean somebody
   * who glances at the menu and taps away has silently "read" a reply they never saw — and that reply
   * is then invisible for ever, with nothing to bring it back. The dot must survive everything except
   * the conversation being on screen.
   *
   * The local state is updated OPTIMISTICALLY and the server is told in the background: the person is
   * looking at the message, so the dot going out is a statement about what is on their screen, not
   * about whether a POST succeeded. A failed write simply means the dot returns on the next open —
   * which is the safe direction, since it shows a message again rather than hiding one.
   */
  const openReport = useCallback((reportId: string) => {
    setOpenThread(reportId);
    setReply(''); setReplyShot(''); setNote('');
    // Stamped locally with a value that is certainly past the last message shown; the SERVER writes
    // its own clock, and that is the one the next fetch will carry.
    setMine((prev) => (prev ?? []).map((r) => (r.id === reportId ? { ...r, reporterReadAt: Date.now() } : r)));
    void (async () => {
      try {
        await fetch(`/api/report/${encodeURIComponent(reportId)}/read`, {
          method: 'POST', headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        });
      } catch { /* best-effort: the dot comes back next time, which is the safe way to be wrong */ }
    })();
  }, []);

  /** The SAME compression path the first report uses — one rule, so one can never accept what the other refuses. */
  const pickReplyShot = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setNote('');
    const r = await compressForReport(file);
    if (!r.ok) { setNote(r.error || 'That image could not be used.'); return; }
    setReplyShot(r.dataUrl || '');
  }, []);

  const sendReply = useCallback(async (reportId: string) => {
    const parsed = validateReplyPayload(reply, replyShot);
    if (parsed.ok !== true) { setNote(parsed.error); return; }
    if (replying) return;
    setReplying(true);
    setNote('');
    try {
      const res = await fetch(`/api/report/${encodeURIComponent(reportId)}/reply`, {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: parsed.text, ...(parsed.screenshot ? { screenshot: parsed.screenshot } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setNote(data?.error || 'Could not send that. Please try again.'); return; }
      // The server returns the WHOLE thread, so the screen shows what was actually stored rather
      // than what we hoped was stored — the difference matters the one time a write is dropped.
      setMine((prev) => (prev ?? []).map((r) => (r.id === reportId ? { ...r, messages: data.messages as ReportMessage[] } : r)));
      setReply('');
      setReplyShot('');
      // 🔒 SAID OUT LOUD WHEN THE PICTURE DID NOT MAKE IT. The text is saved either way; letting the
      // person believe their screenshot went through when it did not is how they stop trusting the
      // channel — and a screenshot is usually the part that was going to answer the question.
      if (replyShot && data?.imageSaved === false) {
        setNote('Your message was sent, but the screenshot could not be attached. You can try adding it again.');
      }
    } catch {
      setNote('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setReplying(false);
    }
  }, [reply, replyShot, replying]);

  const pick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setNote('');
    const r = await compressForReport(file);
    if (!r.ok) { setNote(r.error || 'That image could not be used.'); return; }
    setShot(r.dataUrl || '');
  }, []);

  const send = useCallback(async () => {
    if (busy || !kind || message.trim().length < 5) return;
    setBusy(true);
    setNote('');
    try {
      // MEASURED HERE, NOT EARLIER. The scan has to see the page as it is at the moment the person
      // decided something was wrong — a value captured when the sheet mounted would describe the
      // screen underneath the sheet a second ago, which is not quite the same page and would be
      // impossible to tell apart from the real one afterwards.
      const seen = collectDiagnostics(window);
      const errors = recentErrors();
      const appBuild = await nativeAppBuild();
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: message.trim(),
          problemKind: kind,
          targetKind: target?.kind ?? 'bug',
          ...(target?.id ? { targetId: target.id } : {}),
          ...(shot ? { screenshot: shot } : {}),
          context: {
            view: view || '',
            platform: (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() || 'web',
            userAgent: navigator.userAgent,
            // Which frontend this person is running. On the bundled Android app this is the ONLY way
            // to tell a current install from one that shipped months ago — and a stale bundle is
            // itself a common cause of "it doesn't work for me".
            build: (() => { try { return typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''; } catch { return ''; } })(),
            ...(appBuild ? { appBuild } : {}),
            ...seen,
            ...(errors.length ? { errors } : {}),
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // THE SERVER'S OWN REASON, SHOWN. The old app-report swallowed every failure, so a signed-out
        // user pressed Send and nothing happened at all — which is exactly what a fake button looks
        // like.
        setNote(data?.error || 'Could not send your report. Please try again.');
        return;
      }
      setDone(true);
      setTimeout(() => { onClose(); }, 1500);
    } catch {
      setNote('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, kind, message, shot, target, view, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      // THE SHEET CONTRACT (index.css), added 2026-09-22 after measuring this dialog at nine
      // viewport/notch combinations. `-flush` because this is an edge-to-edge phone bottom sheet;
      // `-over-nav` because SHEET_Z (400) paints ABOVE the tab bar's z-150, so it covers the bar
      // rather than being covered by it and must NOT hold a strip for a bar nobody can see.
      // ⚠️ `p-0` is gone on purpose: a `p-*` utility beats the overlay class on source order and
      // silently zeroes all four reserves — that exact bug was live in NavAppStore's two sheets.
      className="nb-sheet-overlay-flush nb-sheet-over-nav fixed inset-0 flex items-end sm:items-center justify-center sm:p-4"
      style={{ zIndex: SHEET_Z, background: 'rgba(2,6,12,0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Report a problem"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        // `nb-sheet` is the other half of the pair: it caps the card at the room the overlay really
        // has, so the Old-reports list cannot grow past the screen. Without it this sheet had NO
        // height limit at all — a long conversation simply ran off the bottom.
        // ⚠️ The card's own `env(safe-area-inset-bottom)` padding is GONE because the overlay now
        // reserves that inset; keeping both would leave a double gap under the buttons.
        className="nb-sheet w-full sm:max-w-md bg-surface border border-line rounded-t-3xl sm:rounded-3xl p-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2 min-w-0">
            {/* BACK, not a second close. Inside a conversation the back arrow returns to the list and
                the list returns to the chooser — so a person who taps the wrong thing is one gesture
                from where they meant to be, instead of having to reopen the whole sheet.
                It is hidden when `target` sent us straight to the form: there is nothing behind it. */}
            {!target && (mode !== 'choose' || openThread) && (
              <button
                onClick={() => { if (openThread) setOpenThread(''); else setMode('choose'); }}
                disabled={busy}
                aria-label="Back"
                className="p-2 -ml-2 rounded-xl text-muted hover:bg-raised hover:text-ink disabled:opacity-40 shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-ink truncate">
                {openThread ? 'Your report' : mode === 'list' ? 'Your reports' : 'Report a problem'}
              </h2>
              <p className="text-[11px] text-faint mt-0.5">
                {target?.kind === 'app' ? 'About this app.'
                  : target?.kind === 'user' ? 'About this person.'
                  : openThread ? 'NavBharatAI replies here.'
                  : mode === 'list' ? 'Your reports and our replies.'
                  : mode === 'new' ? 'Tell us what went wrong — a person reads every report.'
                  : 'A person reads every report.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-2 rounded-xl text-faint hover:bg-raised hover:text-ink disabled:opacity-40 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="py-8 text-center">
            <Check className="w-8 h-8 text-success mx-auto mb-2" />
            <p className="text-sm font-semibold text-ink">Sent. Thank you.</p>
            <p className="text-[11px] text-faint mt-1">A person will read it.</p>
          </div>
        ) : mode === 'choose' ? (
          /* ── THE TWO DOORS ──────────────────────────────────────────────────────────────────────
             ADMIN 2026-09-17: *"popup me 2 option dikhe, 1. report new problem, 2- old report"*.
             Filing a complaint and reading an answer are different errands, and stacking them in one
             scroll made each one get in the other's way — somebody with three open threads scrolled
             past all of them to file a fourth, and a first-time reporter met an empty list they had
             no use for. */
          <div className="space-y-2.5">
            <button
              onClick={() => setMode('new')}
              className="w-full flex items-center gap-3 p-4 rounded-2xl border border-line bg-raised hover:bg-raised-hover text-left transition-colors"
            >
              <span className="shrink-0 w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-400/25 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-accent-text" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">Report a new problem</span>
                <span className="block text-[11px] text-faint mt-0.5">Something went wrong — tell us what.</span>
              </span>
            </button>

            <button
              onClick={() => setMode('list')}
              className="w-full flex items-center gap-3 p-4 rounded-2xl border border-line bg-raised hover:bg-raised-hover text-left transition-colors"
            >
              <span className="shrink-0 w-9 h-9 rounded-xl bg-raised border border-line flex items-center justify-center relative">
                <MessageSquare className="w-4 h-4 text-muted" />
                {/* 🟢 THE SECOND OF THE THREE DOTS. Same rule as the sidebar's and the row's — all
                    three read `hasUnreadAdminReply`, so a dot here can never lead to a list with
                    nothing marked in it. That mismatch is precisely how people learn to ignore dots. */}
                {unread > 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0d1117]"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">
                  Old reports
                  {unread > 0 && (
                    <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-widest text-success">
                      {unread} new
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-faint mt-0.5">
                  {mine === null ? 'Loading…'
                    : mine.length === 0 ? 'You have not reported anything yet.'
                    : unread > 0 ? 'NavBharatAI has replied.'
                    : `${mine.length} report${mine.length === 1 ? '' : 's'} · your conversations.`}
                </span>
              </span>
            </button>
          </div>
        ) : mode === 'list' ? (
          <>
            {/* YOUR EARLIER REPORTS, AND WHAT WE SAID BACK. Its own screen since 2026-09-17 — see the
                chooser above for why it stopped sharing one with the form. */}
            {/* ONE input, shared by every thread — only one is open at a time, and a picker per
                report would be a DOM node per report for no behaviour anyone can see. */}
            <input
              ref={replyFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickReplyShot(f); }}
            />

            {mine === null ? (
              <p className="py-8 text-center text-[11px] text-faint">Loading your reports…</p>
            ) : mine.length === 0 ? (
              <div className="py-8 text-center">
                <MessageSquare className="w-7 h-7 text-faint mx-auto mb-2" />
                <p className="text-sm font-semibold text-muted">Nothing here yet</p>
                <p className="text-[11px] text-faint mt-1">Reports you send will appear here with our replies.</p>
                <button
                  onClick={() => setMode('new')}
                  className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[12px] font-bold text-on-accent"
                >
                  Report a problem
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-line bg-well p-3">
                <div className="space-y-1.5 max-h-[60vh] supports-[height:100dvh]:max-h-[60dvh] overflow-y-auto">
                  {(mine ?? []).map((r) => {
                    const isOpen = openThread === r.id;
                    // 🟢 THE THIRD DOT, and the reason the old badge was replaced. The chip here used
                    // to appear whenever ANY admin message existed (`fromUs > 0`) — which says "a
                    // reply arrived once", never "a reply is NEW", and so it could never go out.
                    // `hasUnreadAdminReply` is the same rule the sidebar and the chooser use.
                    const isUnread = hasUnreadAdminReply(r);
                    return (
                      <div key={r.id} className={`rounded-xl border bg-raised ${isUnread ? 'border-emerald-400/40' : 'border-line'}`}>
                        <button
                          onClick={() => { if (isOpen) setOpenThread(''); else openReport(r.id); }}
                          className="w-full text-left px-3 py-2.5"
                          aria-expanded={isOpen}
                        >
                          <span className="flex items-center gap-2">
                            {isUnread && (
                              <span aria-hidden className="shrink-0 w-2 h-2 rounded-full bg-emerald-400" />
                            )}
                            <span className={`text-[11px] flex-1 truncate ${isUnread ? 'text-ink font-semibold' : 'text-muted'}`}>
                              {problemKindLabel(r.problemKind) || 'Problem'} — {r.message}
                            </span>
                            {isUnread && (
                              <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-success">
                                <MessageSquare className="w-2.5 h-2.5" /> New
                              </span>
                            )}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="px-3 pb-3 space-y-2">
                            {r.messages.length === 0 ? (
                              <p className="text-[11px] text-faint">
                                No reply yet. A person reads every report.
                              </p>
                            ) : (
                              r.messages.map((m, i) => (
                                <div
                                  key={`${m.at}-${i}`}
                                  className={`text-[11px] leading-relaxed rounded-xl px-3 py-2 ${
                                    m.from === 'admin'
                                      ? 'bg-indigo-500/10 border border-indigo-400/25 text-accent-text'
                                      : 'bg-raised border border-line text-body'
                                  }`}
                                >
                                  {/* 🔒 WHITE-LABEL LAW: to the user this is always NavBharatAI.
                                      Never an admin's name, never an email, never who answered. */}
                                  <span className="block text-[9px] uppercase tracking-widest font-black opacity-60 mb-0.5">
                                    {m.from === 'admin' ? 'NavBharatAI' : 'You'}
                                  </span>
                                  {m.text}
                                  {m.shotId && (
                                    <ReportShot
                                      src={`/api/report/${encodeURIComponent(r.id)}/shot/${encodeURIComponent(m.shotId)}`}
                                      headers={() => authedHeaders()}
                                      alt={m.from === 'admin' ? 'Screenshot from NavBharatAI' : 'Screenshot you sent'}
                                    />
                                  )}
                                </div>
                              ))
                            )}

                            <div className="flex items-end gap-2">
                              <textarea
                                value={reply}
                                onChange={(e) => setReply(e.target.value.slice(0, REPLY_MAX))}
                                rows={2}
                                placeholder="Answer here…"
                                className="flex-1 bg-well border border-line rounded-xl px-3 py-2 text-[12px] text-ink placeholder-faint outline-none focus:border-indigo-500/60 resize-none"
                              />
                              <button
                                onClick={() => void sendReply(r.id)}
                                /* A screenshot ALONE is a complete answer — on a layout complaint it
                                   is usually the whole answer — so an empty box with a picture
                                   attached must not be a dead button. */
                                disabled={replying || (reply.trim().length === 0 && !replyShot)}
                                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-[11px] font-bold text-on-accent"
                              >
                                {replying ? '…' : 'Send'}
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => replyFileRef.current?.click()}
                                disabled={replying}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-raised text-[10px] font-semibold text-muted hover:bg-raised-hover disabled:opacity-40"
                              >
                                <ImageIcon className="w-3 h-3" /> {replyShot ? 'Change screenshot' : 'Add screenshot'}
                              </button>
                              {replyShot && (
                                <>
                                  <img src={replyShot} alt="Screenshot to send" className="w-7 h-7 rounded object-cover border border-line" />
                                  <button onClick={() => setReplyShot('')} className="text-[10px] text-faint hover:text-muted underline">Remove</button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {note && <p className="mt-3 text-[11px] text-warn leading-relaxed">{note}</p>}
          </>
        ) : (
          <>
            {/* ONE TAP BEFORE THE BOX, and it is what makes the rest of the report legible.
                A real report read "App is not responsive and sometimes it does not work in Mobile
                phones" — which could be a layout bug, a hang, or a dead button, and we had no way to
                ask. The tap settles that before the ambiguity is created, and it changes the question
                the box asks so the answer lands on the right thing. */}
            <p className="text-[11px] font-semibold text-muted mb-2">What kind of problem is it?</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PROBLEM_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  aria-pressed={kind === k.id}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors ${
                    kind === k.id
                      ? 'bg-indigo-600 border-indigo-500 text-on-accent'
                      : 'bg-raised border-line text-muted hover:bg-raised-hover'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              rows={4}
              autoFocus
              placeholder={kind ? problemKindAsk(kind) : 'Pick one above, then tell us what happened.'}
              className="w-full bg-well border border-line rounded-2xl px-3.5 py-3 text-sm text-ink placeholder-faint outline-none focus:border-indigo-500/60 resize-none"
            />

            <div className="flex items-center gap-2 mt-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line bg-raised text-[11px] font-semibold text-body hover:bg-raised-hover disabled:opacity-40"
              >
                <ImageIcon className="w-3.5 h-3.5" /> {shot ? 'Change screenshot' : 'Add screenshot'}
              </button>
              {shot && (
                <>
                  <img src={shot} alt="Attached screenshot" className="w-9 h-9 rounded-lg object-cover border border-line" />
                  <button onClick={() => setShot('')} className="text-[11px] text-faint hover:text-muted underline">Remove</button>
                </>
              )}
            </div>

            {note && <p className="mt-3 text-[11px] text-warn leading-relaxed">{note}</p>}

            <button
              onClick={() => void send()}
              disabled={busy || !kind || message.trim().length < 5}
              className="mt-4 w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-on-accent flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {busy ? 'Sending…' : 'Send report'}
            </button>
            {/* 🔒 THIS LINE HAD TO CHANGE WITH THE CODE. It used to end with a flat claim that no
                other information was gathered — which stopped being true the moment the screen size,
                the build and the recent errors were attached. A promise that quietly goes stale is
                worse than no promise, so it now names what is actually sent, and nothing is sent that
                is not named here. Test-locked in `tests/reportCapture.test.ts`. */}
            <p className="mt-2 text-[10px] text-faint leading-relaxed">
              So the problem can be found without asking you for details, we attach: the screen you were
              on, your screen size, your device and app version, whether you were online, and any error
              messages your browser had just recorded. No page content, and nothing you typed elsewhere.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default ReportSheet;
