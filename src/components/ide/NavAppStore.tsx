import React, { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFileChunked } from '../../lib/zipProjectUpload';
import {
  Store, Upload, Loader2, ShieldCheck, ShieldAlert, AlertTriangle, Download,
  CheckCircle2, X, Clock, ExternalLink, Info, Globe, Play, Link2, Trash2, Lock,
} from 'lucide-react';
import { WebAppPlayer } from './WebAppPlayer';
import { authedHeaders } from '../../App';

// Nav App Store — publish your Android app, and install other people's.
//
// WHAT THE USER SEES, and why it is shaped this way (admin 2026-07-27):
//
//  • BROWSE is the default tab, because most people arriving here want an app, not to publish one.
//  • PUBLISH takes a real form. The developer's name and a working contact email are required, not
//    bureaucracy: they are what makes an abuse report or a takedown actionable, and an app nobody can
//    be held responsible for is exactly what a malware uploader wants.
//  • REVIEW exists only for an admin, and it is the only path to a published app. A clean malware
//    scan produces "waiting for review", never "live" — malware built for a specific campaign is
//    routinely unknown to every engine on the day it ships.
//
// The permissions an app asks for are shown to DOWNLOADERS, not hidden in the review screen. Someone
// deciding whether to install something has a right to know it wants to read their text messages.

type Tab = 'browse' | 'publish' | 'mine' | 'review';

interface StoreStatus {
  acceptingUploads: boolean;
  uploadFeeInr: number;
  categories: string[];
  maxSizeMb: number;
  isAdmin: boolean;
  missing: string[];
}

interface HighRisk { permission: string; why: string }

interface PublicApp {
  id: string; appName: string; packageName: string; versionName: string;
  shortDescription: string; description: string; category: string; iconDataUrl?: string;
  sizeBytes: number; permissions: string[]; highRisk: HighRisk[]; downloads: number;
  developerName: string; publishedAt: number; sha256: string;
}

interface MineApp {
  id: string; appName: string; versionName: string; status: string;
  submittedAt: number; reviewedAt?: number; reviewNote?: string;
  scanVerdict: string; downloads: number; sizeBytes: number;
}

interface QueueApp extends PublicApp {
  status: string; uid: string;
  developer: { name: string; email: string; phone?: string; website?: string };
  scanVerdict: string; scanMalicious: number; scanEnginesTotal: number;
  scanFlaggedBy: string[]; scanReportUrl?: string; inspectionWarnings: string[];
  submittedAt: number;
}

function fmtSize(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** A browser-run store app (Kadam 1 of the web-app ecosystem — see navStoreWeb.ts). */
interface WebApp {
  id: string;
  name: string;
  description: string;
  iconDataUrl?: string;
  requiresPassword: boolean;
  runs: number;
  remixes: number;
  publishedAt: number;
  /** Owner/admin views only. */
  status?: 'unlisted' | 'listed' | 'removed';
}

const EMPTY_FORM = {
  developerName: '', developerEmail: '', developerPhone: '', developerWebsite: '',
  appName: '', versionName: '1.0.0', shortDescription: '', description: '',
  category: '', acceptedTerms: false,
};

export interface NavAppStoreProps {
  /** Deep link (`/store/app/<id>`): open this web app's player immediately. */
  initialWebAppId?: string | null;
}

export const NavAppStore: React.FC<NavAppStoreProps> = ({ initialWebAppId }) => {
  const [tab, setTab] = useState<Tab>('browse');
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [apps, setApps] = useState<PublicApp[]>([]);
  const [mine, setMine] = useState<MineApp[]>([]);
  const [queue, setQueue] = useState<QueueApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openApp, setOpenApp] = useState<PublicApp | null>(null);
  // WEB APPS — run in the viewer's browser, nothing to install. Deep link opens the player directly.
  const [webApps, setWebApps] = useState<WebApp[]>([]);
  const [webMine, setWebMine] = useState<WebApp[]>([]);
  const [webQueue, setWebQueue] = useState<WebApp[]>([]);
  // A share link (`/store/app/<id>`) opens the player IMMEDIATELY — the receiver tapped an app,
  // not a store; the store is what they see when they close it. Read once at mount.
  const [playingId, setPlayingId] = useState<string | null>(() => {
    if (initialWebAppId) return initialWebAppId;
    try {
      const m = window.location.pathname.match(/^\/store\/app\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    } catch { return null; }
  });
  const [webBusy, setWebBusy] = useState('');

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [apkName, setApkName] = useState('');
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string; highRisk?: HighRisk[] } | null>(null);
  const [reviewing, setReviewing] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/status', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current && data) setStatus(data as StoreStatus);
    } catch { /* the browse tab still works from cache-less empty state */ }
  }, []);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/nav-store/apps');
      const data = await res.json().catch(() => null);
      if (liveRef.current) setApps(Array.isArray(data?.apps) ? data.apps : []);
    } catch {
      if (liveRef.current) setError('Could not load the store.');
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/mine', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current) setMine(Array.isArray(data?.apps) ? data.apps : []);
    } catch { /* shown as an empty list */ }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/admin/queue?status=pending', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current) setQueue(Array.isArray(data?.apps) ? data.apps : []);
    } catch { /* shown as an empty queue */ }
  }, []);

  const loadWebApps = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/web/apps');
      const data = await res.json().catch(() => null);
      if (liveRef.current) setWebApps(Array.isArray(data?.apps) ? data.apps : []);
    } catch { /* the APK list still renders */ }
  }, []);

  const loadWebMine = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/web/mine', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current) setWebMine(Array.isArray(data?.apps) ? data.apps : []);
    } catch { /* shown as an empty list */ }
  }, []);

  const loadWebQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/web/admin/queue', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current) setWebQueue(Array.isArray(data?.apps) ? data.apps : []);
    } catch { /* shown as an empty queue */ }
  }, []);

  /** Owner action on one of MY web apps; the store reloads so the change is visibly real. */
  const webAppAction = useCallback(async (id: string, body: Record<string, unknown>) => {
    setWebBusy(id);
    try {
      await fetch(`/api/nav-store/web/app/${encodeURIComponent(id)}/settings`, {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      void loadWebMine();
      void loadWebApps();
    } finally {
      if (liveRef.current) setWebBusy('');
    }
  }, [loadWebMine, loadWebApps]);

  const decideWeb = useCallback(async (id: string, decision: 'listed' | 'removed') => {
    setWebBusy(id);
    try {
      await fetch('/api/nav-store/web/admin/review', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, decision }),
      });
      void loadWebQueue();
      void loadWebApps();
    } finally {
      if (liveRef.current) setWebBusy('');
    }
  }, [loadWebQueue, loadWebApps]);

  useEffect(() => { void loadStatus(); void loadApps(); void loadWebApps(); }, [loadStatus, loadApps, loadWebApps]);
  useEffect(() => {
    if (tab === 'mine') { void loadMine(); void loadWebMine(); }
    if (tab === 'review') { void loadQueue(); void loadWebQueue(); }
  }, [tab, loadMine, loadQueue, loadWebMine, loadWebQueue]);

  // KEEP THE FILE, don't base64 it (2026-07-28). Reading a 50 MB APK into a base64 string only to
  // post it inside JSON is what capped the store at ~24 MB against the platform's request limit —
  // while the UI advertised 150 MB. The file is now transferred in chunks at submit time.
  const pickApk = useCallback((file: File) => {
    setSubmitResult(null);
    if (!/\.apk$/i.test(file.name)) {
      setSubmitResult({ ok: false, message: 'Please choose a .apk file.' });
      return;
    }
    setApkFile(file);
    setApkName(file.name);
  }, []);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      if (!apkFile) { setSubmitResult({ ok: false, message: 'Please choose your .apk file.' }); return; }
      // Chunked transfer — every request clears the platform cap, so a real 5-150 MB APK gets through.
      const { uploadId } = await uploadFileChunked(apkFile, (p) => setUploadPct(Math.round(p.fraction * 100)));
      const res = await fetch('/api/nav-store/submit', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...form, uploadId }),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (!res.ok || !data?.ok) {
        setSubmitResult({ ok: false, message: data?.error || 'Your app could not be submitted.' });
        return;
      }
      setSubmitResult({ ok: true, message: data.message, highRisk: data.highRisk });
      setForm({ ...EMPTY_FORM });
      setApkFile(null);
      setApkName('');
      void loadMine();
    } catch (err) {
      if (liveRef.current) {
        setSubmitResult({ ok: false, message: err instanceof Error ? err.message : 'Could not reach the server. Nothing was uploaded.' });
      }
    } finally {
      if (liveRef.current) { setSubmitting(false); setUploadPct(0); }
    }
  }, [form, apkFile, submitting, loadMine]);

  const decide = useCallback(async (id: string, decision: 'approved' | 'rejected' | 'removed') => {
    setReviewing(id);
    try {
      await fetch('/api/nav-store/admin/review', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, decision }),
      });
      void loadQueue();
      void loadApps();
    } finally {
      if (liveRef.current) setReviewing('');
    }
  }, [loadQueue, loadApps]);

  const field = (k: keyof typeof EMPTY_FORM, label: string, opts: { type?: string; rows?: number; hint?: string; required?: boolean } = {}) => (
    <label className="block">
      <span className="block text-xs text-white/50 mb-1.5">
        {label}{opts.required && <span className="text-rose-400"> *</span>}
      </span>
      {opts.rows ? (
        <textarea
          value={form[k] as string}
          onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
          rows={opts.rows}
          className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 resize-y"
        />
      ) : (
        <input
          type={opts.type || 'text'}
          value={form[k] as string}
          onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
          className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
        />
      )}
      {opts.hint && <span className="block text-[11px] text-white/35 mt-1 leading-snug">{opts.hint}</span>}
    </label>
  );

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#0d1117] text-white" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-3xl mx-auto px-4 py-5 sm:px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <Store size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold truncate">Nav App Store</h1>
            <p className="text-xs text-white/50">Publish your Android app — and install apps others have made</p>
          </div>
        </div>

        {/* Tabs — scroll rather than overflow on a phone */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          {([['browse', 'Browse'], ['publish', 'Publish'], ['mine', 'My apps'],
             ...(status?.isAdmin ? [['review', `Review${queue.length ? ` (${queue.length})` : ''}`]] : []),
            ] as Array<[Tab, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                tab === id ? 'bg-emerald-600 text-white' : 'bg-white/5 text-white/50 hover:text-white/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 flex gap-2 px-3 py-2.5 rounded-lg text-xs text-amber-300 bg-amber-500/10">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{error}
          </p>
        )}

        {/* ── Browse: INSTANT (web) apps — tap and it runs, nothing to install ── */}
        {tab === 'browse' && webApps.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
              <Globe size={12} /> Instant apps — run in your browser, nothing to install
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {webApps.map((a) => (
                <div key={a.id} className="flex gap-3 p-3 rounded-xl bg-[#161b22] border border-white/10 hover:border-white/25 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {a.iconDataUrl ? <img src={a.iconDataUrl} alt="" className="w-full h-full object-cover" /> : <Globe size={18} className="text-white/30" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {a.name}
                      {a.requiresPassword && <Lock size={11} className="text-white/40 flex-shrink-0" />}
                    </p>
                    <p className="text-xs text-white/50 truncate">{a.description || 'A NavBharatAI-built app'}</p>
                    <p className="text-[11px] text-white/30 mt-1">{a.runs} run{a.runs === 1 ? '' : 's'}</p>
                  </div>
                  <button
                    onClick={() => setPlayingId(a.id)}
                    className="self-center flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex-shrink-0 transition-colors"
                  >
                    <Play size={12} /> Open
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Browse ── */}
        {tab === 'browse' && (
          loading ? (
            <p className="flex items-center gap-2 text-sm text-white/40 py-10 justify-center">
              <Loader2 size={15} className="animate-spin" /> Loading apps…
            </p>
          ) : apps.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Store size={36} className="text-white/10 mx-auto mb-3" />
              <p className="text-sm text-white/50">No apps published yet.</p>
              <p className="text-xs text-white/30 mt-1">Every app here is checked by a person before it appears.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {apps.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setOpenApp(a)}
                  className="flex gap-3 p-3 rounded-xl bg-[#161b22] border border-white/10 hover:border-white/25 text-left transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {a.iconDataUrl ? <img src={a.iconDataUrl} alt="" className="w-full h-full object-cover" /> : <Store size={18} className="text-white/30" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.appName}</p>
                    <p className="text-xs text-white/50 truncate">{a.shortDescription}</p>
                    <p className="text-[11px] text-white/30 mt-1">
                      {a.developerName} · {fmtSize(a.sizeBytes)}
                      {a.highRisk.length > 0 && <span className="text-amber-400"> · {a.highRisk.length} sensitive permission{a.highRisk.length === 1 ? '' : 's'}</span>}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {/* ── Publish ── */}
        {tab === 'publish' && (
          status && !status.acceptingUploads ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-300 mb-2">
                <ShieldAlert size={15} /> Not accepting apps yet
              </p>
              <p className="text-xs text-white/60 leading-relaxed">
                The store cannot take apps until malware scanning and app storage are switched on — no
                app should ever be handed to someone's phone unscanned. Still to configure:
                {' '}<span className="text-white/80">{status.missing.join(', ')}</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-white/60">
                <p className="flex items-center gap-1.5 text-emerald-300 font-semibold mb-1">
                  <ShieldCheck size={13} /> Publishing is free{status ? ` (₹${status.uploadFeeInr})` : ''}
                </p>
                Your app is scanned for malware and then checked by a person before it appears. That
                usually takes a day. Apps that fail the scan are never stored.
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {field('developerName', 'Your name or company', { required: true })}
                {field('developerEmail', 'Contact email', { type: 'email', required: true, hint: 'How anyone reports a problem with your app. Not shown publicly.' })}
                {field('developerPhone', 'Phone (optional)')}
                {field('developerWebsite', 'Website (optional)', { hint: 'Starting with https://' })}
                {field('appName', 'App name', { required: true })}
                {field('versionName', 'Version', { required: true, hint: 'For example 1.0.0' })}
              </div>

              {field('shortDescription', 'One-line description', { required: true, hint: 'Shown in the app list. Up to 120 characters.' })}
              {field('description', 'Full description', { rows: 4, required: true, hint: 'What does your app do? At least 30 characters.' })}

              <label className="block">
                <span className="block text-xs text-white/50 mb-1.5">Category<span className="text-rose-400"> *</span></span>
                <select
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                  className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                >
                  <option value="">Choose a category…</option>
                  {(status?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <div>
                <span className="block text-xs text-white/50 mb-1.5">Your app file<span className="text-rose-400"> *</span></span>
                <input ref={fileRef} type="file" accept=".apk" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickApk(f); }} />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-white/20 hover:border-white/40 text-sm text-white/70 transition-colors"
                >
                  <Upload size={15} /> {apkName || `Choose your .apk (up to ${status?.maxSizeMb ?? 150} MB)`}
                </button>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-white/60 leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.acceptedTerms}
                  onChange={(e) => setForm((p) => ({ ...p, acceptedTerms: e.target.checked }))}
                  className="mt-0.5 accent-emerald-500 flex-shrink-0"
                />
                <span>
                  I made this app or have the right to publish it, it contains no malware, and I
                  understand it will be removed if it harms users.
                </span>
              </label>

              <button
                onClick={() => void submit()}
                disabled={submitting || !apkFile}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-base font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
                {submitting
                  ? (uploadPct > 0 && uploadPct < 100 ? `Uploading ${uploadPct}%…` : 'Scanning your app…')
                  : 'Submit my app'}
              </button>

              {submitResult && (
                <div className={`rounded-xl p-3 text-xs leading-relaxed ${submitResult.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                  <p className="flex gap-2">
                    {submitResult.ok ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />}
                    <span>{submitResult.message}</span>
                  </p>
                  {submitResult.highRisk && submitResult.highRisk.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 text-white/60">
                      <p className="font-semibold mb-1">Your app asks for these sensitive permissions:</p>
                      {submitResult.highRisk.map((h) => (
                        <p key={h.permission}>• {h.why}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        )}

        {/* ── My apps ── */}
        {tab === 'mine' && webMine.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
              <Globe size={12} /> My instant apps
            </p>
            <div className="space-y-2">
              {webMine.map((a) => (
                <div key={a.id} className="p-3 rounded-xl bg-[#161b22] border border-white/10">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{a.name}</p>
                    <span className={`ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
                      a.status === 'listed' ? 'bg-emerald-500/15 text-emerald-300'
                        : a.status === 'unlisted' ? 'bg-sky-500/15 text-sky-300'
                        : 'bg-white/10 text-white/50'
                    }`}>
                      {a.status === 'listed' ? <CheckCircle2 size={10} /> : a.status === 'unlisted' ? <Link2 size={10} /> : <X size={10} />}
                      {/* 'unlisted' is a REAL state, said honestly: the link works now; the store
                          listing needs a person's review — same discipline as the APK store. */}
                      {a.status === 'listed' ? 'On the store' : a.status === 'unlisted' ? 'Live via link · store listing under review' : 'Removed'}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40 mt-1">{a.runs} run{a.runs === 1 ? '' : 's'} · {a.requiresPassword ? 'private (password)' : 'public'}</p>
                  {a.status !== 'removed' && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button
                        onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/store/app/${a.id}`); }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-white/70 transition-colors"
                      ><Link2 size={11} /> Copy link</button>
                      <button
                        onClick={() => setPlayingId(a.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-white/70 transition-colors"
                      ><Play size={11} /> Open</button>
                      {a.requiresPassword ? (
                        <button
                          onClick={() => void webAppAction(a.id, { visibility: 'public' })}
                          disabled={webBusy === a.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[11px] text-white/70 transition-colors"
                        >Make public</button>
                      ) : (
                        <button
                          onClick={() => {
                            const pw = window.prompt('Set a password for this app (at least 4 characters):');
                            if (pw && pw.length >= 4) void webAppAction(a.id, { visibility: 'private', password: pw });
                          }}
                          disabled={webBusy === a.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[11px] text-white/70 transition-colors"
                        ><Lock size={11} /> Make private</button>
                      )}
                      <button
                        onClick={() => { if (window.confirm('Unpublish this app? Its link stops working and its published files are deleted. Your workspace is untouched.')) void webAppAction(a.id, { action: 'unpublish' }); }}
                        disabled={webBusy === a.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/40 disabled:opacity-40 text-[11px] text-rose-300 transition-colors"
                      ><Trash2 size={11} /> Unpublish</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'mine' && (
          mine.length === 0 && webMine.length === 0 ? (
            <p className="text-center text-sm text-white/40 py-12">You have not submitted any apps yet.</p>
          ) : (
            <div className="space-y-2">
              {mine.map((a) => (
                <div key={a.id} className="p-3 rounded-xl bg-[#161b22] border border-white/10">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{a.appName}</p>
                    <span className="text-xs text-white/40">v{a.versionName}</span>
                    <span className={`ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
                      a.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300'
                        : a.status === 'pending' ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-white/10 text-white/50'
                    }`}>
                      {a.status === 'approved' ? <CheckCircle2 size={10} /> : a.status === 'pending' ? <Clock size={10} /> : <X size={10} />}
                      {a.status === 'approved' ? 'Live' : a.status === 'pending' ? 'Waiting for review' : a.status}
                    </span>
                  </div>
                  {a.status === 'approved' && <p className="text-[11px] text-white/40 mt-1">{a.downloads} download{a.downloads === 1 ? '' : 's'}</p>}
                  {a.reviewNote && <p className="text-[11px] text-white/50 mt-1.5 leading-relaxed">Reviewer: {a.reviewNote}</p>}
                </div>
              ))}
            </div>
          )
        )}

        {/* ── Admin review: instant apps waiting for a STORE LISTING (their links already work) ── */}
        {tab === 'review' && status?.isAdmin && webQueue.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
              <Globe size={12} /> Instant apps — listing requests
            </p>
            <div className="space-y-3">
              {webQueue.map((a) => (
                <div key={a.id} className="p-3 rounded-xl bg-[#161b22] border border-white/10">
                  <p className="text-sm font-semibold">{a.name}</p>
                  <p className="text-xs text-white/50 mt-0.5">{a.description || '—'}</p>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => setPlayingId(a.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-white/70 transition-colors"
                    ><Play size={11} /> Try it</button>
                    <button
                      onClick={() => void decideWeb(a.id, 'listed')}
                      disabled={webBusy === a.id}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[11px] text-white font-semibold transition-colors"
                    >List on the store</button>
                    <button
                      onClick={() => void decideWeb(a.id, 'removed')}
                      disabled={webBusy === a.id}
                      className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-500 disabled:opacity-40 text-[11px] text-white font-semibold transition-colors"
                    >Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Admin review ── */}
        {tab === 'review' && status?.isAdmin && (
          queue.length === 0 && webQueue.length === 0 ? (
            <p className="text-center text-sm text-white/40 py-12">Nothing waiting for review.</p>
          ) : (
            <div className="space-y-3">
              {queue.map((a) => (
                <div key={a.id} className="p-3 rounded-xl bg-[#161b22] border border-white/10">
                  <p className="text-sm font-semibold">{a.appName} <span className="text-xs font-normal text-white/40">v{a.versionName}</span></p>
                  <p className="text-xs text-white/50 mt-0.5">{a.shortDescription}</p>
                  <p className="text-[11px] text-white/40 mt-1.5">
                    {a.developer?.name} · {a.developer?.email}{a.developer?.phone ? ` · ${a.developer.phone}` : ''}
                  </p>
                  <p className="text-[11px] text-white/30 mt-0.5 break-all">{fmtSize(a.sizeBytes)} · sha256 {a.sha256?.slice(0, 16)}…</p>

                  <div className={`mt-2 px-2.5 py-1.5 rounded-lg text-[11px] ${
                    a.scanVerdict === 'clean' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
                  }`}>
                    Scan: {a.scanVerdict} — {a.scanMalicious} of {a.scanEnginesTotal} engines flagged it
                    {a.scanFlaggedBy?.length > 0 && ` (${a.scanFlaggedBy.slice(0, 3).join(', ')})`}
                    {a.scanReportUrl && (
                      <a href={a.scanReportUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline">
                        <ExternalLink size={9} /> report
                      </a>
                    )}
                  </div>

                  {a.highRisk?.length > 0 && (
                    <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-[11px] text-rose-300 leading-relaxed">
                      <p className="font-semibold mb-0.5">Sensitive permissions — look closely:</p>
                      {a.highRisk.map((h) => <p key={h.permission}>• {h.why}</p>)}
                    </div>
                  )}
                  {a.inspectionWarnings?.length > 0 && a.inspectionWarnings.map((w, i) => (
                    <p key={i} className="mt-1.5 text-[11px] text-white/40 leading-relaxed">• {w}</p>
                  ))}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => void decide(a.id, 'approved')}
                      disabled={reviewing === a.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold disabled:opacity-40"
                    >
                      {reviewing === a.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Publish
                    </button>
                    <button
                      onClick={() => void decide(a.id, 'rejected')}
                      disabled={reviewing === a.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/70 disabled:opacity-40"
                    >
                      <X size={12} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── App detail ── */}
      {openApp && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpenApp(null)}>
          <div
            className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-[#161b22] border border-white/10 rounded-t-2xl sm:rounded-2xl p-4 sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-3 mb-3">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                {openApp.iconDataUrl ? <img src={openApp.iconDataUrl} alt="" className="w-full h-full object-cover" /> : <Store size={22} className="text-white/30" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold truncate">{openApp.appName}</h2>
                <p className="text-xs text-white/50">{openApp.developerName} · v{openApp.versionName}</p>
                <p className="text-[11px] text-white/30">{openApp.category} · {fmtSize(openApp.sizeBytes)} · {openApp.downloads} downloads</p>
              </div>
            </div>

            <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap mb-4">{openApp.description}</p>

            {/* What it can do on your phone. Shown BEFORE the download button, on purpose. */}
            {openApp.highRisk.length > 0 && (
              <div className="mb-4 px-3 py-2.5 rounded-xl bg-amber-500/10 text-xs text-amber-200 leading-relaxed">
                <p className="font-semibold mb-1 flex items-center gap-1.5"><ShieldAlert size={13} /> This app asks to:</p>
                {openApp.highRisk.map((h) => <p key={h.permission}>• {h.why}</p>)}
              </div>
            )}

            <a
              href={`/api/nav-store/download/${encodeURIComponent(openApp.id)}`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-base font-bold transition-colors"
            >
              <Download size={17} /> Download .apk
            </a>

            <p className="mt-3 flex gap-2 text-[11px] text-white/40 leading-relaxed">
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              To install an app from outside the Play Store, Android will ask you to allow installs
              from this browser. This app was scanned for malware and checked by a person, but always
              install only what you actually trust.
            </p>

            <button onClick={() => setOpenApp(null)} className="w-full mt-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80">
              Close
            </button>
          </div>
        </div>
      )}
      {playingId && <WebAppPlayer appId={playingId} onClose={() => setPlayingId(null)} />}
    </div>
  );
};

export default NavAppStore;
