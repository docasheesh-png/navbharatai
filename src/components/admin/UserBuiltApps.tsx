import { useCallback, useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { previewPlan, publishStateView, type BuiltAppRow } from '../../lib/adminAppModeration';
import { useAppPreview } from './AppPreviewSheet';

/**
 * SAVED APPS THIS PERSON BUILT, on their profile, each with an Open button (admin 2026-10-21: "admin jab kisi user ki
 * profile dekhta hai, to us profile me user ne jo app banayi hai, woh bhi dikhe… har user ki profile me is user ki
 * app open karne ka button").
 *
 * The profile already listed the PUBLISHED apps; an app built and never published was invisible there. This list
 * reads the same durable-file list the Apps page uses, in its owner mode (`/api/admin/apps?q=<uid>`), so it holds
 * the apps that were never published too — and Open is the Apps page's own preview (saved copy, live site, or an
 * in-browser render of the saved files; the owner's machine is never woken).
 *
 * 🔒 A FAILED READ IS SAID, NEVER SHOWN AS "NO APPS": the admin decides whether to act on an account from this
 * screen, and an empty list over a broken read would tell them the opposite of the truth.
 */
const PAGE = 12;

export function UserBuiltApps({ uid, headers }: { uid: string; headers: Record<string, string> }) {
  const [rows, setRows] = useState<BuiltAppRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanLimited, setScanLimited] = useState(false);
  const [error, setError] = useState('');
  const { openPreview, previewSheet } = useAppPreview(headers);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    try {
      const qs = `q=${encodeURIComponent(uid)}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await fetch(`/api/admin/apps?${qs}`, { headers });
      const d = await r.json().catch(() => null) as { ok?: boolean; mode?: string; scanLimited?: boolean; rows?: BuiltAppRow[]; nextCursor?: string | null; error?: string } | null;
      if (!r.ok || !d || d.ok === false || !Array.isArray(d.rows)) { setError(d?.error || 'This user’s apps could not be read.'); return; }
      if (d.mode !== 'owner') { setError('This account id is not one the apps list can search by, so its apps cannot be listed here.'); return; }
      setError('');
      setScanLimited(d.scanLimited === true);
      setNext(typeof d.nextCursor === 'string' && d.nextCursor ? d.nextCursor : null);
      setRows((prev) => {
        const have = new Set((cursor ? prev ?? [] : []).map((x) => x.workspaceId));
        return [...(cursor ? prev ?? [] : []), ...d.rows!.filter((x) => !have.has(x.workspaceId))];
      });
    } catch { setError('This user’s apps could not be read.'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, headers['x-admin-token']]);

  useEffect(() => { setRows(null); setNext(null); setError(''); setScanLimited(false); void load(null); }, [load]);

  return (
    <div className="mt-4" data-testid="user-built-apps">
      <p className="text-[9px] font-black uppercase tracking-widest text-faint mb-2">Apps built by this user</p>
      {!error && scanLimited && <p className="text-[11px] text-warn">Only the first 200 saved workspace records were checked. More apps may exist.</p>}
      {error ? (
        <p role="alert" className="text-[11px] text-warn">{error}</p>
      ) : rows === null ? (
        <p className="text-[11px] text-muted">Loading apps…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted">{scanLimited ? 'No apps were found in the checked records.' : 'No saved apps were found for this user.'}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((a) => {
            const view = publishStateView(a.publish, a.heldFrom);
            const plan = previewPlan(a);
            return (
              <div key={a.workspaceId} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink truncate">{a.appName || 'Name not recorded'}</span>
                  <span className="block text-[10px] text-faint truncate">{view.label}{a.savedAt > 0 ? ` · saved ${new Date(a.savedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ''}</span>
                </span>
                <button
                  onClick={() => void openPreview(a)}
                  disabled={plan.source === 'none'}
                  title={plan.label}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-sky-500/40 disabled:opacity-40"
                >
                  <Eye size={11} /> Open
                </button>
              </div>
            );
          })}
          {next && (
            <button onClick={() => void load(next)} disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-sky-500/40 disabled:opacity-40">
              {loading ? 'Loading…' : `Load ${PAGE} more`}
            </button>
          )}
        </div>
      )}
      {previewSheet}
    </div>
  );
}
