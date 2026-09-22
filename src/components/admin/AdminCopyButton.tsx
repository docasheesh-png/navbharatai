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
import {
  clampPosition, defaultPosition, isTap, parsePosition, serializePosition,
  type Point,
} from '../../lib/floatingButtonPosition';
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
  const [pos, setPos] = useState<Point | null>(null);
  const [hidden, setHidden] = useState(false);
  const [closedNote, setClosedNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [dragging, setDragging] = useState(false);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number; at: number } | null>(null);

  const size = useCallback(() => {
    const r = shellRef.current?.getBoundingClientRect();
    return { width: r?.width || 56, height: r?.height || 56 };
  }, []);

  // Where it starts: where the admin last left it, clamped to THIS screen. The clamp is what stops a
  // button parked in the corner of a laptop from being off-screen on a phone.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const s = { width: 56, height: 56 };
    let stored: Point | null = null;
    try { stored = parsePosition(window.localStorage?.getItem(COPY_BUTTON_POSITION_KEY)); } catch { stored = null; }
    setPos(stored ? clampPosition(stored, s, view) : defaultPosition(s, view));
  }, []);

  // A rotation or a resized window must never strand it off the edge.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setPos((p) => (p ? clampPosition(p, size(), { width: window.innerWidth, height: window.innerHeight }) : p));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [size]);

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

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!pos) return;
    const el = shellRef.current;
    try { el?.setPointerCapture(e.pointerId); } catch { /* capture is an optimisation, not a requirement */ }
    gesture.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, at: Date.now() };
    setDragging(true);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const view = { width: window.innerWidth, height: window.innerHeight };
    setPos(clampPosition(
      { x: g.originX + (e.clientX - g.startX), y: g.originY + (e.clientY - g.startY) },
      size(),
      view,
    ));
  }, [size]);

  const endGesture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDragging(false);
    try { shellRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    // A press and a drag end the same way, so the gesture itself decides which one happened.
    if (isTap(e.clientX - g.startX, e.clientY - g.startY, Date.now() - g.at)) { void copyPage(); return; }
    setPos((p) => {
      if (p) { try { window.localStorage?.setItem(COPY_BUTTON_POSITION_KEY, serializePosition(p)); } catch { /* private mode */ } }
      return p;
    });
  }, [copyPage]);

  if (typeof document === 'undefined') return null;

  if (hidden) {
    return closedNote
      ? createPortal(
          <div
            data-nb-no-copy=""
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-card border border-line text-body px-4 py-2 rounded-xl text-xs font-bold shadow-2xl"
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
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
