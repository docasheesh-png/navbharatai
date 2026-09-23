// THE FLOATING COPY BUTTON ON EVERY ADMIN PAGE.
//
// ADMIN 2026-09-14: *"admin panel me ek floating 'copy' button bana — x(close) button ke sath. jab
// chahe admin kisi bhi page par ho. waha ek floting 'copy' button dikhe. (moving — finger se kahi bhi
// khiska sake, aur x(close) kar sake) … pure page ka … pure 100% pages ko. woh page mai apko bhejunga,
// aur aap waha jo bhi problem ho, woh solve karoge!"*
//
// It sits above every admin tab, drags with a finger or a mouse to anywhere on the screen, remembers
// where it was put, and closes. One press copies the whole page.
//
// 🔵 IT COPIES JSON WHEN A BUILD REPORT IS OPEN (admin 2026-09-17: *"jab build report copy ki jaye to
// json formate me hi copy ho. abhi text me copy ho rahi hai."*). The page-text copy below is right for
// an ordinary admin screen and wrong for a 153-issue report, which a DOM outline flattens into
// something unparseable. See `adminCopyPayload.ts`. Everywhere else, the paragraph below still stands.
//
// 🔴 WHAT IT COPIES OTHERWISE IS TEXT, AND THAT IS THE POINT, NOT A SHORTFALL. The reasoning lives in
// `pageSnapshot.ts` — in short, a browser cannot photograph its own window, the libraries that claim
// to REDRAW the page instead (a refusal `ReportSheet.tsx` already recorded), and `getDisplayMedia`
// prompts every time and does not exist in the Android WebView. A text copy works on 100% of pages on
// every device with no prompt, and carries more of what a fix needs than a picture does. The phone's
// own screenshot button is still the right tool for a purely visual complaint.
//
// 🔒 IT COPIES `document.body`, NOT THE TAB'S CONTAINER. An open dialog, a toast and a sheet are all
// portalled to the body, so they are genuinely part of what the admin is looking at — a copy that
// silently omitted the dialog they are complaining about would be the worst kind of wrong. This
// component's own markup carries `data-nb-no-copy` so it never copies itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, X, Check, AlertTriangle } from 'lucide-react';
import { defaultPosition } from '../../lib/floatingButtonPosition';
import { useDraggableFloat } from '../../hooks/useDraggableFloat';
import { formatPageSnapshot, outlinePage } from '../../lib/pageSnapshot';
import { collectDiagnostics, describeOverflow } from '../../lib/reportDiagnostics';
import { recentErrors } from '../../lib/recentErrors';
import { nativeAppBuild } from '../../lib/appBuildId';
import { copyTextToClipboard } from '../../lib/copyText';
import { chooseAdminCopyPayload, copyStatusText, type AdminCopyCandidates } from '../../lib/adminCopyPayload';

/** Survives a tab switch and a reload; per-browser, and nothing but two numbers. */
export const COPY_BUTTON_POSITION_KEY = 'nbai.admin.copyButton.pos';

/** Long enough to read, short enough not to sit over the page. */
const STATUS_MS = 3200;

type Status = null | { ok: boolean; text: string };

export interface AdminCopyButtonProps {
  /** The tab the admin is on — it names the page at the top of the copy. */
  pageLabel: string;
  /**
   * JSON the open view says should be copied INSTEAD of the page text (admin 2026-09-17: "jab build
   * report copy ki jaye to json formate me hi copy ho"). Omitted/null ⇒ today's page-text copy,
   * byte-identical. See `adminCopyPayload.ts` for why this is registered rather than scraped.
   */
  jsonPayload?: AdminCopyCandidates | null;
}

export function AdminCopyButton({ pageLabel, jsonPayload }: AdminCopyButtonProps) {
  const [hidden, setHidden] = useState(false);
  const [closedNote, setClosedNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  // The drag, the clamp on every position, the remembered spot and the tap-vs-drag decision are the
  // shared hook (2026-09-22) — the same mechanics the Focus Mode exit button uses, not a second copy.
  const copyPageRef = useRef<() => void>(() => {});
  const { pos, dragging, shellRef, handlers } = useDraggableFloat({
    storageKey: COPY_BUTTON_POSITION_KEY,
    fallbackSize: { width: 56, height: 56 },
    initialPosition: defaultPosition,
    onTap: () => copyPageRef.current(),
  });

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), STATUS_MS);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (!closedNote) return;
    const t = setTimeout(() => setClosedNote(false), 5000);
    return () => clearTimeout(t);
  }, [closedNote]);

  const copyPage = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // A BUILD REPORT WINS OVER THE PAGE TEXT. Checked first so a report that is open is never
      // flattened into a DOM outline — but it does NOT skip the page read below, because the report's
      // own JSON is what gets copied only when there genuinely is one.
      const payload = chooseAdminCopyPayload(jsonPayload ?? {});
      if (payload) {
        const okJson = await copyTextToClipboard(payload.json);
        setStatus(okJson
          ? { ok: true, text: copyStatusText(payload, 0) }
          : { ok: false, text: 'The browser refused the clipboard. Try again with the window focused.' });
        return;
      }

      // READ THE PAGE FIRST, ANSWER AFTERWARDS. Everything below is measured from the page as it is at
      // the moment of the press — a value cached at mount would describe a screen the admin has since
      // navigated away from, and would be impossible to tell apart from the real one in the paste.
      const seen = collectDiagnostics(window);
      const outline = outlinePage(document.body);
      const appBuild = await nativeAppBuild();
      const text = formatPageSnapshot({
        page: pageLabel,
        capturedAt: new Date().toISOString(),
        frontendBuild: (() => { try { return typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''; } catch { return ''; } })(),
        appBuild,
        viewport: seen.viewport,
        dpr: seen.dpr,
        platform: (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() || 'web',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        language: seen.language,
        online: seen.online,
        connection: seen.connection,
        overflowLine: describeOverflow({
          scanned: seen.overflowScanned ?? false,
          truncated: seen.overflowTruncated ?? false,
          findings: seen.overflow ?? [],
        }),
        errors: recentErrors(),
        outline,
      });
      const ok = await copyTextToClipboard(text);
      // 🔒 THE HONEST REPORT. `copyTextToClipboard` returns false when the browser refused, and a
      // "Copied!" over a refusal is exactly the fake success this repo forbids — the admin would paste
      // their old clipboard and never know why the page did not match.
      setStatus(ok
        ? { ok: true, text: copyStatusText(null, outline.lines.length) }
        : { ok: false, text: 'The browser refused the clipboard. Try again with the window focused.' });
    } catch {
      setStatus({ ok: false, text: 'Could not read this page. Nothing was copied.' });
    } finally {
      setBusy(false);
    }
  }, [busy, pageLabel, jsonPayload]);
  copyPageRef.current = () => { void copyPage(); };

  if (typeof document === 'undefined') return null;

  if (hidden) {
    return closedNote
      ? createPortal(
          <div
            data-nb-no-copy=""
            className="nb-float-bottom fixed left-1/2 -translate-x-1/2 z-[70] bg-card border border-line text-body px-4 py-2 rounded-xl text-xs font-bold shadow-2xl"
          >
            Copy button hidden — reload the admin panel to bring it back.
          </div>,
          document.body,
        )
      : null;
  }

  if (!pos) return null;

  return createPortal(
    <div
      data-nb-no-copy=""
      className="fixed z-[70] select-none"
      style={{ left: `${pos.x}px`, top: `${pos.y}px`, touchAction: 'none' }}
    >
      {status && (
        <div
          className={`absolute bottom-full right-0 mb-2 w-60 px-3 py-2 rounded-xl text-[11px] font-bold shadow-2xl border ${
            status.ok
              ? 'bg-emerald-950 border-emerald-500/40 text-success'
              : 'bg-red-950 border-red-500/40 text-danger'
          }`}
        >
          <span className="flex items-start gap-2">
            {status.ok ? <Check className="w-3.5 h-3.5 mt-px shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />}
            <span>{status.text}</span>
          </span>
        </div>
      )}

      <div
        ref={shellRef}
        role="button"
        tabIndex={0}
        aria-label="Copy this admin page"
        title="Drag to move · press to copy the whole page"
        {...handlers}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void copyPage(); } }}
        className={`w-14 h-14 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-on-accent shadow-2xl border border-line flex items-center justify-center cursor-grab ${
          dragging ? 'cursor-grabbing scale-105' : ''
        } ${busy ? 'opacity-70' : ''} transition-transform`}
      >
        <Copy className="w-6 h-6" />
      </div>

      <button
        type="button"
        aria-label="Hide the copy button"
        title="Hide until the admin panel is reloaded"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setHidden(true); setClosedNote(true); }}
        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-raised border border-line text-on-accent hover:text-on-accent hover:bg-red-600 flex items-center justify-center shadow-lg"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>,
    document.body,
  );
}
