import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Users, Zap, IndianRupee, Activity, Shield, Settings, Server, Plus, Search, AlertTriangle, CheckCircle2, Megaphone, Tag, ToggleLeft, ToggleRight, Cpu, TrendingUp, Eye, UserCheck, Globe, Database, FileText, Download, ArrowUpDown, Target, Bell, Clock, Trash2, Flag, Image as PictureIcon } from 'lucide-react';
import { TirangaLoader } from './ui/TirangaLoader';
// @ts-ignore -- XSquare is a valid export in installed lucide-react 0.546.0
import { XSquare as BanIcon } from 'lucide-react';
import { summarizeCostTelemetry, type CostLadderSummary } from '../lib/agentV3CostSummary';
import { summarizeFailurePatterns, summarizeBuildTimes } from '../lib/buildReportAnalytics';
import { firstPassHeadline, FIRST_PASS_TARGET, type FirstPassMetaStats } from '../lib/firstPassQuality';
import { copyTextToClipboard } from '../lib/copyText';
import { reportParts, partJson, partsSummary, ordinal } from './adminReportParts';
import { MonitorPanels } from './admin/MonitorPanels';
import { reportStatus, reportStatusLabel, reportStatusHint, openReportCount, type ReportTriage } from '../server/AgentV3/reportTriage';

interface AdminDashboardProps {
  adminToken: string;
  onLogout: () => void;
}

type TabId = 'monitor' | 'users' | 'engines' | 'revenue' | 'reports' | 'userreports' | 'security' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  // HOME = the live Monitor (2026-08-23). The old Overview content was not removed — it is rendered
  // BELOW the live charts on this same page, so every number the admin already relied on is still
  // here, one screen earlier. Moved rather than copied: two copies of these panels would drift.
  { id: 'monitor',   label: 'Monitor',      icon: Activity },
  { id: 'users',     label: 'Users',        icon: Users },
  { id: 'engines',   label: 'AI Engines',   icon: Cpu },
  { id: 'revenue',   label: 'Revenue',      icon: IndianRupee },
  { id: 'reports',   label: 'Build Reports', icon: FileText },
  // USER REPORTS — a SEPARATE page from Build Reports on purpose (admin 2026-08-21). One is the
  // engine telling us about a build; this is a person telling us about the product or about another
  // person. Mixing them would bury the complaints that need a human.
  { id: 'userreports', label: 'User Reports', icon: Flag },
  { id: 'security',  label: 'Security',     icon: Shield },
  { id: 'settings',  label: 'Settings',     icon: Settings },
];

type ReportTier = 'paid' | 'free' | 'admin' | 'unknown';

interface AdminBuildReportRow extends ReportTriage {
  /** True when the build had not finished at the moment Report was pressed — see AdminBuildReportStore. */
  inFlight?: boolean;
  /** The whole-SESSION view: the wait the user actually lived, and any workspace wipes. */
  sessionLine?: string | null;
  sessionDataLoss?: number | null;
  id: string;
  reportedAt: number;
  userId: string | null;
  email: string | null;
  name: string | null;
  workspaceId: string | null;
  buildId: string | null;
  ok: boolean | null;
  appLabel: string;
  userTier: string | null;
  tier: ReportTier;
  billedInr: number | null;
  billedUsd: number | null;
  buildMs: number | null;
  rootCause: string | null;
  summary: string | null;
  /** How many defects the engine repaired in its OWN output, and how many it left unresolved.
   *  Absent on reports written before this measurement existed — those rows are EXCLUDED from the
   *  first-pass rate rather than counted as clean (see firstPassStatsFromMeta). */
  healCount?: number;
  unresolvedCount?: number;
  /** How many builds/edits of the session the record carries (1 when only the focused build exists). */
  sessionParts?: number;
}

type ReportSortKey = 'time' | 'name' | 'app' | 'tier' | 'charged';
type ReportTierFilter = 'all' | 'paid' | 'free' | 'admin';
type ReportStatusFilter = 'all' | 'ok' | 'failed';

const statCard = (label: string, value: string | number, sub: string, color: string, Icon: React.ComponentType<any>) => (
  <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-5 relative overflow-hidden">
    <div className={`absolute top-0 left-0 w-full h-1 ${color}`} />
    <div className="flex justify-between items-start">
      <div>
        <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">{label}</p>
        <h3 className="text-2xl font-black text-white tracking-tight mt-1 font-mono">{value}</h3>
        <p className="text-[9px] text-[#8b949e] uppercase font-bold tracking-wider mt-2">{sub}</p>
      </div>
      <div className={`p-2.5 rounded-xl border border-white/10 bg-white/5`}>
        <Icon className="w-4 h-4 text-white/60" />
      </div>
    </div>
  </div>
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ adminToken, onLogout }) => {
  const [activeTab, setActiveTab] = useState<TabId>('monitor');
  // ── User reports (admin 2026-08-21) ──────────────────────────────────────
  const [userReports, setUserReports] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [openReport, setOpenReport] = useState<any>(null);
  const [reportFilter, setReportFilter] = useState<'open' | 'all'>('open');
  /** The account sheet: opened FROM a report (or from the Users tab), so a decision is made with the
   *  whole picture in front of the admin rather than from a complaint alone. */
  const [account, setAccount] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [userSort, setUserSort] = useState('tokens');
  const [userSearch, setUserSearch] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Settings state
  const [maintenanceMode, setMaintenanceModeState] = useState(false);
  const [featureFlags, setFeatureFlagsState] = useState<any>({});
  const [pricingConfig, setPricingConfigState] = useState<any>({});
  const [providerEnabled, setProviderEnabledState] = useState<any>({});

  // Promo form
  const [promoCode, setPromoCode] = useState('');
  const [promoTokens, setPromoTokens] = useState('');
  const [promoDiscount, setPromoDiscount] = useState('');
  const [promoMaxUses, setPromoMaxUses] = useState('1');

  // Announcement / user notification
  const [annMsg, setAnnMsg] = useState('');
  const [annTarget, setAnnTarget] = useState('all');
  const [annEmail, setAnnEmail] = useState('');

  // Token adjust
  const [tokenDelta, setTokenDelta] = useState('');
  const [tokenReason, setTokenReason] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  // AgentV3 cost-ladder telemetry (revenue tab) — real per-tier cost & success rate.
  const [costSummary, setCostSummary] = useState<CostLadderSummary | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  // T1-admin-dashboard — build-failure analytics (overall failure rate + spike dates).
  const [failureReport, setFailureReport] = useState<{ overall: { totalBuilds: number; failedBuilds: number; failureRate: number }; spikeDates: string[] } | null>(null);

  // P-MON.6 — FinOps recommendations (real, from /api/admin/finops).
  const [finops, setFinops] = useState<any>(null);
  const [finopsLoading, setFinopsLoading] = useState(false);

  // P-MON.3 — per-provider LLM latency percentiles (real, from /api/admin/llm-latency).
  const [llmLatency, setLlmLatency] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);

  // P-MON.4 — composite platform health score (real, from /api/admin/health-score).
  const [healthScore, setHealthScore] = useState<any>(null);

  // P-MON.5 — AI insights + NL telemetry query (real, from /api/admin/insights).
  const [insights, setInsights] = useState<any>(null);
  const [insightQuestion, setInsightQuestion] = useState('');
  const [insightAnswer, setInsightAnswer] = useState<string | null>(null);
  const [insightAsking, setInsightAsking] = useState(false);

  // P-MON.2 — latency anomaly/trend watch (real, from /api/admin/anomaly/latency).
  const [latencyAnomaly, setLatencyAnomaly] = useState<any>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);

  // P-SEC.3 — admin TOTP MFA enrolment state.
  const [mfaStatus, setMfaStatus] = useState<{ enabled: boolean; envManaged: boolean } | null>(null);
  const [mfaEnroll, setMfaEnroll] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  // Build Reports inbox (admin 2026-07-29) — the reports users submit via the single "Report" button.
  const [buildReports, setBuildReports] = useState<AdminBuildReportRow[]>([]);
  const [buildReportsLoading, setBuildReportsLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState<{
    meta: AdminBuildReportRow;
    report: any;
    /** Every build/edit of that session (admin 2026-08-09) — absent for a single-build report. */
    session?: { builds?: any[]; count?: number; omittedBuilds?: number; historyUnreadable?: boolean } | null;
  } | null>(null);
  const [selectedReportLoading, setSelectedReportLoading] = useState(false);
  /** Which part of the open report the admin is looking at / will copy or download ('all' | index). */
  const [reportPart, setReportPart] = useState('all');
  // ALL BUILDS browser (admin 2026-08-06) — every user's every build, no user submit needed.
  interface AllBuildRow {
    workspaceId: string; savedAt: number; ownerUid: string | null;
    id: string; startedAt?: number; endedAt?: number; ok?: boolean;
    summary?: string; rootCause?: string; prompt?: string;
    /** Resolved server-side from the SAME wallet records the Users tab reads (adminUserLookup.ts). */
    owner?: { label: string; email: string; name: string; shortUid: string; anonymous: boolean };
  }
  const [allBuilds, setAllBuilds] = useState<AllBuildRow[]>([]);
  const [allBuildsLoading, setAllBuildsLoading] = useState(false);
  const [allBuildsSearch, setAllBuildsSearch] = useState('');
  // Four filters, deliberately (see server/lib/buildListFilter.ts for why not more).
  const [allBuildsStatus, setAllBuildsStatus] = useState<'all' | 'failed' | 'succeeded'>('all');
  const [allBuildsDate, setAllBuildsDate] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [allBuildsUid, setAllBuildsUid] = useState('');
  const [allBuildsCounts, setAllBuildsCounts] = useState<{ all: number; failed: number; succeeded: number; unknown: number } | null>(null);
  const [allBuildsUsers, setAllBuildsUsers] = useState<Array<{ uid: string; count: number; label: string }>>([]);
  const [allBuildsFetched, setAllBuildsFetched] = useState<{ fetched: number; limit: number } | null>(null);
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Array<{ id: string; startedAt: number; endedAt?: number; ok?: boolean; summary?: string; prompt?: string }>>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  // Build Reports — filters & sorting (admin 2026-08-01): who sent which report, when, free/paid.
  const [reportSearch, setReportSearch] = useState('');
  const [reportTierFilter, setReportTierFilter] = useState<ReportTierFilter>('all');
  const [reportStatusFilter, setReportStatusFilter] = useState<ReportStatusFilter>('all');
  const [reportSortKey, setReportSortKey] = useState<ReportSortKey>('time');
  const [reportSortAsc, setReportSortAsc] = useState(false); // default: newest first

  // Apply the search + tier + status filters, then sort. Pure derivation of the fetched rows.
  const visibleBuildReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    const filtered = buildReports.filter((r) => {
      if (reportTierFilter !== 'all' && r.tier !== reportTierFilter) return false;
      if (reportStatusFilter === 'ok' && r.ok !== true) return false;
      if (reportStatusFilter === 'failed' && r.ok !== false) return false;
      if (q) {
        const hay = `${r.name ?? ''} ${r.email ?? ''} ${r.appLabel ?? ''} ${r.userId ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = reportSortAsc ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      switch (reportSortKey) {
        case 'name': return dir * (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '');
        case 'app': return dir * (a.appLabel ?? '').localeCompare(b.appLabel ?? '');
        case 'tier': return dir * (a.tier ?? '').localeCompare(b.tier ?? '');
        case 'charged': return dir * ((a.billedInr ?? 0) - (b.billedInr ?? 0));
        case 'time':
        default: return dir * (a.reportedAt - b.reportedAt);
      }
    });
    return sorted;
  }, [buildReports, reportSearch, reportTierFilter, reportStatusFilter, reportSortKey, reportSortAsc]);

  const fmtCharge = (inr: number | null): { text: string; cls: string } => {
    if (inr == null) return { text: '—', cls: 'text-zinc-500' };
    if (inr <= 0) return { text: '₹0', cls: 'text-[#8b949e]' };
    return { text: `₹${inr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, cls: 'text-emerald-300 font-bold' };
  };

  // M8-S8.1 — data-driven failure signal: which failure class recurs most across all reports.
  const failureSummary = useMemo(() => summarizeFailurePatterns(buildReports), [buildReports]);
  // ROADMAP #1 Phase 0.2 — FIRST-PASS QUALITY: the one number that says whether the ENGINE improved.
  // Per the 50/50 law a self-heal is a RED FLAG, so the headline is the CLEAN rate (zero repairs
  // needed), never the delivered rate. Computed from the SAME rows already fetched — one shared
  // implementation with the server route (src/lib/firstPassQuality.ts), so the two can never drift.
  /**
   * IT WAS MEASURING COMPLAINTS, NOT BUILDS (admin screenshot 2026-08-12, showing 4.3%).
   *
   * `buildReports` is the inbox of reports USERS SUBMITTED by pressing "Report", and people press
   * Report when something went WRONG. Computing the engine's first-pass rate from that sample makes
   * the headline read as an engine-wide number while describing a self-selected pile of failures.
   *
   * "4.3% of builds are right first time" and "4.3% of the builds people complained about were right
   * first time" are different sentences, and only the second one was ever true.
   *
   * The comment this replaces said the client shares the server's implementation "so the two can never
   * drift" — which was right about the FUNCTION and blind to the DATA. Sharing a formula while feeding
   * it a different population is exactly how two numbers drift while looking identical. So the card now
   * takes the server's answer, computed over every build by every user, and the local computation is
   * gone rather than left as a second path to get this wrong again.
   */
  const [firstPassData, setFirstPassData] = useState<(FirstPassMetaStats & { headline?: string; reported?: FirstPassMetaStats & { headline?: string } }) | null>(null);
  const fetchFirstPass = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/first-pass-quality?limit=500', { headers });
      const d = await r.json();
      setFirstPassData(d && typeof d.cleanRate !== 'undefined' ? d : null);
    } catch (e) { console.error(e); setFirstPassData(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);
  const firstPass = firstPassData;
  // M6-S6.1 — the speed signal: average / median / slowest build time across all reports.
  const buildTimeSummary = useMemo(() => summarizeBuildTimes(buildReports), [buildReports]);
  const fmtDuration = (ms: number): string => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`);

  const tierBadge = (tier: ReportTier): { label: string; cls: string } => {
    switch (tier) {
      case 'paid': return { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
      case 'free': return { label: 'Free', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' };
      case 'admin': return { label: 'Admin/Tester', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
      default: return { label: 'Unknown', cls: 'bg-zinc-600/20 text-zinc-400 border-zinc-600/30' };
    }
  };

  const headers = { 'x-admin-token': adminToken, 'Content-Type': 'application/json' };

  const toast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000); };

  // UPDATE BROADCAST — "tell the users who are behind that a new build is on Play".
  //
  // Two steps on purpose. PREVIEW is safe and shows exactly who would be reached and who is excluded;
  // SEND hands that same number back to the server, so a stale screen can never fire at a cohort the
  // admin never actually saw. A notification cannot be un-sent.
  const [updateCohort, setUpdateCohort] = useState<{
    latestVersionCode: number | null; targetCount: number; upToDate: number;
    unknownVersion: number; wrongPlatform: number; truncated: boolean; summary: string;
  } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  const fetchUpdateCohort = useCallback(async () => {
    setUpdateBusy(true);
    try {
      const r = await fetch('/api/admin/update-broadcast/preview', { headers });
      setUpdateCohort(await r.json());
    } catch { setUpdateCohort(null); }
    finally { setUpdateBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const sendUpdateBroadcast = useCallback(async () => {
    if (!updateCohort || updateCohort.targetCount <= 0) return;
    // The admin confirms a specific number of people, not a button.
    if (!window.confirm(`Send an update notification to ${updateCohort.targetCount} device(s) on an older build?\n\nThis cannot be undone.`)) return;
    setUpdateBusy(true);
    try {
      const r = await fetch('/api/admin/update-broadcast/send', {
        method: 'POST', headers,
        body: JSON.stringify({ confirmCount: updateCohort.targetCount }),
      });
      const d = await r.json();
      // Report what the SERVER did, never what was requested — including a refusal and its reason.
      toast(d?.blocked ? `Not sent — ${d.reason}` : d?.error ? `Failed — ${d.error}` : `Sent to ${d.sent} device(s).`);
      await fetchUpdateCohort();
    } catch { toast('Could not send the update notification.'); }
    finally { setUpdateBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, updateCohort, fetchUpdateCohort]);

  /** Every user report, newest first. `open` by default — the queue that still needs a person. */
  const fetchUserReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const q = reportFilter === 'open' ? '?status=open' : '';
      const r = await fetch(`/api/admin/reports${q}`, { headers });
      const d = await r.json();
      setUserReports(Array.isArray(d?.reports) ? d.reports : []);
    } catch (e) { console.error(e); setUserReports([]); }
    finally { setReportsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, reportFilter]);

  /** One report in full — the screenshot is fetched HERE, never in the list, so the list stays light. */
  const openUserReport = useCallback(async (id: string) => {
    setOpenReport({ loading: true });
    try {
      const r = await fetch(`/api/admin/reports/${encodeURIComponent(id)}`, { headers });
      const d = await r.json();
      setOpenReport(r.ok ? d : { error: d?.error || 'Could not open that report.' });
    } catch { setOpenReport({ error: 'Could not open that report.' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const markUserReport = useCallback(async (id: string, status: string) => {
    try {
      await fetch(`/api/admin/reports/${encodeURIComponent(id)}/status`, {
        method: 'POST', headers, body: JSON.stringify({ status }),
      });
      setOpenReport(null);
      void fetchUserReports();
    } catch { /* the row stays as it was; the admin can retry */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, fetchUserReports]);

  /** One person's whole account. Every section says whether it was READ — see the route. */
  const openAccount = useCallback(async (uid: string) => {
    setAccount({ loading: true, uid });
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/account`, { headers });
      const d = await r.json();
      setAccount(r.ok ? { ...d, uid } : { error: d?.error || 'Could not open that account.', uid });
    } catch { setAccount({ error: 'Could not open that account.', uid }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const fetchBuildReports = useCallback(async () => {
    setBuildReportsLoading(true);
    try {
      const r = await fetch('/api/admin/build-reports', { headers });
      const d = await r.json();
      setBuildReports(Array.isArray(d?.reports) ? d.reports : []);
    } catch (e) { console.error(e); setBuildReports([]); }
    finally { setBuildReportsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  /**
   * SERVER NECESSITY (admin 2026-08-12) — the one number that decides whether the browser-native plan
   * is worth building: how many past apps were given a Node server they never needed?
   *
   * It lives behind a button rather than loading with the tab because it reads up to 500 build
   * documents. That is a real cost to pay on every visit for a number nobody is looking at most days.
   */
  const [necessity, setNecessity] = useState<{
    headline: string;
    tally: { examined: number; neededAndBuilt: number; builtButNotNeeded: number; neededButMissing: number; neitherNeededNorBuilt: number; reasonCounts: Record<string, number> };
    sample: Array<{ workspaceId: string; prompt: string; neededServer: boolean; reasons: string[]; builtServer: boolean }>;
  } | null>(null);
  const [necessityLoading, setNecessityLoading] = useState(false);

  const fetchNecessity = useCallback(async () => {
    setNecessityLoading(true);
    try {
      const r = await fetch('/api/admin/server-necessity?limit=500', { headers });
      const d = await r.json();
      setNecessity(d?.tally ? d : null);
      if (!d?.tally) toast(d?.error || 'Could not measure — no builds with enough recorded detail yet.');
    } catch (e) { console.error(e); setNecessity(null); toast('Could not measure server necessity.'); }
    finally { setNecessityLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  /**
   * THE PUBLISH CEILING (ROADMAP §10) — how close publishing is to stopping for EVERYONE.
   *
   * Every published app holds one Firebase Hosting channel and the pool is capped per site. Past the
   * cap, the next publish fails for whoever happens to be next, and every one after that. Nothing on
   * our side could see it coming, because our registry counts apps we know about while the cap counts
   * channels that EXIST — and those drifted apart the moment a purge deleted a record and left its
   * channel serving.
   *
   * It loads WITH the overview rather than behind a button, unlike the two panels below: a warning
   * nobody clicks is not a warning, and the cost is one channel list, not 500 build documents.
   */
  const [channels, setChannels] = useState<{
    verdict: { used: number; cap: number; remaining: number; reclaimable: number; level: 'ok' | 'warn' | 'critical'; message: string };
    channels: Array<{ channelId: string; url: string; updateTime: string | null; state: 'live' | 'stale' | 'unknown'; workspaceId: string | null; reclaimable: boolean }>;
  } | null>(null);
  const [channelsError, setChannelsError] = useState('');
  const [reclaiming, setReclaiming] = useState('');

  const fetchChannels = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/hosting/channels', { headers });
      const d = await r.json();
      if (d?.verdict) { setChannels(d); setChannelsError(''); return; }
      // An unreadable list is NOT "zero in use". Say UNKNOWN rather than show a false all-clear on
      // the one number this panel exists for.
      setChannels(null);
      setChannelsError(d?.error || 'Could not read the hosting channel list — the ceiling is UNKNOWN, not clear.');
    } catch (e) { console.error(e); setChannels(null); setChannelsError('Could not read the hosting channel list — the ceiling is UNKNOWN, not clear.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const reclaimChannel = useCallback(async (channelId: string) => {
    setReclaiming(channelId);
    try {
      const r = await fetch(`/api/admin/hosting/channels/${encodeURIComponent(channelId)}/reclaim`, { method: 'POST', headers });
      const d = await r.json();
      if (d?.ok) { toast(`Reclaimed ${channelId}.`); await fetchChannels(); }
      else toast(d?.error || 'Reclaim failed — the channel was NOT removed.');
    } catch (e) { console.error(e); toast('Reclaim failed — the channel was NOT removed.'); }
    finally { setReclaiming(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, fetchChannels]);

  /**
   * SANDBOX HANDOVER (Phase 0 of IN_BROWSER_PREVIEW_PLAN.md) — where a sandbox's billed life goes.
   *
   * The companion to Server necessity, and deliberately capable of returning bad news: if post-build
   * holding turns out to be a small share, Phase 3 is a reliability change and must not be sold as a
   * cost one. Same button-gated loading, for the same reason — it reads up to 500 build documents plus
   * the sandbox records.
   */
  const [handover, setHandover] = useState<{
    headline: string;
    tally: { examined: number; measured: number; buildHours: number; heldAfterHours: number; frontendOnlyCount: number; recoverableHours: number; unknown: Record<string, number> };
    projection: { spanDays: number; recoverableHoursPerDay: number; monthlyUsdEstimate: number };
    sample: Array<{ workspaceId: string; prompt: string; known: boolean; why?: string; buildMinutes?: number; heldAfterMinutes?: number; frontendOnly?: boolean }>;
  } | null>(null);
  const [handoverLoading, setHandoverLoading] = useState(false);

  const fetchHandover = useCallback(async () => {
    setHandoverLoading(true);
    try {
      const r = await fetch('/api/admin/sandbox-handover?limit=500', { headers });
      const d = await r.json();
      setHandover(d?.tally ? d : null);
      if (!d?.tally) toast(d?.error || 'Could not measure — no builds with both a settled report and a sandbox record yet.');
    } catch (e) { console.error(e); setHandover(null); toast('Could not measure sandbox handover.'); }
    finally { setHandoverLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  /**
   * WHY IS APPLE SIGN-IN FAILING? — the answer, from inside production (admin 2026-08-22).
   *
   * `/api/admin/apple-signin` has existed since 2026-08-21 and had NO UI, so the only way to read it
   * was to curl it with an admin token. For an admin who does not use a terminal that is the same as
   * not having built it — and it is the one check that can say "stop looking at our code" with
   * evidence instead of confidence.
   *
   * The optional code box is what makes the answer sharp. `auth/invalid-credential` PROVES Apple
   * already accepted the sign-in, so the report can point at Firebase's four Apple values instead of
   * sending the admin back to press Verify in Apple's portal — which is exactly the wrong-portal trip
   * this pair of fixes exists to stop. Leave it empty and the report answers as it always did.
   *
   * Unlike the two buttons beside it this reads no build documents, so it is cheap; it is behind a
   * button because it makes a live HTTP request to our own public URL.
   */
  const [appleDiag, setAppleDiag] = useState<{
    verdict: string; message: string; nextStep: string | null;
    url?: string; configured?: boolean; source?: string | null;
    servedLength?: number; fetchedLength?: number | null; fetchedStatus?: number | null;
    fetchError?: string | null; serviceId?: string; returnUrl?: string; observedCode?: string | null;
  } | null>(null);
  const [appleDiagLoading, setAppleDiagLoading] = useState(false);
  const [appleObservedCode, setAppleObservedCode] = useState('');

  const fetchAppleDiag = useCallback(async () => {
    setAppleDiagLoading(true);
    try {
      const code = appleObservedCode.trim();
      const q = code ? `?code=${encodeURIComponent(code)}` : '';
      const r = await fetch(`/api/admin/apple-signin${q}`, { headers });
      const d = await r.json();
      // A verdict is the ONE field every answer carries. Keying off it means a changed payload shows
      // an honest "could not check" rather than an empty card that looks like a clean result.
      setAppleDiag(d?.verdict ? d : null);
      if (!d?.verdict) toast(d?.error || 'Could not check Apple sign-in.');
    } catch (e) { console.error(e); setAppleDiag(null); toast('Could not check Apple sign-in.'); }
    finally { setAppleDiagLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, appleObservedCode]);

  const openBuildReport = useCallback(async (id: string) => {
    setSelectedReportLoading(true);
    setReportPart('all'); // a new report always opens on the whole thing, never the previous part index
    try {
      const r = await fetch(`/api/admin/build-reports/${encodeURIComponent(id)}`, { headers });
      if (!r.ok) throw new Error('not found');
      const d = await r.json();
      setSelectedReport(d);
    } catch (e) { console.error(e); toast('Could not open that report.'); }
    finally { setSelectedReportLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  // ALL BUILDS browser helpers — the admin's window over EVERY workspace's durable reports.
  const fetchAllBuilds = useCallback(async () => {
    setAllBuildsLoading(true);
    try {
      const params = new URLSearchParams();
      if (allBuildsSearch.trim()) params.set('q', allBuildsSearch.trim());
      if (allBuildsStatus !== 'all') params.set('status', allBuildsStatus);
      if (allBuildsDate !== 'all') params.set('date', allBuildsDate);
      if (allBuildsUid) params.set('uid', allBuildsUid);
      const qs = params.toString() ? `?${params}` : '';
      const r = await fetch(`/api/admin/all-builds${qs}`, { headers });
      const d = await r.json();
      setAllBuilds(Array.isArray(d?.builds) ? d.builds : []);
      setAllBuildsCounts(d?.counts ?? null);
      setAllBuildsUsers(Array.isArray(d?.users) ? d.users : []);
      setAllBuildsFetched(typeof d?.fetched === 'number' ? { fetched: d.fetched, limit: d.limit ?? 0 } : null);
    } catch (e) { console.error(e); setAllBuilds([]); setAllBuildsCounts(null); setAllBuildsUsers([]); }
    finally { setAllBuildsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, allBuildsSearch, allBuildsStatus, allBuildsDate, allBuildsUid]);

  const expandWorkspaceBuilds = useCallback(async (workspaceId: string) => {
    if (expandedWorkspace === workspaceId) { setExpandedWorkspace(null); setExpandedHistory([]); return; }
    setExpandedWorkspace(workspaceId);
    setExpandedLoading(true);
    try {
      const r = await fetch(`/api/admin/all-builds/${encodeURIComponent(workspaceId)}`, { headers });
      const d = await r.json();
      setExpandedHistory(Array.isArray(d?.history) ? d.history : []);
    } catch (e) { console.error(e); setExpandedHistory([]); }
    finally { setExpandedLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, expandedWorkspace]);

  /** Save a JSON string as a file. One implementation — every Download button funnels through it. */
  const saveJsonFile = (json: string, filename: string) => {
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { console.error(e); toast('Download failed.'); }
  };

  /** Copy a JSON string, and say honestly whether it worked (a browser can refuse the clipboard). */
  const copyJson = async (json: string, what: string) => {
    if (!json) { toast('Nothing to copy — that part is empty.'); return; }
    const ok = await copyTextToClipboard(json);
    toast(ok ? `${what} copied as JSON.` : 'Copy blocked by the browser — use Download instead.');
  };

  // Auth header rides on fetch (a plain <a href> cannot carry it). Returns the pretty JSON so the
  // Download and Copy buttons share ONE fetch path and can never diverge in what they hand over.
  const fetchWorkspaceReportJson = async (workspaceId: string, buildId?: string): Promise<string> => {
    try {
      const qs = buildId ? `?build=${encodeURIComponent(buildId)}` : '';
      const r = await fetch(`/api/admin/all-builds/${encodeURIComponent(workspaceId)}/download${qs}`, { headers });
      if (!r.ok) { toast('No report recorded for that build.'); return ''; }
      return JSON.stringify(await r.json(), null, 2);
    } catch (e) { console.error(e); toast('Could not load that report.'); return ''; }
  };

  const downloadWorkspaceReport = async (workspaceId: string, buildId?: string) => {
    const json = await fetchWorkspaceReportJson(workspaceId, buildId);
    if (!json) return;
    saveJsonFile(json, buildId ? `build-${workspaceId}-${buildId}.json` : `build-session-${workspaceId}.json`);
  };

  const copyWorkspaceReport = async (workspaceId: string, buildId?: string) => {
    const json = await fetchWorkspaceReportJson(workspaceId, buildId);
    if (!json) return;
    await copyJson(json, buildId ? 'Build' : 'Full session');
  };

  // PARTS (admin 2026-08-09): a submitted report now carries the WHOLE session, so Download/Copy act
  // on the CHOSEN part — "All", or the 1st / 2nd / 3rd … build — never silently on just one of them.
  const selectedParts = useMemo(() => reportParts(selectedReport), [selectedReport]);
  const selectedPartJson = useMemo(() => partJson(selectedReport, reportPart), [selectedReport, reportPart]);
  const selectedPartMeta = selectedParts.find((p) => p.key === reportPart) ?? selectedParts[0];

  /**
   * TRIAGE MARKS (admin request 2026-08-12). Sends one mark and folds the SERVER's merged answer back
   * into the list, so a badge is only ever drawn from a mark that actually persisted — an optimistic
   * local update would show "Fixed" on a write that silently failed, which is the one thing this
   * feature must never do.
   */
  const markReport = async (id: string, mark: { downloaded?: boolean; fixed?: boolean; note?: string }) => {
    try {
      const r = await fetch(`/api/admin/build-reports/${encodeURIComponent(id)}/mark`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(mark),
      });
      if (!r.ok) { toast('Could not save that mark.'); return; }
      const { triage } = await r.json() as { triage: ReportTriage };
      setBuildReports((rows) => rows.map((row) => (row.id === id ? { ...row, ...triage } : row)));
      setSelectedReport((s) => (s && s.meta.id === id ? { ...s, meta: { ...s.meta, ...triage } } : s));
    } catch (e) { console.error(e); toast('Could not save that mark.'); }
  };

  // DELETE a report from the inbox (admin 2026-08-16: "delete karne ka option do — agar space kha rahi
  // ho"). Each record can be ~1 MB, so a handled report is pure stored cost once its bug is fixed.
  const deleteReport = async (id: string) => {
    if (!window.confirm('Delete this build report permanently? This frees its storage and cannot be undone.')) return;
    try {
      const r = await fetch(`/api/admin/build-reports/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      if (!r.ok) { toast('Could not delete that report.'); return; }
      setBuildReports((rows) => rows.filter((row) => row.id !== id));
      setSelectedReport((s) => (s && s.meta.id === id ? null : s));
      toast('Report deleted.');
    } catch (e) { console.error(e); toast('Could not delete that report.'); }
  };

  const clearAllReports = async () => {
    if (buildReports.length === 0) { toast('The inbox is already empty.'); return; }
    if (!window.confirm(`Delete ALL ${buildReports.length} build reports permanently? This frees their storage and cannot be undone.`)) return;
    try {
      const r = await fetch('/api/admin/build-reports/clear', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
      });
      if (!r.ok) { toast('Could not clear the reports.'); return; }
      const { deleted } = await r.json() as { deleted: number };
      setBuildReports([]);
      setSelectedReport(null);
      toast(`Deleted ${deleted} report(s).`);
    } catch (e) { console.error(e); toast('Could not clear the reports.'); }
  };

  const downloadSelectedReport = () => {
    if (!selectedPartJson) { toast('Nothing to download.'); return; }
    saveJsonFile(selectedPartJson, `${selectedPartMeta?.filename || `build-report-${selectedReport?.meta.id}`}.json`);
    // Downloading is a FACT about the admin's action, so it is recorded automatically. It is NOT a
    // claim that the work is done — that is the separate "Fixed" mark, which only a person sets.
    if (selectedReport?.meta.id) void markReport(selectedReport.meta.id, { downloaded: true });
  };

  const copySelectedReport = () => void copyJson(selectedPartJson, selectedPartMeta?.label || 'Report');

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/analytics', { headers });
      const d = await r.json();
      setAnalytics(d);
      setMaintenanceModeState(d.maintenanceMode ?? false);
      setFeatureFlagsState(d.featureFlags ?? {});
      setPricingConfigState(d.pricingConfig ?? {});
      setProviderEnabledState(d.providerEnabled ?? {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [adminToken]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const r = await fetch(`/api/admin/users?sort=${userSort}&search=${encodeURIComponent(userSearch)}`, { headers });
      // HONESTY (admin bug 2026-07-15: "users list show nahi ho rahi"): the old code did
      // `Array.isArray(d) ? d : []`, so a 401 (expired admin token) / 500 (Firestore error) response
      // body — an OBJECT, not an array — was silently shown as "No users found", indistinguishable from
      // a genuinely-empty list. Check r.ok first and surface the REAL reason so the admin can act
      // (re-login on 401, see the Firestore error on 500) instead of a misleading empty state.
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as any));
        const reason = body?.detail || body?.error || `HTTP ${r.status}`;
        setUsers([]);
        setUsersError(r.status === 401 ? 'Admin session expired — please log out and log in again.' : `Couldn't load users: ${reason}`);
        return;
      }
      const d = await r.json();
      setUsers(Array.isArray(d) ? d : []);
      if (!Array.isArray(d)) setUsersError('Unexpected response from the server.');
    } catch (e: any) {
      setUsers([]);
      setUsersError(`Couldn't reach the server: ${e?.message || 'network error'}`);
    } finally { setUsersLoading(false); }
  }, [adminToken, userSort, userSearch]);

  const fetchPromos = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/promo', { headers });
      const d = await r.json();
      setPromos(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
  }, [adminToken]);

  const fetchCostTelemetry = useCallback(async () => {
    setCostLoading(true);
    try {
      const r = await fetch('/api/admin/agentv3/cost-telemetry?days=30', { headers });
      const d = await r.json();
      setCostSummary(summarizeCostTelemetry(Array.isArray(d?.history) ? d.history : []));
      try {
        const fr = await fetch('/api/admin/agentv3/build-analytics?days=30', { headers });
        const fd = await fr.json();
        setFailureReport(fd && fd.overall ? fd : null);
      } catch { setFailureReport(null); }
    } catch (e) {
      console.error(e);
      setCostSummary(summarizeCostTelemetry([]));
    } finally {
      setCostLoading(false);
    }
  }, [adminToken]);

  const fetchFinOps = useCallback(async () => {
    setFinopsLoading(true);
    try {
      const r = await fetch('/api/admin/finops', { headers });
      const d = await r.json();
      setFinops(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setFinops(null);
    } finally {
      setFinopsLoading(false);
    }
  }, [adminToken]);

  const fetchLlmLatency = useCallback(async () => {
    setLlmLoading(true);
    try {
      const r = await fetch('/api/admin/llm-latency', { headers });
      const d = await r.json();
      setLlmLatency(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setLlmLatency(null);
    } finally {
      setLlmLoading(false);
    }
  }, [adminToken]);

  const fetchHealthScore = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/health-score', { headers });
      const d = await r.json();
      setHealthScore(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setHealthScore(null);
    }
  }, [adminToken]);

  const fetchInsights = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/insights', { headers });
      const d = await r.json();
      setInsights(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setInsights(null);
    }
  }, [adminToken]);

  const askInsight = useCallback(async () => {
    const question = insightQuestion.trim();
    if (!question) return;
    setInsightAsking(true);
    setInsightAnswer(null);
    try {
      const r = await fetch('/api/admin/insights/query', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const d = await r.json();
      setInsightAnswer(typeof d?.answer === 'string' ? d.answer : 'No answer available.');
    } catch (e) {
      console.error(e);
      setInsightAnswer('Query failed. Please try again.');
    } finally {
      setInsightAsking(false);
    }
  }, [adminToken, insightQuestion]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);
  useEffect(() => { if (activeTab === 'monitor') { fetchHealthScore(); fetchInsights(); fetchChannels(); } }, [activeTab, fetchHealthScore, fetchInsights, fetchChannels]);
  useEffect(() => { if (activeTab === 'users') fetchUsers(); }, [activeTab, fetchUsers]);
  useEffect(() => { if (activeTab === 'settings') { fetchPromos(); fetchUpdateCohort(); } }, [activeTab, fetchPromos, fetchUpdateCohort]);
  useEffect(() => { if (activeTab === 'revenue') { fetchCostTelemetry(); fetchFinOps(); } }, [activeTab, fetchCostTelemetry, fetchFinOps]);
  useEffect(() => { if (activeTab === 'reports') { fetchBuildReports(); fetchFirstPass(); } }, [activeTab, fetchBuildReports, fetchFirstPass]);
  useEffect(() => { if (activeTab === 'userreports') fetchUserReports(); }, [activeTab, fetchUserReports]);
  const fetchLatencyAnomaly = useCallback(async () => {
    setAnomalyLoading(true);
    try {
      const r = await fetch('/api/admin/anomaly/latency', { headers });
      const d = await r.json();
      setLatencyAnomaly(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setLatencyAnomaly(null);
    } finally {
      setAnomalyLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { if (activeTab === 'engines') { fetchLlmLatency(); fetchLatencyAnomaly(); } }, [activeTab, fetchLlmLatency, fetchLatencyAnomaly]);

  // ── P-SEC.3 — admin MFA enrolment handlers ──
  const fetchMfaStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/mfa/status', { headers });
      const d = await r.json();
      setMfaStatus(d && typeof d === 'object' ? d : null);
    } catch (e) { console.error(e); setMfaStatus(null); }
  }, [adminToken]);

  useEffect(() => { if (activeTab === 'security') fetchMfaStatus(); }, [activeTab, fetchMfaStatus]);

  const startMfaEnroll = async () => {
    setMfaBusy(true);
    try {
      const r = await fetch('/api/admin/mfa/enroll', { method: 'POST', headers });
      const d = await r.json();
      if (r.ok && d.secret) { setMfaEnroll(d); setMfaCode(''); }
      else toast(d.error || 'Failed to start enrolment.');
    } catch (e: any) { toast(`Error: ${e?.message || e}`); }
    finally { setMfaBusy(false); }
  };

  const confirmMfaEnroll = async () => {
    setMfaBusy(true);
    try {
      const r = await fetch('/api/admin/mfa/verify', { method: 'POST', headers, body: JSON.stringify({ code: mfaCode }) });
      const d = await r.json();
      if (r.ok && d.ok) { toast('MFA enabled ✓'); setMfaEnroll(null); setMfaCode(''); fetchMfaStatus(); }
      else toast(d.error || 'Invalid code.');
    } catch (e: any) { toast(`Error: ${e?.message || e}`); }
    finally { setMfaBusy(false); }
  };

  const disableMfa = async () => {
    setMfaBusy(true);
    try {
      const r = await fetch('/api/admin/mfa/disable', { method: 'POST', headers, body: JSON.stringify({ code: mfaCode }) });
      const d = await r.json();
      if (r.ok && d.ok) { toast('MFA disabled.'); setMfaCode(''); fetchMfaStatus(); }
      else toast(d.error || 'Could not disable MFA.');
    } catch (e: any) { toast(`Error: ${e?.message || e}`); }
    finally { setMfaBusy(false); }
  };

  const adminPost = async (url: string, body: any) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return r.json();
  };

  const handleTokenAdjust = async (userId: string) => {
    if (!tokenDelta) return;
    setActionLoading(userId);
    try {
      const r = await adminPost(`/api/admin/users/${userId}/tokens`, { delta: parseInt(tokenDelta), reason: tokenReason });
      if (r.ok) { toast(`Tokens adjusted! New balance: ${r.newBalance}`); fetchUsers(); setTokenDelta(''); setTokenReason(''); setSelectedUserId(''); }
      else toast('Error: ' + r.error);
    } finally { setActionLoading(null); }
  };

  const handleBan = async (userId: string, banned: boolean) => {
    setActionLoading(userId + '_ban');
    try {
      const r = await adminPost(`/api/admin/users/${userId}/ban`, { banned, reason: 'Admin action' });
      if (r.ok) { toast(banned ? 'User banned' : 'User unbanned'); fetchUsers(); }
      else toast('Error: ' + r.error);
    } finally { setActionLoading(null); }
  };

  const handlePro = async (userId: string, grant: boolean) => {
    setActionLoading(userId + '_pro');
    try {
      const r = await adminPost(`/api/admin/users/${userId}/pro`, { grant });
      if (r.ok) { toast(grant ? 'Pro granted!' : 'Pro revoked'); fetchUsers(); }
      else toast('Error: ' + r.error);
    } finally { setActionLoading(null); }
  };

  // Merge a duplicate account's wallet INTO this user (one person = one wallet). The admin PROVES the
  // two accounts are the same person by supplying the source userId. Debt carries, welcome bonus counts
  // once, real purchases carry (server-side tested mergeWallets). Confirmed before running (irreversible).
  const handleMerge = async (intoUserId: string) => {
    const fromUserId = window.prompt(`Merge which account's wallet INTO this user?\nEnter the SOURCE userId (the duplicate to retire).\n\nDebt carries, welcome bonus counts once, purchases carry. The source wallet is zeroed and retired.`);
    if (!fromUserId || !fromUserId.trim()) return;
    if (!window.confirm(`Merge wallet of\n  ${fromUserId.trim()}\nINTO\n  ${intoUserId}\n?\nThis is irreversible. The source is zeroed and flagged merged.`)) return;
    setActionLoading(intoUserId + '_merge');
    try {
      const r = await adminPost(`/api/admin/users/${intoUserId}/merge`, { fromUserId: fromUserId.trim() });
      if (r.ok) { toast(`Merged! New balance: ${(r.newBalance ?? 0).toLocaleString()} tokens`); fetchUsers(); }
      else toast('Merge failed: ' + (r.detail || r.error));
    } finally { setActionLoading(null); }
  };

  const handleSettingsSave = async () => {
    const r = await adminPost('/api/admin/settings', { maintenanceMode, featureFlags, pricingConfig, providerEnabled });
    if (r.ok) toast('Settings saved!');
    else toast('Error saving settings');
  };

  const handleAnnouncement = async () => {
    if (!annMsg.trim()) return;
    if (annTarget === 'user' && !annEmail.trim()) { toast('Enter the user’s email to message one user.'); return; }
    const r = await adminPost('/api/admin/announcement', { message: annMsg, target: annTarget, email: annTarget === 'user' ? annEmail.trim() : undefined });
    if (r.ok) { toast(annTarget === 'user' ? `Message sent to ${annEmail.trim()}` : 'Message sent to all users!'); setAnnMsg(''); setAnnEmail(''); }
    else toast('Error: ' + r.error);
  };

  const handlePromoCreate = async () => {
    if (!promoCode) return;
    const r = await adminPost('/api/admin/promo', { code: promoCode, freeTokens: parseInt(promoTokens) || 0, discountPct: parseInt(promoDiscount) || 0, maxUses: parseInt(promoMaxUses) || 1 });
    if (r.ok) { toast('Promo code created!'); setPromoCode(''); setPromoTokens(''); setPromoDiscount(''); fetchPromos(); }
    else toast('Error: ' + r.error);
  };

  const providerColors: Record<string, string> = { gemini: 'bg-blue-500', anthropic: 'bg-orange-500', grok: 'bg-purple-500', vertex: 'bg-green-500', openai: 'bg-emerald-500' };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 py-4 text-left">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-6 right-6 z-50 bg-indigo-600 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-2xl animate-in slide-in-from-top-2">
          {toastMsg}
        </div>
      )}

      {/* Header — logout always pinned top-right, visible on all screen sizes */}
      <div className="relative flex items-start justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex-1 min-w-0 pr-24">
          <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block" />
            Platform Administration Console
          </p>
          <h1 className="text-2xl font-black text-white uppercase tracking-tight mt-1">navBharatAI Admin</h1>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={fetchAnalytics} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 hover:border-indigo-500 rounded-xl text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {analytics?.maintenanceMode && (
              <span className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-xl text-[10px] font-black text-red-400 uppercase tracking-widest">Maintenance ON</span>
            )}
          </div>
        </div>
        {/* Logout — always top-right, never wraps off screen */}
        <button
          onClick={() => { localStorage.removeItem('admin_token'); onLogout(); }}
          className="absolute top-0 right-0 px-4 py-2.5 bg-red-500/10 hover:bg-red-500 active:bg-red-600 border border-red-500/30 text-red-400 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 whitespace-nowrap"
        >
          Logout
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#161b22] p-1 rounded-2xl border border-white/5 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-[#8b949e] hover:text-white hover:bg-white/5'}`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {loading && !analytics ? (
        <div className="py-24 text-center">
          <TirangaLoader className="w-10 h-10 mx-auto mb-4" />
          <p className="text-xs text-[#8b949e] font-black uppercase tracking-widest">Loading dashboard data...</p>
        </div>
      ) : (
        <>
          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'monitor' && (
            <div className="space-y-6">
              {/* LIVE MONITOR — real time-series from the platform's own telemetry. Everything below it
                  is the business view the Overview tab used to hold, unchanged. */}
              <MonitorPanels adminToken={adminToken} />

              <div className="pt-1">
                <h2 className="text-[11px] font-black text-white uppercase tracking-widest">Business</h2>
                <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-widest mt-0.5">
                  Revenue, users and lifetime usage — from Firestore, not the live window above
                </p>
              </div>

              {/* Row 1: 4 key metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statCard('Total Revenue', `₹${(analytics?.totalRevenue || 0).toLocaleString('en-IN')}`, 'Verified payments', 'bg-emerald-500', IndianRupee)}
                {statCard('Registered Users', analytics?.totalUsers || 0, `+${analytics?.newUsersToday || 0} today`, 'bg-indigo-500', Users)}
                {statCard('Website Hits Today', (analytics?.websiteHitsToday || 0).toLocaleString(), `${(analytics?.websiteHitsTotal || 0).toLocaleString()} total`, 'bg-sky-500', Globe)}
                {statCard('Active (24h)', analytics?.activeUsers24h || 0, 'Unique users with AI requests', 'bg-violet-500', Activity)}
              </div>

              {/* Row 2: 4 more metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statCard('Output Tokens', (analytics?.totalTokensUsed || 0).toLocaleString(), 'All providers combined', 'bg-amber-500', Zap)}
                {statCard('Platform Margin', `₹${(analytics?.estimatedProfit || 0).toFixed(2)}`, 'Revenue minus AI cost', (analytics?.estimatedProfit || 0) >= 0 ? 'bg-emerald-500' : 'bg-red-500', TrendingUp)}
                {statCard('Token Purchases', analytics?.tokenPurchaseCount || 0, 'Paid transactions', 'bg-pink-500', Tag)}
                {statCard('Cost / Request', `₹${(analytics?.burnRate || 0).toFixed(5)}`, 'Direct provider cost', 'bg-orange-500', Cpu)}
              </div>

              {/* ── THE PUBLISH CEILING (ROADMAP §10) ────────────────────────────────────────
                  Every published app holds one Firebase Hosting channel, and the pool is capped per
                  site. Past the cap, publishing stops for EVERY user at once. This is the only place
                  that number is visible — and the only place a channel orphaned by a deleted chat
                  can be found at all, since its id is a one-way hash with no record left to trace. */}
              {(channels || channelsError) && (
                <div className={`rounded-[1.5rem] p-6 border ${
                  channelsError ? 'bg-[#161b22] border-white/10'
                  : channels?.verdict.level === 'critical' ? 'bg-red-500/5 border-red-500/30'
                  : channels?.verdict.level === 'warn' ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-[#161b22] border-white/10'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Publish Capacity</h3>
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${
                      channelsError ? 'bg-white/5 border-white/10 text-[#8b949e]'
                      : channels?.verdict.level === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : channels?.verdict.level === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
                      {channelsError ? 'unknown' : channels?.verdict.level}
                    </span>
                  </div>

                  {channelsError ? (
                    <p className="text-xs text-[#8b949e] leading-relaxed">{channelsError}</p>
                  ) : channels && (
                    <>
                      <p className="text-xs text-white/80 leading-relaxed">{channels.verdict.message}</p>
                      <p className="text-[11px] text-[#8b949e] mt-1.5 leading-relaxed">
                        {channels.verdict.remaining} more app{channels.verdict.remaining === 1 ? '' : 's'} can be published before
                        the limit. The cap of {channels.verdict.cap} is a working figure — Google does not publish this number —
                        so treat it as approximate until a real &quot;quota reached&quot; confirms it.
                      </p>

                      {channels.channels.some((c) => c.reclaimable) && (
                        <div className="mt-4 space-y-2">
                          <p className="text-[10px] font-black uppercase tracking-wider text-[#8b949e]">
                            Wasted channels — no live app is using these
                          </p>
                          {channels.channels.filter((c) => c.reclaimable).map((c) => (
                            <div key={c.channelId} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/5 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-mono text-white/80 truncate">{c.channelId}</p>
                                <p className="text-[10px] text-[#8b949e] truncate">
                                  {c.state === 'unknown'
                                    /* No record anywhere — a purge deleted it and left the app serving. */
                                    ? 'Its chat and record are gone, but the app is still live'
                                    /* Both unpublish and takedown delete the channel BEFORE the registry,
                                       so this state means one of those deletes failed and said success. */
                                    : `Marked not-live, but the channel still exists${c.workspaceId ? ` · ${c.workspaceId}` : ''}`}
                                </p>
                              </div>
                              <button
                                onClick={() => void reclaimChannel(c.channelId)}
                                disabled={reclaiming === c.channelId}
                                className="shrink-0 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-600/20 text-[10px] font-black uppercase tracking-wider text-white/70 hover:text-red-300 disabled:opacity-40"
                              >
                                {reclaiming === c.channelId ? 'Reclaiming…' : 'Reclaim'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── P-MON.4 Composite platform health (real, from /api/admin/health-score) ── */}
              {healthScore?.score && (
                <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Platform Health Score</h3>
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${
                      healthScore.score.grade === 'excellent' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : healthScore.score.grade === 'good' ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                      : healthScore.score.grade === 'fair' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : healthScore.score.grade === 'unknown' ? 'bg-white/5 border-white/10 text-[#8b949e]'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                      {healthScore.score.grade}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {([
                      { label: 'Health', value: healthScore.score.health, good: (v: number) => v >= 75 },
                      { label: 'Reliability', value: healthScore.score.reliability, good: (v: number) => v >= 75 },
                      { label: 'Risk', value: healthScore.score.risk, good: (v: number) => v <= 25 },
                    ] as const).map(m => (
                      <div key={m.label} className="bg-black/30 rounded-xl p-4 text-center">
                        <div className="text-[9px] text-[#8b949e] uppercase font-bold tracking-widest">{m.label}</div>
                        <div className={`text-2xl font-black font-mono mt-1 ${
                          m.value == null ? 'text-[#8b949e]' : m.good(m.value) ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {m.value == null ? '—' : m.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(healthScore.score.missing) && healthScore.score.missing.length > 0 && (
                    <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest mt-3">
                      No data yet for: {healthScore.score.missing.join(', ')} — excluded from the score (not faked).
                    </p>
                  )}
                </div>
              )}

              {/* ── P-MON.5 AI Insights (real, deterministic from live metrics) + NL query ── */}
              {insights && (
                <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">AI Insights</h3>
                    <span className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest">Derived from live metrics — not projected</span>
                  </div>
                  <div className="space-y-2">
                    {(insights.insights || []).map((i: any) => (
                      <div key={i.id} className="flex items-start gap-3 bg-black/30 rounded-xl p-3">
                        <span className={`mt-0.5 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0 ${
                          i.severity === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-400'
                          : i.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                          : i.severity === 'good' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-white/5 border-white/10 text-[#8b949e]'}`}>
                          {i.severity}
                        </span>
                        <div>
                          <div className="text-xs font-bold text-white">{i.headline}</div>
                          <div className="text-[11px] text-[#8b949e] mt-0.5">{i.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* NL telemetry query */}
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <div className="flex gap-2">
                      <input
                        value={insightQuestion}
                        onChange={(e) => setInsightQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') askInsight(); }}
                        placeholder="Ask: cost? success rate? which provider is cheapest?"
                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-[#484f58] focus:outline-none focus:border-indigo-500/50"
                      />
                      <button
                        onClick={askInsight}
                        disabled={insightAsking || !insightQuestion.trim()}
                        className="bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold uppercase px-4 rounded-lg disabled:opacity-40 hover:bg-indigo-500/30 transition-colors"
                      >
                        {insightAsking ? '…' : 'Ask'}
                      </button>
                    </div>
                    {insightAnswer && (
                      <p className="text-[11px] text-[#c9d1d9] bg-black/30 rounded-lg p-3 mt-2">{insightAnswer}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Provider Usage Ranking */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">API Usage Ranking</h3>
                    <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-widest mt-1">Most to least used providers</p>
                  </div>
                  <div className="space-y-3">
                    {(analytics?.providerRanking || []).length === 0 && (
                      <p className="text-[10px] text-[#8b949e] uppercase font-bold">No data yet</p>
                    )}
                    {(analytics?.providerRanking || []).map((p: any, i: number) => {
                      const total = (analytics?.providerRanking || []).reduce((s: number, x: any) => s + x.requests, 0);
                      const pct = total > 0 ? Math.round((p.requests / total) * 100) : 0;
                      const col = providerColors[p.name?.toLowerCase()] || 'bg-indigo-500';
                      return (
                        <div key={p.name}>
                          <div className="flex justify-between text-xs font-bold text-white mb-1">
                            <span className="uppercase font-mono">#{i + 1} {p.name}</span>
                            <span className="text-[#8b949e]">{p.requests} req · {p.avgLatencyMs}ms avg</span>
                          </div>
                          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden">
                            <div className={`${col} h-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-[9px] text-[#8b949e] mt-0.5">{pct}% of requests · {(p.tokensUsed || 0).toLocaleString()} tokens</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Provider Burn Split */}
                <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Provider Token Burn</h3>
                    <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-widest mt-1">Token consumption by provider</p>
                  </div>
                  <div className="space-y-3">
                    {Object.entries(analytics?.providerWise || {}).map(([name, tokens]: any) => {
                      const pct = analytics?.totalTokensUsed > 0 ? Math.round((tokens / analytics.totalTokensUsed) * 100) : 0;
                      const col = providerColors[name?.toLowerCase()] || 'bg-indigo-500';
                      return (
                        <div key={name}>
                          <div className="flex justify-between text-xs font-bold text-white mb-1">
                            <span className="uppercase font-mono">{name}</span>
                            <span className="text-[#8b949e] font-mono">{tokens.toLocaleString()} tokens</span>
                          </div>
                          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden">
                            <div className={`${col} h-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {Object.keys(analytics?.providerWise || {}).length === 0 && (
                      <p className="text-[10px] text-[#8b949e] uppercase font-bold">No data yet</p>
                    )}
                  </div>
                  <div className="bg-black/30 rounded-xl p-3 space-y-1 font-mono text-xs border border-white/5">
                    <div className="flex justify-between"><span className="text-[#8b949e]">Total Provider Cost</span><span className="text-orange-400 font-black">₹{(analytics?.totalProviderCost || 0).toFixed(4)}</span></div>
                    <div className="flex justify-between"><span className="text-[#8b949e]">Cashfree Gateway</span><span className="text-emerald-400">{analytics?.cashfreeStatus?.clientId || '–'}</span></div>
                  </div>
                </div>
              </div>

              {/* Recent Purchases */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Recent Token Purchases</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                      <th className="py-2 text-left">User</th><th className="py-2 text-left">Amount</th><th className="py-2 text-left">Tokens</th><th className="py-2 text-left">Date</th>
                    </tr></thead>
                    <tbody className="divide-y divide-white/5">
                      {(analytics?.recentPurchases || []).map((p: any, i: number) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="py-2 text-[#8b949e] font-mono text-[10px]">{(p.userId || '').slice(0, 12)}…</td>
                          <td className="py-2 text-emerald-400 font-black">₹{p.amount}</td>
                          <td className="py-2 text-amber-400 font-mono">{(p.tokens || 0).toLocaleString()}</td>
                          <td className="py-2 text-[#8b949e] text-[9px]">{new Date(p.date || 0).toLocaleDateString('en-IN')}</td>
                        </tr>
                      ))}
                      {(!analytics?.recentPurchases || analytics.recentPurchases.length === 0) && (
                        <tr><td colSpan={4} className="py-6 text-center text-[#8b949e] text-[10px] font-bold uppercase">No purchases yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── USERS TAB ── */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* Search + Sort */}
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-[200px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b949e]" />
                  <input
                    value={userSearch} onChange={e => setUserSearch(e.target.value)}
                    placeholder="Search by email or name..."
                    className="w-full bg-[#161b22] border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-[#8b949e] outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex gap-1 bg-[#161b22] p-1 rounded-xl border border-white/10">
                  {[['alpha', 'A-Z'], ['tokens', 'Tokens'], ['ai_per_day', 'AI Use'], ['recent', 'Recent']].map(([val, lbl]) => (
                    <button key={val} onClick={() => setUserSort(val)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${userSort === val ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-white'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <button onClick={fetchUsers} className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-wider text-white hover:border-indigo-500 transition-all active:scale-95">
                  <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? 'animate-spin' : ''}`} /> Load
                </button>
              </div>

              {/* User Table */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/20">
                        <th className="py-3 px-4 text-left">User</th>
                        <th className="py-3 px-4 text-left">Token Balance</th>
                        <th className="py-3 px-4 text-left">Total Used</th>
                        <th className="py-3 px-4 text-left">Wallet</th>
                        <th className="py-3 px-4 text-left">Pro</th>
                        <th className="py-3 px-4 text-left">Status</th>
                        <th className="py-3 px-4 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {usersLoading && (
                        <tr><td colSpan={7} className="py-10 text-center"><TirangaLoader className="w-5 h-5 mx-auto" /></td></tr>
                      )}
                      {!usersLoading && users.length === 0 && usersError && (
                        <tr><td colSpan={7} className="py-10 text-center text-red-400 text-[10px] font-bold normal-case px-4">{usersError} <button onClick={fetchUsers} className="underline ml-1">Retry</button></td></tr>
                      )}
                      {!usersLoading && users.length === 0 && !usersError && (
                        <tr><td colSpan={7} className="py-10 text-center text-[#8b949e] text-[10px] font-bold uppercase">No users found. Click Load to fetch.</td></tr>
                      )}
                      {users.map((u: any) => (
                        <tr key={u.userId} className={`hover:bg-white/5 transition-colors ${u.banned ? 'bg-red-950/20' : ''}`}>
                          <td className="py-3 px-4">
                            {/* The same account sheet a report opens — one place where a person's whole
                                picture lives, reachable from both surfaces rather than rebuilt in each. */}
                            <button onClick={() => void openAccount(u.userId)} className="text-left group">
                              <div className="text-white font-bold text-[11px] group-hover:underline">{u.name}</div>
                              <div className="text-[#8b949e] text-[9px] font-mono group-hover:text-white/80">{u.email}</div>
                            </button>
                          </td>
                          <td className="py-3 px-4 font-mono text-amber-400 font-black">{(u.tokenBalance || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 font-mono text-violet-400">{(u.totalTokensUsed || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 font-mono text-emerald-400">₹{(u.remainingBalance || 0).toFixed(2)}</td>
                          <td className="py-3 px-4">
                            {u.hasPro ? <span className="text-indigo-400 font-black text-[9px] uppercase">Pro</span> : <span className="text-[#484f58] text-[9px] uppercase">–</span>}
                          </td>
                          <td className="py-3 px-4">
                            {u.banned ? <span className="text-red-400 font-black text-[9px] uppercase flex items-center gap-1"><BanIcon className="w-3 h-3"/>Banned</span> : <span className="text-emerald-400 font-black text-[9px] uppercase flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>Active</span>}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex gap-1.5">
                              {/* Token adjust */}
                              {selectedUserId === u.userId ? (
                                <div className="flex gap-1 items-center">
                                  <input type="number" placeholder="tokens" value={tokenDelta} onChange={e => setTokenDelta(e.target.value)} className="w-20 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none" />
                                  <input placeholder="reason" value={tokenReason} onChange={e => setTokenReason(e.target.value)} className="w-20 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none" />
                                  <button onClick={() => handleTokenAdjust(u.userId)} disabled={actionLoading === u.userId} className="px-2 py-1 bg-indigo-600 rounded-lg text-[9px] font-black text-white uppercase">
                                    {actionLoading === u.userId ? '...' : 'OK'}
                                  </button>
                                  <button onClick={() => setSelectedUserId('')} className="px-2 py-1 bg-white/10 rounded-lg text-[9px] text-white uppercase">X</button>
                                </div>
                              ) : (
                                <>
                                  <button onClick={() => { setSelectedUserId(u.userId); setTokenDelta(''); setTokenReason(''); }} className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[9px] font-black text-amber-400 uppercase hover:bg-amber-500/20 transition-all">
                                    Tokens
                                  </button>
                                  <button onClick={() => handlePro(u.userId, !u.hasPro)} disabled={actionLoading === u.userId + '_pro'} className="px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-[9px] font-black text-indigo-400 uppercase hover:bg-indigo-500/20 transition-all">
                                    {actionLoading === u.userId + '_pro' ? '...' : u.hasPro ? 'Revoke' : 'Pro'}
                                  </button>
                                  <button onClick={() => handleBan(u.userId, !u.banned)} disabled={actionLoading === u.userId + '_ban'} className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-all border ${u.banned ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}>
                                    {actionLoading === u.userId + '_ban' ? '...' : u.banned ? 'Unban' : 'Ban'}
                                  </button>
                                  <button onClick={() => handleMerge(u.userId)} disabled={actionLoading === u.userId + '_merge'} title="Merge a duplicate account's wallet INTO this user" className="px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[9px] font-black text-purple-400 uppercase hover:bg-purple-500/20 transition-all">
                                    {actionLoading === u.userId + '_merge' ? '...' : 'Merge'}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── AI ENGINES TAB ── */}
          {activeTab === 'engines' && (
            <div className="space-y-6">
              {/* Live provider status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(analytics?.liveProviderStats || {}).map(([name, stat]: any) => {
                  const isOnCooldown = stat.cooldownUntil > Date.now();
                  const secondsLeft = isOnCooldown ? Math.ceil((stat.cooldownUntil - Date.now()) / 1000) : 0;
                  return (
                    <div key={name} className={`bg-[#161b22] border rounded-[1.5rem] p-5 space-y-3 ${isOnCooldown ? 'border-red-500/30' : 'border-white/10'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${isOnCooldown ? 'bg-red-500 animate-pulse' : stat.inFlight > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                          <span className="font-black text-white uppercase font-mono">{name}</span>
                        </div>
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${isOnCooldown ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
                          {isOnCooldown ? `Cooldown ${secondsLeft}s` : 'Healthy'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-black/30 rounded-lg p-2">
                          <div className="text-[9px] text-[#8b949e] uppercase font-bold">In-Flight</div>
                          <div className="text-sm font-black text-white font-mono">{stat.inFlight}</div>
                        </div>
                        <div className="bg-black/30 rounded-lg p-2">
                          <div className="text-[9px] text-[#8b949e] uppercase font-bold">Avg Latency</div>
                          <div className="text-sm font-black text-amber-400 font-mono">{stat.avgLatencyMs}ms</div>
                        </div>
                        <div className="bg-black/30 rounded-lg p-2">
                          <div className="text-[9px] text-[#8b949e] uppercase font-bold">Errors</div>
                          <div className={`text-sm font-black font-mono ${stat.errorCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{stat.errorCount}</div>
                        </div>
                      </div>
                      <div className="text-[9px] text-[#8b949e] font-mono">{stat.requestCount} total requests</div>
                    </div>
                  );
                })}
                {Object.keys(analytics?.liveProviderStats || {}).length === 0 && (
                  <div className="col-span-2 text-center py-12 text-[#8b949e] text-[10px] font-bold uppercase">No provider activity yet. Stats appear after first AI request.</div>
                )}
              </div>

              {/* Provider ON/OFF controls */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Provider Kill Switches</h3>
                <p className="text-[10px] text-[#8b949e]">Disable a provider to prevent new requests from routing to it. Changes take effect immediately on next request.</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(providerEnabled).map(([name, enabled]: any) => (
                    <button
                      key={name}
                      onClick={() => { const newVal = { ...providerEnabled, [name]: !enabled }; setProviderEnabledState(newVal); adminPost('/api/admin/settings', { providerEnabled: newVal }).then(() => toast(`${name} ${!enabled ? 'enabled' : 'disabled'}`)); }}
                      className={`flex items-center justify-between p-4 rounded-xl border transition-all ${enabled ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}
                    >
                      <span className="font-black uppercase text-[11px] text-white">{name}</span>
                      {enabled ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-red-400" />}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button onClick={handleSettingsSave} className="px-5 py-2.5 bg-indigo-600 rounded-xl text-[11px] font-black uppercase tracking-wider text-white hover:bg-indigo-700 transition-all active:scale-95">
                    Save Provider Settings
                  </button>
                </div>
              </div>

              {/* ── P-MON.3 Inference-latency percentiles (real, from trace spans) ── */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-sky-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Inference Latency (p50 / p95 / p99)</h3>
                  </div>
                  <button
                    onClick={fetchLlmLatency}
                    disabled={llmLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${llmLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {!llmLatency || !Array.isArray(llmLatency.providers) || llmLatency.providers.length === 0 ? (
                  <p className="text-[10px] text-[#8b949e] uppercase font-bold py-4">
                    {llmLoading ? 'Loading latency…' : 'No provider latency samples yet — appears after AI requests run.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                        <th className="py-2.5 px-3 text-left">Provider</th>
                        <th className="py-2.5 px-3 text-left">Samples</th>
                        <th className="py-2.5 px-3 text-left">p50</th>
                        <th className="py-2.5 px-3 text-left">p95</th>
                        <th className="py-2.5 px-3 text-left">p99</th>
                        <th className="py-2.5 px-3 text-left">Max</th>
                        <th className="py-2.5 px-3 text-left">Errors</th>
                      </tr></thead>
                      <tbody className="divide-y divide-white/5">
                        {llmLatency.providers.map((p: any) => (
                          <tr key={p.provider} className="hover:bg-white/5">
                            <td className="py-2.5 px-3 text-white font-black uppercase font-mono">{p.provider}</td>
                            <td className="py-2.5 px-3 text-[#8b949e] font-mono">{p.latency?.count ?? 0}</td>
                            <td className="py-2.5 px-3 text-emerald-400 font-mono">{p.latency?.p50 ?? '—'}ms</td>
                            <td className="py-2.5 px-3 text-amber-400 font-mono">{p.latency?.p95 ?? '—'}ms</td>
                            <td className="py-2.5 px-3 text-orange-400 font-mono">{p.latency?.p99 ?? '—'}ms</td>
                            <td className="py-2.5 px-3 text-[#8b949e] font-mono">{p.latency?.max ?? '—'}ms</td>
                            <td className={`py-2.5 px-3 font-mono font-black ${p.errorRatePct > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{p.errorRatePct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest pt-1">
                      Percentiles from real `ai.provider.*` trace spans — tail latency (p95/p99) that the average hides.
                    </p>
                  </div>
                )}
              </div>

              {/* ── P-MON.2 Latency anomaly / trend watch (real, from trace durations) ── */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-violet-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Latency Anomaly Watch</h3>
                  </div>
                  <button
                    onClick={fetchLatencyAnomaly}
                    disabled={anomalyLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${anomalyLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {!latencyAnomaly || typeof latencyAnomaly.count !== 'number' || latencyAnomaly.count === 0 ? (
                  <p className="text-[10px] text-[#8b949e] uppercase font-bold py-4">
                    {anomalyLoading ? 'Analyzing…' : 'Not enough request-latency samples yet — appears after traffic flows.'}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {statCard('Samples', latencyAnomaly.count, 'recent traces', 'bg-sky-500', Activity)}
                      {statCard('Anomalies', (latencyAnomaly.zAnomalies?.length || 0) + (latencyAnomaly.ewmaAnomalies?.length || 0), 'z-score + EWMA', (latencyAnomaly.zAnomalies?.length || 0) + (latencyAnomaly.ewmaAnomalies?.length || 0) > 0 ? 'bg-amber-500' : 'bg-emerald-500', AlertTriangle)}
                      {statCard('Trend', latencyAnomaly.trend?.direction || 'n/a', latencyAnomaly.trend ? `slope ${Number(latencyAnomaly.trend.slope).toFixed(3)}` : 'unknown', latencyAnomaly.trend?.direction === 'rising' ? 'bg-red-500' : latencyAnomaly.trend?.direction === 'falling' ? 'bg-emerald-500' : 'bg-[#30363d]', TrendingUp)}
                      {statCard('Avg Latency', `${latencyAnomaly.stats?.mean ?? '—'}ms`, `max ${latencyAnomaly.stats?.max ?? '—'}ms`, 'bg-indigo-500', Cpu)}
                    </div>
                    {(latencyAnomaly.zAnomalies?.length || 0) > 0 && (
                      <div className="text-[10px] text-amber-400/90 font-mono">
                        Spikes: {latencyAnomaly.zAnomalies.slice(0, 6).map((a: any) => `${Math.round(a.v)}ms`).join(', ')}
                      </div>
                    )}
                    <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest">
                      z-score + EWMA anomaly detection over real per-trace durations. No data → no anomalies (never faked).
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── REVENUE TAB ── */}
          {activeTab === 'revenue' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {statCard('Total Revenue', `₹${(analytics?.totalRevenue || 0).toLocaleString('en-IN')}`, 'All time', 'bg-emerald-500', IndianRupee)}
                {statCard('Provider Cost', `₹${(analytics?.totalProviderCost || 0).toFixed(4)}`, 'AI API cost', 'bg-red-500', Database)}
                {statCard('Net Margin', `₹${(analytics?.estimatedProfit || 0).toFixed(2)}`, 'Revenue - cost', (analytics?.estimatedProfit || 0) >= 0 ? 'bg-emerald-500' : 'bg-red-500', TrendingUp)}
                {statCard('Token Purchases', analytics?.tokenPurchaseCount || 0, 'Successful payments', 'bg-pink-500', Tag)}
                {statCard('Cost / Request', `₹${(analytics?.burnRate || 0).toFixed(5)}`, 'Avg AI provider cost', 'bg-orange-500', Cpu)}
                {statCard('Active Users', analytics?.activeUsers24h || 0, 'Using AI in 24h', 'bg-violet-500', UserCheck)}
              </div>

              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Top Consuming Users</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                      <th className="py-2.5 px-3 text-left">User</th>
                      <th className="py-2.5 px-3 text-left">Tokens Used</th>
                      <th className="py-2.5 px-3 text-left">Money Spent</th>
                      <th className="py-2.5 px-3 text-left">Balance Left</th>
                    </tr></thead>
                    <tbody className="divide-y divide-white/5">
                      {(analytics?.expensiveUsers || []).map((u: any, i: number) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="py-2.5 px-3"><div className="text-white font-bold">{u.name}</div><div className="text-[9px] text-[#8b949e]">{u.email}</div></td>
                          <td className="py-2.5 px-3 text-amber-400 font-mono font-black">{(u.tokens_used || 0).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-emerald-400 font-mono">₹{u.money_spent || 0}</td>
                          <td className="py-2.5 px-3 text-sky-400 font-mono">₹{(u.remaining_balance || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {(analytics?.expensiveUsers || []).length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[#8b949e] text-[10px] font-bold uppercase">No data</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── AgentV3 cost-ladder (v5.0 build cost routing — real telemetry) ── */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">v5.0 Cost-Ladder (last 30 days)</h3>
                  </div>
                  <button
                    onClick={fetchCostTelemetry}
                    disabled={costLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${costLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>

                {!costSummary || costSummary.totalBuilds === 0 ? (
                  <p className="text-[10px] text-[#8b949e] uppercase font-bold py-4">
                    {costLoading ? 'Loading telemetry…' : 'No v5.0 builds recorded yet — data appears once Pro v5.0 builds run.'}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {statCard('v5.0 Builds', costSummary.totalBuilds.toLocaleString(), `${costSummary.days} day(s)`, 'bg-indigo-500', Server)}
                      {statCard('Success Rate', `${costSummary.overallSuccessPct}%`, `${costSummary.okBuilds} ok`, costSummary.overallSuccessPct >= 80 ? 'bg-emerald-500' : 'bg-amber-500', CheckCircle2)}
                      {statCard('Cheap-Tier Share', `${costSummary.cheapTierSharePct}%`, 'ran on Gemini (cheapest)', 'bg-sky-500', TrendingUp)}
                      {statCard('Billed (v5.0)', `$${costSummary.totalBilledUsd.toFixed(4)}`, `${costSummary.powerBuilds} power builds`, 'bg-pink-500', IndianRupee)}
                    </div>

                    {/* T1-admin-dashboard — build-failure analytics: overall failure rate + spike-day alert. */}
                    {failureReport && failureReport.overall.totalBuilds > 0 && (
                      <div className={`rounded-xl border p-4 ${failureReport.spikeDates.length > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-widest text-[#8b949e]">Build Failure Rate (30d)</span>
                          <span className={`text-sm font-black ${failureReport.overall.failureRate > 0.2 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {(failureReport.overall.failureRate * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-[10px] text-[#8b949e] mt-1">
                          {failureReport.overall.failedBuilds.toLocaleString()} failed of {failureReport.overall.totalBuilds.toLocaleString()} builds
                        </div>
                        {failureReport.spikeDates.length > 0 && (
                          <div className="text-[10px] text-red-400 font-bold mt-2">
                            ⚠️ Failure-rate spike on: {failureReport.spikeDates.join(', ')}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                          <th className="py-2.5 px-3 text-left">Start Tier</th>
                          <th className="py-2.5 px-3 text-left">Builds</th>
                          <th className="py-2.5 px-3 text-left">Share</th>
                          <th className="py-2.5 px-3 text-left">Success</th>
                          <th className="py-2.5 px-3 text-left">Avg Tokens</th>
                          <th className="py-2.5 px-3 text-left">Avg Time</th>
                          <th className="py-2.5 px-3 text-left">Billed</th>
                        </tr></thead>
                        <tbody className="divide-y divide-white/5">
                          {costSummary.byTier.map((row) => (
                            <tr key={row.key} className="hover:bg-white/5">
                              <td className="py-2.5 px-3 text-white font-black uppercase">{row.key}</td>
                              <td className="py-2.5 px-3 text-amber-400 font-mono font-black">{row.builds}</td>
                              <td className="py-2.5 px-3 text-sky-400 font-mono">{row.sharePct}%</td>
                              <td className={`py-2.5 px-3 font-mono font-black ${row.successPct >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{row.successPct}%</td>
                              <td className="py-2.5 px-3 text-[#8b949e] font-mono">{row.avgTokens.toLocaleString()}</td>
                              <td className="py-2.5 px-3 text-[#8b949e] font-mono">{row.avgDurationSec}s</td>
                              <td className="py-2.5 px-3 text-emerald-400 font-mono">${row.billedUsd.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest">
                      Cheap-tier success rate is the P8 cutover signal — high share + high success means the ladder is safe to default-on.
                    </p>
                  </>
                )}
              </div>

              {/* ── P-MON.6 FinOps recommendations (real, derived from live metrics) ── */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">FinOps Recommendations</h3>
                  </div>
                  <button
                    onClick={fetchFinOps}
                    disabled={finopsLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${finopsLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>

                {!finops || !Array.isArray(finops.recommendations) ? (
                  <p className="text-[10px] text-[#8b949e] uppercase font-bold py-4">
                    {finopsLoading ? 'Analyzing spend…' : 'No metrics available yet.'}
                  </p>
                ) : finops.recommendations.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-[10px] font-bold uppercase text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    No cost issues detected from current metrics
                    {finops.summary?.builds === 0 && <span className="text-[#8b949e]"> (no builds recorded yet)</span>}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {finops.recommendations.map((rec: any) => {
                      // Static class strings — Tailwind JIT cannot see dynamically-built class names.
                      const box = rec.severity === 'critical'
                        ? 'border-red-500/20 bg-red-500/5'
                        : rec.severity === 'warning'
                          ? 'border-amber-500/20 bg-amber-500/5'
                          : 'border-sky-500/20 bg-sky-500/5';
                      const dot = rec.severity === 'critical' ? 'bg-red-500' : rec.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500';
                      return (
                        <div key={rec.id} className={`border ${box} rounded-xl p-4`}>
                          <div className="flex items-start gap-2.5">
                            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dot}`} />
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-black text-white">{rec.title}</span>
                                {typeof rec.observedWasteUsd === 'number' && (
                                  <span className="text-[10px] font-mono font-black text-red-400 whitespace-nowrap">~${rec.observedWasteUsd.toFixed(4)} wasted</span>
                                )}
                              </div>
                              <p className="text-[10px] text-[#8b949e] mt-1 leading-relaxed">{rec.detail}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[9px] text-[#484f58] font-bold uppercase tracking-widest pt-1">
                      Derived from real recorded metrics — no hardcoded prices, no projections. Waste figures are already-observed spend.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── BUILD REPORTS TAB (admin 2026-07-29) — the reports users submit via "Report" ── */}

      {/* ONE PERSON'S WHOLE ACCOUNT (admin 2026-08-21). Opened from a report, or from the Users tab —
          the point is that a suspension is decided WITH the account in front of you, not from a
          complaint alone. Rendered at the dashboard root so it can sit above either surface. */}
      {account && (
        <div className="nb-sheet-overlay fixed inset-0 z-[60] bg-black/75 flex items-center justify-center" onClick={() => setAccount(null)}>
          <div className="nb-sheet w-full max-w-2xl overflow-y-auto bg-[#0d1117] border border-white/10 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            {account.loading ? (
              <p className="text-sm text-white/60">Opening account…</p>
            ) : account.error ? (
              <p className="text-sm text-amber-300">{account.error}</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-base font-bold text-white break-all">{account.identity?.email || account.identity?.name || account.uid}</h4>
                    <p className="text-[11px] text-white/40 break-all">{account.uid}</p>
                  </div>
                  <button onClick={() => setAccount(null)} className="text-white/40 hover:text-white p-1" aria-label="Close">✕</button>
                </div>

                {account.wallet?.banned && (
                  <p className="mt-3 text-[11px] px-3 py-2 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30">
                    Suspended{account.wallet.banReason ? ` — ${account.wallet.banReason}` : ''}
                  </p>
                )}

                {/* The few flags worth a second look. Not accusations. */}
                {Array.isArray(account.flags) && account.flags.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {account.flags.map((f: string) => (
                      <li key={f} className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 text-amber-200 border border-amber-500/25">{f}</li>
                    ))}
                  </ul>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                  {[
                    { label: 'Tokens', value: account.wallet?.ok ? Number(account.wallet.tokenBalance).toLocaleString('en-IN') : null },
                    { label: 'Balance', value: account.wallet?.ok ? `₹${Number(account.wallet.remainingBalanceInr).toFixed(2)}` : null },
                    { label: 'Apps built', value: account.builds?.ok ? String(account.builds.apps?.length ?? 0) : null },
                    { label: 'Recharges', value: account.payments?.ok ? String(account.payments.successful) : null },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl border border-white/10 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-white/40">{c.label}</p>
                      {/* NOT ZERO WHEN WE COULD NOT READ IT — see the route. An admin who reads "0
                          recharges" from a failed query sees someone who never paid us. */}
                      <p className={`text-lg font-black ${c.value === null ? 'text-white/30' : 'text-white'}`}>
                        {c.value ?? 'unread'}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-[11px] text-white/50">
                  Spent on builds: {account.builds?.ok ? `₹${Number(account.builds.spentInr).toFixed(2)}` : 'could not be read'}
                  {account.payments?.ok && <> · Paid in: ₹{Number(account.payments.totalInr).toFixed(2)} over {account.payments.successful} recharge{account.payments.successful === 1 ? '' : 's'}</>}
                  {account.builds?.ok && <> · {account.builds.totalBuilds} builds ({account.builds.failed} failed)</>}
                </p>

                {/* PER APP — one app is many builds, so this is grouped by app, not by build. The unit
                    is ₹ because that is what the record holds and what actually left the wallet;
                    deriving a token figure from a changing rate would be an invented number. */}
                {account.builds?.ok && account.builds.apps?.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-2">Per app</p>
                    <div className="space-y-1.5">
                      {account.builds.apps.slice(0, 15).map((a: any) => (
                        <div key={a.sessionId} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                          <span className="text-xs text-white truncate flex-1">{a.title}</span>
                          <span className="text-[11px] text-white/40 shrink-0">{a.builds} build{a.builds === 1 ? '' : 's'}{a.failed > 0 ? ` · ${a.failed} failed` : ''}</span>
                          <span className="text-xs font-bold text-white shrink-0">₹{Number(a.spentInr).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {account.publishedApps?.ok && account.publishedApps.count > 0 && (
                  <p className="mt-3 text-[11px] text-white/50">{account.publishedApps.count} published app{account.publishedApps.count === 1 ? '' : 's'} live</p>
                )}

                <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-white/10">
                  <button
                    onClick={() => { void handleBan(account.uid, !account.wallet?.banned); setAccount(null); }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white ${account.wallet?.banned ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
                  >
                    <Shield size={13} /> {account.wallet?.banned ? 'Lift the suspension' : 'Suspend this account'}
                  </button>
                  <button onClick={() => setAccount(null)} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/60">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

          {activeTab === 'userreports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="flex items-center gap-2 text-lg font-black text-white tracking-tight">
                  <Flag size={18} className="text-rose-400" /> User Reports
                  {userReports.length > 0 && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-rose-500/40 text-rose-300">
                      {userReports.length}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {(['open', 'all'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setReportFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${reportFilter === f ? 'bg-rose-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                    >{f === 'open' ? 'Needs a person' : 'All'}</button>
                  ))}
                  <button onClick={() => void fetchUserReports()} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60" aria-label="Refresh">
                    <RefreshCw size={14} className={reportsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {reportsLoading && userReports.length === 0 ? (
                <p className="text-xs text-white/40">Loading reports…</p>
              ) : userReports.length === 0 ? (
                <p className="text-xs text-white/40">
                  {reportFilter === 'open' ? 'Nothing waiting. Every report has been handled.' : 'No reports yet.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {userReports.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => void openUserReport(r.id)}
                      className="w-full text-left rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] p-3 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/15 text-white/60">
                          {r.target?.kind === 'app' ? 'App' : r.target?.kind === 'user' ? 'User' : 'Problem'}
                        </span>
                        {r.status !== 'open' && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-emerald-500/30 text-emerald-300">{r.status}</span>
                        )}
                        {r.hasScreenshot && <PictureIcon size={12} className="text-white/40" />}
                        <span className="text-[10px] text-white/35 ml-auto">{new Date(r.at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-white mt-1.5 line-clamp-2">{r.message}</p>
                      <p className="text-[11px] text-white/40 mt-1">
                        From {r.reporter?.email || r.reporter?.name || r.reporter?.shortUid || 'unknown'}
                        {r.reported && <> · about {r.reported.email || r.reported.name || r.reported.shortUid}</>}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* One report, in full. BOTH people are named, and the actions an admin actually needs
                  are right here — reading a complaint and then hunting for the account in another tab
                  is how reports stop getting handled. */}
              {openReport && (
                <div className="nb-sheet-overlay fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setOpenReport(null)}>
                  <div className="nb-sheet w-full max-w-lg overflow-y-auto bg-[#161b22] border border-white/10 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
                    {openReport.loading ? (
                      <p className="text-sm text-white/60">Opening…</p>
                    ) : openReport.error ? (
                      <p className="text-sm text-amber-300">{openReport.error}</p>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-base font-bold text-white">Report</h4>
                          <button onClick={() => setOpenReport(null)} className="text-white/40 hover:text-white p-1" aria-label="Close">✕</button>
                        </div>
                        <p className="text-sm text-white whitespace-pre-wrap mt-3 bg-black/30 rounded-xl p-3">{openReport.report?.message}</p>

                        <div className="grid grid-cols-2 gap-3 mt-4 text-[11px]">
                          <div className="rounded-xl border border-white/10 p-3">
                            <p className="text-white/40 uppercase tracking-widest text-[9px] font-black mb-1">Reported by</p>
                            <button onClick={() => void openAccount(openReport.report.reporterUid)} className="text-left text-white break-all underline decoration-white/20 hover:decoration-white">
                              {openReport.reporter?.email || openReport.reporter?.shortUid || '—'}
                            </button>
                            <p className="text-white/40 break-all">{openReport.report?.reporterUid}</p>
                          </div>
                          <div className="rounded-xl border border-white/10 p-3">
                            <p className="text-white/40 uppercase tracking-widest text-[9px] font-black mb-1">About</p>
                            {openReport.reported ? (
                              <>
                                <button onClick={() => void openAccount(openReport.report.target.ownerUid)} className="text-left text-white break-all underline decoration-white/20 hover:decoration-white">
                                  {openReport.reported.email || openReport.reported.shortUid}
                                </button>
                                <p className="text-white/40 break-all">{openReport.report?.target?.ownerUid}</p>
                                {openReport.reportsAgainstReported > 1 && (
                                  <p className="text-rose-300 mt-1 font-semibold">{openReport.reportsAgainstReported} reports about this account</p>
                                )}
                              </>
                            ) : (
                              <p className="text-white/40">Not about a person</p>
                            )}
                          </div>
                        </div>

                        {openReport.report?.context && (
                          <p className="text-[10px] text-white/35 mt-3">
                            Screen: {openReport.report.context.view || '—'} · {openReport.report.context.platform || '—'}
                          </p>
                        )}

                        {openReport.screenshot && (
                          <img src={openReport.screenshot} alt="Screenshot from the reporter" className="mt-3 w-full rounded-xl border border-white/10" />
                        )}

                        <div className="flex flex-wrap gap-2 mt-5">
                          <button onClick={() => void markUserReport(openReport.report.id, 'actioned')} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white">Acted on it</button>
                          <button onClick={() => void markUserReport(openReport.report.id, 'reviewed')} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold text-white">Read it</button>
                          <button onClick={() => void markUserReport(openReport.report.id, 'dismissed')} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/60">Dismiss</button>
                          {openReport.report?.target?.ownerUid && (
                            <button
                              onClick={() => { void handleBan(openReport.report.target.ownerUid, true); void markUserReport(openReport.report.id, 'actioned'); }}
                              className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white"
                            ><Shield size={13} /> Suspend this account</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-black text-white tracking-tight">
                    Build Reports
                    {/* THE ONE NUMBER WORTH SEEING FIRST (admin 2026-08-12): how many still need work.
                        Counted from the marks, so it can never disagree with the badges below it. */}
                    {(() => {
                      const open = openReportCount(buildReports);
                      return open > 0 ? (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">{open} open</span>
                      ) : null;
                    })()}
                  </h3>
                  <p className="text-[11px] text-[#8b949e] font-bold mt-0.5">Reports submitted by users via the “Report” button — admin-only. Download marks a report sent; “Mark fixed” is yours to set once the work is merged.</p>
                </div>
                <div className="flex items-center gap-2">
                  {/* SERVER NECESSITY (admin 2026-08-12) — see fetchNecessity. Behind a button because it
                      reads up to 500 build documents; nobody should pay that on every tab visit. */}
                  <button
                    onClick={fetchNecessity}
                    disabled={necessityLoading}
                    title="How many past apps were given a server they never needed? Every one of those could have skipped the sandbox."
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-amber-500/40 text-amber-300 hover:text-white hover:bg-amber-600/20 disabled:opacity-40"
                  >
                    <Server className={`w-3.5 h-3.5 ${necessityLoading ? 'animate-pulse' : ''}`} /> Server necessity
                  </button>
                  {/* SANDBOX HANDOVER (Phase 0 of the in-browser preview plan) — see fetchHandover. */}
                  <button
                    onClick={fetchHandover}
                    disabled={handoverLoading}
                    title="After a build finished, how much longer did its sandbox stay billable — and how much of that could the browser have served?"
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-violet-500/40 text-violet-300 hover:text-white hover:bg-violet-600/20 disabled:opacity-40"
                  >
                    <Clock className={`w-3.5 h-3.5 ${handoverLoading ? 'animate-pulse' : ''}`} /> Sandbox handover
                  </button>
                  {/* APPLE SIGN-IN (admin 2026-08-22) — see fetchAppleDiag. The endpoint shipped a day
                      earlier with no UI at all, which for a non-terminal admin is the same as unbuilt.
                      The code box is optional and only ever SHARPENS the final answer. */}
                  <input
                    value={appleObservedCode}
                    onChange={(e) => setAppleObservedCode(e.target.value)}
                    placeholder="auth/… (optional)"
                    title="The error code shown in the sign-in message, if you have one. It makes the answer more exact; leave it empty to just check our side."
                    className="text-[11px] font-bold px-2.5 py-2 rounded-xl bg-[#0d1117] border border-white/10 text-white placeholder:text-[#6e7681] w-[9.5rem] focus:outline-none focus:border-sky-500/50"
                  />
                  <button
                    onClick={fetchAppleDiag}
                    disabled={appleDiagLoading}
                    title="Is anything on OUR side stopping Sign in with Apple? Fetches our own public verification file exactly as Apple does."
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-sky-500/40 text-sky-300 hover:text-white hover:bg-sky-600/20 disabled:opacity-40"
                  >
                    <Shield className={`w-3.5 h-3.5 ${appleDiagLoading ? 'animate-pulse' : ''}`} /> Apple sign-in
                  </button>
                  <button
                    onClick={fetchBuildReports}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-white/10 text-[#8b949e] hover:text-white hover:bg-white/5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${buildReportsLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                  {/* Reclaim storage in one action (admin 2026-08-16). Each record can be ~1 MB; a cleared
                      inbox is real space back. Disabled when empty; confirms before it wipes. */}
                  <button
                    onClick={clearAllReports}
                    disabled={buildReports.length === 0}
                    title="Delete ALL build reports — frees their storage (cannot be undone)"
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-red-500/40 text-red-300 hover:text-white hover:bg-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete all
                  </button>
                </div>
              </div>

              {/* APPLE SIGN-IN RESULT (admin 2026-08-22). Colour carries the verdict, because the whole
                  value of this check is separating "our fault" from "not our fault" at a glance — and
                  `unverifiable` is deliberately its own colour, since being unable to ASK is not the
                  same as a bad answer, and painting it red is how someone ends up fixing the wrong
                  thing. The next step is the line to act on, so it is the loudest thing on the card. */}
              {appleDiag && (() => {
                const ok = appleDiag.verdict === 'ours-is-correct';
                const unknown = appleDiag.verdict === 'unverifiable';
                // FULL CLASS NAMES, never a class built by interpolating a colour name into it.
                // Tailwind scans source text and cannot see a composed class, so it is simply never
                // generated — the element ends up unstyled while the code looks correct.
                const icon = ok ? 'text-emerald-400' : unknown ? 'text-amber-400' : 'text-red-400';
                const ring = ok ? 'border-emerald-500/25' : unknown ? 'border-amber-500/25' : 'border-red-500/25';
                const text = ok ? 'text-emerald-200/90' : unknown ? 'text-amber-200/90' : 'text-red-200/90';
                return (
                  <div className={`bg-[#161b22] border ${ring} rounded-[1.25rem] p-4 space-y-3`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Shield className={`w-4 h-4 ${icon}`} />
                      <h4 className="text-sm font-black text-white tracking-tight">Sign in with Apple — is it us?</h4>
                      <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${ring} ${text}`}>
                        {appleDiag.verdict.replace(/-/g, ' ')}
                      </span>
                      {appleDiag.observedCode && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 text-[#8b949e]">
                          code: {appleDiag.observedCode}
                        </span>
                      )}
                    </div>
                    <p className={`text-[12px] ${text} font-bold leading-relaxed`}>{appleDiag.message}</p>
                    {appleDiag.nextStep && (
                      <div className="bg-[#0d1117] border border-white/10 rounded-xl p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-[#8b949e] mb-1">Do this next</p>
                        <p className="text-[12px] text-white font-bold leading-relaxed">{appleDiag.nextStep}</p>
                      </div>
                    )}
                    {/* Lengths and status, never the file's contents — enough to spot a truncated paste
                        or a stray wrapper without printing a long token nobody will read. */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {([
                        ['File configured', appleDiag.configured ? `yes (${appleDiag.source || '—'})` : 'no'],
                        ['Public URL status', appleDiag.fetchedStatus == null ? '—' : String(appleDiag.fetchedStatus)],
                        ['Length here / there', `${appleDiag.servedLength ?? 0} / ${appleDiag.fetchedLength ?? '—'}`],
                        ['Services ID', appleDiag.serviceId || '—'],
                      ] as Array<[string, string]>).map(([label, value]) => (
                        <div key={label} className="bg-[#0d1117] border border-white/10 rounded-xl p-2.5">
                          <p className="text-[10px] font-black uppercase tracking-wider text-[#6e7681]">{label}</p>
                          <p className="text-[12px] text-white font-bold break-all">{value}</p>
                        </div>
                      ))}
                    </div>
                    {appleDiag.fetchError && (
                      <p className="text-[11px] text-amber-300/80 font-bold break-all">Check failed with: {appleDiag.fetchError}</p>
                    )}
                  </div>
                );
              })()}

              {/* SERVER NECESSITY RESULT (admin 2026-08-12). The number that decides whether the
                  browser-native plan proceeds. Shown with its CAVEAT and a spot-check sample, never as a
                  bare percentage — this drives a large decision, and a number without its limits is how
                  a large change gets approved on a misunderstanding. */}
              {necessity && (
                <div className="bg-[#161b22] border border-amber-500/25 rounded-[1.25rem] p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Server className="w-4 h-4 text-amber-400" />
                    <h4 className="text-sm font-black text-white tracking-tight">Did these apps need a server?</h4>
                  </div>
                  <p className="text-[12px] text-amber-200/90 font-bold leading-relaxed">{necessity.headline}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([
                      ['Server built, NOT needed', necessity.tally.builtButNotNeeded, 'text-amber-300', 'could have skipped the sandbox'],
                      ['Neither needed nor built', necessity.tally.neitherNeededNorBuilt, 'text-emerald-300', 'already browser-native'],
                      ['Genuinely needed one', necessity.tally.neededAndBuilt, 'text-sky-300', 'E2B is required here'],
                      ['Needed, but missing', necessity.tally.neededButMissing, 'text-red-300', 'a correctness gap, not a cost one'],
                    ] as const).map(([label, n, cls, hint]) => (
                      <div key={label} className="bg-[#0d1117] border border-white/10 rounded-xl p-3">
                        <div className={`text-2xl font-black tabular-nums ${cls}`}>{n}</div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-[#8b949e] mt-1">{label}</div>
                        <div className="text-[10px] text-[#6e7681] mt-0.5 leading-snug">{hint}</div>
                      </div>
                    ))}
                  </div>
                  {Object.keys(necessity.tally.reasonCounts).length > 0 && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-[#8b949e] mb-1.5">Why a server was genuinely needed</div>
                      <div className="space-y-1">
                        {Object.entries(necessity.tally.reasonCounts).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                          <div key={reason} className="flex items-start gap-2 text-[11px] text-[#c9d1d9]">
                            <span className="tabular-nums font-black text-sky-300 shrink-0 w-6">{n}×</span>
                            <span className="leading-snug">{reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* SPOT-CHECK. A percentage produced by a classifier nobody has read is not evidence —
                      these are real builds the admin can recognise and disagree with. */}
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-[#8b949e] font-bold hover:text-white">Check it against {necessity.sample.length} real builds</summary>
                    <div className="mt-2 space-y-1.5">
                      {necessity.sample.map((s) => (
                        <div key={s.workspaceId} className="bg-[#0d1117] border border-white/5 rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${s.neededServer ? 'border-sky-500/40 text-sky-300' : 'border-emerald-500/40 text-emerald-300'}`}>
                              {s.neededServer ? 'needed' : 'not needed'}
                            </span>
                            {s.builtServer && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-amber-500/40 text-amber-300">built one</span>}
                          </div>
                          <div className="text-[11px] text-[#c9d1d9] mt-1 leading-snug">{s.prompt || <span className="text-[#6e7681]">(no prompt recorded)</span>}</div>
                          {s.reasons.length > 0 && <div className="text-[10px] text-[#8b949e] mt-0.5">{s.reasons.join(' · ')}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* SANDBOX HANDOVER RESULT (Phase 0 of IN_BROWSER_PREVIEW_PLAN.md). The measured split
                  between real build work and post-build holding. The excluded builds are shown as
                  loudly as the measured ones: an unmeasurable hold is not a zero-length hold, and
                  quietly treating it as one is how a measurement turns into a flattering estimate. */}
              {handover && (
                <div className="bg-[#161b22] border border-violet-500/25 rounded-[1.25rem] p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Clock className="w-4 h-4 text-violet-400" />
                    <h4 className="text-sm font-black text-white tracking-tight">Where does a sandbox's billed time go?</h4>
                  </div>
                  <p className="text-[12px] text-violet-200/90 font-bold leading-relaxed">{handover.headline}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([
                      ['Real build work', `${handover.tally.buildHours}h`, 'text-sky-300', 'a browser can never absorb this'],
                      ['Held after the build', `${handover.tally.heldAfterHours}h`, 'text-amber-300', 'the only window Phase 3 targets'],
                      ['Reclaimable', `${handover.tally.recoverableHours}h`, 'text-emerald-300', `frontend-only — ${handover.tally.frontendOnlyCount} builds`],
                      ['Could not measure', `${handover.tally.examined - handover.tally.measured}`, 'text-[#8b949e]', 'excluded, never counted as zero'],
                    ] as const).map(([label, n, cls, hint]) => (
                      <div key={label} className="bg-[#0d1117] border border-white/10 rounded-xl p-3">
                        <div className={`text-2xl font-black tabular-nums ${cls}`}>{n}</div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-[#8b949e] mt-1">{label}</div>
                        <div className="text-[10px] text-[#6e7681] mt-0.5 leading-snug">{hint}</div>
                      </div>
                    ))}
                  </div>
                  {/* The extrapolation is kept visually APART from the measured numbers above, and says
                      what it is. The two must never be read as one row of equally solid figures. */}
                  {handover.projection.monthlyUsdEstimate > 0 && (
                    <div className="bg-[#0d1117] border border-white/10 rounded-xl p-3">
                      <div className="text-[10px] font-black uppercase tracking-wider text-[#8b949e]">Extrapolation, not a bill</div>
                      <div className="text-[12px] text-[#c9d1d9] mt-1 leading-snug">
                        Over the sample's <span className="tabular-nums font-black text-white">{handover.projection.spanDays}</span> days that is{' '}
                        <span className="tabular-nums font-black text-emerald-300">{handover.projection.recoverableHoursPerDay}h/day</span> reclaimable ≈{' '}
                        <span className="tabular-nums font-black text-emerald-300">${handover.projection.monthlyUsdEstimate}/month</span>. Scaled from this
                        window at the measured sandbox rate — the real bill moves with usage.
                      </div>
                    </div>
                  )}
                  {Object.entries(handover.tally.unknown).some(([, n]) => n > 0) && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-[#8b949e] mb-1.5">Why builds were excluded</div>
                      <div className="space-y-1">
                        {Object.entries(handover.tally.unknown).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([why, n]) => (
                          <div key={why} className="flex items-start gap-2 text-[11px] text-[#c9d1d9]">
                            <span className="tabular-nums font-black text-[#8b949e] shrink-0 w-6">{n}×</span>
                            <span className="leading-snug">{({
                              'no-build-window': 'the report never recorded a start and end (unsettled or legacy build)',
                              'no-sandbox-record': 'no durable sandbox record for that workspace',
                              'never-paused': 'nothing ever stamped a pause — the hold is real but unmeasurable',
                              'stale-pairing': 'the pause predates the build, so the record is about an earlier sandbox',
                            } as Record<string, string>)[why] ?? why}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-[#8b949e] font-bold hover:text-white">Check it against {handover.sample.length} real builds</summary>
                    <div className="mt-2 space-y-1.5">
                      {handover.sample.map((s) => (
                        <div key={s.workspaceId} className="bg-[#0d1117] border border-white/5 rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {s.known ? (
                              <>
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-sky-500/40 text-sky-300">{s.buildMinutes}m build</span>
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-amber-500/40 text-amber-300">{s.heldAfterMinutes}m held</span>
                                {s.frontendOnly && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300">reclaimable</span>}
                              </>
                            ) : (
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-white/15 text-[#8b949e]">not measurable · {s.why}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#c9d1d9] mt-1 leading-snug">{s.prompt || <span className="text-[#6e7681]">(no prompt recorded)</span>}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* ALL BUILDS (admin 2026-08-06): every user's every build — 0→100% report downloadable
                  WITHOUT the user pressing Report. The engine already records every build durably;
                  this is the admin's global window over that record. */}
              <div className="bg-[#161b22] border border-indigo-500/20 rounded-[1.25rem] p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-sm font-black text-white tracking-tight">All builds — every user, no submit needed</h4>
                  <span className="text-[10px] text-[#8b949e] font-bold">full 0→100% report per build, straight from the engine's own record</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={allBuildsSearch}
                    onChange={(e) => setAllBuildsSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void fetchAllBuilds(); }}
                    placeholder="Search: name, email, workspace, prompt words…"
                    className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => void fetchAllBuilds()}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${allBuildsLoading ? 'animate-spin' : ''}`} /> Load
                  </button>
                </div>
                {/* FOUR filters, and no more. Status answers "what needs work", date answers "is it
                    still happening", user answers "is it one account", and search covers the rest.
                    Tier/model/duration filters were considered and left out: an admin who needs those
                    is already opening the full report, and a ten-control bar costs more attention than
                    it saves on a screen opened to move fast. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    ['all', 'All', allBuildsCounts?.all],
                    ['failed', 'Failed', allBuildsCounts?.failed],
                    ['succeeded', 'Worked', allBuildsCounts?.succeeded],
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      onClick={() => { setAllBuildsStatus(value); }}
                      className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border ${
                        allBuildsStatus === value
                          ? value === 'failed' ? 'border-rose-500/60 bg-rose-500/15 text-rose-200'
                            : value === 'succeeded' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                            : 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                          : 'border-white/10 text-[#8b949e] hover:text-white hover:border-white/20'
                      }`}
                    >
                      {label}{typeof count === 'number' ? ` ${count}` : ''}
                    </button>
                  ))}

                  <span className="w-px h-5 bg-white/10 mx-1" aria-hidden="true" />

                  <select
                    value={allBuildsDate}
                    onChange={(e) => setAllBuildsDate(e.target.value as typeof allBuildsDate)}
                    className="bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-indigo-500"
                    aria-label="Filter by date"
                  >
                    <option value="all">Any time</option>
                    <option value="today">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                  </select>

                  <select
                    value={allBuildsUid}
                    onChange={(e) => setAllBuildsUid(e.target.value)}
                    className="bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white max-w-[16rem] focus:outline-none focus:border-indigo-500"
                    aria-label="Filter by user"
                  >
                    <option value="">Every user</option>
                    {allBuildsUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>{u.label} ({u.count})</option>
                    ))}
                  </select>

                  {(allBuildsStatus !== 'all' || allBuildsDate !== 'all' || allBuildsUid || allBuildsSearch) && (
                    <button
                      onClick={() => { setAllBuildsStatus('all'); setAllBuildsDate('all'); setAllBuildsUid(''); setAllBuildsSearch(''); }}
                      className="text-[10px] font-bold px-2 py-1.5 rounded-lg text-[#8b949e] hover:text-white underline"
                    >
                      Clear
                    </button>
                  )}

                  <span className="text-[10px] text-[#8b949e] ml-auto">
                    Showing {allBuilds.length}
                    {allBuildsFetched && allBuildsFetched.fetched >= allBuildsFetched.limit
                      /* Honest about the fetch ceiling: at the limit there may be OLDER builds this
                         list has not looked at, so "0 failed" must not read as "none exist". */
                      ? ` of the ${allBuildsFetched.fetched} most recent — narrow the date to see further back`
                      : allBuildsFetched ? ` of ${allBuildsFetched.fetched} loaded` : ''}
                  </span>
                </div>

                {allBuilds.length === 0 && !allBuildsLoading && (
                  <p className="text-[11px] text-[#8b949e]">Press Load to list the most recently active builds across all users.</p>
                )}
                <div className="space-y-1.5 max-h-[28rem] overflow-y-auto">
                  {allBuilds.map((b) => (
                    <div key={b.workspaceId} className="border border-white/5 rounded-xl overflow-hidden">
                      <button
                        onClick={() => void expandWorkspaceBuilds(b.workspaceId)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5"
                      >
                        <span className={`shrink-0 w-2 h-2 rounded-full ${b.ok === true ? 'bg-emerald-400' : b.ok === false ? 'bg-rose-400' : 'bg-zinc-500'}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12px] font-bold text-white truncate">{b.prompt || b.summary || b.workspaceId}</span>
                          {/* The person first, in words. This line used to read `user RyN1xjbfr…`,
                              which is the Firebase UID -- correct, unreadable, and impossible to act
                              on. The uid stays available (title + workspace id) for matching against
                              logs, but it is no longer the only thing shown. */}
                          <span className="block text-[10px] truncate">
                            <span
                              className={b.owner?.anonymous ? 'text-amber-300/80' : 'text-sky-300/90'}
                              title={b.ownerUid || 'no user id'}
                            >
                              {b.owner?.label || (b.ownerUid ? `id ${b.ownerUid.slice(0, 8)}…` : 'Signed-out user')}
                            </span>
                            <span className="text-[#8b949e]">
                              {' · '}{b.savedAt ? new Date(b.savedAt).toLocaleString() : ''}
                            </span>
                          </span>
                          <span className="block text-[9px] text-[#6e7681] font-mono truncate">{b.workspaceId}</span>
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); void copyWorkspaceReport(b.workspaceId); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void copyWorkspaceReport(b.workspaceId); } }}
                          className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                        >
                          ⧉ Copy session
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); void downloadWorkspaceReport(b.workspaceId); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void downloadWorkspaceReport(b.workspaceId); } }}
                          className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10"
                        >
                          ⬇ Full session
                        </span>
                      </button>
                      {expandedWorkspace === b.workspaceId && (
                        <div className="border-t border-white/5 bg-black/20 px-3 py-2 space-y-1">
                          {expandedLoading && <p className="text-[11px] text-[#8b949e]">Loading builds…</p>}
                          {!expandedLoading && expandedHistory.length === 0 && (
                            <p className="text-[11px] text-[#8b949e]">Only the latest report exists for this workspace — use “Full session” above.</p>
                          )}
                          {/* NUMBERED 1st, 2nd, 3rd … in BUILD order (admin 2026-08-09). The list itself
                              arrives newest-first, so the position is counted from the far end — that way
                              "1st part" here means the same build as "1st part" in the session download,
                              which is ordered oldest → newest. */}
                          {!expandedLoading && expandedHistory.map((h, i) => (
                            <div key={h.id} className="flex items-center gap-3 py-1">
                              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${h.ok === true ? 'bg-emerald-400' : h.ok === false ? 'bg-rose-400' : 'bg-zinc-500'}`} />
                              <span className="shrink-0 text-[10px] font-black text-[#8b949e] tabular-nums w-9">{ordinal(expandedHistory.length - i)}</span>
                              <span className="flex-1 min-w-0 text-[11px] text-[#c9d1d9] truncate">
                                {h.startedAt ? new Date(h.startedAt).toLocaleString() : h.id} — {h.prompt || h.summary || 'build'}
                              </span>
                              <button
                                onClick={() => void copyWorkspaceReport(b.workspaceId, h.id)}
                                className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border border-emerald-500/30 text-emerald-300/80 hover:text-white hover:bg-emerald-500/10"
                              >
                                ⧉ Copy
                              </button>
                              <button
                                onClick={() => void downloadWorkspaceReport(b.workspaceId, h.id)}
                                className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border border-white/10 text-[#8b949e] hover:text-white hover:bg-white/5"
                              >
                                ⬇ This build
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* FIRST-PASS QUALITY (ROADMAP #1 Phase 0.2) — the headline engine number. A build that
                  healed itself is NOT counted as a success (50/50 law: a heal is a red flag), so this
                  deliberately reads lower than the delivered rate shown beside it. Honest by
                  construction: shows nothing rather than a fake 0% when no row carries the signal. */}
              {firstPass && firstPass.cleanRate !== null && (
                <div className="bg-[#161b22] border border-white/10 rounded-[1.25rem] p-4">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Target className="w-4 h-4 text-indigo-400" />
                    <h4 className="text-sm font-black text-white tracking-tight">First-pass quality</h4>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      firstPass.cleanRate >= FIRST_PASS_TARGET
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    }`}>
                      target {Math.round(FIRST_PASS_TARGET * 100)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div>
                      <p className="text-2xl font-black text-white tabular-nums">{(firstPass.cleanRate * 100).toFixed(1)}%</p>
                      <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider">Right first time</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-emerald-300 tabular-nums">{firstPass.clean}</p>
                      <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider">Clean</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-amber-300 tabular-nums">{firstPass.healed}</p>
                      <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider">Needed repair</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-rose-300 tabular-nums">{firstPass.failed}</p>
                      <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider">Failed</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#8b949e] leading-snug">{firstPassHeadline(firstPass)} <span className="text-[#6e7681]">Across EVERY build by every user — not only the ones someone reported.</span></p>
                  {/* THE GAP IS THE SIGNAL (admin screenshot 2026-08-12). Complaints far below the
                      engine-wide rate is healthy self-selection — people report what broke. The two
                      being EQUAL would mean users are reporting a fair sample, which is much worse
                      news, and only showing both makes that visible. */}
                  {firstPass.reported && firstPass.reported.cleanRate !== null && (
                    <p className="text-[10px] text-[#8b949e]/70 mt-1.5 leading-snug">
                      Among the {firstPass.reported.total} build(s) users actually pressed “Report” on, {(firstPass.reported.cleanRate * 100).toFixed(1)}% were right first time.
                      {firstPass.cleanRate !== null && firstPass.reported.cleanRate < firstPass.cleanRate
                        ? ' Lower than the rate above, which is expected — people report what broke.'
                        : ' NOT lower than the rate above — users are reporting a fair sample, so the gap is not self-selection.'}
                    </p>
                  )}
                  {firstPass.skippedLegacy > 0 && (
                    <p className="text-[10px] text-[#8b949e]/70 mt-1.5 leading-snug">
                      {firstPass.skippedLegacy} older build(s) excluded — they predate this measurement and
                      carry no repair count. Counting them as clean would inflate the number.
                    </p>
                  )}
                  {firstPass.topHealCodes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider mb-2">
                        Repairs that fire most — prevent these upstream
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {firstPass.topHealCodes.map((h) => (
                          <span key={h.code} className="text-[10px] font-mono px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[#c9d1d9]">
                            {h.code} <span className="text-amber-300 font-bold">×{h.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Top failure patterns (M8-S8.1) — data-driven: which failure class recurs most, so the
                  most-impactful fix is chosen from real evidence. Only shown when there are failures. */}
              {!buildReportsLoading && failureSummary.totalFailed > 0 && (
                <div className="bg-[#161b22] border border-amber-500/20 rounded-[1.25rem] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <h4 className="text-sm font-black text-white tracking-tight">Top failure patterns</h4>
                    <span className="text-[11px] text-[#8b949e] font-bold">
                      {failureSummary.totalFailed} failed of {failureSummary.totalReports} report(s)
                    </span>
                  </div>
                  <div className="grid gap-1.5">
                    {failureSummary.patterns.map((p) => {
                      const pct = failureSummary.totalFailed > 0 ? Math.round((p.count / failureSummary.totalFailed) * 100) : 0;
                      return (
                        <div key={p.label} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 text-[12px] font-bold text-white truncate" title={p.sample}>{p.label}</span>
                          <span className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                            <span className="block h-full bg-amber-500/70 rounded-full" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-16 shrink-0 text-right text-[11px] text-[#8b949e] tabular-nums">{p.count} · {pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Build-time signal (M6-S6.1) — average / median / slowest builds, so speed is measurable. */}
              {!buildReportsLoading && buildTimeSummary.counted > 0 && (
                <div className="bg-[#161b22] border border-sky-500/20 rounded-[1.25rem] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-sky-400" />
                    <h4 className="text-sm font-black text-white tracking-tight">Build speed</h4>
                    <span className="text-[11px] text-[#8b949e] font-bold">across {buildTimeSummary.counted} build(s)</span>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Average</p>
                      <p className="text-xl font-black text-white font-mono">{fmtDuration(buildTimeSummary.avgMs)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Median</p>
                      <p className="text-xl font-black text-white font-mono">{fmtDuration(buildTimeSummary.medianMs)}</p>
                    </div>
                    <div className="min-w-[180px]">
                      <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest mb-1">Slowest</p>
                      {buildTimeSummary.slowest.slice(0, 3).map((s, i) => (
                        <p key={i} className="text-[11px] text-[#8b949e] truncate"><span className="text-amber-400 font-bold font-mono">{fmtDuration(s.ms)}</span> · {s.app}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Filters + sorting (admin 2026-08-01): who sent which report, when, free/paid */}
              {!buildReportsLoading && buildReports.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8b949e]" />
                    <input
                      value={reportSearch}
                      onChange={(e) => setReportSearch(e.target.value)}
                      placeholder="Search name, email, or app…"
                      className="w-full bg-[#161b22] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-[12px] text-white placeholder:text-[#8b949e] focus:border-indigo-500/50 outline-none"
                    />
                  </div>
                  <select
                    value={reportTierFilter}
                    onChange={(e) => setReportTierFilter(e.target.value as ReportTierFilter)}
                    className="bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white outline-none focus:border-indigo-500/50"
                    title="Filter by user type"
                  >
                    <option value="all">All users</option>
                    <option value="paid">Paid</option>
                    <option value="free">Free</option>
                    <option value="admin">Admin/Tester</option>
                  </select>
                  <select
                    value={reportStatusFilter}
                    onChange={(e) => setReportStatusFilter(e.target.value as ReportStatusFilter)}
                    className="bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white outline-none focus:border-indigo-500/50"
                    title="Filter by build outcome"
                  >
                    <option value="all">All status</option>
                    <option value="ok">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                  <select
                    value={reportSortKey}
                    onChange={(e) => setReportSortKey(e.target.value as ReportSortKey)}
                    className="bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white outline-none focus:border-indigo-500/50"
                    title="Sort by"
                  >
                    <option value="time">Sort: Time</option>
                    <option value="name">Sort: Name</option>
                    <option value="app">Sort: App</option>
                    <option value="tier">Sort: User type</option>
                    <option value="charged">Sort: ₹ Charged</option>
                  </select>
                  <button
                    onClick={() => setReportSortAsc((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-white/10 text-[#8b949e] hover:text-white hover:bg-white/5"
                    title={reportSortAsc ? 'Ascending' : 'Descending'}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" /> {reportSortAsc ? 'Asc' : 'Desc'}
                  </button>
                </div>
              )}

              {buildReportsLoading ? (
                <div className="flex items-center justify-center py-12 text-[#8b949e] text-sm"><TirangaLoader className="w-5 h-5 mr-2" /> Loading reports…</div>
              ) : buildReports.length === 0 ? (
                <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-8 text-center text-[#8b949e] text-sm">No build reports submitted yet.</div>
              ) : (
                <>
                  <p className="text-[11px] text-[#8b949e] font-bold">
                    Showing {visibleBuildReports.length} of {buildReports.length} report(s)
                  </p>
                  {visibleBuildReports.length === 0 ? (
                    <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-8 text-center text-[#8b949e] text-sm">No reports match these filters.</div>
                  ) : (
                    <div className="bg-[#161b22] border border-white/10 rounded-[1.25rem] overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wider text-[#8b949e] border-b border-white/10">
                              <th className="px-3 py-2.5 font-black w-10">SN</th>
                              <th className="px-3 py-2.5 font-black">Application</th>
                              <th className="px-3 py-2.5 font-black">Sender</th>
                              <th className="px-3 py-2.5 font-black">Email</th>
                              <th className="px-3 py-2.5 font-black whitespace-nowrap">Time</th>
                              <th className="px-3 py-2.5 font-black">User</th>
                              <th className="px-3 py-2.5 font-black whitespace-nowrap">Charged</th>
                              <th className="px-3 py-2.5 font-black">Status</th>
                              <th className="px-3 py-2.5 font-black w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleBuildReports.map((r, idx) => {
                              const badge = tierBadge(r.tier);
                              return (
                                <tr
                                  key={r.id}
                                  onClick={() => openBuildReport(r.id)}
                                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors"
                                >
                                  <td className="px-3 py-2.5 text-[12px] text-[#8b949e] tabular-nums">{idx + 1}</td>
                                  <td className="px-3 py-2.5 max-w-[240px]">
                                    <span className="flex items-center gap-2">
                                      <span className={`w-2 h-2 rounded-full shrink-0 ${r.ok === true ? 'bg-emerald-500' : r.ok === false ? 'bg-red-500' : r.inFlight ? 'bg-amber-500' : 'bg-zinc-600'}`} />
                                      <span className="block text-[12px] font-bold text-white truncate">{r.appLabel}</span>
                                      {/* A report carrying the whole session says so in the list, so the
                                          admin knows there are parts to choose from before opening it. */}
                                      {(r.sessionParts ?? 1) > 1 && (
                                        <span className="shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-indigo-500/40 text-indigo-300">{r.sessionParts} parts</span>
                                      )}
                                      {/* TRIAGE (admin 2026-08-12) — "is report ka kaam ho chuka hai?".
                                          Downloaded and Fixed are DIFFERENT facts and are shown as such:
                                          a report downloaded this morning may still be shipping its bugs
                                          tonight. See reportTriage.ts. */}
                                      {(() => {
                                        const st = reportStatus(r);
                                        if (st === 'new') return null; // an untouched report needs no badge — the list is already full
                                        return (
                                          <span
                                            title={reportStatusHint(r, (ms) => new Date(ms).toLocaleString())}
                                            className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${st === 'fixed' ? 'border-emerald-500/40 text-emerald-300' : 'border-sky-500/40 text-sky-300'}`}
                                          >{reportStatusLabel(st)}</span>
                                        );
                                      })()}
                                    </span>
                                    {r.rootCause && <span className="block text-[10px] text-amber-400/80 mt-0.5 truncate max-w-[240px]">{r.rootCause}</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-[12px] text-white/90 truncate max-w-[140px]">{r.name || <span className="text-[#8b949e]">—</span>}</td>
                                  <td className="px-3 py-2.5 text-[12px] text-[#8b949e] truncate max-w-[180px]">{r.email || r.userId || 'unknown'}</td>
                                  <td className="px-3 py-2.5 text-[11px] text-[#8b949e] whitespace-nowrap">{new Date(r.reportedAt).toLocaleString()}</td>
                                  <td className="px-3 py-2.5">
                                    <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-full border ${badge.cls}`} title={r.userTier || undefined}>{badge.label}</span>
                                  </td>
                                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                                    {(() => { const c = fmtCharge(r.billedInr); return <span className={`text-[12px] ${c.cls}`} title={r.billedUsd != null ? `$${r.billedUsd}` : undefined}>{c.text}</span>; })()}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    {/* "—" for an unfinished build read as "it produced nothing", which is the
                                        alarming reading and the wrong one. A build still running when Report was
                                        pressed says so. */}
                                    <span className={`text-[11px] font-black ${r.ok === true ? 'text-emerald-400' : r.ok === false ? 'text-red-400' : r.inFlight ? 'text-amber-400' : 'text-zinc-500'}`}>
                                      {r.ok === true ? 'Success' : r.ok === false ? 'Failed' : r.inFlight ? 'Still running' : '—'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="flex items-center gap-2">
                                      <Eye className="w-4 h-4 text-[#8b949e]" />
                                      {/* Delete this report (admin 2026-08-16) — stopPropagation so it never
                                          opens the report it is removing. Confirmed before it deletes. */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); void deleteReport(r.id); }}
                                        title="Delete this report (frees its storage)"
                                        className="text-[#8b949e] hover:text-red-400 transition-colors"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Detail viewer for the selected report */}
              {(selectedReport || selectedReportLoading) && (
                <div className="nb-sheet-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setSelectedReport(null)}>
                  <div className="nb-sheet bg-[#0d1117] border border-white/15 rounded-[1.5rem] w-full max-w-3xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                      <div className="min-w-0">
                        <h4 className="text-sm font-black text-white truncate">{selectedReport?.meta.appLabel ?? 'Loading…'}</h4>
                        {selectedReport && <p className="text-[10px] text-[#8b949e] truncate">{selectedReport.meta.email || selectedReport.meta.userId || 'unknown'} · {new Date(selectedReport.meta.reportedAt).toLocaleString()} · {partsSummary(selectedReport)}</p>}
                      </div>
                      {/* ⚠️ MOBILE CROP (admin 2026-09-03): on a narrow screen this row is wider than the
                          buttons it holds (part picker + Copy JSON + Download JSON + Mark fixed + Delete
                          + Close), and the modal's own `overflow-hidden` (for its rounded corners) simply
                          clipped whatever didn't fit — Close was unreachable. `overflow-x-auto` alone did
                          nothing here: a flex child only scrolls once something caps its width smaller than
                          its content, so the cap (`max-w-[68vw]`, lifted on sm+ where the row already fits)
                          is what turns the clip into a swipe. */}
                      <div className="flex items-center gap-2 shrink-0 max-w-[68vw] sm:max-w-none overflow-x-auto">
                        {/* ⚠️ WE COULD NOT READ THIS SESSION'S HISTORY (admin 2026-08-27, on "shuru ke
                            9 gayab, only 10th report hi aati hai"). A read failure used to return an
                            empty list, which the record then rendered as a genuine one-build session —
                            a confident wrong number that nobody would ever question. Said out loud
                            here, because a missing report is only findable if it announces itself. */}
                        {selectedReport?.session?.historyUnreadable && (
                          <span className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-wider px-2.5 py-2 rounded-xl border border-amber-500/50 text-amber-300 bg-amber-500/10">
                            ⚠ Earlier builds could not be read — this may not be the whole session
                          </span>
                        )}
                        {/* PART PICKER (admin 2026-08-09) — the record holds the whole 0→100% session,
                            so the admin chooses how much to take: All, or the 1st / 2nd / 3rd … build.
                            Only shown when there is genuinely more than one part to choose between. */}
                        {selectedParts.length > 1 && (
                          <select
                            value={reportPart}
                            onChange={(e) => setReportPart(e.target.value)}
                            aria-label="Which part of the report"
                            className="shrink-0 bg-[#0d1117] border border-white/10 rounded-xl px-2.5 py-2 text-[11px] font-bold text-white focus:outline-none focus:border-indigo-500"
                          >
                            {selectedParts.map((p) => (
                              <option key={p.key} value={p.key}>{p.label}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={copySelectedReport}
                          disabled={!selectedPartJson}
                          className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-emerald-500/40 text-emerald-300 hover:text-white hover:bg-emerald-600/20 disabled:opacity-40"
                        >
                          <FileText className="w-3.5 h-3.5" /> Copy JSON
                        </button>
                        <button
                          onClick={downloadSelectedReport}
                          disabled={!selectedPartJson}
                          className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-indigo-500/40 text-indigo-300 hover:text-white hover:bg-indigo-600/20 disabled:opacity-40"
                        >
                          <Download className="w-3.5 h-3.5" /> Download JSON
                        </button>
                        {/* THE MARK ONLY A PERSON SETS (admin 2026-08-12). Download records itself; this
                            does not, because "I have the file" and "the bugs are gone" are different
                            facts and only one of them can be observed by a button. Reversible on
                            purpose — a mis-click that could not be undone would bury a real bug. */}
                        {(() => {
                          const id = selectedReport?.meta.id;
                          const isFixed = reportStatus(selectedReport?.meta) === 'fixed';
                          return (
                            <button
                              onClick={() => id && void markReport(id, { fixed: !isFixed })}
                              disabled={!id}
                              title={isFixed
                                ? reportStatusHint(selectedReport?.meta, (ms) => new Date(ms).toLocaleString())
                                : 'Mark this report as fixed — only after the work is actually merged'}
                              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border disabled:opacity-40 ${isFixed
                                ? 'border-emerald-500/60 text-emerald-200 bg-emerald-600/20 hover:bg-emerald-600/30'
                                : 'border-white/15 text-[#8b949e] hover:text-white hover:bg-white/5'}`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> {isFixed ? 'Fixed' : 'Mark fixed'}
                            </button>
                          );
                        })()}
                        {/* Delete this report from the detail view too (admin 2026-08-16) — same confirm,
                            same storage reclaim; closes the panel on success. */}
                        <button
                          onClick={() => selectedReport?.meta.id && void deleteReport(selectedReport.meta.id)}
                          disabled={!selectedReport?.meta.id}
                          title="Delete this report permanently (frees its storage)"
                          className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-red-500/40 text-red-300 hover:text-white hover:bg-red-600/20 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                        <button onClick={() => setSelectedReport(null)} className="shrink-0 whitespace-nowrap text-[#8b949e] hover:text-white px-2 py-2 rounded-xl hover:bg-white/5">Close</button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-4">
                      {selectedReportLoading ? (
                        <div className="flex items-center justify-center py-12 text-[#8b949e] text-sm"><TirangaLoader className="w-5 h-5 mr-2" /> Loading report…</div>
                      ) : (
                        // WHAT YOU SEE IS WHAT YOU COPY: the viewer renders the SAME bytes the two
                        // buttons hand over, so the chosen part can never differ from the read one.
                        <pre className="text-[11px] leading-relaxed text-[#c9d1d9] whitespace-pre-wrap break-words font-mono">{selectedPartJson || JSON.stringify(selectedReport?.report ?? {}, null, 2)}</pre>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SECURITY TAB ── */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* ── P-SEC.3 — Two-Factor Authentication (TOTP) ── */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Two-Factor Authentication</h3>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${mfaStatus?.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-[#8b949e]'}`}>
                    {mfaStatus?.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-[11px] text-[#8b949e] font-medium">
                  Require a time-based code from an authenticator app (Google Authenticator, Authy, 1Password) at admin login — protection against password leaks and SIM-swap attacks on SMS OTP.
                </p>

                {mfaStatus?.envManaged ? (
                  <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">
                    Managed by ADMIN_TOTP_SECRET on the server — enrolment is read-only here.
                  </p>
                ) : !mfaStatus?.enabled && !mfaEnroll ? (
                  <button onClick={startMfaEnroll} disabled={mfaBusy}
                    className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95">
                    {mfaBusy ? 'Working…' : 'Enable 2FA'}
                  </button>
                ) : !mfaStatus?.enabled && mfaEnroll ? (
                  <div className="space-y-3">
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-2">
                      <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">1. Add this key to your authenticator app</p>
                      <code className="block text-emerald-400 font-mono text-sm break-all select-all">{mfaEnroll.secret}</code>
                      <p className="text-[9px] text-[#8b949e] break-all">Or paste this URI: <span className="font-mono">{mfaEnroll.otpauthUri}</span></p>
                    </div>
                    <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">2. Enter the 6-digit code to confirm</p>
                    <div className="flex gap-2">
                      <input value={mfaCode} inputMode="numeric" maxLength={6}
                        onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-5 py-3 text-white font-bold tracking-[0.3em] text-center outline-none focus:border-emerald-500" />
                      <button onClick={confirmMfaEnroll} disabled={mfaBusy || mfaCode.length !== 6}
                        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95">
                        Confirm
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Enter a current code to disable 2FA</p>
                    <div className="flex gap-2">
                      <input value={mfaCode} inputMode="numeric" maxLength={6}
                        onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-5 py-3 text-white font-bold tracking-[0.3em] text-center outline-none focus:border-red-500" />
                      <button onClick={disableMfa} disabled={mfaBusy || mfaCode.length !== 6}
                        className="px-5 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95">
                        Disable
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {statCard('Failed Logins', analytics?.failedRequests || 0, 'Admin login failures', 'bg-red-500', Shield)}
                {statCard('Website Hits', (analytics?.websiteHitsTotal || 0).toLocaleString(), 'All time requests', 'bg-sky-500', Globe)}
                {statCard('Today Hits', (analytics?.websiteHitsToday || 0).toLocaleString(), `vs ${analytics?.websiteHitsYesterday || 0} yesterday`, 'bg-indigo-500', Eye)}
              </div>

              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-tight">Recent Failed Login Attempts</h3>
                </div>
                <div className="space-y-2">
                  {(analytics?.failedLoginAttempts || []).length === 0 && <p className="text-[10px] text-[#8b949e] uppercase font-bold">No failed attempts recorded.</p>}
                  {(analytics?.failedLoginAttempts || []).slice().reverse().map((attempt: any, i: number) => (
                    <div key={i} className="flex items-center justify-between bg-black/30 rounded-xl px-4 py-2.5 border border-red-500/10">
                      <div>
                        <span className="text-red-400 font-mono text-[11px] font-black">{attempt.ip}</span>
                        {attempt.username && <span className="text-[#8b949e] text-[9px] ml-2">tried: "{attempt.username}"</span>}
                      </div>
                      <span className="text-[9px] text-[#8b949e]">{new Date(attempt.time).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rate-limited providers */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Rate Limited Providers</h3>
                <div className="space-y-2">
                  {Object.entries(analytics?.liveProviderStats || {})
                    .filter(([, s]: any) => s.cooldownUntil > Date.now())
                    .map(([name, s]: any) => (
                      <div key={name} className="flex justify-between items-center bg-red-950/20 border border-red-500/20 rounded-xl px-4 py-2.5">
                        <span className="text-red-400 font-black uppercase font-mono text-[11px]">{name}</span>
                        <span className="text-[10px] text-red-300">Cooldown: {Math.ceil((s.cooldownUntil - Date.now()) / 1000)}s remaining</span>
                      </div>
                    ))}
                  {Object.entries(analytics?.liveProviderStats || {}).filter(([, s]: any) => s.cooldownUntil > Date.now()).length === 0 && (
                    <p className="text-emerald-400 font-bold text-[11px] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />All providers healthy — no rate limits active</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── SETTINGS TAB ── */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              {/* App update broadcast — reaches the user who has NOT opened the app, which the in-app
                  banner by definition cannot. Targets only devices on an older build. */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Bell className="w-4 h-4 text-emerald-400" /> App Update Notification
                </h3>
                {updateCohort?.latestVersionCode == null ? (
                  <p className="text-xs text-amber-300/90 leading-relaxed">
                    ANDROID_LATEST_VERSION_CODE is not set in Cloud Run, so there is no release to announce.
                    Set it to the versionCode of the build you uploaded to Play, then reload.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-[#8b949e] leading-relaxed">
                      {updateCohort?.summary || 'Checking which devices are behind…'}
                    </p>
                    {updateCohort?.truncated && (
                      <p className="text-[11px] text-amber-300/80">
                        Device scan hit its cap — the real number of stale devices is higher than shown.
                      </p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={fetchUpdateCohort}
                        disabled={updateBusy}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 text-[#c9d1d9] hover:bg-white/10 disabled:opacity-50"
                      >
                        Refresh
                      </button>
                      <button
                        onClick={sendUpdateBroadcast}
                        disabled={updateBusy || !updateCohort || updateCohort.targetCount <= 0}
                        className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {updateBusy ? 'Working…' : `Send update notification${updateCohort ? ` (${updateCohort.targetCount})` : ''}`}
                      </button>
                    </div>
                    <p className="text-[11px] text-[#6e7681] leading-relaxed">
                      Only devices on an OLDER build are notified — anyone already up to date is skipped, and a
                      device that has not reported its version is never guessed at. Android only (there is no iOS
                      release). Tapping the notification opens the Play Store listing.
                    </p>
                  </>
                )}
              </div>

              {/* Maintenance Mode */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Server className="w-4 h-4 text-red-400" /> Maintenance Mode
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white font-bold">Site Maintenance</p>
                    <p className="text-[10px] text-[#8b949e]">When enabled, users see a maintenance message</p>
                  </div>
                  <button onClick={() => { setMaintenanceModeState(!maintenanceMode); adminPost('/api/admin/settings', { maintenanceMode: !maintenanceMode }).then(() => toast('Maintenance mode updated!')); }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-black text-[11px] uppercase transition-all ${maintenanceMode ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                    {maintenanceMode ? <><ToggleRight className="w-4 h-4" /> ON — Disable</> : <><ToggleLeft className="w-4 h-4" /> OFF — Enable</>}
                  </button>
                </div>
              </div>

              {/* Feature Flags */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Feature Flags</h3>
                <div className="space-y-3">
                  {Object.entries(featureFlags).map(([key, val]: any) => (
                    <div key={key} className="flex items-center justify-between bg-black/20 rounded-xl px-4 py-3 border border-white/5">
                      <div>
                        <p className="text-sm text-white font-bold capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                        <p className="text-[9px] text-[#8b949e] uppercase font-bold">{val ? 'Enabled' : 'Disabled'}</p>
                      </div>
                      <button onClick={() => { const nf = { ...featureFlags, [key]: !val }; setFeatureFlagsState(nf); adminPost('/api/admin/settings', { featureFlags: nf }).then(() => toast(`${key} ${!val ? 'enabled' : 'disabled'}`)); }}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${val ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/10 text-[#8b949e]'}`}>
                        {val ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pricing Config */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <IndianRupee className="w-4 h-4 text-emerald-400" /> Pricing Configuration
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-indigo-400 font-black uppercase tracking-widest block mb-2">Coins per Rs.1</label>
                    <input type="number" value={pricingConfig.coinsPerRupee || 100} onChange={e => setPricingConfigState((p: any) => ({ ...p, coinsPerRupee: parseInt(e.target.value) }))}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-indigo-400 font-black uppercase tracking-widest block mb-2">Referral Bonus %</label>
                    <input type="number" value={pricingConfig.referralBonusPct || 10} onChange={e => setPricingConfigState((p: any) => ({ ...p, referralBonusPct: parseInt(e.target.value) }))}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono outline-none focus:border-indigo-500" />
                  </div>
                </div>
                <button onClick={handleSettingsSave} className="px-5 py-2.5 bg-indigo-600 rounded-xl text-[11px] font-black uppercase tracking-wider text-white hover:bg-indigo-700 transition-all active:scale-95">
                  Save Pricing
                </button>
              </div>

              {/* Send a message to users (admin 2026-07-30): delivers a real notification to ALL users
                  or to ONE specific user (by email). Users see it via the notification bell in the app. */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-amber-400" /> Message Users
                </h3>
                <textarea value={annMsg} onChange={e => setAnnMsg(e.target.value)} placeholder="Type your message to users..." rows={3}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-[#8b949e] outline-none focus:border-indigo-500 resize-none" />
                <div className="flex flex-wrap items-center gap-3">
                  <select value={annTarget} onChange={e => setAnnTarget(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500">
                    <option value="all">All Users</option>
                    <option value="user">A Specific User</option>
                  </select>
                  {annTarget === 'user' && (
                    <input
                      type="email"
                      value={annEmail}
                      onChange={e => setAnnEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="flex-1 min-w-[200px] bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-[#8b949e] outline-none focus:border-indigo-500"
                    />
                  )}
                  <button onClick={handleAnnouncement} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 rounded-xl text-[11px] font-black uppercase tracking-wider text-black transition-all active:scale-95">
                    Send Message
                  </button>
                </div>
                <p className="text-[10px] text-[#8b949e] leading-relaxed">Delivered in-app via the notification bell. “All Users” reaches everyone; “A Specific User” reaches only that email.</p>
              </div>

              {/* Promo Codes */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Tag className="w-4 h-4 text-pink-400" /> Promo Code Generator
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] text-indigo-400 font-black uppercase tracking-widest block mb-2">Code</label>
                    <input value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())} placeholder="SAVE50" className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-indigo-500 uppercase" />
                  </div>
                  <div>
                    <label className="text-[10px] text-indigo-400 font-black uppercase tracking-widest block mb-2">Free Tokens</label>
                    <input type="number" value={promoTokens} onChange={e => setPromoTokens(e.target.value)} placeholder="500" className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-indigo-400 font-black uppercase tracking-widest block mb-2">Discount %</label>
                    <input type="number" value={promoDiscount} onChange={e => setPromoDiscount(e.target.value)} placeholder="10" className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-indigo-400 font-black uppercase tracking-widest block mb-2">Max Uses</label>
                    <input type="number" value={promoMaxUses} onChange={e => setPromoMaxUses(e.target.value)} placeholder="1" className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono outline-none focus:border-indigo-500" />
                  </div>
                </div>
                <button onClick={handlePromoCreate} className="px-5 py-2.5 bg-pink-600 hover:bg-pink-700 rounded-xl text-[11px] font-black uppercase tracking-wider text-white transition-all active:scale-95 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Create Promo Code
                </button>

                {promos.length > 0 && (
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                        <th className="py-2 text-left">Code</th><th className="py-2 text-left">Tokens</th><th className="py-2 text-left">Discount</th><th className="py-2 text-left">Used</th><th className="py-2 text-left">Status</th>
                      </tr></thead>
                      <tbody className="divide-y divide-white/5">
                        {promos.map((p: any) => (
                          <tr key={p.id} className="hover:bg-white/5">
                            <td className="py-2 text-pink-400 font-black font-mono">{p.code}</td>
                            <td className="py-2 text-amber-400 font-mono">{p.freeTokens || 0}</td>
                            <td className="py-2 text-sky-400 font-mono">{p.discountPct || 0}%</td>
                            <td className="py-2 text-white font-mono">{p.usedCount || 0}/{p.maxUses || 1}</td>
                            <td className="py-2"><span className={`text-[9px] font-black uppercase ${p.active ? 'text-emerald-400' : 'text-red-400'}`}>{p.active ? 'Active' : 'Expired'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
