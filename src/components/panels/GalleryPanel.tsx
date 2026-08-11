/**
 * COMMUNITY GALLERY — browse apps other people published, and publish your own.
 *
 * ROADMAP §2 (community gallery / remix).
 *
 * Two honesty rules shape this screen, and both come from what the server actually does:
 *   • Publishing says "sent for review", never "published". Nothing reaches the gallery without an
 *     admin approving it, so telling the user their app is live would be a lie the moment they read it.
 *   • When the server REFUSES because a secret is still in their code, this shows the file and line.
 *     A generic "publish failed" would leave them retrying the same thing forever — and the whole
 *     point of the refusal is that they can act on it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Search, Sparkles, Upload, AlertTriangle, GitFork } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cardClasses } from '../ui/variants';

interface GalleryPanelProps {
  user: FirebaseUser | null;
  files: Record<string, string>;
  /** Called with the remixed files so the builder can start a new app from them. */
  onRemix?: (title: string, files: Record<string, string>, remixedFrom: string) => void;
}

interface PublicApp {
  id: string;
  title: string;
  description: string;
  tags: string[];
  authorName: string;
  fileCount: number;
  remixCount: number;
  status?: string;
  reviewNote?: string;
}

interface Blocker { path: string; line: number; message: string }

async function authedHeaders(): Promise<Record<string, string>> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) base.Authorization = `Bearer ${token}`;
  } catch { /* unauthenticated — the server rejects protected calls */ }
  return base;
}

export const GalleryPanel: React.FC<GalleryPanelProps> = ({ user, files, onRemix }) => {
  const [apps, setApps] = useState<PublicApp[]>([]);
  const [mine, setMine] = useState<PublicApp[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/gallery?q=${encodeURIComponent(query)}`);
      if (r.ok) setApps((await r.json()).apps ?? []);
    } catch { /* an empty gallery renders its own honest state */ }
    finally { setLoading(false); }
  }, [query]);

  const loadMine = useCallback(async () => {
    if (!user) return;
    try {
      const r = await fetch('/api/gallery/mine', { headers: await authedHeaders() });
      if (r.ok) setMine((await r.json()).apps ?? []);
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMine(); }, [loadMine]);

  const publish = async () => {
    setPublishing(true); setMessage(''); setBlockers([]);
    try {
      const r = await fetch('/api/gallery/publish', {
        method: 'POST',
        headers: await authedHeaders(),
        body: JSON.stringify({ title, description, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), files }),
      });
      const d = await r.json();
      if (r.ok) {
        setMessage(`${d.message} ${d.excluded ?? ''}`);
        setTitle(''); setDescription(''); setTags('');
        loadMine();
      } else {
        // The blockers are the actionable part — a bare "failed" would leave the user retrying.
        setMessage(d.error || 'Could not publish.');
        setBlockers(Array.isArray(d.blockers) ? d.blockers : []);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally { setPublishing(false); }
  };

  const remix = async (app: PublicApp) => {
    try {
      const r = await fetch(`/api/gallery/${app.id}/remix`, { method: 'POST', headers: await authedHeaders() });
      const d = await r.json();
      if (!r.ok) { setMessage(d.error || 'Could not remix that app.'); return; }
      onRemix?.(d.title, d.files, d.remixedFrom);
      setMessage(`Started "${d.title}". ${d.note}`);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex-1 h-full overflow-auto bg-[#0d1117] p-6 space-y-5">
      <h2 className="text-lg font-black text-white tracking-tight">Community Gallery</h2>

      {/* ── Publish your own ─────────────────────────────────────────────────────────────────── */}
      <div className={cn(cardClasses(), 'p-5 space-y-3')}>
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-black text-white uppercase tracking-tight">Share your app</h3>
        </div>
        {!user ? (
          <p className="text-[11px] text-[#8b949e]">Sign in to share your app with other people.</p>
        ) : (
          <>
            <p className="text-[11px] text-[#8b949e]">
              Other people can open your app, read how it was built, and start their own from it.
              Your environment files and keys are never published — and if a key is still inside your
              code, NavBharatAI refuses to publish and tells you exactly where it is.
            </p>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is your app called?" />
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" />
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated (shop, hindi, invoice)" />
            <Button size="sm" onClick={publish} disabled={publishing || !title.trim() || !description.trim()}
              className="uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700">
              {publishing ? 'Checking…' : 'Send for review'}
            </Button>
          </>
        )}

        {message && <div className="text-[11px] text-amber-300">{message}</div>}
        {blockers.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-bold text-red-400">
              <AlertTriangle className="w-3 h-3" /> Remove these before publishing
            </div>
            {blockers.map((b, i) => (
              <div key={i} className="bg-black/30 rounded px-3 py-1.5 text-[10px]">
                <span className="font-mono text-amber-300">{b.path}:{b.line}</span>
                <span className="text-[#8b949e]"> — {b.message}</span>
              </div>
            ))}
          </div>
        )}

        {mine.length > 0 && (
          <div className="pt-2 border-t border-white/5 space-y-1">
            <div className="text-[11px] font-bold text-[#8b949e]">Your submissions</div>
            {mine.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-200 truncate">{m.title}</span>
                <span className={cn('shrink-0 uppercase text-[9px] font-bold tracking-widest',
                  m.status === 'approved' ? 'text-emerald-400' : m.status === 'rejected' ? 'text-red-400' : 'text-amber-400')}>
                  {m.status === 'pending' ? 'waiting for review' : m.status}
                  {m.reviewNote ? ` — ${m.reviewNote}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Browse ───────────────────────────────────────────────────────────────────────────── */}
      <div className={cn(cardClasses(), 'p-5 space-y-3')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-tight">Apps people have shared</h3>
          </div>
          <div className="flex items-center gap-2">
            <Search className="w-3 h-3 text-zinc-500" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-7 text-[11px]" />
          </div>
        </div>

        {loading ? (
          <p className="text-[11px] text-[#8b949e]">Loading…</p>
        ) : apps.length === 0 ? (
          <p className="text-[11px] text-[#8b949e]">
            {query ? 'Nothing matches that search.' : 'No apps have been shared yet — yours could be the first.'}
          </p>
        ) : (
          <div className="space-y-2">
            {apps.map((a) => (
              <div key={a.id} className="bg-black/30 rounded px-3 py-2 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-white truncate">{a.title}</div>
                    <div className="text-[11px] text-[#8b949e]">{a.description}</div>
                  </div>
                  <Button size="sm" onClick={() => remix(a)} disabled={!user}
                    className="shrink-0 uppercase tracking-widest bg-sky-600 hover:bg-sky-700">
                    <Sparkles className="w-3 h-3 mr-1" /> Remix
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                  <span>by {a.authorName}</span>
                  <span>{a.fileCount} files</span>
                  <span className="flex items-center gap-1"><GitFork className="w-3 h-3" />{a.remixCount}</span>
                  {a.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-white/5">{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GalleryPanel;
