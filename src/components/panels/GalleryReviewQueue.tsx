/**
 * GALLERY REVIEW QUEUE — where an admin approves, rejects or removes what people sent to the gallery.
 *
 * Queue Q-162 (the unreachable-routes triage) found the defect: every gallery submission is created
 * `pending`, `POST /api/gallery/admin/:id/review` is the ONLY path to `approved`, and nothing in the app
 * called it. So "Send for review" promised a review nobody could perform, and the gallery could never
 * show a single app — a feature that looked done and did nothing.
 *
 * It lives inside the Gallery screen, like App Mart's review lives inside App Mart, and it renders
 * NOTHING unless the server says this person is a reviewer (the admin route answers 403 to everyone
 * else) — the client never decides who is an admin. The admin reads the code before deciding: that is
 * the whole point of the queue, so Approve stays disabled until the source has been opened.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, FileCode } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cardClasses } from '../ui/variants';

export interface PendingGalleryApp {
  id: string;
  title: string;
  description: string;
  authorName: string;
  authorEmail?: string;
  fileCount: number;
  bytes?: number;
  excludedPaths?: string[];
  files: string[];
}

export type GalleryDecision = 'approved' | 'rejected' | 'removed';

/** The three calls this screen makes — injectable so the flow is testable without a server. */
export interface GalleryReviewApi {
  /** `null` = this person is not a reviewer (403/401) — the queue renders nothing. */
  listPending(): Promise<PendingGalleryApp[] | null>;
  readSource(id: string): Promise<Record<string, string>>;
  review(id: string, decision: GalleryDecision, note: string): Promise<void>;
}

async function readError(r: Response, fallback: string): Promise<string> {
  try {
    const d = await r.json();
    return typeof d?.error === 'string' && d.error ? d.error : fallback;
  } catch {
    return fallback;
  }
}

export function galleryReviewApi(headers: () => Promise<Record<string, string>>): GalleryReviewApi {
  return {
    async listPending() {
      const r = await fetch('/api/gallery/admin/pending', { headers: await headers() });
      if (r.status === 401 || r.status === 403) return null;
      if (!r.ok) throw new Error(await readError(r, 'Could not load the review queue.'));
      const d = await r.json();
      return Array.isArray(d?.apps) ? d.apps : [];
    },
    async readSource(id) {
      const r = await fetch(`/api/gallery/admin/${encodeURIComponent(id)}/source`, { headers: await headers() });
      if (!r.ok) throw new Error(await readError(r, 'Could not read that app\'s code.'));
      const d = await r.json();
      return d?.files && typeof d.files === 'object' ? d.files : {};
    },
    async review(id, decision, note) {
      const r = await fetch(`/api/gallery/admin/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ decision, note }),
      });
      if (!r.ok) throw new Error(await readError(r, 'Could not save that decision.'));
      const d = await r.json().catch(() => null);
      if (d?.ok !== true || d?.status !== decision) throw new Error('The server did not confirm that decision.');
    },
  };
}

const DECISION_LABEL: Record<GalleryDecision, string> = {
  approved: 'Approved — it is now in the gallery.',
  rejected: 'Rejected — the author sees your note, and the code was deleted.',
  removed: 'Removed — the code was deleted.',
};

interface Props {
  api: GalleryReviewApi;
  /** Called after a decision, so the public list re-reads what is now approved. */
  onDecided?: () => void;
}

export const GalleryReviewQueue: React.FC<Props> = ({ api, onDecided }) => {
  const [apps, setApps] = useState<PendingGalleryApp[] | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [source, setSource] = useState<Record<string, string>>({});
  const [file, setFile] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setApps(await api.listPending());
      setError('');
    } catch (e) {
      setApps([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const readCode = async (id: string) => {
    setBusy(true); setError(''); setDone('');
    try {
      const files = await api.readSource(id);
      setSource(files);
      setFile(Object.keys(files)[0] ?? '');
      setOpen(id);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const decide = async (id: string, decision: GalleryDecision) => {
    setBusy(true); setError('');
    try {
      await api.review(id, decision, note.trim());
      setApps((list) => (list ?? []).filter((a) => a.id !== id));
      setOpen(null); setSource({}); setNote('');
      setDone(DECISION_LABEL[decision]);
      onDecided?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // Not a reviewer (or not yet known): this screen does not exist for them.
  if (apps === null) return null;

  return (
    <div className={cn(cardClasses(), 'p-5 space-y-3')}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-accent-text" />
        <h3 className="text-sm font-black text-ink uppercase tracking-tight">Review queue</h3>
        <span className="text-[10px] text-muted">({apps.length} waiting)</span>
      </div>
      <p className="text-[11px] text-muted">
        Only reviewers see this. Read the code before you approve it — an approved app can be opened and remixed
        by anyone. Rejecting or removing deletes the code.
      </p>

      {done && <div className="text-[11px] text-success">{done}</div>}
      {error && <div className="text-[11px] text-danger">{error}</div>}

      {apps.length === 0 ? (
        <p className="text-[11px] text-muted">Nothing is waiting for review.</p>
      ) : (
        <div className="space-y-2">
          {apps.map((a) => (
            <div key={a.id} className="bg-well rounded px-3 py-2 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold text-ink truncate">{a.title}</div>
                  <div className="text-[11px] text-muted">{a.description}</div>
                  <div className="text-[10px] text-faint">
                    by {a.authorName}{a.authorEmail ? ` (${a.authorEmail})` : ''} · {a.fileCount} files
                    {a.bytes ? ` · ${Math.round(a.bytes / 1024)} KB` : ''}
                    {a.excludedPaths?.length ? ` · ${a.excludedPaths.length} private file(s) left out` : ''}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => readCode(a.id)} disabled={busy}>
                  <FileCode className="w-3 h-3 mr-1" /> Read the code
                </Button>
              </div>

              {open === a.id && (
                <div className="space-y-2">
                  <select value={file} onChange={(e) => setFile(e.target.value)}
                    className="w-full bg-card border border-line rounded px-2 py-1 text-[11px] text-body">
                    {Object.keys(source).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <pre className="max-h-72 overflow-auto bg-card border border-line rounded p-2 text-[10px] text-body whitespace-pre-wrap">
                    {source[file] ?? ''}
                  </pre>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the author (shown to them)" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decide(a.id, 'approved')} disabled={busy}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => decide(a.id, 'rejected')} disabled={busy}>Reject</Button>
                    <Button size="sm" variant="danger" onClick={() => decide(a.id, 'removed')} disabled={busy}>Remove</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GalleryReviewQueue;
