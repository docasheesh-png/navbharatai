// The Download card under a chat reply that made a spreadsheet (server: AgentV3/spreadsheetTurn.ts).
//
// HOW A PRESS BECOMES A FILE — the App Mart download's proven shape, for the same two reasons:
//   1. An ordinary fetch asks the server for a short-lived signed link. It is the only step that can
//      carry the sign-in token, and the server checks the file is this account's.
//   2. The link is a NAVIGATION. On the web the browser downloads the attachment in place; in the
//      phone app the WebView has no download manager, so the link goes to the system browser, which
//      does. `resolveApiHref` makes the path reach our server from the bundled app.
// The rows never pass through this component — it only knows the file's name and shape.

import { useState } from 'react';
import { Download, Table2 } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { resolveApiHref } from '../../lib/apiBase';
import { isNativeApp } from '../../lib/mobileNative';
import type { SheetFileRef } from './agentV3Types';
import { sheetFileButtons, sheetFileSummary, type SheetFileButton } from './sheetFileButtons';

export default function SheetFileCard({ file }: { file: SheetFileRef }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const download = async (b: SheetFileButton) => {
    if (busy) return;
    setBusy(b.key);
    setError('');
    try {
      const r = await fetch(`/api/agentv3/sheet-files/${encodeURIComponent(file.id)}/ticket`, {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ format: b.format, sheet: b.sheet }),
      });
      const d = await r.json().catch(() => null) as { path?: string; error?: string } | null;
      if (!r.ok || !d?.path) {
        setError(d?.error || 'Could not start the download. Please try again.');
        return;
      }
      const href = resolveApiHref(d.path, window);
      if (isNativeApp()) window.open(href, '_blank');
      else window.location.href = href;
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-line bg-well px-3 py-2.5 text-body">
      <div className="flex items-center gap-2">
        <Table2 className="w-5 h-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={file.title || file.fileBase}>
            {file.title || file.fileBase}
          </div>
          <div className="text-[11px] text-muted">{sheetFileSummary(file)}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sheetFileButtons(file).map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => { void download(b); }}
            disabled={busy !== null}
            aria-label={b.ariaLabel}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-opacity touch-manipulation disabled:opacity-60 ${
              b.primary ? 'bg-accent text-on-accent hover:opacity-90' : 'border border-line bg-raised text-body hover:opacity-90'
            }`}
          >
            <Download className="w-3.5 h-3.5" aria-hidden />
            {busy === b.key ? 'Preparing…' : b.label}
          </button>
        ))}
      </div>
      {error && <div className="mt-1.5 text-[11px] text-danger">{error}</div>}
    </div>
  );
}
