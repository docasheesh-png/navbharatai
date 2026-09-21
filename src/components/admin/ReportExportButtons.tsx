// COPY / DOWNLOAD, ON THE CARD ITSELF.
//
// ADMIN 2026-09-21: *"un sab reports par direct copy/download option dedo, jisse woh report apko di
// jaye … aur sabhi report par bhi analysis kar ke download ya copy button bana do"*.
//
// WHY A PER-CARD CONTROL WHEN A FLOATING ONE ALREADY EXISTS. The floating `AdminCopyButton` copies
// the PAGE, as text, and that is the right answer for a page — see its header. But a data card is not
// a page: `pageSnapshot` walks the DOM and emits an OUTLINE, so a 30-row table, a 30-day series or a
// nested cost breakdown arrives flattened and unparseable, which is the exact defect
// `adminCopyPayload.ts` recorded for the build report and solved by giving THAT one a JSON path. A
// tab also holds several cards at once, so a page copy cannot say which one the admin means.
//
// 🔒 EVERY DECISION IS IN `reportExport.ts`, WHICH IS PURE. This file is the I/O half only: clipboard,
// blob, toast. That split is what lets the envelope, the filename and the native-download rule be
// unit-tested without a browser.
//
// 🔴 DOWNLOAD IS HIDDEN INSIDE THE ANDROID APP, DELIBERATELY. Capacitor's WebView implements neither
// the `download` attribute nor a `DownloadListener` (`MainActivity.java` registers three plugins and
// no download handler), so a blob click there returns silently and nothing is saved. Shipping a button
// that does nothing is the "built but not really working" state the second absolute rule forbids — so
// on a native shell there is Copy alone, and Copy genuinely works there (`copyTextToClipboard` keeps
// its `execCommand` fallback precisely for the WebView).

import { useCallback, useMemo, useState } from 'react';
import { Copy, Download, Check } from 'lucide-react';
import { copyTextToClipboard } from '../../lib/copyText';
import { isNativeShell, type NativeShellContext } from '../../lib/nativeShell';
import {
  downloadWorksHere, exportStatusText, reportExportText, reportFilename,
} from '../../lib/reportExport';

export interface ReportExportButtonsProps {
  /** The card's visible heading. It names the report in the envelope, the toast and the filename. */
  label: string;
  /** The card's OWN state — the parsed response it already holds. Never re-fetched, never scraped. */
  data: unknown;
  /** Which admin tab this card sits on. */
  tab?: string;
  /** The window the numbers cover, e.g. "last 30 days". */
  window?: string;
  /** The endpoint that produced it, so a reader can re-read it later. */
  source?: string;
  /** How the host reports success or failure. The admin panel passes its own toast. */
  onStatus?: (message: string) => void;
  /** Injected in tests. Production reads the real shell. */
  nativeOverride?: boolean;
}

/** How long the tick stays after a successful copy. */
const TICK_MS = 1800;

export function ReportExportButtons({
  label, data, tab, window: windowLabel, source, onStatus, nativeOverride,
}: ReportExportButtonsProps) {
  const [copied, setCopied] = useState(false);

  const isNative = useMemo(() => {
    if (typeof nativeOverride === 'boolean') return nativeOverride;
    // `isNativeShell` takes the context rather than reading a global, so it stays testable. On the
    // server (SSR of the render tests) there is no `window`, and "not a native app" is the right
    // answer there: those tests render for the web.
    if (typeof window === 'undefined') return false;
    return isNativeShell(window as unknown as Pick<NativeShellContext, 'Capacitor'>);
  }, [nativeOverride]);

  // The text is built ON PRESS, not on render: a card that refreshes every 30 seconds would otherwise
  // re-stringify its whole payload on every tick for a button nobody pressed.
  const buildText = useCallback(
    () => reportExportText({ label, data, tab, window: windowLabel, source, now: Date.now() }),
    [label, data, tab, windowLabel, source],
  );

  const say = useCallback((m: string) => { onStatus?.(m); }, [onStatus]);

  const onCopy = useCallback(async () => {
    const text = buildText();
    // An empty payload is a REFUSAL, not an empty copy — wiping the admin's clipboard is the failure
    // that looks exactly like success.
    if (!text) { say(`${label} has nothing to copy yet.`); return; }
    const ok = await copyTextToClipboard(text);
    say(exportStatusText(label, ok, 'copy'));
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), TICK_MS);
  }, [buildText, label, say]);

  const onDownload = useCallback(() => {
    const text = buildText();
    if (!text) { say(`${label} has nothing to download yet.`); return; }
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = reportFilename(label, Date.now());
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(exportStatusText(label, true, 'download'));
    } catch (e) {
      console.error(e);
      say(exportStatusText(label, false, 'download'));
    }
  }, [buildText, label, say]);

  const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-line text-[10px] '
    + 'font-bold text-muted hover:text-ink hover:border-accent-text/40 transition-colors';

  return (
    // `data-nb-no-copy` so the floating page copy does not echo these controls back as page content.
    <span className="inline-flex items-center gap-1 shrink-0" data-nb-no-copy="">
      <button type="button" onClick={() => void onCopy()} className={btn} title={`Copy ${label} as JSON`}>
        {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {downloadWorksHere(isNative) ? (
        <button type="button" onClick={onDownload} className={btn} title={`Download ${label} as JSON`}>
          <Download className="w-3 h-3" />
          Download
        </button>
      ) : null}
    </span>
  );
}

export default ReportExportButtons;
