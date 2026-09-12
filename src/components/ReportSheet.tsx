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
import { X, Send, Image as ImageIcon, Check, Loader2, MessageSquare } from 'lucide-react';
import { authedHeaders } from '../lib/authHeaders';
import {
  MESSAGE_MAX, PROBLEM_KINDS, REPLY_MAX, problemKindAsk, problemKindLabel, validateReplyPayload,
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

export function ReportSheet({ open, onClose, target, view }: ReportSheetProps) {
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
  }, [open]);

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
      className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: SHEET_Z, background: 'rgba(2,6,12,0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Report a problem"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="w-full sm:max-w-md bg-[#0d1117] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-white">Report a problem</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {target?.kind === 'app' ? 'About this app.' : target?.kind === 'user' ? 'About this person.' : 'Tell us what went wrong — a person reads every report.'}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-2 rounded-xl text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="py-8 text-center">
            <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white">Sent. Thank you.</p>
            <p className="text-[11px] text-zinc-500 mt-1">A person will read it.</p>
          </div>
        ) : (
          <>
            {/* YOUR EARLIER REPORTS, AND WHAT WE SAID BACK. Above the new-report form on purpose:
                somebody opening this sheet for the second time is usually here about the first one,
                and a reply they cannot find is a reply that was never sent. */}
            {/* ONE input, shared by every thread — only one is open at a time, and a picker per
                report would be a DOM node per report for no behaviour anyone can see. */}
            <input
              ref={replyFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickReplyShot(f); }}
            />

            {(mine?.length ?? 0) > 0 && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] font-semibold text-zinc-300 mb-2">Your earlier reports</p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {(mine ?? []).map((r) => {
                    const isOpen = openThread === r.id;
                    const fromUs = r.messages.filter((m) => m.from === 'admin').length;
                    return (
                      <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.03]">
                        <button
                          onClick={() => { setOpenThread(isOpen ? '' : r.id); setReply(''); setReplyShot(''); }}
                          className="w-full text-left px-3 py-2"
                          aria-expanded={isOpen}
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-[11px] text-zinc-300 flex-1 truncate">
                              {problemKindLabel(r.problemKind) || 'Problem'} — {r.message}
                            </span>
                            {fromUs > 0 && (
                              <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
                                <MessageSquare className="w-2.5 h-2.5" /> Reply
                              </span>
                            )}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="px-3 pb-3 space-y-2">
                            {r.messages.length === 0 ? (
                              <p className="text-[11px] text-zinc-500">
                                No reply yet. A person reads every report.
                              </p>
                            ) : (
                              r.messages.map((m, i) => (
                                <div
                                  key={`${m.at}-${i}`}
                                  className={`text-[11px] leading-relaxed rounded-xl px-3 py-2 ${
                                    m.from === 'admin'
                                      ? 'bg-indigo-500/10 border border-indigo-400/25 text-indigo-100'
                                      : 'bg-white/5 border border-white/10 text-zinc-200'
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
                                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white placeholder-zinc-600 outline-none focus:border-indigo-500/60 resize-none"
                              />
                              <button
                                onClick={() => void sendReply(r.id)}
                                /* A screenshot ALONE is a complete answer — on a layout complaint it
                                   is usually the whole answer — so an empty box with a picture
                                   attached must not be a dead button. */
                                disabled={replying || (reply.trim().length === 0 && !replyShot)}
                                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-[11px] font-bold text-white"
                              >
                                {replying ? '…' : 'Send'}
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => replyFileRef.current?.click()}
                                disabled={replying}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[10px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                              >
                                <ImageIcon className="w-3 h-3" /> {replyShot ? 'Change screenshot' : 'Add screenshot'}
                              </button>
                              {replyShot && (
                                <>
                                  <img src={replyShot} alt="Screenshot to send" className="w-7 h-7 rounded object-cover border border-white/10" />
                                  <button onClick={() => setReplyShot('')} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">Remove</button>
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

            {/* ONE TAP BEFORE THE BOX, and it is what makes the rest of the report legible.
                A real report read "App is not responsive and sometimes it does not work in Mobile
                phones" — which could be a layout bug, a hang, or a dead button, and we had no way to
                ask. The tap settles that before the ambiguity is created, and it changes the question
                the box asks so the answer lands on the right thing. */}
            <p className="text-[11px] font-semibold text-zinc-300 mb-2">What kind of problem is it?</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PROBLEM_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  aria-pressed={kind === k.id}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors ${
                    kind === k.id
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
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
              className="w-full bg-black/40 border border-white/10 rounded-2xl px-3.5 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500/60 resize-none"
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
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[11px] font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-40"
              >
                <ImageIcon className="w-3.5 h-3.5" /> {shot ? 'Change screenshot' : 'Add screenshot'}
              </button>
              {shot && (
                <>
                  <img src={shot} alt="Attached screenshot" className="w-9 h-9 rounded-lg object-cover border border-white/10" />
                  <button onClick={() => setShot('')} className="text-[11px] text-zinc-500 hover:text-zinc-300 underline">Remove</button>
                </>
              )}
            </div>

            {note && <p className="mt-3 text-[11px] text-amber-300 leading-relaxed">{note}</p>}

            <button
              onClick={() => void send()}
              disabled={busy || !kind || message.trim().length < 5}
              className="mt-4 w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {busy ? 'Sending…' : 'Send report'}
            </button>
            {/* 🔒 THIS LINE HAD TO CHANGE WITH THE CODE. It used to end with a flat claim that no
                other information was gathered — which stopped being true the moment the screen size,
                the build and the recent errors were attached. A promise that quietly goes stale is
                worse than no promise, so it now names what is actually sent, and nothing is sent that
                is not named here. Test-locked in `tests/reportCapture.test.ts`. */}
            <p className="mt-2 text-[10px] text-zinc-600 leading-relaxed">
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
