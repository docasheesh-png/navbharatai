import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { previewPlan, type BuiltAppRow } from '../../lib/adminAppModeration';
import { UNTRUSTED_PREVIEW_SANDBOX } from '../../lib/previewSandbox';

/**
 * OPEN ANY BUILT APP, from wherever the admin is looking at it (admin 2026-10-21: the user's profile lists the
 * apps they built, each with an Open button). The logic moved here VERBATIM from BuiltAppsPanel so the Apps page
 * and the profile share ONE preview — same saved-copy / live / in-browser-render rules, same sandboxing, and
 * never a woken machine (see the preview route in admin.ts).
 */
const PREVIEW_IFRAME_ALLOW = 'clipboard-write; fullscreen';
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

export function useAppPreview(headers: Record<string, string>) {
  const [preview, setPreview] = useState<{ row: BuiltAppRow; html: string | null; loading: boolean; error: string; kind: string } | null>(null);
  const openPreview = useCallback(async (row: BuiltAppRow) => {
    const plan = previewPlan(row);
    if (plan.source === 'none') { setPreview({ row, html: null, loading: false, error: plan.label, kind: '' }); return; }
    if (plan.source === 'copy' || plan.source === 'live') { setPreview({ row, html: null, loading: false, error: '', kind: plan.source }); return; }
    setPreview({ row, html: null, loading: true, error: '', kind: '' });
    try {
      const r = await fetch(`/api/admin/apps/${encodeURIComponent(row.workspaceId)}/preview`, {
        method: 'POST', headers, body: JSON.stringify({ origin: window.location.origin }),
      });
      const d = await r.json();
      if (!r.ok || d?.error) { setPreview({ row, html: null, loading: false, error: d?.error || 'Could not render this app.', kind: '' }); return; }
      if (d?.empty || !d?.html) { setPreview({ row, html: null, loading: false, error: d?.note || 'No saved files for this app.', kind: '' }); return; }
      setPreview({ row, html: String(d.html), loading: false, error: '', kind: String(d.kind || '') });
    } catch (e) {
      console.error(e);
      setPreview({ row, html: null, loading: false, error: 'Could not render this app.', kind: '' });
    }
  }, [headers]);

  const previewSheet = preview && (() => {
        const plan = previewPlan(preview.row);
        // THE SHEET CONTRACT (index.css), added 2026-09-22 from a measured audit. `-over-nav`
        // because z-9998 paints above the tab bar. `p-3` is gone: a `p-*` utility beats the
        // overlay class on source order and would zero the notch reserve (12px against a 47px
        // notch); `sm:p-6` stays, since at ≥sm the insets and the bar are all 0 anyway.
        // 🔒 Portalled to the body: rendered in place it sat inside the admin console, and any
        // ancestor with a transform, a filter or a backdrop-blur becomes the containing block for a
        // `position: fixed` child — the trap tests/theSheetOpensOverTheScreenNotInsideAFooter.test.ts
        // exists for. A sheet that carries the contract must also be out of reach of that trap.
        const sheet = (
          <div className="nb-sheet-overlay nb-sheet-over-nav fixed inset-0 z-[9998] flex items-center justify-center sm:p-6 bg-scrim backdrop-blur-sm" role="presentation">
            {/* `h-full` + `nb-sheet`, not `h-[88vh]`: a `vh` fraction is measured against the LARGE
                viewport and against a screen that still owes space to the notch. The overlay's box
                IS the visible area now, so "as tall as it can be" is the honest height — and the
                iframe below is already `flex-1 min-h-0`, so it fills whatever it is given. */}
            <div role="dialog" aria-modal="true" aria-label={`Preview of ${preview.row.appName || preview.row.workspaceId}`}
                 className="nb-sheet w-full max-w-[1100px] h-full rounded-2xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-ink truncate">
                    {preview.row.appName || 'Name not recorded'}
                    {preview.row.owner?.label ? <span className="font-normal text-muted"> · {preview.row.owner.label}</span> : null}
                  </p>
                  <p className="text-[10px] font-mono text-faint truncate">{preview.row.workspaceId}</p>
                  <p className="text-[10px] text-muted truncate">{preview.error || plan.label}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(plan.source === 'copy' || plan.source === 'live') && (
                    <a href={plan.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-info hover:underline">
                      <ExternalLink size={10} /> Open in a tab
                    </a>
                  )}
                  <button onClick={() => setPreview(null)} aria-label="Close preview"
                          className="w-8 h-8 rounded-lg bg-raised border border-line text-ink flex items-center justify-center hover:border-sky-500/40">
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {(plan.source === 'copy' || plan.source === 'live') && (
                  <iframe
                    title={`${plan.source === 'copy' ? 'Saved copy' : 'Published app'} of ${preview.row.workspaceId}`}
                    src={plan.url} className="w-full h-full border-0" allow={PREVIEW_IFRAME_ALLOW} sandbox={IFRAME_SANDBOX}
                  />
                )}
                {/* 🔒 A STRANGER'S code rendered inside the ADMIN's session (forensic audit 2026-10-04, P0): a
                    srcDoc frame with allow-same-origin IS this page, so any user's app could read the admin's
                    Firebase session from localStorage. The opaque sandbox keeps it out of the platform origin. */}
                {plan.source === 'render' && preview.html && (
                  <iframe title={`In-browser render of ${preview.row.workspaceId}`} srcDoc={preview.html} className="w-full h-full border-0" allow={PREVIEW_IFRAME_ALLOW} sandbox={UNTRUSTED_PREVIEW_SANDBOX} />
                )}
                {plan.source === 'render' && preview.loading && (
                  <p className="p-6 text-[12px] text-muted">Rendering from the saved files…</p>
                )}
                {(plan.source === 'none' || (!preview.loading && !preview.html && plan.source === 'render')) && (
                  <p className="p-6 text-[12px] text-warn">{preview.error || plan.label}</p>
                )}
              </div>
            </div>
          </div>
        );
        // No document ⇒ nothing to portal into (a server render), so render in place.
        return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
      })();
  return { openPreview, previewSheet };
}
