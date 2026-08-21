import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Store, Loader2, ShieldCheck, ShieldAlert, AlertTriangle, Download,
  CheckCircle2, X, Clock, ExternalLink, Info, Globe, Play, Link2, Trash2, Lock, Package,
} from 'lucide-react';
import { WebAppPlayer } from './WebAppPlayer';
import { authedHeaders } from '../../App';
import { resolveApiHref } from '../../lib/apiBase';
import { isNativeApp } from '../../lib/mobileNative';
import { mergeReviewQueue, pendingReviewCount, reviewStatusLabel, reviewActionsFor } from './storeReviewQueue';

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
  priceInr?: number;
  /** How many screenshots the creator uploaded — the detail view fetches the images themselves on open. */
  screenshotCount?: number;
  /** Owner/admin views only. */
  status?: 'unlisted' | 'listed' | 'removed';
}

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
  // The tab badge counts only what still needs a DECISION — approved apps are a record, not work.
  const pendingCount = pendingReviewCount(queue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openApp, setOpenApp] = useState<PublicApp | null>(null);
  // WEB-APP DETAIL — tap a listing to see its screenshots before opening it (admin report 2026-08-19).
  // The images ship only here (on demand), never on the browse list, so the gallery stays light.
  const [detailApp, setDetailApp] = useState<WebApp | null>(null);
  const [detailShots, setDetailShots] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const openWebDetail = async (a: WebApp) => {
    setDetailApp(a);
    setDetailShots([]);
    if ((a.screenshotCount ?? 0) <= 0) return;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/nav-store/web/app/${encodeURIComponent(a.id)}`);
      const data = await res.json().catch(() => null);
      setDetailShots(Array.isArray(data?.screenshots) ? data.screenshots.filter((s: unknown): s is string => typeof s === 'string') : []);
    } catch { /* the detail still shows name + description without the images */ } finally {
      setDetailLoading(false);
    }
  };

  // WEB APPS — run in the viewer's browser, nothing to install. Deep link opens the player directly.
  const [webApps, setWebApps] = useState<WebApp[]>([]);
  const [webMine, setWebMine] = useState<WebApp[]>([]);
  const [webQueue, setWebQueue] = useState<WebApp[]>([]);
  /**
   * APPS YOU OWN (admin 2026-08-16: "purchase ho jaye to us par kharidne wale ka naam likh jaye, fir
   * jitni baar chahe code copy kare — par bas wahi ek app").
   *
   * A purchase is a permanent entitlement, not a one-shot download: buy once, take the code as often
   * as you like, and ONLY for that app. The server already recorded the purchase and already lets an
   * owner re-copy free; this section is the missing half — seeing what you own, so the promise is
   * usable. Hidden entirely when you own nothing, so it never shows an empty shelf.
   */
  const [owned, setOwned] = useState<Array<{ appId: string; name: string | null; priceInr: number; at: number; available: boolean }>>([]);
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

  const [reviewing, setReviewing] = useState('');
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

  /**
   * The review list: apps WAITING plus apps ALREADY APPROVED (admin 2026-08-21: "app waha se gayab na
   * ho, 'approved' likh kar dikhti rahe").
   *
   * It used to ask for `status=pending` only, so the moment an admin approved an app it disappeared
   * from the only screen that showed it — no way to see what had been approved, and no way to reach it
   * again to take it down. Pending stays first, because that is the work; approved follows as a record.
   */
  const loadQueue = useCallback(async () => {
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        fetch('/api/nav-store/admin/queue?status=pending', { headers: await authedHeaders() }),
        fetch('/api/nav-store/admin/queue?status=approved', { headers: await authedHeaders() }),
      ]);
      const pending = await pendingRes.json().catch(() => null);
      const approved = await approvedRes.json().catch(() => null);
      if (!liveRef.current) return;
      setQueue(mergeReviewQueue<QueueApp>(
        Array.isArray(pending?.apps) ? pending.apps : [],
        Array.isArray(approved?.apps) ? approved.apps : [],
      ));
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

  const loadOwned = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/web/purchases', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current && Array.isArray(data?.apps)) setOwned(data.apps);
    } catch { /* signed out or offline — the section simply stays hidden */ }
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
    if (tab === 'mine') { void loadMine(); void loadWebMine(); void loadOwned(); }
    if (tab === 'review') { void loadQueue(); void loadWebQueue(); }
  }, [tab, loadMine, loadQueue, loadWebMine, loadWebQueue, loadOwned]);

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

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#0d1117] text-white" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-3xl mx-auto px-4 py-5 sm:px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
            <Store size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold truncate">App Mart</h1>
            <p className="text-xs text-white/50">Play apps made by other creators — or publish your own</p>
          </div>
        </div>

        {/* Tabs — scroll rather than overflow on a phone */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          {([['browse', 'Browse'], ['publish', 'Publish'], ['mine', 'My apps'],
             ...(status?.isAdmin ? [['review', `Review${pendingCount ? ` (${pendingCount})` : ''}`]] : []),
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

        {/*
          BROWSE = TWO HALVES, ALWAYS BOTH LABELLED (admin 2026-08-16, from a screenshot).
          Before this, the instant-app list sat above the APK list and only the APK half rendered an
          empty state — so a store WITH an app in it showed "No apps published yet" underneath, and
          the whole screen read as broken. Now each half owns its heading AND its own empty line, so
          an empty half says "nothing here yet" instead of contradicting the half above it. When BOTH
          are empty there is one invitation instead of two apologies.
        */}
        {tab === 'browse' && !loading && webApps.length === 0 && apps.length === 0 && (
          <div className="text-center py-14 px-4">
            <Store size={40} className="text-white/10 mx-auto mb-3" />
            <p className="text-sm text-white/60 font-medium">App Mart is just getting started.</p>
            <p className="text-xs text-white/35 mt-1.5 max-w-xs mx-auto leading-relaxed">
              Build something in NavBharatAI Pro and publish it here — it will run in anyone's browser, with nothing to install.
            </p>
          </div>
        )}

        {/* ── Half 1: PLAY INSTANTLY (web apps) — tap and it runs ── */}
        {tab === 'browse' && !loading && (webApps.length > 0 || apps.length > 0) && (
          <div className="mb-7">
            <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
              <Play size={12} /> Play instantly — runs in your browser, nothing to install
            </p>
            {webApps.length === 0 ? (
              <p className="text-xs text-white/30 py-4 px-3 rounded-xl bg-white/[0.02] border border-white/5">
                No instant apps yet — the first one can be yours.
              </p>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {webApps.map((a) => (
                <div key={a.id} className="flex gap-3 p-3 rounded-xl bg-[#161b22] border border-white/10 hover:border-white/25 transition-colors">
                  <button
                    onClick={() => void openWebDetail(a)}
                    className="flex gap-3 min-w-0 flex-1 text-left"
                    title="See details & screenshots"
                  >
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {a.iconDataUrl ? <img src={a.iconDataUrl} alt="" className="w-full h-full object-cover" /> : <Globe size={18} className="text-white/30" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                        {a.name}
                        {a.requiresPassword && <Lock size={11} className="text-white/40 flex-shrink-0" />}
                      </p>
                      <p className="text-xs text-white/50 truncate">{a.description || 'A NavBharatAI-built app'}</p>
                      <p className="text-[11px] text-white/30 mt-1">
                        {a.runs} run{a.runs === 1 ? '' : 's'}
                        {(a.screenshotCount ?? 0) > 0 && <span className="text-white/40"> · {a.screenshotCount} screenshot{a.screenshotCount === 1 ? '' : 's'}</span>}
                        {(a.priceInr ?? 0) > 0 && <span className="text-emerald-300"> · remix ₹{a.priceInr}</span>}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => setPlayingId(a.id)}
                    className="self-center flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex-shrink-0 transition-colors"
                  >
                    <Play size={12} /> Open
                  </button>
                </div>
              ))}
            </div>
            )}
          </div>
        )}

        {tab === 'browse' && loading && (
          <p className="flex items-center gap-2 text-sm text-white/40 py-10 justify-center">
            <Loader2 size={15} className="animate-spin" /> Loading apps…
          </p>
        )}

        {/* ── Half 2: INSTALL (Android) — real .apk apps, a different product entirely ── */}
        {tab === 'browse' && !loading && (webApps.length > 0 || apps.length > 0) && (
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
              <Package size={12} /> Install on Android — real .apk apps
            </p>
            {apps.length === 0 ? (
              <p className="text-xs text-white/30 py-4 px-3 rounded-xl bg-white/[0.02] border border-white/5">
                No Android apps yet. Every one is scanned and checked by a person before it appears here.
              </p>
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
            )}
          </div>
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
            // PUBLISH FROM THE BUILD ONLY (admin 2026-08-16). The store carries ONLY apps NavBharatAI
            // built — there is no "choose a file from your device" anymore, because that was the one way
            // someone else's malware could enter. You publish an app straight from its finished build
            // (the "Publish to App Mart" button beside Download), which sends the app NavBharatAI
            // made — including one saved to your own GitHub — with no file to upload. See navStore.ts.
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-white/60">
                <p className="flex items-center gap-1.5 text-emerald-300 font-semibold mb-1">
                  <ShieldCheck size={13} /> Publishing is free{status ? ` (₹${status.uploadFeeInr})` : ''}
                </p>
                Your app is scanned for malware and then checked by a person before it appears. That
                usually takes a day. Apps that fail the scan are never stored.
              </div>

              <div className="rounded-xl border border-white/10 bg-[#161b22] p-4">
                <p className="flex items-center gap-1.5 text-sm font-bold text-white mb-2">
                  <Store size={15} className="text-emerald-400" /> Only apps you built with NavBharatAI
                </p>
                <p className="text-xs text-white/60 leading-relaxed">
                  App Mart carries only apps NavBharatAI made — so there is no app-file upload
                  here. You cannot upload a <span className="text-white/80">.apk</span>, a
                  {' '}<span className="text-white/80">.zip</span>, or a file from anywhere else. This is
                  what keeps the store free of apps NavBharatAI did not build.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-[#0d1117] p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3">How to publish your app</p>
                <ol className="space-y-2.5 text-sm text-white/75">
                  <li className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center">1</span>
                    <span>Open the app you built with NavBharatAI (a new one, or one saved to your GitHub).</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center">2</span>
                    <span>Build its Android app (APK) from the build screen.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-600/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center">3</span>
                    <span>
                      Next to <span className="inline-flex items-center gap-1 text-white/90"><Download size={12} /> Download</span>,
                      tap <span className="inline-flex items-center gap-1 font-semibold text-emerald-300"><Store size={12} /> Publish to App Mart</span>.
                      Fill in your name, email and app details there — NavBharatAI sends the build for you,
                      with no file to upload.
                    </span>
                  </li>
                </ol>
                <p className="flex items-start gap-1.5 text-[11px] text-white/45 leading-snug mt-3 pt-3 border-t border-white/10">
                  <Info size={12} className="shrink-0 mt-px" />
                  A NavBharatAI app stored in your GitHub still publishes this way — it is a NavBharatAI
                  build, so it comes straight from your build, never a hand-uploaded file.
                </p>
              </div>
            </div>
          )
        )}

        {/* ── My apps ── */}
        {tab === 'mine' && webMine.length > 0 && (
          <div className="mb-5">
            {owned.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={12} /> Apps you own — take the code any time
                </p>
                <p className="text-[11px] text-white/35 mb-2 leading-relaxed">
                  You bought these. Copying is free and unlimited, for these apps only — buy once, take the code whenever you need it.
                </p>
                <div className="grid gap-2">
                  {owned.map((o) => (
                    <div key={o.appId} className="flex items-center gap-3 p-3 rounded-xl bg-[#161b22] border border-white/10">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{o.name || 'An app you bought'}</p>
                        <p className="text-[11px] text-white/35 mt-0.5">
                          Bought for ₹{o.priceInr}
                          {!o.available && <span className="text-amber-300"> · the creator has taken this off the store — your copy stays yours</span>}
                        </p>
                      </div>
                      {o.available && (
                        <button
                          onClick={() => setPlayingId(o.appId)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex-shrink-0 transition-colors"
                        ><Play size={12} /> Open &amp; copy</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                      {/* SELLING IS PARKED (admin 2026-08-15) — every app is free to remix for now.
                          Shown as a plain label rather than a disabled button: a button that cannot
                          do anything is a promise the screen cannot keep, and the tooltip says what
                          is actually coming rather than pretending something is broken. */}
                      <span
                        title="Every app on the store is free to remix right now. Selling your app — with the money going straight to your own bank — is being built."
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.03] text-[11px] text-white/35"
                      >Selling — coming soon</span>
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
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{a.appName} <span className="text-xs font-normal text-white/40">v{a.versionName}</span></p>
                    {/* The app stays on this screen after approval, saying so — it used to vanish. */}
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                      a.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                    }`}>
                      {reviewStatusLabel(a.status)}
                    </span>
                  </div>
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

                  {/* An APPROVED app is live in the store, so "Publish" and "Reject" would be wrong
                      buttons for it — the only thing left to decide is whether to take it down. */}
                  <div className="flex gap-2 mt-3">
                    {reviewActionsFor(a.status) === 'remove' ? (
                      <button
                        onClick={() => void decide(a.id, 'removed')}
                        disabled={reviewing === a.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 hover:bg-rose-600/20 text-xs font-semibold text-white/70 hover:text-rose-300 disabled:opacity-40"
                      >
                        {reviewing === a.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Remove from store
                      </button>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── App detail ── */}
      {detailApp && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDetailApp(null)}>
          <div className="w-full sm:max-w-lg bg-[#0d1117] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                {detailApp.iconDataUrl ? <img src={detailApp.iconDataUrl} alt="" className="w-full h-full object-cover" /> : <Globe size={20} className="text-white/30" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold truncate flex items-center gap-1.5">{detailApp.name}{detailApp.requiresPassword && <Lock size={12} className="text-white/40" />}</h2>
                <p className="text-[11px] text-white/40">{detailApp.runs} run{detailApp.runs === 1 ? '' : 's'} · A NavBharatAI-built app</p>
              </div>
            </div>

            <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap mb-4">{detailApp.description || 'A NavBharatAI-built app.'}</p>

            {detailLoading ? (
              <p className="flex items-center gap-2 text-xs text-white/40 py-6 justify-center"><Loader2 size={14} className="animate-spin" /> Loading screenshots…</p>
            ) : detailShots.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
                {detailShots.map((s, i) => (
                  <img key={i} src={s} alt={`${detailApp.name} screenshot ${i + 1}`} className="h-64 rounded-xl border border-white/10 object-cover flex-shrink-0" />
                ))}
              </div>
            ) : (detailApp.screenshotCount ?? 0) === 0 ? (
              <p className="text-[11px] text-white/30 mb-2">No screenshots yet.</p>
            ) : null}

            <button
              onClick={() => { const id = detailApp.id; setDetailApp(null); setPlayingId(id); }}
              className="w-full mt-2 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2"
            >
              <Play size={14} /> Open the app
            </button>
            <button onClick={() => setDetailApp(null)} className="w-full mt-2 py-2 rounded-lg text-xs text-white/50 hover:text-white/80">Close</button>
          </div>
        </div>
      )}

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

            {/* DOWNLOAD (admin report 2026-08-19: "app mart se apk download hi nahi hoti").
                Two different jobs, so two paths — a single `<a href>` could not do both:
                  • WEB — a normal link. The browser streams a 30 MB file straight to disk; pulling it
                    into a blob first would hold the whole APK in the tab's memory for no gain.
                  • APP — the WebView has no download manager, so a link to an attachment does exactly
                    nothing (which is what the user saw). Handing it to the system browser gives the
                    file to Android's real downloader, the same `_blank` route UpdateBanner already
                    relies on. The URL is resolved through resolveApiHref because in the bundled app a
                    relative /api path points at the shell itself, not at our server. */}
            <a
              href={resolveApiHref(`/api/nav-store/download/${encodeURIComponent(openApp.id)}`, window)}
              onClick={(e) => {
                if (!isNativeApp()) return; // web: let the browser do what it already does well
                e.preventDefault();
                window.open(e.currentTarget.href, '_blank');
              }}
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
