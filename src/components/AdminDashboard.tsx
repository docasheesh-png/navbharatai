import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Users, Zap, IndianRupee, Activity, Shield, Settings, Server, Plus, Search, AlertTriangle, CheckCircle2, Megaphone, Tag, ToggleLeft, ToggleRight, Cpu, TrendingUp, Eye, UserCheck, Globe, Database, FileText, Download, ArrowUpDown, Target } from 'lucide-react';
import { TirangaLoader } from './ui/TirangaLoader';
// @ts-ignore -- XSquare is a valid export in installed lucide-react 0.546.0
import { XSquare as BanIcon } from 'lucide-react';
import { summarizeCostTelemetry, type CostLadderSummary } from '../lib/agentV3CostSummary';
import { summarizeFailurePatterns, summarizeBuildTimes } from '../lib/buildReportAnalytics';
import { firstPassStatsFromMeta, firstPassHeadline, FIRST_PASS_TARGET } from '../lib/firstPassQuality';

interface AdminDashboardProps {
  adminToken: string;
  onLogout: () => void;
}

type TabId = 'overview' | 'users' | 'engines' | 'revenue' | 'reports' | 'security' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'overview',  label: 'Overview',    icon: Activity },
  { id: 'users',     label: 'Users',        icon: Users },
  { id: 'engines',   label: 'AI Engines',   icon: Cpu },
  { id: 'revenue',   label: 'Revenue',      icon: IndianRupee },
  { id: 'reports',   label: 'Build Reports', icon: FileText },
  { id: 'security',  label: 'Security',     icon: Shield },
  { id: 'settings',  label: 'Settings',     icon: Settings },
];

type ReportTier = 'paid' | 'free' | 'admin' | 'unknown';

interface AdminBuildReportRow {
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
  const [activeTab, setActiveTab] = useState<TabId>('overview');
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
  const [selectedReport, setSelectedReport] = useState<{ meta: AdminBuildReportRow; report: any } | null>(null);
  const [selectedReportLoading, setSelectedReportLoading] = useState(false);
  // ALL BUILDS browser (admin 2026-08-06) — every user's every build, no user submit needed.
  interface AllBuildRow {
    workspaceId: string; savedAt: number; ownerUid: string | null;
    id: string; startedAt?: number; endedAt?: number; ok?: boolean;
    summary?: string; rootCause?: string; prompt?: string;
  }
  const [allBuilds, setAllBuilds] = useState<AllBuildRow[]>([]);
  const [allBuildsLoading, setAllBuildsLoading] = useState(false);
  const [allBuildsSearch, setAllBuildsSearch] = useState('');
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
  const firstPass = useMemo(() => firstPassStatsFromMeta(buildReports), [buildReports]);
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

  const openBuildReport = useCallback(async (id: string) => {
    setSelectedReportLoading(true);
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
      const qs = allBuildsSearch.trim() ? `?q=${encodeURIComponent(allBuildsSearch.trim())}` : '';
      const r = await fetch(`/api/admin/all-builds${qs}`, { headers });
      const d = await r.json();
      setAllBuilds(Array.isArray(d?.builds) ? d.builds : []);
    } catch (e) { console.error(e); setAllBuilds([]); }
    finally { setAllBuildsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, allBuildsSearch]);

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

  // Auth header rides on fetch (a plain <a href> cannot carry it), then the blob becomes the file.
  const downloadWorkspaceReport = async (workspaceId: string, buildId?: string) => {
    try {
      const qs = buildId ? `?build=${encodeURIComponent(buildId)}` : '';
      const r = await fetch(`/api/admin/all-builds/${encodeURIComponent(workspaceId)}/download${qs}`, { headers });
      if (!r.ok) { toast('No report recorded for that build.'); return; }
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildId ? `build-${workspaceId}-${buildId}.json` : `build-session-${workspaceId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { console.error(e); toast('Download failed.'); }
  };

  const downloadSelectedReport = () => {
    if (!selectedReport) return;
    try {
      const blob = new Blob([JSON.stringify(selectedReport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `build-report-${selectedReport.meta.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { console.error(e); toast('Download failed.'); }
  };

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
  useEffect(() => { if (activeTab === 'overview') { fetchHealthScore(); fetchInsights(); } }, [activeTab, fetchHealthScore, fetchInsights]);
  useEffect(() => { if (activeTab === 'users') fetchUsers(); }, [activeTab, fetchUsers]);
  useEffect(() => { if (activeTab === 'settings') fetchPromos(); }, [activeTab, fetchPromos]);
  useEffect(() => { if (activeTab === 'revenue') { fetchCostTelemetry(); fetchFinOps(); } }, [activeTab, fetchCostTelemetry, fetchFinOps]);
  useEffect(() => { if (activeTab === 'reports') fetchBuildReports(); }, [activeTab, fetchBuildReports]);
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
          {activeTab === 'overview' && (
            <div className="space-y-6">
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
                            <div className="text-white font-bold text-[11px]">{u.name}</div>
                            <div className="text-[#8b949e] text-[9px] font-mono">{u.email}</div>
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
          {activeTab === 'reports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-white tracking-tight">Build Reports</h3>
                  <p className="text-[11px] text-[#8b949e] font-bold mt-0.5">Reports submitted by users via the “Report” button — admin-only.</p>
                </div>
                <button
                  onClick={fetchBuildReports}
                  className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-white/10 text-[#8b949e] hover:text-white hover:bg-white/5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${buildReportsLoading ? 'animate-spin' : ''}`} /> Refresh
                </button>
              </div>

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
                    placeholder="Search: user id, workspace, prompt words…"
                    className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => void fetchAllBuilds()}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${allBuildsLoading ? 'animate-spin' : ''}`} /> Load
                  </button>
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
                          <span className="block text-[10px] text-[#8b949e] font-mono truncate">
                            {b.ownerUid ? `user ${b.ownerUid}` : 'anon'} · {b.savedAt ? new Date(b.savedAt).toLocaleString() : ''} · {b.workspaceId}
                          </span>
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
                          {!expandedLoading && expandedHistory.map((h) => (
                            <div key={h.id} className="flex items-center gap-3 py-1">
                              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${h.ok === true ? 'bg-emerald-400' : h.ok === false ? 'bg-rose-400' : 'bg-zinc-500'}`} />
                              <span className="flex-1 min-w-0 text-[11px] text-[#c9d1d9] truncate">
                                {h.startedAt ? new Date(h.startedAt).toLocaleString() : h.id} — {h.prompt || h.summary || 'build'}
                              </span>
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
              {!buildReportsLoading && firstPass.cleanRate !== null && (
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
                  <p className="text-[11px] text-[#8b949e] leading-snug">{firstPassHeadline(firstPass)}</p>
                  {firstPass.skippedLegacy > 0 && (
                    <p className="text-[10px] text-[#8b949e]/70 mt-1.5 leading-snug">
                      {firstPass.skippedLegacy} older report(s) excluded — they predate this measurement and
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
                                  <td className="px-3 py-2.5"><Eye className="w-4 h-4 text-[#8b949e]" /></td>
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelectedReport(null)}>
                  <div className="bg-[#0d1117] border border-white/15 rounded-[1.5rem] w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                      <div className="min-w-0">
                        <h4 className="text-sm font-black text-white truncate">{selectedReport?.meta.appLabel ?? 'Loading…'}</h4>
                        {selectedReport && <p className="text-[10px] text-[#8b949e] truncate">{selectedReport.meta.email || selectedReport.meta.userId || 'unknown'} · {new Date(selectedReport.meta.reportedAt).toLocaleString()}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={downloadSelectedReport}
                          disabled={!selectedReport}
                          className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-indigo-500/40 text-indigo-300 hover:text-white hover:bg-indigo-600/20 disabled:opacity-40"
                        >
                          <Download className="w-3.5 h-3.5" /> Download JSON
                        </button>
                        <button onClick={() => setSelectedReport(null)} className="text-[#8b949e] hover:text-white px-2 py-2 rounded-xl hover:bg-white/5">Close</button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-4">
                      {selectedReportLoading ? (
                        <div className="flex items-center justify-center py-12 text-[#8b949e] text-sm"><TirangaLoader className="w-5 h-5 mr-2" /> Loading report…</div>
                      ) : (
                        <pre className="text-[11px] leading-relaxed text-[#c9d1d9] whitespace-pre-wrap break-words font-mono">{JSON.stringify(selectedReport?.report ?? {}, null, 2)}</pre>
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
