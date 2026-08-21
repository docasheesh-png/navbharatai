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
//   3. WE ATTACH THE FACTS THE USER SHOULD NOT HAVE TO TYPE — which screen they were on, the build,
//      the platform. Most reports say "it doesn't work"; the context is what makes those actionable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Image as ImageIcon, Check, Loader2 } from 'lucide-react';
import { authedHeaders } from '../App';
import { MESSAGE_MAX, type ReportTargetKind } from '../lib/userReport';
import { compressForReport } from '../lib/reportImage';

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

export function ReportSheet({ open, onClose, target, view }: ReportSheetProps) {
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // A fresh sheet every time it opens: a half-typed complaint from an hour ago is not what the user
  // means to send now.
  useEffect(() => {
    if (open) { setMessage(''); setShot(''); setNote(''); setDone(false); }
  }, [open]);

  const pick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setNote('');
    const r = await compressForReport(file);
    if (!r.ok) { setNote(r.error || 'That image could not be used.'); return; }
    setShot(r.dataUrl || '');
  }, []);

  const send = useCallback(async () => {
    if (busy || message.trim().length < 5) return;
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: message.trim(),
          targetKind: target?.kind ?? 'bug',
          ...(target?.id ? { targetId: target.id } : {}),
          ...(shot ? { screenshot: shot } : {}),
          context: {
            view: view || '',
            platform: (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() || 'web',
            userAgent: navigator.userAgent,
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
  }, [busy, message, shot, target, view, onClose]);

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
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              rows={4}
              autoFocus
              placeholder="What happened? Even one line helps."
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
              disabled={busy || message.trim().length < 5}
              className="mt-4 w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <p className="mt-2 text-[10px] text-zinc-600 leading-relaxed">
              We attach the screen you were on and your device type so the problem can be found. Nothing
              else is collected.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default ReportSheet;
