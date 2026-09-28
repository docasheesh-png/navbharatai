// "Report" on a piece of AI output — a picture the image generator made, or a reply an assistant wrote.
//
// WHY THIS EXISTS: Google Play rejected the Android update on 2026-09-28 under the Sexual Content and
// AI-Generated Content policies. Its own words: "We allow apps that prohibit and prevent the generation
// of Restricted Content AND contain in-app user reporting/flagging features." The first half is the
// Pollinations word scan (`server/lib/pollinationsGuard.ts`); this is the second half. The general
// "Report a problem" sheet could already carry a complaint, but nothing sat ON the content itself, so a
// reviewer looking at an offensive picture had no way to flag THAT picture without leaving it.
//
// What a report does, all real (second absolute rule):
//   1. It goes to the SAME admin inbox every other report reaches (`POST /api/report`, kind `ai`),
//      with the reason, the prompt or reply text, and — for a picture — the picture itself attached.
//   2. The flagged content is hidden on this screen at once (`onReported`), because the person who
//      flagged it asked not to see it, and waiting for an admin to agree would be the wrong way round.
//
// Sign-in is required by the route (a report nobody can be asked about is worth little); a signed-out
// person is told so in plain words rather than meeting a button that does nothing.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, X } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { compressForReport } from '../../lib/reportImage';
import { AI_REPORT_REASONS, aiReportMessage, type AiReportReason } from '../../lib/userReport';
import { dataUrlToBlob } from '../../lib/imageExport';

export interface ReportAiContentProps {
  /** A picture the image generator made, or an assistant's reply. */
  surface: 'image' | 'reply';
  /** The prompt behind the picture, or the reply's text. Sent so the admin can see what was flagged. */
  content?: string;
  /** For a picture: resolves to a data URL of it, attached to the report. Null ⇒ sent without it. */
  getImage?: () => Promise<string | null>;
  /** Called once the report is accepted — the host hides the content. */
  onReported?: () => void;
  /** Which screen, for the admin. */
  view?: string;
  /** The trigger button's classes; the default suits an action row of 36px buttons. */
  className?: string;
  /** The flag icon's size classes. */
  iconClassName?: string;
}

/** The picture as a Blob, or null — a picture that cannot be read is sent as text only, never faked. */
function pictureBlob(url: string | null): Blob | null {
  if (!url || !url.startsWith('data:')) return null;
  try { return dataUrlToBlob(url); } catch { return null; }
}

export function ReportAiContent({ surface, content, getImage, onReported, view, className, iconClassName }: ReportAiContentProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AiReportReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const what = surface === 'image' ? 'image' : 'reply';

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason('');
    setNote('');
    setError('');
  };

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError('');
    try {
      let screenshot = '';
      if (surface === 'image' && getImage) {
        const blob = pictureBlob(await getImage().catch(() => null));
        if (blob) {
          const r = await compressForReport(blob);
          if (r.ok && r.dataUrl) screenshot = r.dataUrl;
        }
      }
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          targetKind: 'ai',
          message: aiReportMessage({ surface, reason, note, content }),
          ...(screenshot ? { screenshot } : {}),
          context: { view: view || '' },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // The server's own reason — "Sign in to send a report." is the common one, and it is the
        // honest next step, so it is shown as it is.
        setError(data?.error || 'Could not send your report. Please try again.');
        return;
      }
      setSent(true);
      setOpen(false);
      onReported?.();
    } catch {
      setError('Could not send your report. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent && !onReported) {
    return <span className={`text-[10px] text-muted ${className ?? ''}`}>Reported — thank you</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Report this AI ${what}`}
        title={`Report this ${what}`}
        className={className ?? 'shrink-0 w-9 h-9 rounded-lg bg-raised border border-line text-muted hover:text-danger flex items-center justify-center transition-colors'}
      >
        <Flag className={iconClassName ?? 'w-3.5 h-3.5'} />
      </button>
      {/* PORTALLED, AND ON THE SHEET CONTRACT (`everyPopupClearsTheChrome.test.ts`). The button lives
          inside a chat bubble that animates with a transform, and a transformed ancestor becomes the
          containing block for `position: fixed` — so un-portalled, this sheet would open INSIDE the
          bubble. `nb-sheet-overlay` keeps it clear of the notch and the tab bar; `-over-nav` because
          z-400 paints above the bar's 150. No `p-*` on the overlay: it would cancel the contract. */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="nb-sheet-overlay nb-sheet-over-nav fixed inset-0 flex items-end sm:items-center justify-center bg-scrim sm:p-4"
          style={{ zIndex: 400 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Report this ${what}`}
          onClick={close}
        >
          <div
            className="nb-sheet w-full max-w-sm overflow-y-auto rounded-2xl border border-line bg-card text-body p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">Report this {what}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {onReported ? 'It will be hidden from you and sent to NavBharatAI for review.' : 'It will be sent to NavBharatAI for review.'}
                </p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="text-muted hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {AI_REPORT_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReason(r.id)}
                  aria-pressed={reason === r.id}
                  className={`text-left text-xs rounded-lg px-3 py-2 border transition-colors ${
                    reason === r.id ? 'border-accent bg-accent text-on-accent' : 'border-line bg-raised text-body'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Anything else? (optional)"
              className="w-full resize-none rounded-lg bg-well border border-line px-2 py-1.5 text-xs text-ink outline-none"
            />
            {error && <p className="text-[11px] text-danger">{error}</p>}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!reason || busy}
              className="w-full rounded-lg py-2 text-xs font-semibold bg-accent text-on-accent disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default ReportAiContent;
