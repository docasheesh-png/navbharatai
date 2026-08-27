import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Store, Loader2, ShieldCheck, ShieldAlert, AlertTriangle, Download,
  CheckCircle2, X, Clock, ExternalLink, Info, Globe, Play, Link2, Trash2, Lock, Package, Flag,
  Rocket, ImagePlus, Clipboard, Copy,
} from 'lucide-react';
import { WebAppPlayer } from './WebAppPlayer';
import { authedHeaders } from '../../lib/authHeaders';
import { resolveApiHref } from '../../lib/apiBase';
import { isNativeApp } from '../../lib/mobileNative';
import { mergeReviewQueue, pendingReviewCount, reviewStatusLabel, reviewActionsFor } from './storeReviewQueue';
import { publishableApps, publishBlockedReason, type PublishableApp } from './publishablePicker';
import { readStoreIcon, readStoreIconFromClipboard, type IconCheck } from '../../lib/appIcon';

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

  // ── PUBLISH FROM THIS PAGE (admin 2026-08-26) ────────────────────────────────────────────────
  // The Publish tab used to be directions to another screen. These hold the picker that makes it a
  // place you can publish from: your own NavBharatAI apps, the listing details, and the result.
  const [myApps, setMyApps] = useState<PublishableApp[] | null>(null);   // null = not loaded yet
  const [pickWs, setPickWs] = useState('');
  const [pickName, setPickName] = useState('');
  const [pickDesc, setPickDesc] = useState('');
  const [pickIcon, setPickIcon] = useState('');
  const [pickIconErr, setPickIconErr] = useState('');
  const [pickIconBusy, setPickIconBusy] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [pubResult, setPubResult] = useState<{ ok: boolean; message: string; shareUrl?: string } | null>(null);
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
  /** What viewers actually reported. Written since the store shipped; until now, read by nobody. */
  const [reports, setReports] = useState<Array<{ appId: string; appName: string; appStatus: string; reporterUid: string; reason: string; at: number }>>([]);
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

  // The apps THIS user built with NavBharatAI, for the publish picker. `conversations` is the same
  // list the v5 history reads, so an app appears here the moment it exists — no second source of
  // truth to drift. A failure yields an empty list (and the picker says so), never a crash.
  const loadMyApps = useCallback(async () => {
    try {
      const res = await fetch('/api/agentv3/conversations', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      setMyApps(publishableApps(Array.isArray(data?.conversations) ? data.conversations : [], Date.now()));
    } catch {
      if (liveRef.current) setMyApps([]);
    }
  }, []);

  // Choosing an app pre-fills its name — the user can edit it, and a previous result must not linger
  // over a different app's form.
  const choosePublishApp = useCallback((workspaceId: string) => {
    setPickWs(workspaceId);
    setPubResult(null);
    const hit = (myApps ?? []).find((a) => a.workspaceId === workspaceId);
    setPickName(hit ? hit.suggestedName : '');
  }, [myApps]);

  const acceptPickIcon = useCallback(async (run: () => Promise<IconCheck>) => {
    setPickIconBusy(true);
    setPickIconErr('');
    try {
      const r = await run();
      if (!r.ok || !r.dataUrl) { setPickIconErr(r.error || 'That image could not be used.'); return; }
      setPickIcon(r.dataUrl);
    } finally {
      setPickIconBusy(false);
    }
  }, []);

  /**
   * Publish the CHOSEN app as an instant App Mart app.
   *
   * 🔒 The server re-verifies ownership from the token and re-runs the whole publish gate, so this
   * button cannot widen what the store accepts. Its refusals are specific and useful (a hardcoded key
   * with its file and line, "this app needs a server", a size cap) — so they are shown VERBATIM. A
   * generic "publishing failed" here would throw away the one sentence that tells the user what to fix.
   */
  const publishChosenApp = useCallback(async () => {
    if (pubBusy || !pickWs) return;
    const name = pickName.trim();
    if (!name) { setPubResult({ ok: false, message: 'Give your app a name.' }); return; }
    setPubBusy(true);
    setPubResult(null);
    try {
      const res = await fetch('/api/nav-store/web/publish', {
        method: 'POST',
        headers: { ...(await authedHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: pickWs,
          name,
          visibility: 'public',
          ...(pickDesc.trim() ? { description: pickDesc.trim() } : {}),
          ...(pickIcon ? { iconDataUrl: pickIcon } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setPubResult({ ok: false, message: data?.error || 'Publishing failed — nothing was published.' });
        return;
      }
      const shareUrl = `${window.location.origin}${data.shareUrl}`;
      try { await navigator.clipboard?.writeText(shareUrl); } catch { /* the link is shown anyway */ }
      setPubResult({
        ok: true,
        shareUrl,
        message: data.status === 'listed'
          ? 'Published! Your app is live on App Mart.'
          : 'Published! Your link works right now (copied) — the store listing goes live after a quick human review.',
      });
      void loadWebMine();
    } catch {
      setPubResult({ ok: false, message: 'Could not reach NavBharatAI — nothing was published.' });
    } finally {
      setPubBusy(false);
    }
  }, [pubBusy, pickWs, pickName, pickDesc, pickIcon, loadWebMine]);

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

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch('/api/nav-store/web/admin/reports', { headers: await authedHeaders() });
      const data = await res.json().catch(() => null);
      if (liveRef.current) setReports(Array.isArray(data?.reports) ? data.reports : []);
    } catch { /* shown as no reports */ }
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
      void loadReports();
      void loadWebApps();
    } finally {
      if (liveRef.current) setWebBusy('');
    }
  }, [loadWebQueue, loadWebApps]);

  useEffect(() => { void loadStatus(); void loadApps(); void loadWebApps(); }, [loadStatus, loadApps, loadWebApps]);
  // Loaded when the Publish tab is actually opened, not on mount: most people arriving at App Mart
  // want to play an app, and a list nobody asked for is a request nobody needed.
  useEffect(() => { if (tab === 'publish' && myApps === null) void loadMyApps(); }, [tab, myApps, loadMyApps]);
  useEffect(() => {
    if (tab === 'mine') { void loadMine(); void loadWebMine(); void loadOwned(); }
    if (tab === 'review') { void loadQueue(); void loadWebQueue(); void loadReports(); }
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
              {/* ── PUBLISH ONE OF YOUR OWN APPS (admin 2026-08-26) ────────────────────────────
                  First on the page on purpose: this is what someone opening "Publish" came to do.
                  The steps below stay, demoted, because a real installable Android app is a
                  different product from an instant app — not a worse way to do the same thing. */}
              <div className="rounded-xl border border-emerald-500/25 bg-[#0d1117] p-4">
                <p className="flex items-center gap-1.5 text-sm font-bold text-white mb-1">
                  <Rocket size={15} className="text-emerald-400" /> Publish an app you built
                </p>
                <p className="text-xs text-white/55 leading-relaxed mb-3">
                  Pick one of your NavBharatAI apps and it goes on App Mart as an instant app — people
                  open it and it runs in their browser. Nothing to build, nothing to upload.
                </p>

                <label className="block text-[11px] font-bold uppercase tracking-wider text-white/40 mb-1.5">Your app</label>
                <select
                  value={pickWs}
                  onChange={(e) => choosePublishApp(e.target.value)}
                  disabled={myApps === null || myApps.length === 0}
                  aria-label="Choose which of your apps to publish"
                  className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50 disabled:opacity-60"
                >
                  <option value="">
                    {myApps === null ? 'Loading your apps…' : myApps.length === 0 ? 'No apps yet' : 'Choose an app…'}
                  </option>
                  {(myApps ?? []).map((a) => (
                    <option key={a.workspaceId} value={a.workspaceId}>{a.label}{a.live ? ' · live' : ''}</option>
                  ))}
                </select>

                {myApps !== null && myApps.length === 0 && (
                  <p className="flex items-start gap-1.5 text-[11px] text-white/45 leading-snug mt-2">
                    <Info size={12} className="shrink-0 mt-px" />
                    You have not built an app yet. Build one in NavBharatAI Pro v5.0, then come back —
                    it will appear in this list by itself.
                  </p>
                )}

                {pickWs && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-white/40 mb-1.5">App name</label>
                      <input
                        value={pickName}
                        onChange={(e) => setPickName(e.target.value.slice(0, 60))}
                        placeholder="What should people see it called?"
                        className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
                        Short description <span className="text-white/25 normal-case font-medium">(optional)</span>
                      </label>
                      <textarea
                        value={pickDesc}
                        onChange={(e) => setPickDesc(e.target.value.slice(0, 600))}
                        rows={2}
                        placeholder="One or two lines about what it does."
                        className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-500/50 resize-none"
                      />
                    </div>

                    {/* An icon is what a listing is recognised by — the store already had a real bug
                        where apps showed a name and no logo. Same shared pipeline as the other two
                        icon surfaces, so a 1024px AI-generated PNG is fitted rather than refused. */}
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
                        App icon <span className="text-white/25 normal-case font-medium">(optional)</span>
                      </label>
                      <div className="flex items-center gap-2.5">
                        {pickIcon
                          ? <img src={pickIcon} alt="" className="w-11 h-11 rounded-xl object-cover border border-white/10 shrink-0" />
                          : <div className="w-11 h-11 rounded-xl bg-[#161b22] border border-white/10 flex items-center justify-center shrink-0"><Package size={16} className="text-white/25" /></div>}
                        <label className="px-3 py-2 rounded-lg border border-white/10 bg-[#161b22] hover:border-white/25 text-white/80 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors">
                          <ImagePlus size={13} /> Upload
                          <input type="file" accept="image/*" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void acceptPickIcon(() => readStoreIcon(f)); }} />
                        </label>
                        <button
                          type="button"
                          onClick={() => void acceptPickIcon(() => readStoreIconFromClipboard())}
                          className="px-3 py-2 rounded-lg border border-white/10 bg-[#161b22] hover:border-white/25 text-white/80 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                        ><Clipboard size={13} /> Paste</button>
                        {pickIcon && (
                          <button type="button" onClick={() => setPickIcon('')} className="text-[11px] text-white/40 hover:text-white/70 underline underline-offset-2">Remove</button>
                        )}
                      </div>
                      {pickIconBusy && <p className="text-[11px] text-white/40 mt-1.5">Fitting your picture…</p>}
                      {pickIconErr && <p className="text-[11px] text-amber-300 mt-1.5">{pickIconErr}</p>}
                    </div>
                  </div>
                )}

                {/* NO DEAD BUTTON: whenever Publish cannot run, the reason sits right under it. */}
                {(() => {
                  const blocked = publishBlockedReason({
                    signedIn: true, loading: myApps === null, appCount: (myApps ?? []).length,
                    workspaceId: pickWs, name: pickName, busy: pubBusy,
                  });
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => void publishChosenApp()}
                        disabled={blocked !== ''}
                        className="mt-3 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        {pubBusy ? <Loader2 size={15} className="animate-spin" /> : <Store size={15} />}
                        {pubBusy ? 'Publishing…' : 'Publish to App Mart'}
                      </button>
                      {blocked && !pubBusy && (
                        <p className="text-[11px] text-white/45 leading-snug mt-1.5 text-center">{blocked}</p>
                      )}
                    </>
                  );
                })()}

                {/* The gate's refusals name the exact file and line, or the exact cap — shown verbatim,
                    because that one sentence is what tells the user what to fix. */}
                {pubResult && (
                  <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${pubResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
                    <p className="flex items-start gap-1.5">
                      {pubResult.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
                      <span className="whitespace-pre-wrap break-words">{pubResult.message}</span>
                    </p>
                    {pubResult.shareUrl && (
                      <div className="flex items-center gap-2 mt-2">
                        <a href={pubResult.shareUrl} target="_blank" rel="noopener noreferrer"
                          className="flex-1 min-w-0 truncate underline underline-offset-2 hover:text-white">{pubResult.shareUrl}</a>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(pubResult.shareUrl!)}
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/15 text-[11px] font-semibold"><Copy size={11} /> Copy</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

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
                <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1">Want a real Android app (.apk) instead?</p>
                <p className="text-[11px] text-white/45 leading-relaxed mb-3">
                  An instant app runs in the browser (the picker above). An Android app installs on a
                  phone — that one is built from your app's build screen:
                </p>
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

        {/* ── Admin: WHAT VIEWERS REPORTED ───────────────────────────────────────────────────────
            These were written to Firestore from the day the store shipped and READ BY NOTHING, so
            "Report sent — a person will look at it" was a promise the code could not keep. This is
            the person. Newest first, with the app it is about and a way to open or remove it. */}
        {tab === 'review' && status?.isAdmin && reports.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-400/70 mb-2 flex items-center gap-1.5">
              <Flag size={12} /> Reported by viewers ({reports.length})
            </p>
            <div className="space-y-2">
              {reports.map((r, i) => (
                <div key={`${r.appId}-${r.at}-${i}`} className="p-3 rounded-xl bg-[#161b22] border border-rose-500/20">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{r.appName}</p>
                    <span className="text-[10px] text-white/40 shrink-0">
                      {r.at ? new Date(r.at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <p className="text-xs text-white/70 mt-1 whitespace-pre-wrap break-words">{r.reason}</p>
                  <p className="text-[10px] text-white/35 mt-1">
                    {/* Anonymous is recorded honestly rather than dressed up — a reviewer should weigh it. */}
                    {r.reporterUid === 'anon' ? 'from a signed-out viewer' : 'from a signed-in user'}
                    {r.appStatus === 'removed' ? ' · this app is already removed' : ` · status: ${r.appStatus}`}
                  </p>
                  {r.appStatus !== 'removed' && (
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => setPlayingId(r.appId)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-white/70 transition-colors"
                      ><Play size={11} /> See it</button>
                      <button
                        onClick={() => void decideWeb(r.appId, 'removed')}
                        disabled={webBusy === r.appId}
                        className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-500 disabled:opacity-40 text-[11px] text-white font-semibold transition-colors"
                      >Remove this app</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
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
        <div className="nb-sheet-overlay-flush fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDetailApp(null)}>
          <div className="nb-sheet w-full sm:max-w-lg bg-[#0d1117] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
        <div className="nb-sheet-overlay-flush fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpenApp(null)}>
          <div
            className="nb-sheet w-full sm:max-w-lg overflow-y-auto bg-[#161b22] border border-white/10 rounded-t-2xl sm:rounded-2xl p-4 sm:p-5"
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
