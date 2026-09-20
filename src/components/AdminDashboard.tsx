import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Users, Zap, IndianRupee, Activity, Shield, Settings, Server, Plus, Search, AlertTriangle, CheckCircle2, Megaphone, Tag, ToggleLeft, ToggleRight, Cpu, TrendingUp, Eye, UserCheck, Globe, Database, FileText, Download, ArrowUpDown, ArrowUp, ArrowDown, Target, Bell, Clock, Trash2, Flag, ShieldAlert, Image as PictureIcon, Smartphone, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { effectiveDirection } from '../lib/adminUserSort';
import { TirangaLoader } from './ui/TirangaLoader';
import { usePagedList } from '../hooks/usePagedList';
import { LoadMore } from './common/LoadMore';
import { stampLabel, dayLabel, signInMethodWords } from '../lib/adminUserDisplay';
import { PublishedAppsCard } from './profile/PublishedAppsCard';
import { publishedAppRows, liveAppCount } from '../lib/publishedAppsView';
import { adultOptInSummary } from '../lib/adultContent';
import { confirmCopy } from '../lib/adminAppModeration';
import { BuiltAppsPanel } from './admin/BuiltAppsPanel';
// @ts-ignore -- XSquare is a valid export in installed lucide-react 0.546.0
import { XSquare as BanIcon } from 'lucide-react';
import { summarizeCostTelemetry, type CostLadderSummary } from '../lib/agentV3CostSummary';
import { summarizeFailurePatterns, summarizeBuildTimes } from '../lib/buildReportAnalytics';
import { firstPassHeadline, FIRST_PASS_TARGET, type FirstPassMetaStats } from '../lib/firstPassQuality';
import { type ExposureRow } from '../lib/licenceExposure';
import { copyTextToClipboard } from '../lib/copyText';
import { safeLS } from '../lib/localStorageSafe';
import { apkReportFilename, apkReportsArchiveFilename } from '../lib/apkReportFile';
import { reportParts, partJson, partsSummary, ordinal } from './adminReportParts';
import { MonitorPanels } from './admin/MonitorPanels';
import { LoadBoard } from './admin/LoadBoard';
import { AudienceCard } from './admin/AudienceCard';
import { BuildCostCard } from './admin/BuildCostCard';
import { ReferralCostCard } from './admin/ReferralCostCard';
import { FailureCategoryCard } from './admin/FailureCategoryCard';
import { AdminCopyButton } from './admin/AdminCopyButton';
import { reportStatus, reportStatusLabel, reportStatusHint, openReportCount, type ReportTriage } from '../server/AgentV3/reportTriage';
import { completenessLine, readCompleteness } from '../server/AgentV3/reportTruncation';
import { problemKindLabel } from '../lib/userReport';
import { ReportInfoButton } from './admin/ReportInfoButton';
import { ReportFilterBar } from './admin/ReportFilterBar';
import { submittedRowFacts, allBuildRowFacts, personLabel } from '../lib/reportRowFacts';
import { rowMatches, statusCountsFor, EMPTY_FILTERS, type ListFilterState } from '../lib/reportListFilter';
import { describeOverflow } from '../lib/reportDiagnostics';
import {
  badgesFromPayload, formatBadge, badgeNeedsAttention, BADGE_HINTS,
  type AdminTabBadges,
} from '../lib/adminTabBadges';
import { ReportShot } from './ReportShot';
import { compressForReport } from '../lib/reportImage';

interface AdminDashboardProps {
  adminToken: string;
  onLogout: () => void;
}

type TabId = 'monitor' | 'users' | 'engines' | 'revenue' | 'reports' | 'userreports' | 'apkreports' | 'security' | 'settings';

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
  // APK REPORTS — a THIRD, separate page (admin 2026-09-14). "Build Reports" above is the in-house
  // AgentV3 engine's own report, sent only when a user presses "Report"; this one is the Android/iOS
  // store-build pipeline (a user's app compiled on their OWN GitHub via GitHub Actions), and it is
  // written AUTOMATICALLY the moment such a build fails — no button, no user action. Different
  // pipeline, different failure shape (Gradle/Xcode/npm, not an AI build turn), so it gets its own page
  // rather than being squeezed into either existing inbox's fields.
  { id: 'apkreports', label: 'APK Reports', icon: Smartphone },
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
  /** The build's own OUTCOME_* code + severity (AdminBuildReportStore) — read by the failure-pattern card. */
  outcomeCode?: string | null;
  outcomeSeverity?: string | null;
  /** How many defects the engine repaired in its OWN output, and how many it left unresolved.
   *  Absent on reports written before this measurement existed — those rows are EXCLUDED from the
   *  first-pass rate rather than counted as clean (see firstPassStatsFromMeta). */
  healCount?: number;
  unresolvedCount?: number;
  /** How many builds/edits of the session the record carries (1 when only the focused build exists). */
  sessionParts?: number;
  /**
   * WHAT THE USER SAID WAS WRONG, in their own words (admin 2026-08-28). Absent when they sent the
   * report without typing anything, and on every report written before the box existed — neither is
   * an error, and neither should read as one.
   */
  userNote?: string | null;
  /**
   * THE ACCOUNT'S tier — "has this person ever bought tokens with real ₹?" (admin 2026-09-14).
   * Resolved server-side by lib/accountTier.ts.
   *
   * ⚠️ NOT the same field as `tier` above, and that is the point. `tier` is
   * `classifyReportTier(billing.userTier)` — how THAT BUILD was routed, which a user turns to "free"
   * simply by choosing the Weak engine. A customer who had paid ₹500 and picked Weak was listed as
   * Free, so "show me my paying users" hid a real customer. Both are kept: one is the build, one is
   * the person, and only the second answers the admin's question.
   */
  accountTier?: ListFilterState['tier'] | null;
}

type ReportSortKey = 'time' | 'name' | 'app' | 'tier' | 'charged';
// `ReportTierFilter` lived here for this inbox's own paid/free select. That control moved into the
// shared ReportFilterBar and its vocabulary into ListTierFilter (reportListFilter.ts), which BOTH
// lists now use — and which carries 'unknown', a bucket this one silently folded into nothing.

const statCard = (label: string, value: string | number, sub: string, color: string, Icon: React.ComponentType<any>) => (
  <div className="bg-card border border-line rounded-[1.5rem] p-5 relative overflow-hidden">
    <div className={`absolute top-0 left-0 w-full h-1 ${color}`} />
    <div className="flex justify-between items-start">
      <div>
        <p className="text-[10px] text-muted font-black uppercase tracking-widest">{label}</p>
        <h3 className="text-2xl font-black text-ink tracking-tight mt-1 font-mono">{value}</h3>
        <p className="text-[9px] text-muted uppercase font-bold tracking-wider mt-2">{sub}</p>
      </div>
      <div className={`p-2.5 rounded-xl border border-line bg-raised`}>
        <Icon className="w-4 h-4 text-muted" />
      </div>
    </div>
  </div>
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ adminToken, onLogout }) => {
  const [activeTab, setActiveTab] = useState<TabId>('monitor');
  // ── User reports (admin 2026-08-21) ──────────────────────────────────────
  const [userReports, setUserReports] = useState<any[]>([]);
  /** The admin's half of a report conversation — see the reply box in the report modal. */
  /** Platform-wide "which feature is being used" for one day — see the card on the Users tab. */
  const [featureSpend, setFeatureSpend] = useState<any>(null);
  const [featureSpendLoading, setFeatureSpendLoading] = useState(false);
  const [reportReply, setReportReply] = useState('');
  const [reportReplyShot, setReportReplyShot] = useState('');
  const [reportReplyBusy, setReportReplyBusy] = useState(false);
  const [reportReplyNote, setReportReplyNote] = useState('');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [openReport, setOpenReport] = useState<any>(null);
  const [reportFilter, setReportFilter] = useState<'open' | 'all'>('open');
  // ── APK build-failure reports (admin 2026-09-14) — a separate inbox, see AdminApkReportStore.ts ──
  const [apkReports, setApkReports] = useState<any[]>([]);
  const [apkReportsLoading, setApkReportsLoading] = useState(false);
  const [openApkReport, setOpenApkReport] = useState<any>(null);
  /** The account sheet: opened FROM a report (or from the Users tab), so a decision is made with the
   *  whole picture in front of the admin rather than from a complaint alone. */
  const [account, setAccount] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  /**
   * Who came to NavBharatAI itself — website visits, app opens and the people who signed in.
   *
   * 🔒 LOADED ON DEMAND, never on a tab switch. The "who came" half scans the wallets and asks Firebase
   * Auth about every account, which is real work nobody asked for when they merely opened Monitor. The
   * admin's instruction ("sab kuch button ke andar ho") and the cost point the same way.
   */
  const [audience, setAudience] = useState<any>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [userSort, setUserSort] = useState('tokens');
  // PAID / FREE and the direction (admin 2026-09-19). Both start at the values that reproduce the
  // previous screen exactly: every account, and each sort's own natural direction — so opening the
  // panel shows what it has always shown, and the two controls only ever narrow or flip deliberately.
  const [userPaid, setUserPaid] = useState<'all' | 'paid' | 'free'>('all');
  const [userDir, setUserDir] = useState<'' | 'asc' | 'desc'>('');
  // The direction ACTUALLY in force. Derived from the same table the server sorts by
  // (`src/lib/adminUserSort.ts`), never from a second copy of it here — an arrow pointing down over a
  // list sorted up is the kind of drift nothing fails to reveal.
  const effectiveUserDir = effectiveDirection(userDir, userSort);
  const [userSearch, setUserSearch] = useState('');
  /**
   * THE USER TABLE IS PAGED ON THE **SERVER** (admin 2026-09-14: "pehle sirf 10-12 line hi load ho").
   *
   * 🔴 AND IT IS THE ONE LIST WHERE A CLIENT-SIDE BUTTON WOULD HAVE BEEN A LIE. Everywhere else the
   * rows are already in the browser, so showing twelve of them is the whole fix. Here the slowness is
   * in the REQUEST: `/api/admin/users` looks up Firebase Auth metadata for every user, batched at
   * Firebase's 100-identifier limit — so 5,000 users is fifty sequential round-trips before the first
   * row can be drawn. Hiding rows after that arrives would change nothing the admin can feel.
   *
   * So "Load more" here asks the SERVER for more: 25 rows, then 50, then 75. Sort and search still
   * run over every user (the server scans the whole collection for them, deliberately — see the
   * route), so searching is never narrowed to the page you happen to be looking at.
   */
  const USER_PAGE = 25;
  const [userLimit, setUserLimit] = useState(USER_PAGE);
  const [userTotal, setUserTotal] = useState<number | null>(null);
  // PURCHASES — who paid, for what (admin 2026-09-17). Fed by /api/admin/purchases, which reads the
  // same rows the analytics tiles are computed from, so the table and the tiles cannot disagree.
  const [purchases, setPurchases] = useState<{
    rows: any[]; total: number; offset: number; limit: number;
    summary: any; overall: any;
  } | null>(null);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchasesError, setPurchasesError] = useState('');
  const [purchaseQuery, setPurchaseQuery] = useState<{
    search: string; status: 'all' | 'revenue' | 'success' | 'pending' | 'failed' | 'free';
    from: string; to: string; sort: 'date' | 'amount' | 'tokens'; dir: 'asc' | 'desc'; offset: number;
  }>({ search: '', status: 'all', from: '', to: '', sort: 'date', dir: 'desc', offset: 0 });
  // Back to page one whenever the list MEANS something different. Without this, an admin who pressed
  // "Load more" five times and then typed a search would fetch 150 rows of the new result — the same
  // reset `usePagedList` does for every client-side list, done here against the server instead.
  useEffect(() => { setUserLimit(USER_PAGE); setUserTotal(null); }, [userSearch, userSort, userPaid, userDir]);
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
  const [failureReport, setFailureReport] = useState<{
    overall: { totalBuilds: number; failedBuilds: number; failureRate: number };
    spikeDates: string[];
    /** WHY they failed, ranked by what each cause cost US. Null when the ledger could not be read. */
    causes?: {
      builds: number; usd: number; headline: string;
      causes: Array<{ category: string; builds: number; usd: number; shareOfBuilds: number; avgSeconds: number; sample?: string }>;
      frameworks: Array<{ framework: string; builds: number }>;
    } | null;
    /** False means the read FAILED — not that nothing went wrong. */
    causesComplete?: boolean;
  } | null>(null);

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
    /** Lifted out of the report the list query already read — see AllDiagnosticsEntry. Every one is
     *  optional: a legacy or unsettled build records none, and the ⓘ panel says "not recorded"
     *  rather than printing a ₹0 nobody was charged. */
    userTier?: string | null; billedInr?: number | null; billedUsd?: number | null; zeroBillReason?: string | null;
    /** Has this row already been handed to someone? (admin 2026-09-14 — one report, two sessions.) */
    triage?: ReportTriage | null;
    /** The ACCOUNT's tier — paid means this person has bought tokens with real ₹. */
    tier?: ListFilterState['tier'] | null;
  }
  const [allBuilds, setAllBuilds] = useState<AllBuildRow[]>([]);
  const [allBuildsLoading, setAllBuildsLoading] = useState(false);
  const [allBuildsSearch, setAllBuildsSearch] = useState('');
  // Four filters, deliberately (see server/lib/buildListFilter.ts for why not more).
  const [allBuildsStatus, setAllBuildsStatus] = useState<'all' | 'failed' | 'succeeded' | 'unknown'>('all');
  const [allBuildsDate, setAllBuildsDate] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [allBuildsUid, setAllBuildsUid] = useState('');
  /** Paid / free / admin / unknown — decided on the ACCOUNT, server-side (see lib/accountTier.ts). */
  const [allBuildsTier, setAllBuildsTier] = useState<ListFilterState['tier']>('all');
  const [allBuildsCounts, setAllBuildsCounts] = useState<{ all: number; failed: number; succeeded: number; unknown: number } | null>(null);
  const [allBuildsUsers, setAllBuildsUsers] = useState<Array<{ uid: string; count: number; label: string }>>([]);
  const [allBuildsFetched, setAllBuildsFetched] = useState<{ fetched: number; limit: number } | null>(null);
  /**
   * Is the Publish Capacity card unfolded? (admin 2026-09-17: "Publish Capacity ko fold/unfold ka
   * option do".) The card grows one row per wasted channel — on the capture that prompted this it
   * carried THIRTY-FOUR of them, each with its own Reclaim button, pushing everything below it off
   * the screen.
   *
   * 🔒 FOLDING MUST NEVER HIDE THE ALARM. The header keeps the level badge and gains a one-line
   * summary when folded, so a critical ceiling is still visible from a collapsed card — a control
   * that can silently conceal a warning is worse than a long card.
   *
   * Default OPEN, so nothing moves for an admin who never presses it, and the choice is remembered
   * per browser. A read that throws (private mode, blocked site data) falls back to open rather than
   * to a folded card the admin did not ask for.
   */
  const [publishCardOpen, setPublishCardOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('admin_publish_capacity_folded') !== '1'; } catch { return true; }
  });
  const togglePublishCard = useCallback(() => {
    setPublishCardOpen((open) => { safeLS('admin_publish_capacity_folded', open ? '1' : '0'); return !open; });
  }, []);
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Array<{ id: string; startedAt: number; endedAt?: number; ok?: boolean; summary?: string; prompt?: string }>>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  // Build Reports — filters & sorting (admin 2026-08-01): who sent which report, when, free/paid.
  // THE SAME FILTER OBJECT THE ALL-BUILDS LIST USES (admin 2026-09-14: "filter bhi all build report
  // wala chahiye dono me!!"). It replaces this inbox's own search + status selects, and ADDS the two
  // it never had: a date range (so "is this still happening?" is askable of the list where users
  // actually complain) and a per-user picker. The tier select and the sort toggle survive alongside
  // it — they are extra, not duplicates, and dropping them would be a regression dressed as parity.
  const [reportFilters, setReportFilters] = useState<ListFilterState>(EMPTY_FILTERS);
  const [reportSortKey, setReportSortKey] = useState<ReportSortKey>('time');
  const [reportSortAsc, setReportSortAsc] = useState(false); // default: newest first

  // Apply the search + tier + status filters, then sort. Pure derivation of the fetched rows.
  /**
   * One row of this inbox, mapped onto the shape the SHARED filter understands. The searchable text
   * still includes the user's own complaint (admin 2026-08-28) — "show me every report that mentions
   * the Save button" is the question this inbox exists to answer, and only their words can answer it.
   */
  const reportFilterRow = useCallback((r: AdminBuildReportRow) => ({
    ok: r.ok, at: r.reportedAt, uid: r.userId,
    // The ACCOUNT's tier, not the build's — see `accountTier` on the row type.
    tier: r.accountTier ?? 'unknown',
    search: [r.name, r.email, r.appLabel, r.userId, r.userNote, r.rootCause],
  }), []);

  /** The chip counts and the user picker, computed from the rows this inbox already holds. */
  const reportCounts = useMemo(
    () => statusCountsFor(buildReports.map(reportFilterRow), reportFilters),
    [buildReports, reportFilters, reportFilterRow],
  );
  const reportUsers = useMemo(() => {
    const by = new Map<string, { uid: string; count: number; label: string }>();
    for (const r of buildReports) {
      const uid = String(r.userId ?? '').trim();
      if (!uid) continue;
      const row = by.get(uid) ?? { uid, count: 0, label: personLabel(r.name, r.email, uid) };
      row.count += 1;
      by.set(uid, row);
    }
    return [...by.values()].sort((a, b) => b.count - a.count);
  }, [buildReports]);

  const visibleBuildReports = useMemo(() => {
    const filtered = buildReports.filter((r) => rowMatches(reportFilterRow(r), reportFilters));
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
  }, [buildReports, reportFilters, reportSortKey, reportSortAsc, reportFilterRow]);

  // `fmtCharge` and `tierBadge` lived here to fill two columns of the nine-column table that this
  // change removed. Their replacements are `formatCharge` and the "User type" fact in
  // reportRowFacts.ts, which BOTH lists now read — and which, unlike these, distinguish "we charged
  // nothing" from "no charge was recorded". Deleted rather than left behind: a dead helper is the
  // thing a later edit resurrects by accident, reintroducing the ₹0-for-unknown it used to print.

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
  /**
   * LICENCE EXPOSURE — third-party services whose terms do not cover a commercial product.
   * Admin-only and read-only: it reports whether each source is running, never any credential value.
   */
  const [licenceRows, setLicenceRows] = useState<ExposureRow[] | null>(null);
  const [licenceHeadline, setLicenceHeadline] = useState('');
  const fetchLicenceExposure = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/licence-exposure', { headers });
      const d = await r.json();
      setLicenceRows(Array.isArray(d?.rows) ? d.rows : null);
      setLicenceHeadline(typeof d?.headline === 'string' ? d.headline : '');
    } catch (e) { console.error(e); setLicenceRows(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);
  /**
   * THE SAFETY QUEUE (admin 2026-09-12, Phase 6) — the messages the automatic check objected to.
   * `null` = not read, kept distinct from an empty queue for the usual reason: on this screen those
   * two look identical and mean opposite things.
   */
  const [safetyFlags, setSafetyFlags] = useState<Array<Record<string, any>> | null>(null);
  const [safetyError, setSafetyError] = useState('');
  const fetchSafetyFlags = useCallback(async () => {
    setSafetyError('');
    try {
      const r = await fetch('/api/admin/safety-flags', { headers });
      const d = await r.json();
      if (!r.ok) { setSafetyFlags(null); setSafetyError(d?.error || 'Could not read the queue.'); return; }
      setSafetyFlags(Array.isArray(d?.rows) ? d.rows : null);
      if (!Array.isArray(d?.rows)) setSafetyError('Unexpected response from the server.');
    } catch (e) { console.error(e); setSafetyFlags(null); setSafetyError('Could not reach the server.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  /**
   * WHO HAS TURNED ON +18 (admin 2026-09-12: "kis kis user ne on kiya hai, admin penal me dikhe").
   *
   * `null` means NOT READ, and it is kept distinct from an empty list on purpose: "nobody has this
   * on" and "the query failed" must never look the same on the screen where the admin decides
   * whether to worry about it.
   */
  const [adultOptIns, setAdultOptIns] = useState<Array<{ userId: string; optedInAt: string; label: string }> | null>(null);
  const [adultError, setAdultError] = useState('');

  /**
   * The other admin lists, same rule, declared here because this is the first point at which every
   * state they read exists. Each one grows with the platform and had no cap at all: every report ever
   * filed, every app ever built, every promo code, every +18 opt-in.
   *
   * The `resetKey`s are the real filters above them — the report Open/All toggle, and the four
   * controls over the all-builds table (search, status, date, user). Change any of those and the list
   * means something different, so it starts at page one.
   */
  const pagedUserReports = usePagedList(userReports, { resetKey: reportFilter });
  const pagedAllBuilds = usePagedList(allBuilds, { resetKey: `${allBuildsSearch}|${allBuildsStatus}|${allBuildsDate}|${allBuildsUid}` });
  const pagedAdultOptIns = usePagedList(adultOptIns);
  const pagedPromos = usePagedList(promos);
  const fetchAdultOptIns = useCallback(async () => {
    setAdultError('');
    try {
      const r = await fetch('/api/admin/adult-optins', { headers });
      const d = await r.json();
      if (!r.ok) { setAdultOptIns(null); setAdultError(d?.error || 'Could not read the list.'); return; }
      setAdultOptIns(Array.isArray(d?.users) ? d.users : null);
      if (!Array.isArray(d?.users)) setAdultError('Unexpected response from the server.');
    } catch (e) { console.error(e); setAdultOptIns(null); setAdultError('Could not reach the server.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);
  // M6-S6.1 — the speed signal: average / median / slowest build time across all reports.
  const buildTimeSummary = useMemo(() => summarizeBuildTimes(buildReports), [buildReports]);
  const fmtDuration = (ms: number): string => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`);

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

  /**
   * Answer the person who reported it.
   *
   * ⚠️ THE NOTIFICATION IS REPORTED HONESTLY, NOT ASSUMED. The server stores the reply first and
   * tells us separately whether the bell actually rang; showing "sent" for both would leave the
   * admin believing a user had been told when they had not — and the user waiting for a reply they
   * can only find by chance.
   */
  const adminReplyFileRef = useRef<HTMLInputElement>(null);

  /** The SAME compression the user's sheet uses, so one side can never accept what the other refuses. */
  const pickAdminReplyShot = async (file: File | undefined) => {
    if (!file) return;
    setReportReplyNote('');
    const r = await compressForReport(file);
    if (!r.ok) { setReportReplyNote(r.error || 'That image could not be used.'); return; }
    setReportReplyShot(r.dataUrl || '');
  };

  const replyToReport = async (id: string) => {
    // A screenshot on its own is a complete reply ("tap here"), so an empty box with one attached
    // must not be a dead button.
    if (!id || reportReplyBusy || (reportReply.trim().length === 0 && !reportReplyShot)) return;
    setReportReplyBusy(true);
    setReportReplyNote('');
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(id)}/reply`, {
        method: 'POST', headers, body: JSON.stringify({ text: reportReply.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setReportReplyNote(data?.error || 'Could not send that reply.'); return; }
      setOpenReport((prev: any) => (prev ? { ...prev, report: { ...prev.report, messages: data.messages } } : prev));
      setReportReply('');
      setReportReplyShot('');
      // Two separate honest failures, kept separate: the bell may not have rung, and the picture may
      // not have attached. Collapsing them into one "sent" would hide whichever actually happened.
      const problems = [
        data?.notified ? '' : 'the user could not be notified, so they may not see it soon',
        reportReplyShot && data?.imageSaved === false ? 'the screenshot could not be attached' : '',
      ].filter(Boolean);
      setReportReplyNote(problems.length ? `Saved — but ${problems.join(', and ')}.` : '');
      void fetchUserReports();
    } catch {
      setReportReplyNote('Could not reach the server. Please try again.');
    } finally {
      setReportReplyBusy(false);
    }
  };

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

  // ── APK build-failure reports — automatic inbox, see AdminApkReportStore.ts ──────────────────────
  const fetchApkReports = useCallback(async () => {
    setApkReportsLoading(true);
    try {
      const r = await fetch('/api/admin/apk-reports', { headers });
      const d = await r.json();
      setApkReports(Array.isArray(d?.reports) ? d.reports : []);
    } catch (e) { console.error(e); setApkReports([]); }
    finally { setApkReportsLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const openApkReportById = useCallback(async (id: string) => {
    setOpenApkReport({ loading: true });
    try {
      const r = await fetch(`/api/admin/apk-reports/${encodeURIComponent(id)}`, { headers });
      const d = await r.json();
      setOpenApkReport(r.ok ? d : { error: d?.error || 'Could not open that report.' });
    } catch { setOpenApkReport({ error: 'Could not open that report.' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const markApkReport = useCallback(async (id: string, fixed: boolean) => {
    try {
      await fetch(`/api/admin/apk-reports/${encodeURIComponent(id)}/mark`, {
        method: 'POST', headers, body: JSON.stringify({ fixed }),
      });
      setOpenApkReport(null);
      void fetchApkReports();
    } catch { /* the row stays as it was; the admin can retry */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, fetchApkReports]);

  const deleteApkReportRow = useCallback(async (id: string) => {
    if (!window.confirm('Delete this APK build report permanently?')) return;
    try {
      await fetch(`/api/admin/apk-reports/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      setOpenApkReport(null);
      setApkReports((rows) => rows.filter((row) => row.id !== id));
    } catch { toast('Could not delete that report.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const clearApkReports = useCallback(async () => {
    if (apkReports.length === 0) { toast('The inbox is already empty.'); return; }
    if (!window.confirm(`Delete ALL ${apkReports.length} APK build reports permanently? This cannot be undone.`)) return;
    try {
      await fetch('/api/admin/apk-reports/clear', { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
      setApkReports([]);
    } catch { toast('Could not clear the APK reports.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, apkReports.length]);

  /**
   * DOWNLOAD ONE REPORT (admin 2026-09-15: "apk build report download ka option hi nahi banaya
   * aapne?"). The record already in hand IS the whole stored report — the same fields the screen
   * renders — so this hands over exactly what was read, with nothing re-fetched that could differ.
   * The on-screen log excerpt lives in a scrolling box; the file is the way to keep all of it.
   */
  const downloadApkReport = (rec: any) => {
    if (!rec || rec.loading || rec.error) { toast('Open a report first — there is nothing to download yet.'); return; }
    saveJsonFile(JSON.stringify(rec, null, 2), apkReportFilename(rec));
  };

  const copyApkReport = (rec: any) => {
    if (!rec || rec.loading || rec.error) { toast('Open a report first — there is nothing to copy yet.'); return; }
    void copyJson(JSON.stringify(rec, null, 2), 'APK build report');
  };

  /** The whole inbox in one file. The list route returns full records, so this is not a summary. */
  const downloadAllApkReports = () => {
    if (apkReports.length === 0) { toast('Nothing to download — the inbox is empty.'); return; }
    saveJsonFile(JSON.stringify(apkReports, null, 2), apkReportsArchiveFilename(new Date()));
  };

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
    verdict: { used: number; cap: number; remaining: number; reclaimable: number; snapshots?: number; level: 'ok' | 'warn' | 'critical'; message: string };
    // `snapshot` is a saved copy of a build rather than a published app (channelInventory.ts). It has
    // no deployment record BY DESIGN, which is why it used to classify as an orphaned app here.
    channels: Array<{ channelId: string; url: string; updateTime: string | null; state: 'live' | 'stale' | 'unknown' | 'indeterminate' | 'default' | 'snapshot'; workspaceId: string | null; reclaimable: boolean }>;
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

  /**
   * BUILT APPS — the moderation list, since 2026-09-18 EVERY user's built app, twelve at a time, each
   * with a preview (`admin/BuiltAppsPanel.tsx`). The list, its paging and its previews live there; what
   * stays here is the CONFIRMATION DIALOG for Unpublish / Ban and the call that runs it — the dialog's
   * copy is the safeguard against a permanent mistake (adminAppModeration.ts) and was not moved.
   *
   * ⚠️ The two actions are deliberately NOT the same button:
   *   • Unpublish — the site goes offline and the OWNER can publish it again. The everyday action.
   *   • Ban       — the site goes offline and the workspace can NEVER publish again. Permanent, and
   *                  nothing in this panel or any other can undo it.
   */
  /** The app awaiting confirmation, and which of the two actions was asked for. */
  const [moderating, setModerating] = useState<{ workspaceId: string; action: 'unpublish' | 'ban' } | null>(null);
  const [moderateReason, setModerateReason] = useState('');
  const [moderateBusy, setModerateBusy] = useState(false);
  /** Told to the panel after an action lands, so it re-reads THAT row in place instead of reloading page one. */
  const [moderated, setModerated] = useState<{ workspaceId: string; tick: number } | null>(null);

  /**
   * Run the confirmed action. Both routes delete the LIVE site first and only then touch the
   * registry, and both answer 502 when the delete could not be confirmed — so a failure here is
   * reported as a failure, never softened into "done". The list is re-read either way, because after
   * a partial failure the admin needs the real state rather than our optimistic guess at it.
   */
  const runModeration = useCallback(async () => {
    if (!moderating) return;
    const { workspaceId, action } = moderating;
    setModerateBusy(true);
    try {
      const path = action === 'ban' ? 'takedown' : 'unpublish';
      const r = await fetch(`/api/admin/deployments/${encodeURIComponent(workspaceId)}/${path}`, {
        method: 'POST', headers, body: JSON.stringify({ reason: moderateReason.trim() }),
      });
      const d = await r.json();
      if (d?.ok) {
        toast(action === 'ban' ? `Banned — ${workspaceId} can never publish again.` : `Unpublished — the owner can publish again.`);
        setModerating(null);
        setModerateReason('');
      } else {
        toast(d?.error || 'Failed — the live site was NOT confirmed removed.');
      }
    } catch (e) { console.error(e); toast('Failed — the live site was NOT confirmed removed.'); }
    finally { setModerateBusy(false); setModerated({ workspaceId, tick: Date.now() }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, moderating, moderateReason]);


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
   * RECLAIM EVERY WASTED CHANNEL, ONE PRESS (admin 2026-09-18).
   *
   * The capture that prompted this carried THIRTY-SEVEN reclaimable channels, each with its own
   * button. Clearing the backlog was the action the panel kept recommending and the one thing it made
   * impractical.
   *
   * 🔒 SEQUENTIAL, AND IT STOPS AT THE FIRST REFUSAL. Each reclaim is a DELETE, and the route refuses
   * one it cannot prove is waste (an incomplete registry, a live channel). Firing them in parallel
   * would turn one refusal into a race nobody can read, and carrying on past it would mean deleting
   * while the server has just said it cannot tell what these are. The list is re-read once at the end
   * rather than after each, so the panel does not flicker through 37 states.
   */
  const [reclaimingAll, setReclaimingAll] = useState<{ done: number; total: number } | null>(null);
  const reclaimAllChannels = useCallback(async () => {
    const targets = (channels?.channels ?? []).filter((c) => c.reclaimable).map((c) => c.channelId);
    if (targets.length === 0) return;
    if (!window.confirm(
      `Reclaim ${targets.length} channel(s)?\n\nThis deletes each one from Firebase Hosting. Saved copies of `
      + 'builds come back on the next build. Anything the server cannot prove is waste is refused and stops this.',
    )) return;
    setReclaimingAll({ done: 0, total: targets.length });
    let done = 0;
    try {
      for (const channelId of targets) {
        const r = await fetch(`/api/admin/hosting/channels/${encodeURIComponent(channelId)}/reclaim`, { method: 'POST', headers });
        const d = await r.json().catch(() => ({}));
        if (!d?.ok) { toast(d?.error || `Stopped at ${channelId} — it was NOT removed.`); break; }
        done += 1;
        setReclaimingAll({ done, total: targets.length });
      }
      toast(done === targets.length ? `Reclaimed ${done} channel(s).` : `Reclaimed ${done} of ${targets.length}, then stopped.`);
    } catch (e) {
      console.error(e);
      toast(`Reclaimed ${done} channel(s), then the request failed.`);
    } finally {
      setReclaimingAll(null);
      await fetchChannels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, channels, fetchChannels]);

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
    /** Which mechanism stopped each recent sandbox — the measurement behind the lifetime heartbeat (sandboxLifetime.ts). */
    pauseCauses?: { idleSweep: number; orphanSweep: number; sweepUnattributed: number; providerOrUnknown: number; total: number };
    /** Where a session's minutes go — ended sessions only (sandboxSessions.ts). */
    minutes?: { sessions: number; avgWallMin: number; avgBusyMin: number; avgIdleMin: number; idleShare: number };
    /** Why machines start — per-reason counts over the last days. */
    starts?: { total: number; byReason: Record<string, number>; days: number };
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
  // ⚠️ TAKES EXPLICIT OVERRIDES, and that is not a convenience. React state is set
  // asynchronously, so a control that calls `setX(v)` and then fetches would send the PREVIOUS
  // value — the filter would always lag one click behind, which is a subtler version of the bug
  // this whole change exists to fix. `Clear` uses this; the effect below passes nothing and reads
  // live state.
  const fetchAllBuilds = useCallback(async (override?: {
    q?: string; status?: typeof allBuildsStatus; date?: typeof allBuildsDate; uid?: string;
    tier?: ListFilterState['tier'];
  }) => {
    const q = override?.q ?? allBuildsSearch;
    const status = override?.status ?? allBuildsStatus;
    const date = override?.date ?? allBuildsDate;
    const uid = override?.uid ?? allBuildsUid;
    // Server-side, like every other filter on this list: the tier lives on the ACCOUNT, and narrowing
    // in the browser would only narrow the 500 rows already fetched — "my paying users" would quietly
    // mean "my paying users among the newest 500 builds".
    const tier = override?.tier ?? allBuildsTier;
    setAllBuildsLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status !== 'all') params.set('status', status);
      if (date !== 'all') params.set('date', date);
      if (uid) params.set('uid', uid);
      if (tier && tier !== 'all') params.set('tier', tier);
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
  }, [adminToken, allBuildsSearch, allBuildsStatus, allBuildsDate, allBuildsUid, allBuildsTier]);

  // Always the LATEST closure, so the effect above can leave `fetchAllBuilds` out of its deps (which
  // would re-run it on every keystroke) without ever calling a stale one that forgets the search box.
  const fetchAllBuildsRef = useRef(fetchAllBuilds);
  fetchAllBuildsRef.current = fetchAllBuilds;

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

  /**
   * MARK AN ALL-BUILDS ROW AS TAKEN (admin 2026-09-14: "jo build report admin download kar le, uske
   * aage koi nisan bana do, jisse build report ki autopsy 2 bar na ho").
   *
   * Folds the SERVER's merged answer back into the list, never an optimistic local guess — a badge
   * drawn from a write that silently failed would send the next session to the same report, which is
   * the exact bug this exists to prevent (one report reached two sessions; their PRs conflicted for
   * two hours). A failed write says so out loud instead of drawing the badge.
   */
  const markBuildTaken = async (workspaceId: string, mark: { downloaded?: boolean; fixed?: boolean }) => {
    try {
      const r = await fetch(`/api/admin/all-builds/${encodeURIComponent(workspaceId)}/mark`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(mark),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.triage) { toast(d?.error || 'The mark could not be saved — the list still shows this as untaken.'); return; }
      setAllBuilds((rows) => rows.map((b) => (b.workspaceId === workspaceId ? { ...b, triage: d.triage } : b)));
    } catch { toast('The mark could not be saved — the list still shows this as untaken.'); }
  };

  /**
   * ⚠️ COPY MARKS IT TOO, not only Download. The admin's words said "download", but the row's other
   * button copies the identical JSON, and a report pasted into a chat has left their hands exactly as
   * much as one saved to disk — on a phone it is the commoner path. A mark that the everyday action
   * bypasses is a mark that does not work.
   *
   * Marked only AFTER the report was really fetched: marking a row whose download 404'd would hide a
   * report nobody has actually got.
   */
  const downloadWorkspaceReport = async (workspaceId: string, buildId?: string) => {
    const json = await fetchWorkspaceReportJson(workspaceId, buildId);
    if (!json) return;
    saveJsonFile(json, buildId ? `build-${workspaceId}-${buildId}.json` : `build-session-${workspaceId}.json`);
    void markBuildTaken(workspaceId, { downloaded: true });
  };

  const copyWorkspaceReport = async (workspaceId: string, buildId?: string) => {
    const json = await fetchWorkspaceReportJson(workspaceId, buildId);
    if (!json) return;
    await copyJson(json, buildId ? 'Build' : 'Full session');
    void markBuildTaken(workspaceId, { downloaded: true });
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

  /**
   * WHAT THE FLOATING COPY BUTTON SHOULD TAKE INSTEAD OF THE PAGE TEXT (admin 2026-09-17: *"jab build
   * report copy ki jaye to json formate me hi copy ho. abhi text me copy ho rahi hai."*).
   *
   * Both of these are MODALS gated on their own state being non-null, so non-null means the admin is
   * genuinely looking at one — the button never silently switches to JSON on a page showing none.
   * The payloads are the SAME strings the panels' own Copy buttons use, so the two can never disagree.
   */
  const copyJsonPayload = useMemo(() => ({
    apkReport: openApkReport && !openApkReport.loading && !openApkReport.error
      ? { label: 'APK build report', json: JSON.stringify(openApkReport, null, 2) }
      : null,
    buildReport: selectedReport && selectedPartJson
      ? { label: selectedPartMeta?.label || 'Build report', json: selectedPartJson }
      : null,
  }), [openApkReport, selectedReport, selectedPartJson, selectedPartMeta]);

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
      // `dir` is omitted while it is '' — an absent parameter is what the server reads as "this
      // sort's natural direction", so an untouched control sends nothing rather than a guess at it.
      const dirParam = userDir ? `&dir=${userDir}` : '';
      const r = await fetch(`/api/admin/users?sort=${userSort}&paid=${userPaid}${dirParam}&search=${encodeURIComponent(userSearch)}&paged=1&limit=${userLimit}`, { headers });
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
      // The envelope is what `paged=1` asks for; the bare array is what every older server returns.
      // Reading both means this panel keeps working against either, which matters because the Android
      // app is bundled and a phone can be a version behind.
      const rows = Array.isArray(d) ? d : Array.isArray(d?.users) ? d.users : null;
      if (!rows) { setUsers([]); setUsersError('Unexpected response from the server.'); return; }
      setUsers(rows);
      setUserTotal(typeof d?.total === 'number' ? d.total : rows.length);
    } catch (e: any) {
      setUsers([]);
      setUsersError(`Couldn't reach the server: ${e?.message || 'network error'}`);
    } finally { setUsersLoading(false); }
  }, [adminToken, userSort, userSearch, userLimit, userPaid, userDir]);

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

  // THE TAB-BAR COUNTERS — "kaha kaam abhi karna hai" (admin 2026-09-17).
  //
  // Fetched ONCE per dashboard load and on Refresh, never per tab switch: the point is that the admin
  // sees where the work is WITHOUT opening anything, so a badge that only appeared after you visited
  // the page would answer a question nobody has. `badgesFromPayload` is total and defensive, so an
  // older server mid-deploy (which knows nothing about this route) simply leaves the bar as it is.
  const [tabBadges, setTabBadges] = useState<AdminTabBadges | null>(null);
  const fetchTabBadges = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/tab-badges', { headers });
      setTabBadges(badgesFromPayload(await r.json()));
    } catch {
      // 🔒 NOT `badgesFromPayload({})` — that would be a set of measured-nothing badges. A failed
      // fetch means we never looked, and the bar must look exactly as it does today.
      setTabBadges(null);
    }
  }, [adminToken]);

  // THE REAL BUILD ENGINES — see GET /api/admin/engines for why the old page was fake.
  const [engines, setEngines] = useState<any>(null);
  const [enginesLoading, setEnginesLoading] = useState(false);
  const fetchEngines = useCallback(async () => {
    setEnginesLoading(true);
    try {
      const r = await fetch('/api/admin/engines', { headers });
      const d = await r.json();
      setEngines(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setEngines(null);
    } finally {
      setEnginesLoading(false);
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

  const fetchAudience = useCallback(async () => {
    setAudienceLoading(true);
    try {
      const r = await fetch('/api/admin/audience', { headers });
      const d = await r.json();
      setAudience(d && typeof d === 'object' ? d : null);
    } catch (e) {
      console.error(e);
      setAudience(null);
    } finally {
      setAudienceLoading(false);
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
  const PURCHASE_PAGE = 25;
  const fetchPurchases = useCallback(async (q: typeof purchaseQuery) => {
    setPurchasesLoading(true);
    setPurchasesError('');
    try {
      const params = new URLSearchParams({
        search: q.search, status: q.status, from: q.from, to: q.to, sort: q.sort, dir: q.dir,
        limit: String(PURCHASE_PAGE), offset: String(q.offset),
      });
      const r = await fetch(`/api/admin/purchases?${params.toString()}`, { headers });
      const d = await r.json();
      if (!r.ok) { setPurchases(null); setPurchasesError(d?.detail || d?.error || 'Could not load purchases.'); return; }
      setPurchases(d && Array.isArray(d.rows) ? d : null);
    } catch (e: any) {
      setPurchases(null);
      setPurchasesError(e?.message || 'Could not load purchases.');
    } finally {
      setPurchasesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const fetchFeatureSpend = useCallback(async () => {
    setFeatureSpendLoading(true);
    try {
      const r = await fetch('/api/admin/feature-spend', { headers });
      const d = await r.json();
      // An unreadable day is null, an empty day is a real payload with no rows. The card tells them
      // apart, because "nobody used anything today" and "we could not read it" are different facts.
      setFeatureSpend(r.ok && d && typeof d === 'object' ? d : null);
    } catch { setFeatureSpend(null); } finally { setFeatureSpendLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  useEffect(() => { if (activeTab === 'users') { fetchUsers(); void fetchFeatureSpend(); } }, [activeTab, fetchUsers, fetchFeatureSpend]);
  useEffect(() => { if (activeTab === 'settings') { fetchPromos(); fetchUpdateCohort(); } }, [activeTab, fetchPromos, fetchUpdateCohort]);
  useEffect(() => { if (activeTab === 'revenue') { fetchCostTelemetry(); fetchFinOps(); } }, [activeTab, fetchCostTelemetry, fetchFinOps]);
  useEffect(() => { if (activeTab === 'revenue') { void fetchPurchases(purchaseQuery); } }, [activeTab, purchaseQuery, fetchPurchases]);
  useEffect(() => { if (activeTab === 'reports') { fetchBuildReports(); fetchFirstPass(); } }, [activeTab, fetchBuildReports, fetchFirstPass]);
  // 🔴 THE BUG THIS FIXES (admin screenshot 2026-09-13: "Failed" selected, worked builds still
  // listed). Every control in the All-builds bar — the status chips, the date select, the user
  // select — only called its setter. `fetchAllBuilds` was reachable ONLY from the Load button and
  // the search box's Enter key, so the chip highlighted and the list never changed. Four dead
  // controls, one missing effect.
  //
  // ⚠️ THE SEARCH BOX IS DELIBERATELY NOT IN THESE DEPS. It is free text; re-fetching per keystroke
  // would hit the endpoint on every letter. It keeps its Enter/Load trigger, and the ref below is
  // what lets this effect still send whatever the box currently holds.
  useEffect(() => {
    if (activeTab !== 'reports') return;
    void fetchAllBuildsRef.current();
  }, [activeTab, allBuildsStatus, allBuildsDate, allBuildsUid, allBuildsTier]);
  useEffect(() => { if (activeTab === 'userreports') fetchUserReports(); }, [activeTab, fetchUserReports]);
  useEffect(() => { if (activeTab === 'apkreports') fetchApkReports(); }, [activeTab, fetchApkReports]);
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

  useEffect(() => { if (activeTab === 'engines') { fetchLlmLatency(); fetchLatencyAnomaly(); void fetchEngines(); } }, [activeTab, fetchLlmLatency, fetchLatencyAnomaly, fetchEngines]);
  // The bar is loaded once, independently of which tab is open — that is the whole point of it.
  useEffect(() => { void fetchTabBadges(); }, [fetchTabBadges]);

  // ── P-SEC.3 — admin MFA enrolment handlers ──
  const fetchMfaStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/mfa/status', { headers });
      const d = await r.json();
      setMfaStatus(d && typeof d === 'object' ? d : null);
    } catch (e) { console.error(e); setMfaStatus(null); }
  }, [adminToken]);

  useEffect(() => { if (activeTab === 'security') { fetchMfaStatus(); fetchLicenceExposure(); void fetchAdultOptIns(); void fetchSafetyFlags(); } }, [activeTab, fetchMfaStatus, fetchLicenceExposure, fetchAdultOptIns, fetchSafetyFlags]);

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

  const providerColors: Record<string, string> = { gemini: 'bg-blue-500 text-on-accent', anthropic: 'bg-orange-500 text-on-accent', grok: 'bg-purple-500 text-on-accent', vertex: 'bg-green-500 text-on-accent', openai: 'bg-emerald-500 text-on-accent' };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 py-4 text-left">
      {/* The floating page-copy button — every admin tab, draggable, closable (admin 2026-09-14). */}
      <AdminCopyButton
        pageLabel={TABS.find((t) => t.id === activeTab)?.label || 'Admin'}
        jsonPayload={copyJsonPayload}
      />

      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-6 right-6 z-50 bg-indigo-600 text-on-accent px-5 py-3 rounded-2xl font-bold text-sm shadow-2xl animate-in slide-in-from-top-2">
          {toastMsg}
        </div>
      )}


      {/* ── CONFIRM UNPUBLISH / BAN ──────────────────────────────────────────────────────────
          Rendered at the root rather than inside the Security tab so the answer cannot be lost by a
          tab change mid-decision.

          🔒 THE GUARDS, and each exists because the ban half is IRREVERSIBLE:
            • The whole panel is the app's id in plain sight — you confirm against what you tapped.
            • Ban and Unpublish read DIFFERENT sentences (`confirmCopy`), never one with a word swapped.
            • A BAN requires a typed reason. Not bureaucracy: it is a deliberate half-second between
              the impulse and a permanent act, and the 180-day record (IT Rules 2021 Rule 3(1)(g)) is
              written from it — an empty reason there is a record that explains nothing.
            • The backdrop does not dismiss, so a stray tap answers nothing. */}
      {moderating && (() => {
        const copy = confirmCopy(moderating.action);
        const isBan = moderating.action === 'ban';
        const reasonMissing = isBan && !moderateReason.trim();
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5 bg-scrim backdrop-blur-sm" role="presentation">
            <div role="alertdialog" aria-modal="true" aria-label={copy.title}
                 className="w-full max-w-[420px] rounded-2xl bg-card border border-line shadow-2xl p-5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                  isBan ? 'bg-red-500/10 border-red-500/20' : 'bg-raised border-line'}`}>
                  {isBan ? <BanIcon size={16} className="text-danger" /> : <Globe size={16} className="text-body" />}
                </span>
                <h2 className="text-base font-bold text-ink">{copy.title}</h2>
              </div>

              <p className="text-[11px] font-mono text-body bg-well border border-line rounded-lg px-2.5 py-1.5 mb-3 truncate">
                {moderating.workspaceId}
              </p>
              <p className={`text-sm leading-relaxed mb-4 ${isBan ? 'text-danger' : 'text-muted'}`}>{copy.body}</p>

              <label className="block text-[10px] font-black uppercase tracking-wider text-muted mb-1.5">
                Reason {isBan ? '(required)' : '(optional)'}
              </label>
              <input
                value={moderateReason}
                onChange={(e) => setModerateReason(e.target.value)}
                placeholder={isBan ? 'Why is this app being banned?' : 'Why is it being taken offline?'}
                className="w-full bg-well border border-line rounded-lg px-3 py-2 text-[12px] text-ink placeholder:text-faint mb-1 focus:outline-none focus:border-sky-500/40"
              />
              <p className="text-[10px] text-faint mb-4 leading-relaxed">
                Kept for 180 days as the record of this removal. The owner is not shown what you type.
              </p>

              <div className="flex gap-2.5">
                {/* Cancel first, so the safe choice is the one nearest the thumb and the one a stray
                    Enter reaches — the destructive button never leads. */}
                <button
                  onClick={() => { setModerating(null); setModerateReason(''); }}
                  disabled={moderateBusy}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-raised hover:bg-raised-hover text-ink text-sm font-bold disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void runModeration()}
                  disabled={moderateBusy || reasonMissing}
                  title={reasonMissing ? 'A ban needs a reason' : undefined}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-ink text-sm font-bold disabled:opacity-40 ${
                    isBan ? 'bg-red-600 hover:bg-red-500 text-on-accent' : 'bg-raised hover:bg-raised-hover'}`}
                >
                  {moderateBusy ? 'Working…' : copy.cta}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Header — logout always pinned top-right, visible on all screen sizes */}
      <div className="relative flex items-start justify-between gap-4 border-b border-line pb-6">
        <div className="flex-1 min-w-0 pr-24">
          <p className="text-[10px] text-accent-text font-black uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block" />
            Platform Administration Console
          </p>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tight mt-1">navBharatAI Admin</h1>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={fetchAnalytics} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-raised border border-line hover:border-indigo-500 rounded-xl text-[10px] font-black uppercase tracking-widest text-ink transition-all active:scale-95">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {analytics?.maintenanceMode && (
              <span className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-xl text-[10px] font-black text-danger uppercase tracking-widest">Maintenance ON</span>
            )}
          </div>
        </div>
        {/* Logout — always top-right, never wraps off screen */}
        <button
          onClick={() => { localStorage.removeItem('admin_token'); onLogout(); }}
          className="absolute top-0 right-0 px-4 py-2.5 bg-red-500/10 hover:bg-red-500 active:bg-red-600 border border-red-500/30 text-danger hover:text-on-accent rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 whitespace-nowrap"
        >
          Logout
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card p-1 rounded-2xl border border-line overflow-x-auto">
        {TABS.map(tab => {
          // THE COUNTER BESIDE THE NAME. `formatBadge` returns null for anything unmeasured, and a
          // null renders NOTHING — never a zero, which on this bar would read as "I looked, there is
          // no work here". Security and Settings carry no badge: neither has a number that means
          // pending work, and inventing one would dilute the ones that do.
          const badge = tabBadges ? (tabBadges as any)[tab.id] : null;
          const text = formatBadge(badge);
          const hot = badgeNeedsAttention(badge);
          const hint = (BADGE_HINTS as any)[tab.id] as string | undefined;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={text && hint ? `${tab.label} — ${hint}` : tab.label}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-indigo-600 text-on-accent shadow-lg' : 'text-muted hover:text-ink hover:bg-raised'}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {text && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[9px] font-black font-mono tabular-nums border ${
                    hot
                      ? 'bg-red-500/15 border-red-500/40 text-danger'
                      : activeTab === tab.id
                        ? 'bg-well border-line text-body'
                        : 'bg-raised border-line text-muted'
                  }`}
                >
                  {text}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && !analytics ? (
        <div className="py-24 text-center">
          <TirangaLoader className="w-10 h-10 mx-auto mb-4" />
          <p className="text-xs text-muted font-black uppercase tracking-widest">Loading dashboard data...</p>
        </div>
      ) : (
        <>
          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'monitor' && (
            <div className="space-y-6">
              {/* THE LOAD BOARD, FIRST ON THE HOME PAGE. The admin asked for exactly this — "admin
                  panel ke home page par to load dikhna chahiye" — and `/api/admin/load` had answered
                  it for weeks with nothing rendering it. It sits ABOVE the live monitor because a
                  ceiling that stops the whole platform outranks a chart of what it is doing now. */}
              <LoadBoard adminToken={adminToken} />

              {/* LIVE MONITOR — real time-series from the platform's own telemetry. Everything below it
                  is the business view the Overview tab used to hold, unchanged. */}
              <MonitorPanels adminToken={adminToken} />

              {/* WHO CAME — NavBharatAI's own website and app (admin 2026-09-14). */}
              <AudienceCard data={audience} onOpen={() => void fetchAudience()} loading={audienceLoading} />

              <div className="pt-1">
                <h2 className="text-[11px] font-black text-ink uppercase tracking-widest">Business</h2>
                <p className="text-[9px] text-muted font-bold uppercase tracking-widest mt-0.5">
                  Revenue, users and lifetime usage — from Firestore, not the live window above
                </p>
              </div>

              {/* Row 1: 4 key metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statCard('Total Revenue', `₹${(analytics?.totalRevenue || 0).toLocaleString('en-IN')}`, 'Verified payments', 'bg-emerald-500 text-on-accent', IndianRupee)}
                {statCard('Registered Users', analytics?.totalUsers || 0, `+${analytics?.newUsersToday || 0} today`, 'bg-indigo-500 text-on-accent', Users)}
                {statCard('Website Hits Today', (analytics?.websiteHitsToday || 0).toLocaleString(), analytics?.hitsSinceBoot ? `${(analytics?.websiteHitsTotal || 0).toLocaleString()} since this server started` : `${(analytics?.websiteHitsTotal || 0).toLocaleString()} total`, 'bg-sky-500 text-on-accent', Globe)}
                {statCard('Active (24h)', analytics?.activeUsers24h || 0, 'Unique users with AI requests', 'bg-violet-500 text-on-accent', Activity)}
              </div>

              {/* Row 2: 4 more metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statCard('Output Tokens', (analytics?.totalTokensUsed || 0).toLocaleString(), analytics?.scope === 'chat' ? 'Chat assistants only — builds are on the Monitor' : 'All providers combined', 'bg-amber-500 text-on-accent', Zap)}
                {/* 🔒 "AT MOST" WHEN THE COST IS A FLOOR. Some calls cannot be priced (a provider that
                    reported no tokens, or a row written before usage was recorded), so the real cost is
                    at least what we summed and the margin is at most what we show. This card used to
                    read a flat "Platform Margin ₹155" while the engine-cost panel beside it showed
                    ₹1,223 of spend — because cost was structurally zero and margin was revenue with a
                    different label. Never again by accident: the word changes with the certainty. */}
                {statCard(
                  analytics?.providerCostComplete === false ? `${analytics?.scope === 'chat' ? 'Chat margin' : 'Platform Margin'} (at most)` : (analytics?.scope === 'chat' ? 'Chat margin' : 'Platform Margin'),
                  `₹${(analytics?.estimatedProfit || 0).toFixed(2)}`,
                  /* CHAT cost only — build cost is on the Monitor's own tiles (scope from the server) */
                  `Revenue minus ${analytics?.scope === 'chat' ? 'CHAT AI' : 'AI'} cost${analytics?.scope === 'chat' ? ' · build cost is on the Monitor' : ''}${analytics?.providerCostComplete === false ? ` · ${analytics?.unpricedCalls || 0} call(s) could not be priced` : ''}`,
                  (analytics?.estimatedProfit || 0) >= 0 ? 'bg-emerald-500 text-on-accent' : 'bg-red-500 text-on-accent', TrendingUp)}
                {statCard('Token Purchases', analytics?.tokenPurchaseCount || 0, 'Paid transactions', 'bg-pink-500 text-on-accent', Tag)}
                {statCard('Cost / Request', `₹${(analytics?.burnRate || 0).toFixed(5)}`, analytics?.scope === 'chat' ? 'Direct provider cost · chat only' : 'Direct provider cost', 'bg-orange-500 text-on-accent', Cpu)}
              </div>

              {/* PUBLISHED APPS, as a NUMBER among the numbers.
                  The full Publish Capacity card below has carried this figure since 2026-08-21 — but it
                  sits under four rows of tiles, and the admin did not know it existed. A ceiling that
                  stops publishing for EVERY user at once has to be readable at a glance, next to the
                  other counts, not found by scrolling.

                  Same source as that card, so the two can never disagree. The colour follows the same
                  verdict: amber at 70%, red at 90%. An unreadable list shows "—", never "0" — reporting
                  a failed read as "no apps published" would be the exact dishonesty the endpoint itself
                  refuses. */}
              <div className="grid grid-cols-1 gap-4">
                {statCard(
                  'Published Apps',
                  channelsError || !channels ? '—' : `${channels.verdict.used} / ${channels.verdict.cap}`,
                  channelsError || !channels
                    ? 'Could not read the list — not a count of zero'
                    : `${channels.verdict.remaining} more can be published${channels.verdict.reclaimable > 0 ? ` · ${channels.verdict.reclaimable} reclaimable` : ''}`,
                  channelsError || !channels ? 'bg-raised'
                    : channels.verdict.level === 'critical' ? 'bg-red-500 text-on-accent'
                    : channels.verdict.level === 'warn' ? 'bg-amber-500 text-on-accent'
                    : 'bg-emerald-500 text-on-accent',
                  Globe,
                )}
              </div>

              {/* ── THE PUBLISH CEILING (ROADMAP §10) ────────────────────────────────────────
                  Every published app holds one Firebase Hosting channel, and the pool is capped per
                  site. Past the cap, publishing stops for EVERY user at once. This is the only place
                  that number is visible — and the only place a channel orphaned by a deleted chat
                  can be found at all, since its id is a one-way hash with no record left to trace. */}
              {(channels || channelsError) && (
                <div className={`rounded-[1.5rem] p-6 border ${
                  channelsError ? 'bg-card border-line'
                  : channels?.verdict.level === 'critical' ? 'bg-red-500/5 border-red-500/30'
                  : channels?.verdict.level === 'warn' ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-card border-line'}`}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <button
                      type="button"
                      onClick={togglePublishCard}
                      aria-expanded={publishCardOpen}
                      aria-controls="publish-capacity-body"
                      className="flex items-center gap-2 min-w-0 text-left group"
                    >
                      {publishCardOpen
                        ? <ChevronDown className="w-4 h-4 shrink-0 text-muted group-hover:text-ink" />
                        : <ChevronRight className="w-4 h-4 shrink-0 text-muted group-hover:text-ink" />}
                      <h3 className="text-sm font-black text-ink uppercase tracking-tight">Publish Capacity</h3>
                      <span className="sr-only">{publishCardOpen ? 'Hide the details' : 'Show the details'}</span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Folded, the numbers still show: a collapsed card must not conceal the ceiling. */}
                      {!publishCardOpen && channels && (
                        <span className="text-[10px] font-bold text-muted tabular-nums">
                          {channels.verdict.used} / {channels.verdict.cap} channels
                          {channels.verdict.reclaimable > 0 ? ` · ${channels.verdict.reclaimable} reclaimable` : ''}
                        </span>
                      )}
                      {!publishCardOpen && channelsError && (
                        <span className="text-[10px] font-bold text-muted">could not be read</span>
                      )}
                      <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${
                        channelsError ? 'bg-raised border-line text-muted'
                        : channels?.verdict.level === 'critical' ? 'bg-red-500/10 border-red-500/30 text-danger'
                        : channels?.verdict.level === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-warn'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-success'}`}>
                        {channelsError ? 'unknown' : channels?.verdict.level}
                      </span>
                    </div>
                  </div>

                  <div id="publish-capacity-body">
                  {!publishCardOpen ? null : channelsError ? (
                    <p className="text-xs text-muted leading-relaxed">{channelsError}</p>
                  ) : channels && (
                    <>
                      <p className="text-xs text-body leading-relaxed">{channels.verdict.message}</p>
                      <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                        {channels.verdict.remaining} more app{channels.verdict.remaining === 1 ? '' : 's'} can be published before
                        the limit. The cap of {channels.verdict.cap} is a working figure — Google does not publish this number —
                        so treat it as approximate until a real &quot;quota reached&quot; confirms it.
                      </p>

                      {channels.channels.some((c) => c.reclaimable) && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <p className="text-[10px] font-black uppercase tracking-wider text-muted">
                              Reclaimable channels — no live app is using these
                            </p>
                            <button
                              onClick={() => void reclaimAllChannels()}
                              disabled={!!reclaimingAll || !!reclaiming}
                              className="shrink-0 px-3 py-1.5 rounded-lg bg-raised hover:bg-red-600/20 border border-line text-[10px] font-black uppercase tracking-wider text-body hover:text-danger disabled:opacity-40"
                            >
                              {reclaimingAll ? `Reclaiming ${reclaimingAll.done}/${reclaimingAll.total}…` : 'Reclaim all'}
                            </button>
                          </div>
                          {channels.channels.filter((c) => c.reclaimable).map((c) => (
                            <div key={c.channelId} className="flex items-center justify-between gap-3 rounded-xl bg-well border border-line px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-mono text-body truncate">{c.channelId}</p>
                                <p className="text-[10px] text-muted truncate">
                                  {c.state === 'snapshot'
                                    /* A build copy, not an app. It never had a record, by design — and
                                       the next green build writes it again, so clearing it is safe. */
                                    ? 'A saved copy of a build, not a published app. It returns on the next build.'
                                    : c.state === 'unknown'
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
                                className="shrink-0 px-3 py-1.5 rounded-lg bg-raised hover:bg-red-600/20 text-[10px] font-black uppercase tracking-wider text-body hover:text-danger disabled:opacity-40"
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
                </div>
              )}

              {/* ── P-MON.4 Composite platform health (real, from /api/admin/health-score) ── */}
              {healthScore?.score && (
                <div className="bg-card border border-line rounded-[1.5rem] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Platform Health Score</h3>
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${
                      healthScore.score.grade === 'excellent' ? 'bg-emerald-500/10 border-emerald-500/30 text-success'
                      : healthScore.score.grade === 'good' ? 'bg-sky-500/10 border-sky-500/30 text-info'
                      : healthScore.score.grade === 'fair' ? 'bg-amber-500/10 border-amber-500/30 text-warn'
                      : healthScore.score.grade === 'unknown' ? 'bg-raised border-line text-muted'
                      : 'bg-red-500/10 border-red-500/30 text-danger'}`}>
                      {healthScore.score.grade}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {([
                      { label: 'Health', value: healthScore.score.health, good: (v: number) => v >= 75 },
                      { label: 'Reliability', value: healthScore.score.reliability, good: (v: number) => v >= 75 },
                      { label: 'Risk', value: healthScore.score.risk, good: (v: number) => v <= 25 },
                    ] as const).map(m => (
                      <div key={m.label} className="bg-well rounded-xl p-4 text-center">
                        <div className="text-[9px] text-muted uppercase font-bold tracking-widest">{m.label}</div>
                        <div className={`text-2xl font-black font-mono mt-1 ${
                          m.value == null ? 'text-muted' : m.good(m.value) ? 'text-success' : 'text-warn'}`}>
                          {m.value == null ? '—' : m.value}
                        </div>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(healthScore.score.missing) && healthScore.score.missing.length > 0 && (
                    <p className="text-[9px] text-faint font-bold uppercase tracking-widest mt-3">
                      No data yet for: {healthScore.score.missing.join(', ')} — excluded from the score (not faked).
                    </p>
                  )}
                </div>
              )}

              {/* ── P-MON.5 AI Insights (real, deterministic from live metrics) + NL query ── */}
              {insights && (
                <div className="bg-card border border-line rounded-[1.5rem] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">AI Insights</h3>
                    <span className="text-[9px] text-faint font-bold uppercase tracking-widest">Derived from live metrics — not projected</span>
                  </div>
                  <div className="space-y-2">
                    {(insights.insights || []).map((i: any) => (
                      <div key={i.id} className="flex items-start gap-3 bg-well rounded-xl p-3">
                        <span className={`mt-0.5 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0 ${
                          i.severity === 'critical' ? 'bg-red-500/10 border-red-500/30 text-danger'
                          : i.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-warn'
                          : i.severity === 'good' ? 'bg-emerald-500/10 border-emerald-500/30 text-success'
                          : 'bg-raised border-line text-muted'}`}>
                          {i.severity}
                        </span>
                        <div>
                          <div className="text-xs font-bold text-ink">{i.headline}</div>
                          <div className="text-[11px] text-muted mt-0.5">{i.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* NL telemetry query */}
                  <div className="mt-4 pt-4 border-t border-line">
                    <div className="flex gap-2">
                      <input
                        value={insightQuestion}
                        onChange={(e) => setInsightQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') askInsight(); }}
                        placeholder="Ask: cost? success rate? which provider is cheapest?"
                        className="flex-1 bg-well border border-line rounded-lg px-3 py-2 text-xs text-ink placeholder:text-faint focus:outline-none focus:border-indigo-500/50"
                      />
                      <button
                        onClick={askInsight}
                        disabled={insightAsking || !insightQuestion.trim()}
                        className="bg-indigo-500/20 border border-indigo-500/40 text-accent-text text-xs font-bold uppercase px-4 rounded-lg disabled:opacity-40 hover:bg-indigo-500/30 transition-colors"
                      >
                        {insightAsking ? '…' : 'Ask'}
                      </button>
                    </div>
                    {insightAnswer && (
                      <p className="text-[11px] text-body bg-well rounded-lg p-3 mt-2">{insightAnswer}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Provider Usage Ranking */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">API Usage Ranking</h3>
                    <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">{analytics?.scope === 'chat' ? 'Most to least used chat providers' : 'Most to least used providers'}</p>
                  </div>
                  <div className="space-y-3">
                    {(analytics?.providerRanking || []).length === 0 && (
                      <p className="text-[10px] text-muted uppercase font-bold">No data yet</p>
                    )}
                    {(analytics?.providerRanking || []).map((p: any, i: number) => {
                      const total = (analytics?.providerRanking || []).reduce((s: number, x: any) => s + x.requests, 0);
                      const pct = total > 0 ? Math.round((p.requests / total) * 100) : 0;
                      const col = providerColors[p.name?.toLowerCase()] || 'bg-indigo-500 text-on-accent';
                      return (
                        <div key={p.name}>
                          <div className="flex justify-between text-xs font-bold text-ink mb-1">
                            <span className="uppercase font-mono">#{i + 1} {p.name}</span>
                            <span className="text-muted">{p.requests} req · {p.avgLatencyMs == null ? 'latency not recorded' : `${p.avgLatencyMs}ms avg`}</span>
                          </div>
                          <div className="w-full bg-well h-2 rounded-full overflow-hidden">
                            <div className={`${col} h-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-[9px] text-muted mt-0.5">{pct}% of requests · {typeof p.measuredCalls === 'number' && p.measuredCalls === 0 ? 'tokens not measured' : `${(p.tokensUsed || 0).toLocaleString()} tokens`}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Provider Burn Split */}
                <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                  <div>
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Provider Token Burn</h3>
                    <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">{analytics?.scope === 'chat' ? 'Chat token consumption by provider' : 'Token consumption by provider'}</p>
                  </div>
                  <div className="space-y-3">
                    {Object.entries(analytics?.providerWise || {}).map(([name, tokens]: any) => {
                      const pct = analytics?.totalTokensUsed > 0 ? Math.round((tokens / analytics.totalTokensUsed) * 100) : 0;
                      const col = providerColors[name?.toLowerCase()] || 'bg-indigo-500 text-on-accent';
                      return (
                        <div key={name}>
                          <div className="flex justify-between text-xs font-bold text-ink mb-1">
                            <span className="uppercase font-mono">{name}</span>
                            <span className="text-muted font-mono">{tokens.toLocaleString()} tokens</span>
                          </div>
                          <div className="w-full bg-well h-2 rounded-full overflow-hidden">
                            <div className={`${col} h-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {Object.keys(analytics?.providerWise || {}).length === 0 && (
                      <p className="text-[10px] text-muted uppercase font-bold">No data yet</p>
                    )}
                  </div>
                  <div className="bg-well rounded-xl p-3 space-y-1 font-mono text-xs border border-line">
                    <div className="flex justify-between">
                      <span className="text-muted">
                        {analytics?.providerCostComplete === false ? 'Provider Cost (at least)' : 'Total Provider Cost'}
                      </span>
                      <span className="text-warn font-black">₹{(analytics?.totalProviderCost || 0).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-muted">Cashfree Gateway</span><span className="text-success">{analytics?.cashfreeStatus?.clientId || '–'}</span></div>
                  </div>
                </div>
              </div>

              {/* Recent Purchases */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight">Recent Token Purchases</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                      <th className="py-2 text-left">User</th><th className="py-2 text-left">Amount</th><th className="py-2 text-left">Tokens</th><th className="py-2 text-left">Date</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line">
                      {(analytics?.recentPurchases || []).map((p: any, i: number) => (
                        <tr key={i} className="hover:bg-raised">
                          <td className="py-2 text-muted font-mono text-[10px]">{(p.userId || '').slice(0, 12)}…</td>
                          <td className="py-2 text-success font-black">₹{p.amount}</td>
                          <td className="py-2 text-warn font-mono">{(p.tokens || 0).toLocaleString()}</td>
                          <td className="py-2 text-muted text-[9px]">{new Date(p.date || 0).toLocaleDateString('en-IN')}</td>
                        </tr>
                      ))}
                      {(!analytics?.recentPurchases || analytics.recentPurchases.length === 0) && (
                        <tr><td colSpan={4} className="py-6 text-center text-muted text-[10px] font-bold uppercase">No purchases yet</td></tr>
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
              {/* WHICH FEATURE IS BEING USED (admin 2026-09-13: "kon sa feature jyada use ho raha hai,
                  kon se feacher ko aur strong karna hai"). Today, across every user. */}
              <div className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="text-sm font-black text-ink tracking-tight">
                    What people used today
                    {featureSpend?.date && <span className="ml-2 text-[10px] font-normal text-faint">{featureSpend.date}</span>}
                  </h4>
                  <button onClick={() => void fetchFeatureSpend()} className="p-1.5 rounded-lg bg-raised hover:bg-raised-hover text-muted" aria-label="Refresh">
                    <RefreshCw size={13} />
                  </button>
                </div>
                {featureSpendLoading && !featureSpend ? (
                  <p className="mt-2 text-[11px] text-faint">Reading…</p>
                ) : !featureSpend ? (
                  <p className="mt-2 text-[11px] text-warn">Could not be read just now — this is not the same as nobody using anything.</p>
                ) : (featureSpend.rows?.length ?? 0) === 0 ? (
                  <p className="mt-2 text-[11px] text-faint">Nothing has been charged to any wallet today yet.</p>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {featureSpend.rows.map((r: { feature: string; label: string; inr: number; charges: number; users: number }) => {
                      const total = Number(featureSpend.totalInr) || 0;
                      const pct = total > 0 ? Math.round((r.inr / total) * 100) : 0;
                      return (
                        <div key={r.feature} className="flex items-center gap-2 text-[11px]">
                          <span className="text-body w-40 shrink-0 truncate">{r.label}</span>
                          <span className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden min-w-0">
                            <span className="block h-full rounded-full bg-emerald-500/70 text-on-accent" style={{ width: `${pct}%` }} />
                          </span>
                          {/* USERS first — the admin is deciding what to invest in, and one heavy
                              user is not the same signal as many people choosing a feature. */}
                          <span className="text-muted tabular-nums w-24 text-right shrink-0">{r.users} user{r.users === 1 ? '' : 's'}</span>
                          <span className="text-body tabular-nums w-16 text-right shrink-0">₹{r.inr.toFixed(2)}</span>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-[10px] text-faint">
                      Counts what a feature COST, across every user. Buying a hosting plan is not counted —
                      that is a purchase, not use of a feature.
                    </p>
                  </div>
                )}
              </div>

              {/* Search + Sort */}
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-[200px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                  <input
                    value={userSearch} onChange={e => setUserSearch(e.target.value)}
                    placeholder="Search by email or name..."
                    className="w-full bg-card border border-line rounded-xl pl-9 pr-4 py-2.5 text-sm text-ink placeholder:text-muted outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex gap-1 bg-card p-1 rounded-xl border border-line">
                  {[['alpha', 'A-Z'], ['tokens', 'Tokens'], ['ai_per_day', 'AI Use'], ['recent', 'Recent']].map(([val, lbl]) => (
                    <button key={val} onClick={() => setUserSort(val)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${userSort === val ? 'bg-indigo-600 text-on-accent' : 'text-muted hover:text-ink'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                {/* PAID / FREE (admin 2026-09-19). "Paid" means what the admin said it means — this
                    person has given NavBharatAI real money at least once — and it is the SAME rule
                    the account panel beside it uses, resolved on the server so the browser never
                    re-derives it from the ₹ column. */}
                <div className="flex gap-1 bg-card p-1 rounded-xl border border-line">
                  {([['all', 'All'], ['paid', 'Paid'], ['free', 'Free']] as const).map(([val, lbl]) => (
                    <button
                      key={val}
                      onClick={() => setUserPaid(val)}
                      aria-pressed={userPaid === val}
                      title={val === 'paid'
                        ? 'Has recharged the wallet with real money at least once'
                        : val === 'free' ? 'Has never paid — still on gifted credit' : 'Every account'}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${userPaid === val ? 'bg-emerald-600 text-on-accent' : 'text-muted hover:text-ink'}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {/* ASCENDING / DESCENDING. It reads out the direction CURRENTLY in force, including
                    the one the chosen sort has by default — so the arrow is never a claim the list
                    contradicts, and pressing it always does what the label just said it would. */}
                <button
                  onClick={() => setUserDir(effectiveUserDir === 'desc' ? 'asc' : 'desc')}
                  aria-label={`Sort ${effectiveUserDir === 'desc' ? 'descending' : 'ascending'} — press to reverse`}
                  title={effectiveUserDir === 'desc' ? 'Highest / newest first — press for the reverse' : 'Lowest / oldest first — press for the reverse'}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-card border border-line rounded-xl text-[10px] font-black uppercase tracking-wider text-ink hover:border-indigo-500 transition-all active:scale-95"
                >
                  {effectiveUserDir === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
                  {effectiveUserDir === 'desc' ? 'Desc' : 'Asc'}
                </button>
                <button onClick={fetchUsers} className="flex items-center gap-2 px-4 py-2.5 bg-raised border border-line rounded-xl text-[10px] font-black uppercase tracking-wider text-ink hover:border-indigo-500 transition-all active:scale-95">
                  <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? 'animate-spin' : ''}`} /> Load
                </button>
              </div>

              {/* User Table */}
              <div className="bg-card border border-line rounded-[1.5rem] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px] bg-well">
                        <th className="py-3 px-4 text-left">User</th>
                        {/* WHEN DID THEY JOIN, AND WHEN WERE THEY LAST HERE (admin 2026-09-11).
                            Both come from Firebase Auth — Firestore answers neither properly; see
                            adminUserActivity.ts. An unread date prints "—" with the reason on hover,
                            never a blank cell that would read as "never signed in". */}
                        <th className="py-3 px-4 text-left">Joined</th>
                        <th className="py-3 px-4 text-left">Last Active</th>
                        <th className="py-3 px-4 text-left">Token Balance</th>
                        <th className="py-3 px-4 text-left">Purchased</th>
                        <th className="py-3 px-4 text-left">Total Used</th>
                        <th className="py-3 px-4 text-left">Wallet</th>
                        <th className="py-3 px-4 text-left">Paid ₹</th>
                        <th className="py-3 px-4 text-left">Status</th>
                        <th className="py-3 px-4 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {usersLoading && (
                        <tr><td colSpan={11} className="py-10 text-center"><TirangaLoader className="w-5 h-5 mx-auto" /></td></tr>
                      )}
                      {!usersLoading && users.length === 0 && usersError && (
                        <tr><td colSpan={11} className="py-10 text-center text-danger text-[10px] font-bold normal-case px-4">{usersError} <button onClick={fetchUsers} className="underline ml-1">Retry</button></td></tr>
                      )}
                      {!usersLoading && users.length === 0 && !usersError && (
                        <tr><td colSpan={11} className="py-10 text-center text-muted text-[10px] font-bold uppercase">No users found. Click Load to fetch.</td></tr>
                      )}
                      {users.map((u: any) => (
                        <tr key={u.userId} className={`hover:bg-raised transition-colors ${u.banned ? 'bg-red-500/10' : ''}`}>
                          <td className="py-3 px-4">
                            {/* The same account sheet a report opens — one place where a person's whole
                                picture lives, reachable from both surfaces rather than rebuilt in each. */}
                            <button onClick={() => void openAccount(u.userId)} title="Open this account — everything we hold about this user, read only" className="text-left group">
                              <div className="text-ink font-bold text-[11px] group-hover:underline">{u.name}</div>
                              <div className="text-muted text-[9px] font-mono group-hover:text-body">{u.email}</div>
                            </button>
                          </td>
                          {(() => {
                            const joined = stampLabel(u.joinedAt, u.joinedAtSource);
                            const active = stampLabel(u.lastActiveAt, u.lastActiveAtSource);
                            return (
                              <>
                                <td className="py-3 px-4" title={joined.title}>
                                  <span className={joined.unread ? 'text-faint' : 'text-muted'}>{joined.unread ? joined.text : dayLabel(u.joinedAt)}</span>
                                </td>
                                <td className="py-3 px-4" title={active.title}>
                                  <span className={active.unread ? 'text-faint' : 'text-muted'}>{active.text}</span>
                                </td>
                              </>
                            );
                          })()}
                          <td className="py-3 px-4 font-mono text-warn font-black">{(u.tokenBalance || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 font-mono text-info">{(u.totalTokensPurchased || 0).toLocaleString()}</td>
                          {/* Real since 2026-09-17: this read a field that was only ever written as 0 (walletLifetime.ts). */}
                          <td className="py-3 px-4 font-mono text-accent-text">{(u.totalTokensUsed || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 font-mono text-success">₹{(u.remainingBalance || 0).toFixed(2)}</td>
                          {/* The ₹ figure, and beside it the FILTER'S OWN verdict for this row.
                              Without it, filtering to Paid on a base where every row reads ₹0 looks
                              exactly like a broken filter — and the verdict is the server's
                              `hasEverPaid`, never `moneySpent > 0` re-derived here, so the column and
                              the filter can never tell the admin two different things. An older
                              server that does not send the field shows the ₹ alone, as before. */}
                          <td className="py-3 px-4 font-mono text-success whitespace-nowrap">
                            ₹{Number(u.moneySpent || 0).toLocaleString('en-IN')}
                            {typeof u.hasEverPaid === 'boolean' && (
                              <span
                                title={u.hasEverPaid
                                  ? 'Has recharged the wallet with real money at least once'
                                  : 'Has never paid — still on gifted credit'}
                                className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                                  u.hasEverPaid ? 'bg-emerald-500/15 text-success' : 'bg-well text-muted'
                                }`}
                              >
                                {u.hasEverPaid ? 'Paid' : 'Free'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {u.banned ? <span className="text-danger font-black text-[9px] uppercase flex items-center gap-1"><BanIcon className="w-3 h-3"/>Banned</span> : <span className="text-success font-black text-[9px] uppercase flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>Active</span>}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex gap-1.5">
                              {/* Token adjust */}
                              {selectedUserId === u.userId ? (
                                <div className="flex gap-1 items-center">
                                  <input type="number" placeholder="tokens" value={tokenDelta} onChange={e => setTokenDelta(e.target.value)} className="w-20 bg-well border border-line rounded-lg px-2 py-1 text-[10px] text-ink outline-none" />
                                  <input placeholder="reason" value={tokenReason} onChange={e => setTokenReason(e.target.value)} className="w-20 bg-well border border-line rounded-lg px-2 py-1 text-[10px] text-ink outline-none" />
                                  <button onClick={() => handleTokenAdjust(u.userId)} disabled={actionLoading === u.userId} className="px-2 py-1 bg-indigo-600 rounded-lg text-[9px] font-black text-on-accent uppercase">
                                    {actionLoading === u.userId ? '...' : 'OK'}
                                  </button>
                                  <button onClick={() => setSelectedUserId('')} className="px-2 py-1 bg-raised rounded-lg text-[9px] text-ink uppercase">X</button>
                                </div>
                              ) : (
                                <>
                                  {/* No "Info" button here on purpose (admin 2026-09-12: "info button
                                      hata do"). The account sheet opens by clicking the user's NAME —
                                      one way in, not two that do the same thing. The name carries the
                                      hover underline and a tooltip so it still reads as clickable. */}
                                  <button onClick={() => { setSelectedUserId(u.userId); setTokenDelta(''); setTokenReason(''); }} className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[9px] font-black text-warn uppercase hover:bg-amber-500/20 transition-all">
                                    Tokens
                                  </button>
                                  <button onClick={() => handleBan(u.userId, !u.banned)} disabled={actionLoading === u.userId + '_ban'} className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-all border ${u.banned ? 'bg-emerald-500/10 border-emerald-500/20 text-success hover:bg-emerald-500/20' : 'bg-red-500/10 border-red-500/20 text-danger hover:bg-red-500/20'}`}>
                                    {actionLoading === u.userId + '_ban' ? '...' : u.banned ? 'Unban' : 'Ban'}
                                  </button>
                                  <button onClick={() => handleMerge(u.userId)} disabled={actionLoading === u.userId + '_merge'} title="Merge a duplicate account's wallet INTO this user" className="px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[9px] font-black text-accent-text uppercase hover:bg-purple-500/20 transition-all">
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
                  {userTotal !== null && users.length < userTotal && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: '12px 0', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setUserLimit((l) => l + USER_PAGE)}
                        disabled={usersLoading}
                        className="px-4 py-2 rounded-full border border-line bg-raised text-[11px] font-bold text-ink hover:bg-raised-hover disabled:opacity-50"
                      >
                        {usersLoading ? 'Loading…' : `Load ${Math.min(USER_PAGE, userTotal - users.length)} more`}
                      </button>
                      <span className="text-[10px] text-muted">
                        Showing {users.length.toLocaleString('en-IN')} of {userTotal.toLocaleString('en-IN')} users
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── AI ENGINES TAB ── */}
          {activeTab === 'engines' && (
            <div className="space-y-6">
              {/* ── THE REAL BUILD ENGINES ───────────────────────────────────────────────────
                  Admin, 2026-09-17: *"ai engine wale page ko bhi update karo, woh fake hai abhi."*
                  They were right. What used to sit here were the CHAT router's in-memory counters,
                  presented as the platform's engines — so GLM and KIMI, which lead every tier and do
                  nearly all of the work, appeared nowhere, and a provider with no traffic at all read
                  as a green "Healthy". Beside it was a "Provider Kill Switches" panel promising that
                  disabling a provider would stop requests routing to it; `serverStats.providerEnabled`
                  is read by NOTHING that routes a request, so the promise was never kept. Both are
                  replaced by what actually decides a build: the three tier ladders themselves. */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-accent-text" />
                    <div>
                      <h3 className="text-sm font-black text-ink uppercase tracking-tight">Build Engines</h3>
                      <p className="text-[9px] text-muted font-bold uppercase tracking-widest mt-0.5">
                        The exact order a build tries, per tier — read from the engine itself
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={fetchEngines}
                    disabled={enginesLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted hover:text-ink transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${enginesLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>

                {!engines || !Array.isArray(engines.tiers) ? (
                  <p className="text-[10px] text-muted uppercase font-bold py-4">
                    {enginesLoading ? 'Reading the ladders…' : 'Could not read the engine ladders.'}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {engines.tiers.map((t: any) => (
                      <div key={t.level} className={`rounded-xl border p-4 ${t.available ? 'border-line bg-raised' : 'border-red-500/40 bg-red-500/5'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] font-black uppercase tracking-widest text-ink">{t.label}</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${t.available ? 'bg-emerald-500/10 border-emerald-500/30 text-success' : 'bg-red-500/10 border-red-500/30 text-danger'}`}>
                            {t.available ? 'Can build' : 'No engine — builds refused'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {(t.rungs || []).map((r: any, i: number) => (
                            <React.Fragment key={`${r.provider}-${r.model}-${i}`}>
                              {i > 0 && <span className="text-faint text-xs">→</span>}
                              <span
                                title={r.keyed ? 'Key present — this rung can run' : 'No key set for this engine — the ladder skips this rung'}
                                className={`px-2.5 py-1.5 rounded-lg border font-mono text-[10px] font-black ${r.keyed ? 'bg-well border-line text-ink' : 'bg-well border-line text-faint line-through'}`}
                              >
                                {r.provider}
                                <span className="text-muted font-normal"> · {r.model}</span>
                                {engines.today?.readable && engines.today?.counts?.[String(r.provider).split('_')[0]] > 0 && (
                                  <span className="ml-1.5 text-success">
                                    {engines.today.counts[String(r.provider).split('_')[0]]} today
                                  </span>
                                )}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* WHAT REALLY RAN TODAY. Withheld entirely when the day could not be read —
                        "nothing built today" and "we could not look" must never render the same. */}
                    <div className="text-[9px] text-faint font-bold uppercase tracking-widest leading-relaxed">
                      {engines.today?.readable
                        ? (Object.keys(engines.today.counts || {}).length > 0
                            ? `Calls today (${engines.today.day}, UTC): ` +
                              Object.entries(engines.today.counts as Record<string, number>)
                                .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')
                            : `No builds have run yet today (${engines.today.day}, UTC).`)
                        : 'Today\u2019s engine use could not be read — this is not the same as "nothing ran".'}
                      <br />
                      A struck-through rung has no key set in this environment, so the ladder skips it.
                      Change a ladder or turn an engine off in Cloud Run (AGENTV3_LADDER_*,
                      AGENTV3_CHEAP_FLOOR) — that is where the switches really are, and they survive a
                      restart. A panel here would only affect one server instance until its next deploy.
                    </div>
                  </div>
                )}
              </div>

              {/* ── CHAT ROUTER — kept, but labelled for what it actually is ─────────────────── */}
              <div className="space-y-2">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight">Chat Router — Live</h3>
                <p className="text-[9px] text-muted font-bold uppercase tracking-widest">
                  {engines?.chat?.scope
                    ? `Scope: ${engines.chat.scope} — resets on every deploy, and does not include other instances`
                    : 'This server instance, since it started — resets on every deploy'}
                  . These serve CHAT, not app builds.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(analytics?.liveProviderStats || {}).map(([name, stat]: any) => {
                  const isOnCooldown = stat.cooldownUntil > Date.now();
                  const secondsLeft = isOnCooldown ? Math.ceil((stat.cooldownUntil - Date.now()) / 1000) : 0;
                  // 🔒 A PROVIDER THAT HAS NEVER RUN IS NOT "HEALTHY". The old card printed a green
                  // Healthy badge on zero requests, which is the most misleading state a status light
                  // can have — it reads as "checked and fine" when nothing was ever checked.
                  const everRan = Number(stat.requestCount) > 0;
                  return (
                    <div key={name} className={`bg-card border rounded-[1.5rem] p-5 space-y-3 ${isOnCooldown ? 'border-red-500/30' : 'border-line'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${isOnCooldown ? 'bg-red-500 animate-pulse text-on-accent' : !everRan ? 'bg-faint' : stat.inFlight > 0 ? 'bg-amber-500 animate-pulse text-on-accent' : 'bg-emerald-500 text-on-accent'}`} />
                          <span className="font-black text-ink uppercase font-mono">{name}</span>
                        </div>
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${isOnCooldown ? 'bg-red-500/10 border-red-500/30 text-danger' : !everRan ? 'bg-raised border-line text-muted' : 'bg-emerald-500/10 border-emerald-500/30 text-success'}`}>
                          {isOnCooldown ? `Cooldown ${secondsLeft}s` : !everRan ? 'Not used yet' : 'Healthy'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-well rounded-lg p-2">
                          <div className="text-[9px] text-muted uppercase font-bold">In-Flight</div>
                          <div className="text-sm font-black text-ink font-mono">{stat.inFlight}</div>
                        </div>
                        <div className="bg-well rounded-lg p-2">
                          <div className="text-[9px] text-muted uppercase font-bold">Avg Latency</div>
                          <div className="text-sm font-black text-warn font-mono">{everRan ? `${stat.avgLatencyMs}ms` : '—'}</div>
                        </div>
                        <div className="bg-well rounded-lg p-2">
                          <div className="text-[9px] text-muted uppercase font-bold">Errors</div>
                          <div className={`text-sm font-black font-mono ${stat.errorCount > 0 ? 'text-danger' : 'text-success'}`}>{stat.errorCount}</div>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted font-mono">{stat.requestCount} total requests</div>
                    </div>
                  );
                })}
                {Object.keys(analytics?.liveProviderStats || {}).length === 0 && (
                  <div className="col-span-2 text-center py-12 text-muted text-[10px] font-bold uppercase">No chat activity on this server instance yet.</div>
                )}
              </div>


              {/* ── P-MON.3 Inference-latency percentiles (real, from trace spans) ── */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-info" />
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Inference Latency (p50 / p95 / p99)</h3>
                  </div>
                  <button
                    onClick={fetchLlmLatency}
                    disabled={llmLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted hover:text-ink transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${llmLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {!llmLatency || !Array.isArray(llmLatency.providers) || llmLatency.providers.length === 0 ? (
                  <p className="text-[10px] text-muted uppercase font-bold py-4">
                    {llmLoading ? 'Loading latency…' : 'No provider latency samples yet — appears after AI requests run.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                        <th className="py-2.5 px-3 text-left">Provider</th>
                        <th className="py-2.5 px-3 text-left">Samples</th>
                        <th className="py-2.5 px-3 text-left">p50</th>
                        <th className="py-2.5 px-3 text-left">p95</th>
                        <th className="py-2.5 px-3 text-left">p99</th>
                        <th className="py-2.5 px-3 text-left">Max</th>
                        <th className="py-2.5 px-3 text-left">Errors</th>
                      </tr></thead>
                      <tbody className="divide-y divide-line">
                        {llmLatency.providers.map((p: any) => (
                          <tr key={p.provider} className="hover:bg-raised">
                            <td className="py-2.5 px-3 text-ink font-black uppercase font-mono">{p.provider}</td>
                            <td className="py-2.5 px-3 text-muted font-mono">{p.latency?.count ?? 0}</td>
                            <td className="py-2.5 px-3 text-success font-mono">{p.latency?.p50 ?? '—'}ms</td>
                            <td className="py-2.5 px-3 text-warn font-mono">{p.latency?.p95 ?? '—'}ms</td>
                            <td className="py-2.5 px-3 text-warn font-mono">{p.latency?.p99 ?? '—'}ms</td>
                            <td className="py-2.5 px-3 text-muted font-mono">{p.latency?.max ?? '—'}ms</td>
                            <td className={`py-2.5 px-3 font-mono font-black ${p.errorRatePct > 0 ? 'text-danger' : 'text-success'}`}>{p.errorRatePct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[9px] text-faint font-bold uppercase tracking-widest pt-1">
                      Percentiles from real `ai.provider.*` trace spans — tail latency (p95/p99) that the average hides.
                    </p>
                  </div>
                )}
              </div>

              {/* ── P-MON.2 Latency anomaly / trend watch (real, from trace durations) ── */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-accent-text" />
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Latency Anomaly Watch</h3>
                  </div>
                  <button
                    onClick={fetchLatencyAnomaly}
                    disabled={anomalyLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted hover:text-ink transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${anomalyLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {!latencyAnomaly || typeof latencyAnomaly.count !== 'number' || latencyAnomaly.count === 0 ? (
                  <p className="text-[10px] text-muted uppercase font-bold py-4">
                    {anomalyLoading ? 'Analyzing…' : 'Not enough request-latency samples yet — appears after traffic flows.'}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {statCard('Samples', latencyAnomaly.count, 'recent traces', 'bg-sky-500 text-on-accent', Activity)}
                      {statCard('Anomalies', (latencyAnomaly.zAnomalies?.length || 0) + (latencyAnomaly.ewmaAnomalies?.length || 0), 'z-score + EWMA', (latencyAnomaly.zAnomalies?.length || 0) + (latencyAnomaly.ewmaAnomalies?.length || 0) > 0 ? 'bg-amber-500 text-on-accent' : 'bg-emerald-500 text-on-accent', AlertTriangle)}
                      {statCard('Trend', latencyAnomaly.trend?.direction || 'n/a', latencyAnomaly.trend ? `slope ${Number(latencyAnomaly.trend.slope).toFixed(3)}` : 'unknown', latencyAnomaly.trend?.direction === 'rising' ? 'bg-red-500 text-on-accent' : latencyAnomaly.trend?.direction === 'falling' ? 'bg-emerald-500 text-on-accent' : 'bg-raised', TrendingUp)}
                      {statCard('Avg Latency', `${latencyAnomaly.stats?.mean ?? '—'}ms`, `max ${latencyAnomaly.stats?.max ?? '—'}ms`, 'bg-indigo-500 text-on-accent', Cpu)}
                    </div>
                    {(latencyAnomaly.zAnomalies?.length || 0) > 0 && (
                      <div className="text-[10px] text-warn font-mono">
                        Spikes: {latencyAnomaly.zAnomalies.slice(0, 6).map((a: any) => `${Math.round(a.v)}ms`).join(', ')}
                      </div>
                    )}
                    <p className="text-[9px] text-faint font-bold uppercase tracking-widest">
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
                {statCard('Total Revenue', `₹${(analytics?.totalRevenue || 0).toLocaleString('en-IN')}`, 'All time', 'bg-emerald-500 text-on-accent', IndianRupee)}
                {statCard(
                  analytics?.providerCostComplete === false ? 'Provider Cost (at least)' : 'Provider Cost',
                  `₹${(analytics?.totalProviderCost || 0).toFixed(4)}`,
                  analytics?.providerCostComplete === false
                    ? `AI API cost · ${analytics?.pricedCalls || 0} priced, ${analytics?.unpricedCalls || 0} not`
                    : 'AI API cost',
                  'bg-red-500 text-on-accent', Database)}
                {statCard(
                  analytics?.providerCostComplete === false ? 'Net Margin (at most)' : 'Net Margin',
                  `₹${(analytics?.estimatedProfit || 0).toFixed(2)}`,
                  analytics?.providerCostComplete === false ? 'Revenue - cost (cost is a floor)' : 'Revenue - cost',
                  (analytics?.estimatedProfit || 0) >= 0 ? 'bg-emerald-500 text-on-accent' : 'bg-red-500 text-on-accent', TrendingUp)}
                {statCard('Token Purchases', analytics?.tokenPurchaseCount || 0, 'Successful payments', 'bg-pink-500 text-on-accent', Tag)}
                {statCard('Cost / Request', `₹${(analytics?.burnRate || 0).toFixed(5)}`, 'Avg AI provider cost', 'bg-orange-500 text-on-accent', Cpu)}
                {statCard('Active Users', analytics?.activeUsers24h || 0, 'Using AI in 24h', 'bg-violet-500 text-on-accent', UserCheck)}
              </div>

              {/* PURCHASES — "this revenue came from which users?" (admin 2026-09-17). Every row is a
                  real `payment_transactions` document; the revenue rule (SUCCESS, paid > 0, a payment
                  rail) is purchaseLedger.ts, shared with the tiles above. Refunds are not recorded by
                  any writer, and the panel says so rather than staying silent. */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-ink uppercase tracking-tight">Purchases — who paid, for what</h3>
                  <button onClick={() => void fetchPurchases(purchaseQuery)} disabled={purchasesLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted hover:text-ink transition-colors disabled:opacity-50">
                    <RefreshCw className={`w-3 h-3 ${purchasesLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>
                {purchases?.overall && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {statCard('Revenue (all time)', `₹${Number(purchases.overall.revenueInr || 0).toLocaleString('en-IN')}`, `${purchases.overall.revenueRows} paid purchase${purchases.overall.revenueRows === 1 ? '' : 's'}`, 'bg-emerald-500 text-on-accent', IndianRupee)}
                    {statCard('In this view', `₹${Number(purchases.summary?.revenueInr || 0).toLocaleString('en-IN')}`, `${purchases.summary?.revenueRows || 0} paid of ${purchases.total} row${purchases.total === 1 ? '' : 's'}`, 'bg-sky-500 text-on-accent', Tag)}
                    {statCard('Credits given free', (purchases.overall.freeCreditRows || 0).toLocaleString('en-IN'), 'coupons, gifts, referral steps — never revenue', 'bg-violet-500 text-on-accent', UserCheck)}
                    {statCard('Unfinished', `${purchases.overall.pendingRows || 0} pending · ${purchases.overall.failedRows || 0} failed`, 'never counted as revenue', 'bg-amber-500 text-on-accent', Activity)}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-end">
                  <input value={purchaseQuery.search} onChange={(e) => setPurchaseQuery((q) => ({ ...q, search: e.target.value, offset: 0 }))}
                    placeholder="Search user, email, txn id…" className="flex-1 min-w-[180px] bg-well border border-line rounded-lg px-3 py-2 text-xs text-ink placeholder:text-faint" />
                  <select value={purchaseQuery.status} onChange={(e) => setPurchaseQuery((q) => ({ ...q, status: e.target.value as typeof q.status, offset: 0 }))}
                    className="bg-well border border-line rounded-lg px-2 py-2 text-xs text-ink">
                    <option value="all">All rows</option>
                    <option value="revenue">Paid (revenue)</option>
                    <option value="success">Successful (incl. free)</option>
                    <option value="free">Free credit only</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                  </select>
                  <label className="text-[9px] uppercase text-faint flex flex-col gap-1">From
                    <input type="date" value={purchaseQuery.from} onChange={(e) => setPurchaseQuery((q) => ({ ...q, from: e.target.value, offset: 0 }))} className="bg-well border border-line rounded-lg px-2 py-1.5 text-xs text-ink" />
                  </label>
                  <label className="text-[9px] uppercase text-faint flex flex-col gap-1">To
                    <input type="date" value={purchaseQuery.to} onChange={(e) => setPurchaseQuery((q) => ({ ...q, to: e.target.value, offset: 0 }))} className="bg-well border border-line rounded-lg px-2 py-1.5 text-xs text-ink" />
                  </label>
                  <select value={`${purchaseQuery.sort}:${purchaseQuery.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); setPurchaseQuery((q) => ({ ...q, sort: sort as typeof q.sort, dir: dir as typeof q.dir, offset: 0 })); }}
                    className="bg-well border border-line rounded-lg px-2 py-2 text-xs text-ink">
                    <option value="date:desc">Latest first</option>
                    <option value="date:asc">Oldest first</option>
                    <option value="amount:desc">Amount ↓</option>
                    <option value="amount:asc">Amount ↑</option>
                    <option value="tokens:desc">Tokens ↓</option>
                    <option value="tokens:asc">Tokens ↑</option>
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                      <th className="py-2.5 px-2 text-left">Date</th>
                      <th className="py-2.5 px-2 text-left">User</th>
                      <th className="py-2.5 px-2 text-left">Product</th>
                      <th className="py-2.5 px-2 text-right">Paid ₹</th>
                      <th className="py-2.5 px-2 text-right">Tokens</th>
                      <th className="py-2.5 px-2 text-right">Credited ₹</th>
                      <th className="py-2.5 px-2 text-left">Status</th>
                      <th className="py-2.5 px-2 text-left">Method</th>
                      <th className="py-2.5 px-2 text-left">Transaction</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line">
                      {purchasesLoading && <tr><td colSpan={9} className="py-8 text-center"><TirangaLoader className="w-5 h-5 mx-auto" /></td></tr>}
                      {!purchasesLoading && purchasesError && <tr><td colSpan={9} className="py-6 text-center text-danger text-[10px] font-bold normal-case">{purchasesError}</td></tr>}
                      {!purchasesLoading && !purchasesError && (purchases?.rows || []).map((p: any) => (
                        <tr key={p.id} className={`hover:bg-raised ${p.revenue ? '' : 'opacity-70'}`}>
                          <td className="py-2 px-2 text-muted whitespace-nowrap">{p.at ? new Date(p.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                          <td className="py-2 px-2">
                            <button onClick={() => void openAccount(p.userId)} className="text-left group" title="Open this account">
                              <div className="text-ink font-bold group-hover:underline">{p.name || p.email || 'NavBharat user'}</div>
                              <div className="text-[9px] text-muted font-mono">{p.email}{p.email ? ' · ' : ''}{(p.userId || '').slice(0, 10)}…</div>
                            </button>
                          </td>
                          <td className="py-2 px-2 text-body">{p.product}</td>
                          <td className={`py-2 px-2 text-right font-mono font-black ${p.revenue ? 'text-success' : 'text-faint'}`}>{p.amountInr > 0 ? `₹${Number(p.amountInr).toLocaleString('en-IN')}` : '₹0'}{p.storePriceInr ? <div className="text-[8px] text-faint font-normal">store price ₹{p.storePriceInr}</div> : null}</td>
                          <td className="py-2 px-2 text-right font-mono text-warn">{Number(p.tokens || 0).toLocaleString('en-IN')}</td>
                          <td className="py-2 px-2 text-right font-mono text-info">₹{Number(p.creditInr || 0).toFixed(2)}{p.platformFeeInr ? <div className="text-[8px] text-faint font-normal">fee ₹{p.platformFeeInr}</div> : null}</td>
                          <td className="py-2 px-2">
                            <span className={`text-[9px] font-black uppercase ${p.status === 'SUCCESS' ? (p.revenue ? 'text-success' : 'text-accent-text') : p.status === 'PENDING' ? 'text-warn' : 'text-danger'}`}>
                              {p.status === 'SUCCESS' && !p.revenue ? 'Free credit' : p.status}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-body">{p.method}</td>
                          <td className="py-2 px-2 font-mono text-[9px] text-muted">
                            <div title={p.transactionId}>{p.transactionId}</div>
                            {p.gatewayReference && p.gatewayReference !== p.transactionId && <div className="text-faint" title={p.gatewayReference}>ref {p.gatewayReference}</div>}
                          </td>
                        </tr>
                      ))}
                      {!purchasesLoading && !purchasesError && (purchases?.rows || []).length === 0 && (
                        <tr><td colSpan={9} className="py-6 text-center text-muted text-[10px] font-bold uppercase">No purchases match</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
                  <span>
                    {purchases ? `Showing ${purchases.rows.length === 0 ? 0 : purchases.offset + 1}–${purchases.offset + purchases.rows.length} of ${purchases.total.toLocaleString('en-IN')}` : ''}
                    {purchases?.overall?.refundTracked === false && <span className="ml-2 text-warn">· Refunds are not recorded by the payment webhook — check the gateway dashboard before treating a paid row as final.</span>}
                  </span>
                  <span className="flex gap-2">
                    <button disabled={!purchases || purchases.offset === 0 || purchasesLoading} onClick={() => setPurchaseQuery((q) => ({ ...q, offset: Math.max(0, q.offset - PURCHASE_PAGE) }))} className="px-2 py-1 rounded-lg bg-raised hover:bg-raised-hover disabled:opacity-40 text-ink">‹ Prev</button>
                    <button disabled={!purchases || purchases.offset + purchases.rows.length >= purchases.total || purchasesLoading} onClick={() => setPurchaseQuery((q) => ({ ...q, offset: q.offset + PURCHASE_PAGE }))} className="px-2 py-1 rounded-lg bg-raised hover:bg-raised-hover disabled:opacity-40 text-ink">Next ›</button>
                  </span>
                </div>
              </div>

              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight">Top Consuming Users</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                      <th className="py-2.5 px-3 text-left">User</th>
                      <th className="py-2.5 px-3 text-left">Tokens Purchased</th>
                      <th className="py-2.5 px-3 text-left">Tokens Used</th>
                      <th className="py-2.5 px-3 text-left">Money Spent</th>
                      <th className="py-2.5 px-3 text-left">Balance Left</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line">
                      {(analytics?.expensiveUsers || []).map((u: any, i: number) => (
                        <tr key={i} className="hover:bg-raised">
                          <td className="py-2.5 px-3"><div className="text-ink font-bold">{u.name}</div><div className="text-[9px] text-muted">{u.email}</div></td>
                          <td className="py-2.5 px-3 text-info font-mono">{(u.tokens_purchased || 0).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-warn font-mono font-black">{(u.tokens_used || 0).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-success font-mono">₹{u.money_spent || 0}</td>
                          <td className="py-2.5 px-3 text-info font-mono">₹{(u.remaining_balance || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {(analytics?.expensiveUsers || []).length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted text-[10px] font-bold uppercase">No data</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── AgentV3 cost-ladder (v5.0 build cost routing — real telemetry) ── */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-accent-text" />
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Build Cost-Ladder (last 30 days)</h3>
                  </div>
                  <button
                    onClick={fetchCostTelemetry}
                    disabled={costLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted hover:text-ink transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${costLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>

                {!costSummary || costSummary.totalBuilds === 0 ? (
                  <p className="text-[10px] text-muted uppercase font-bold py-4">
                    {costLoading ? 'Loading telemetry…' : 'No builds recorded yet — data appears once NavBharatAI Pro builds run.'}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {statCard('Builds', costSummary.totalBuilds.toLocaleString(), `${costSummary.days} day(s)`, 'bg-indigo-500 text-on-accent', Server)}
                      {statCard('Success Rate', `${costSummary.overallSuccessPct}%`, `${costSummary.okBuilds} ok`, costSummary.overallSuccessPct >= 80 ? 'bg-emerald-500 text-on-accent' : 'bg-amber-500 text-on-accent', CheckCircle2)}
                      {statCard('Cheap-Tier Share', `${costSummary.cheapTierSharePct}%`, 'ran on Gemini (cheapest)', 'bg-sky-500 text-on-accent', TrendingUp)}
                      {statCard('Billed', `$${costSummary.totalBilledUsd.toFixed(4)}`, `${costSummary.powerBuilds} power builds`, 'bg-pink-500 text-on-accent', IndianRupee)}
                    </div>

                    {/* T1-admin-dashboard — build-failure analytics: overall failure rate + spike-day alert. */}
                    {failureReport && failureReport.overall.totalBuilds > 0 && (
                      <div className={`rounded-xl border p-4 ${failureReport.spikeDates.length > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-raised'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-widest text-muted">Build Failure Rate (30d)</span>
                          <span className={`text-sm font-black ${failureReport.overall.failureRate > 0.2 ? 'text-danger' : 'text-success'}`}>
                            {(failureReport.overall.failureRate * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-[10px] text-muted mt-1">
                          {failureReport.overall.failedBuilds.toLocaleString()} failed of {failureReport.overall.totalBuilds.toLocaleString()} builds
                        </div>
                        {failureReport.spikeDates.length > 0 && (
                          <div className="text-[10px] text-danger font-bold mt-2">
                            ⚠️ Failure-rate spike on: {failureReport.spikeDates.join(', ')}
                          </div>
                        )}
                        {/*
                          WHY they failed. A rate is a number nobody can act on; a ranked cause with
                          rupees against it is a morning's work. The money is OUR OWN spend on builds
                          that produced nothing — a failed build is never charged to the user — so this
                          card is admin-only, like every other cost figure on this screen.
                        */}
                        {failureReport.causes && failureReport.causes.causes.length > 0 && (
                          <div className="mt-3 border-t border-line pt-3">
                            <div className="text-[9px] font-black uppercase tracking-widest text-muted">Why they failed — ranked by what it cost us</div>
                            <div className="text-[10px] text-muted mt-1 leading-relaxed">{failureReport.causes.headline}</div>
                            <div className="mt-2 space-y-1">
                              {failureReport.causes.causes.slice(0, 6).map((c) => (
                                <div key={c.category}>
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className={c.category === 'unknown' ? 'text-warn font-bold' : 'text-body'}>
                                      {c.category}
                                    </span>
                                    <span className="text-muted">
                                      {c.builds} build{c.builds === 1 ? '' : 's'} · {(c.shareOfBuilds * 100).toFixed(0)}% · ${c.usd.toFixed(4)} · {c.avgSeconds}s avg
                                    </span>
                                  </div>
                                  {/* One REAL example, so a row is something to act on rather than something to go and look up. */}
                                  {c.sample && (
                                    <div className="text-[9px] text-faint mt-0.5 pl-1 border-l border-line leading-relaxed">{c.sample}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                            {failureReport.causes.frameworks.length > 0 && (
                              <div className="text-[10px] text-muted mt-2">
                                Mostly in: {failureReport.causes.frameworks.slice(0, 4).map((f) => `${f.framework} (${f.builds})`).join(', ')}
                              </div>
                            )}
                          </div>
                        )}
                        {/* An unreadable ledger is NOT a clean week, and it says so rather than showing nothing. */}
                        {failureReport.causesComplete === false && (
                          <div className="text-[10px] text-warn mt-2">
                            The cause ledger could not be read, so the reasons below are missing — this is not a clean record.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                          <th className="py-2.5 px-3 text-left">Start Tier</th>
                          <th className="py-2.5 px-3 text-left">Builds</th>
                          <th className="py-2.5 px-3 text-left">Share</th>
                          <th className="py-2.5 px-3 text-left">Success</th>
                          <th className="py-2.5 px-3 text-left">Avg Tokens</th>
                          <th className="py-2.5 px-3 text-left">Avg Time</th>
                          <th className="py-2.5 px-3 text-left">Billed</th>
                        </tr></thead>
                        <tbody className="divide-y divide-line">
                          {costSummary.byTier.map((row) => (
                            <tr key={row.key} className="hover:bg-raised">
                              <td className="py-2.5 px-3 text-ink font-black uppercase">{row.key}</td>
                              <td className="py-2.5 px-3 text-warn font-mono font-black">{row.builds}</td>
                              <td className="py-2.5 px-3 text-info font-mono">{row.sharePct}%</td>
                              <td className={`py-2.5 px-3 font-mono font-black ${row.successPct >= 80 ? 'text-success' : 'text-warn'}`}>{row.successPct}%</td>
                              <td className="py-2.5 px-3 text-muted font-mono">{row.avgTokens.toLocaleString()}</td>
                              <td className="py-2.5 px-3 text-muted font-mono">{row.avgDurationSec}s</td>
                              <td className="py-2.5 px-3 text-success font-mono">${row.billedUsd.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[9px] text-faint font-bold uppercase tracking-widest">
                      Cheap-tier success rate is the P8 cutover signal — high share + high success means the ladder is safe to default-on.
                    </p>
                  </>
                )}
              </div>

              {/* ── P-MON.6 FinOps recommendations (real, derived from live metrics) ── */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-success" />
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">FinOps Recommendations</h3>
                  </div>
                  <button
                    onClick={fetchFinOps}
                    disabled={finopsLoading}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted hover:text-ink transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${finopsLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>

                {!finops || !Array.isArray(finops.recommendations) ? (
                  <p className="text-[10px] text-muted uppercase font-bold py-4">
                    {finopsLoading ? 'Analyzing spend…' : 'No metrics available yet.'}
                  </p>
                ) : finops.recommendations.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-[10px] font-bold uppercase text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    No cost issues detected from current metrics
                    {finops.summary?.builds === 0 && <span className="text-muted"> (no builds recorded yet)</span>}
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
                      const dot = rec.severity === 'critical' ? 'bg-red-500 text-on-accent' : rec.severity === 'warning' ? 'bg-amber-500 text-on-accent' : 'bg-sky-500 text-on-accent';
                      return (
                        <div key={rec.id} className={`border ${box} rounded-xl p-4`}>
                          <div className="flex items-start gap-2.5">
                            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dot}`} />
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-black text-ink">{rec.title}</span>
                                {typeof rec.observedWasteUsd === 'number' && (
                                  <span className="text-[10px] font-mono font-black text-danger whitespace-nowrap">~${rec.observedWasteUsd.toFixed(4)} wasted</span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted mt-1 leading-relaxed">{rec.detail}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[9px] text-faint font-bold uppercase tracking-widest pt-1">
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
        <div className="nb-sheet-overlay fixed inset-0 z-[60] bg-scrim flex items-center justify-center" onClick={() => setAccount(null)}>
          <div className="nb-sheet w-full max-w-2xl overflow-y-auto bg-surface border border-line rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            {account.loading ? (
              <p className="text-sm text-muted">Opening account…</p>
            ) : account.error ? (
              <p className="text-sm text-warn">{account.error}</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-base font-bold text-ink break-all">{account.identity?.email || account.identity?.name || account.uid}</h4>
                    <p className="text-[11px] text-faint break-all">{account.uid}</p>
                  </div>
                  <button onClick={() => setAccount(null)} className="text-faint hover:text-ink p-1" aria-label="Close">✕</button>
                </div>

                {account.wallet?.banned && (
                  <p className="mt-3 text-[11px] px-3 py-2 rounded-lg bg-rose-500/10 text-danger border border-rose-500/30">
                    Suspended{account.wallet.banReason ? ` — ${account.wallet.banReason}` : ''}
                  </p>
                )}

                {/* The few flags worth a second look. Not accusations. */}
                {Array.isArray(account.flags) && account.flags.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {account.flags.map((f: string) => (
                      <li key={f} className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 text-warn border border-amber-500/25">{f}</li>
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
                    <div key={c.label} className="rounded-xl border border-line p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-faint">{c.label}</p>
                      {/* NOT ZERO WHEN WE COULD NOT READ IT — see the route. An admin who reads "0
                          recharges" from a failed query sees someone who never paid us. */}
                      <p className={`text-lg font-black ${c.value === null ? 'text-faint' : 'text-ink'}`}>
                        {c.value ?? 'unread'}
                      </p>
                    </div>
                  ))}
                </div>

                {/* WHO THIS PERSON IS — the facts of the account itself (admin 2026-09-11: "user ka
                    biodata"). Read-only: nothing on this sheet writes to a profile. */}
                <div className="mt-4 rounded-xl border border-line p-3 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-faint">Who they are</p>
                  {(() => {
                    const a = account.account || {};
                    const p = account.profile || {};
                    const joined = stampLabel(a.joinedAt, a.joinedAtSource);
                    const active = stampLabel(a.lastActiveAt, a.lastActiveAtSource);
                    const rows: Array<[string, React.ReactNode]> = [
                      ['Joined', <span title={joined.title}>{joined.unread ? '—' : `${dayLabel(a.joinedAt)} · ${joined.text}`}</span>],
                      ['Last active', <span title={active.title}>{active.text}</span>],
                      ['Signs in with', signInMethodWords(a.signInMethods)],
                      ['Email verified', a.emailVerified === null || a.emailVerified === undefined ? 'unread' : a.emailVerified ? 'Yes' : 'No'],
                    ];
                    if (a.phone) rows.push(['Phone (sign-in)', a.phone]);
                    // `present: false` means they filled nothing in; `ok: false` means we could not
                    // read the row. Different statements, and an admin must not read one as the other.
                    if (p.present) {
                      if (p.displayName) rows.push(['Display name', p.displayName]);
                      if (p.phone) rows.push(['Phone (profile)', p.phone]);
                      if (p.bio) rows.push(['Bio', p.bio]);
                      if (p.budgetLimitInr > 0) rows.push(['Own monthly budget', `₹${Number(p.budgetLimitInr).toLocaleString('en-IN')}`]);
                    } else if (p.ok === false) {
                      rows.push(['Profile', 'could not be read']);
                    }
                    if (a.authDisabled === true) rows.push(['Sign-in', 'Disabled in Firebase Auth']);
                    // Shown only when it is ON: a row reading "Off" on every account is noise that
                    // trains the eye to skip the whole block, including the times it says On.
                    if (p.adult?.optedIn) {
                      rows.push(['Adult content (18+)', adultOptInSummary(p.adult)]);
                    }
                    return rows.map(([label, value], i) => (
                      <div key={`${label}-${i}`} className="flex items-start gap-3 text-[11px]">
                        <span className="text-faint w-32 shrink-0">{label}</span>
                        <span className="text-body break-words min-w-0">{value}</span>
                      </div>
                    ));
                  })()}
                </div>

                {/* WHAT THEY USE — counts and times, never content. See the withheld note at the foot
                    of this sheet and the header of adminUserActivity.ts for why that line is where it is. */}
                <div className="mt-3 rounded-xl border border-line p-3 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-faint">How they use NavBharatAI</p>
                  {(() => {
                    const act = account.activity || {};
                    const ent = account.entitlements || {};
                    const last = stampLabel(act.aiLastAt, 'activity');
                    const rows: Array<[string, React.ReactNode]> = [];
                    rows.push(['App builds', account.builds?.ok
                      ? `${account.builds.totalBuilds} build${account.builds.totalBuilds === 1 ? '' : 's'} across ${account.builds.apps?.length ?? 0} app${(account.builds.apps?.length ?? 0) === 1 ? '' : 's'}`
                      : 'could not be read']);
                    // LIVE apps, matching the card below — the old `count` included taken-down
                    // and unpublished records, so a copied summary contradicted the badges on screen.
                    rows.push(['Published apps (live)', account.publishedApps?.ok ? String(account.publishedApps.liveCount ?? liveAppCount(publishedAppRows(account.publishedApps.rows))) : 'could not be read']);
                    rows.push(['AI chat requests', act.ok === false
                      ? 'could not be read'
                      : `${act.aiRequests ?? 0} recorded · ${act.aiLast30Days ?? 0} in the last 30 days · last ${last.text}`]);
                    if (Array.isArray(act.byTier) && act.byTier.length > 0) {
                      rows.push(['Busiest chat surface', act.byTier.slice(0, 3).map((t: any) => `${t.tier} (${t.requests})`).join(', ')]);
                    }
                    if (act.devices) {
                      rows.push(['Devices seen', act.devices.ok === false
                        ? 'could not be read'
                        : `${act.devices.devices} fingerprint${act.devices.devices === 1 ? '' : 's'} · ${act.devices.browsers} browser${act.devices.browsers === 1 ? '' : 's'}`]);
                    }
                    rows.push(['Hosting plan', ent.hostingPlan ? `${ent.hostingPlan.name}${ent.hostingPlanExpiresAt ? ` · until ${dayLabel(Date.parse(ent.hostingPlanExpiresAt))}` : ''}` : 'None']);
                    rows.push(['Professionals pass', ent.professionalPass === null || ent.professionalPass === undefined
                      ? 'could not be read'
                      : ent.professionalPass.active ? `Active${ent.professionalPass.expiresAt ? ` · until ${dayLabel(Date.parse(ent.professionalPass.expiresAt))}` : ''}` : 'None']);
                    return rows.map(([label, value], i) => (
                      <div key={`${label}-${i}`} className="flex items-start gap-3 text-[11px]">
                        <span className="text-faint w-32 shrink-0">{label}</span>
                        <span className="text-body break-words min-w-0">{value}</span>
                      </div>
                    ));
                  })()}
                </div>

                <p className="mt-3 text-[11px] text-muted">
                  Spent on builds: {account.builds?.ok ? `₹${Number(account.builds.spentInr).toFixed(2)}` : 'could not be read'}
                  {account.payments?.ok && <> · Paid in: ₹{Number(account.payments.totalInr).toFixed(2)} over {account.payments.successful} recharge{account.payments.successful === 1 ? '' : 's'}</>}
                  {account.builds?.ok && <> · {account.builds.totalBuilds} builds ({account.builds.failed} failed)</>}
                </p>

                {/* PURCHASED − USED = REMAINING (admin 2026-09-17) — the chain from money in to credits
                    out, on one screen, in the app's own unit. Chat tokens say how much was MEASURED and
                    how many turns were not: a streamed turn carries no counts, and a sum that hid that
                    would under-state every streaming-heavy account. */}
                {account.usage && (
                  <div className="mt-4 rounded-xl border border-line p-3 space-y-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-faint">Credits — purchased, used, remaining</p>
                    {account.usage.ok === false ? (
                      <p className="text-[11px] text-faint">The wallet could not be read.</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            ['Purchased', account.usage.creditsPurchasedTokens],
                            ['Used', account.usage.creditsUsedTokens],
                            ['Remaining', account.usage.remainingTokens],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-lg bg-raised px-3 py-2">
                              <p className="text-[9px] uppercase tracking-widest text-faint">{label}</p>
                              <p className="text-sm font-black text-ink tabular-nums">{Number(value || 0).toLocaleString('en-IN')}</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-faint">
                          Ledger: +{Number(account.usage.ledgerCreditTokens || 0).toLocaleString('en-IN')} credited · −{Number(account.usage.ledgerDebitTokens || 0).toLocaleString('en-IN')} debited
                          {account.usage.ledgerVerdict === 'off' ? ' · does not reconcile with the balance' : account.usage.ledgerVerdict === 'balanced' ? ' · reconciles' : ''}
                        </p>
                        {account.usage.chat && (
                          <p className="text-[10px] text-muted">
                            Chat AI: {account.usage.chat.ok === false ? 'could not be read' : (
                              <>{account.usage.chat.requests} request{account.usage.chat.requests === 1 ? '' : 's'} · {Number(account.usage.chat.inputTokens || 0).toLocaleString('en-IN')} in / {Number(account.usage.chat.outputTokens || 0).toLocaleString('en-IN')} out tokens measured on {account.usage.chat.measuredRequests}
                                {account.usage.chat.unmeasuredRequests > 0 ? ` · ${account.usage.chat.unmeasuredRequests} streamed turn${account.usage.chat.unmeasuredRequests === 1 ? '' : 's'} carry no token count` : ''}
                                {account.usage.chat.failedRequests > 0 ? ` · ${account.usage.chat.failedRequests} failed` : ''}</>
                            )}
                          </p>
                        )}
                        <p className="text-[10px] text-faint">Build-side provider tokens and real API cost are on each build's report (Build Reports tab); "Spent on builds" above is what the wallet was charged.</p>
                      </>
                    )}
                  </div>
                )}

                {account.purchases && (
                  <div className="mt-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-faint mb-2">
                      Purchases{account.purchases.ok ? ` · ₹${Number(account.purchases.summary?.revenueInr || 0).toLocaleString('en-IN')} paid over ${account.purchases.summary?.revenueRows || 0}` : ''}
                    </p>
                    {account.purchases.ok === false ? (
                      <p className="text-[11px] text-faint">Payment records could not be read.</p>
                    ) : (account.purchases.rows?.length ?? 0) === 0 ? (
                      <p className="text-[11px] text-faint">No purchases on this account.</p>
                    ) : (
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {account.purchases.rows.map((p: any) => (
                          <div key={p.id} className="flex items-start gap-2 text-[10px] rounded-lg border border-line bg-raised px-2 py-1.5">
                            <span className="text-faint shrink-0 w-24">{p.at ? new Date(p.at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}</span>
                            <span className="text-body flex-1 min-w-0 truncate" title={`${p.transactionId}${p.gatewayReference ? ` · ref ${p.gatewayReference}` : ''}`}>{p.product} · {p.method}</span>
                            <span className={`tabular-nums shrink-0 font-bold ${p.revenue ? 'text-success' : 'text-faint'}`}>₹{Number(p.amountInr || 0).toLocaleString('en-IN')}</span>
                            <span className="tabular-nums shrink-0 text-warn">{Number(p.tokens || 0).toLocaleString('en-IN')} tk</span>
                            <span className={`shrink-0 uppercase font-black ${p.status === 'SUCCESS' ? (p.revenue ? 'text-success' : 'text-accent-text') : p.status === 'PENDING' ? 'text-warn' : 'text-danger'}`}>{p.status === 'SUCCESS' && !p.revenue ? 'free' : p.status.toLowerCase()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 🔴 WHERE THE BALANCE WENT (admin 2026-09-13: "user ne 0 app banayi aur 250 me se
                    200 ₹ khatam ho gaye … kaha khatam hua yeh to dikha hi nahi raha?").

                    The line above answers only "spent on BUILDS", so an account that spent nothing on
                    builds read as an account that spent nothing at all — while the assistants, the
                    tools, hosting and voice were all drawing on the same wallet. This block is the
                    rest of the answer, and it comes from ledger rows that were already being written. */}
                {account.wallet?.ok && (
                  <div className="mt-4">
                    <p className="text-[9px] uppercase tracking-widest font-black text-faint mb-2">
                      Where the balance went
                    </p>
                    {(account.wallet.spend?.rows?.length ?? 0) === 0 && !account.wallet.spend?.unattributedInr ? (
                      <p className="text-[11px] text-faint">Nothing has been spent from this wallet.</p>
                    ) : (
                      <div className="space-y-1">
                        {(account.wallet.spend?.rows ?? []).map((r: { feature: string; label: string; inr: number; entries: number }) => {
                          const total = Number(account.wallet.spend?.totalInr) || 0;
                          const pct = total > 0 ? Math.round((r.inr / total) * 100) : 0;
                          return (
                            <div key={r.feature} className="flex items-center gap-2 text-[11px]">
                              <span className="text-body w-40 shrink-0 truncate">{r.label}</span>
                              {/* The bar is the point: the admin asked which feature is used MOST,
                                  and a column of numbers does not answer that at a glance. */}
                              <span className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden min-w-0">
                                <span className="block h-full rounded-full bg-indigo-500/70 text-on-accent" style={{ width: `${pct}%` }} />
                              </span>
                              <span className="text-body tabular-nums w-16 text-right shrink-0">₹{r.inr.toFixed(2)}</span>
                              <span className="text-faint tabular-nums w-9 text-right shrink-0">{pct}%</span>
                            </div>
                          );
                        })}
                        {Number(account.wallet.spend?.absorbedInr) > 0 && (
                          /* 🔴 OUR loss, not their debt (admin 2026-09-13: "aise -500₹ har user ko
                             diye to ham barbaad ho jayenge"). The overdraft floor stopped the charge
                             here and NavBharatAI ate the rest — shown so the bleeding is visible on
                             the screen used to judge it, never folded into the user's number. */
                          <div className="flex items-center gap-2 text-[11px] pt-1">
                            <span className="text-danger w-40 shrink-0">NavBharatAI absorbed</span>
                            <span className="flex-1 min-w-0" />
                            <span className="text-danger tabular-nums w-16 text-right shrink-0">
                              ₹{Number(account.wallet.spend.absorbedInr).toFixed(2)}
                            </span>
                            <span className="w-9 shrink-0" />
                          </div>
                        )}
                        {Number(account.wallet.spend?.unattributedInr) > 0 && (
                          /* 🔒 NEVER filed under a real feature name. Every ledger row written before
                             this recording existed has no feature on it, and putting those rupees
                             under "AI tools" would be an invented number on the exact screen that
                             exists to stop inventing numbers. */
                          <div className="flex items-center gap-2 text-[11px] pt-1">
                            <span className="text-warn w-40 shrink-0">Before this was recorded</span>
                            <span className="flex-1 min-w-0" />
                            <span className="text-warn tabular-nums w-16 text-right shrink-0">
                              ₹{Number(account.wallet.spend.unattributedInr).toFixed(2)}
                            </span>
                            <span className="w-9 shrink-0" />
                          </div>
                        )}
                      </div>
                    )}

                    {(account.wallet.ledger?.length ?? 0) > 0 && (
                      <details className="mt-3">
                        <summary className="text-[10px] text-faint cursor-pointer hover:text-body">
                          Every line on this wallet ({account.wallet.ledger.length})
                        </summary>
                        <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
                          {account.wallet.ledger.map((e: { description: string; tokens: number; at: string; featureLabel: string | null }, i: number) => (
                            <div key={`${e.at}-${i}`} className="flex items-start gap-2 text-[10px]">
                              <span className={`tabular-nums w-20 shrink-0 text-right ${e.tokens < 0 ? 'text-danger' : 'text-success'}`}>
                                {e.tokens > 0 ? '+' : ''}{Number(e.tokens).toLocaleString('en-IN')}
                              </span>
                              <span className="text-muted flex-1 min-w-0 break-words">{e.description || e.featureLabel || '—'}</span>
                              <span className="text-faint shrink-0">{e.at ? new Date(e.at).toLocaleDateString() : ''}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* PER APP — one app is many builds, so this is grouped by app, not by build. The unit
                    is ₹ because that is what the record holds and what actually left the wallet;
                    deriving a token figure from a changing rate would be an invented number. */}
                {account.builds?.ok && account.builds.apps?.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-faint mb-2">Per app</p>
                    <div className="space-y-1.5">
                      {account.builds.apps.slice(0, 15).map((a: any) => (
                        <div key={a.sessionId} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
                          <span className="text-xs text-ink truncate flex-1">{a.title}</span>
                          <span className="text-[11px] text-faint shrink-0">{a.builds} build{a.builds === 1 ? '' : 's'}{a.failed > 0 ? ` · ${a.failed} failed` : ''}</span>
                          <span className="text-xs font-bold text-ink shrink-0">₹{Number(a.spentInr).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 🔴 THE APPS THIS PERSON HAS PUBLISHED — the list, not just a number (admin
                    2026-09-17: "jab admin kisi user ki profile dekhe, to waha bhi woh list dikhe, app
                    open admin bhi kar sake").

                    The rows were ALREADY in this response, complete with each url; the screen printed
                    the count and discarded them. And that count was `publishedApps.count`, which is
                    every deployment RECORD — under the words "published apps live". An account with
                    four apps of which three were taken down read as four live apps, on the exact
                    screen used to decide whether to act on that account. The card counts what the
                    badges say, from one rule (`liveAppCount`). */}
                {account.publishedApps && (
                  <div className="mt-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-faint mb-2">Published apps</p>
                    <PublishedAppsCard
                      rows={publishedAppRows(account.publishedApps.rows)}
                      {...(typeof account.publishedApps.liveCount === 'number' ? { liveCount: account.publishedApps.liveCount } : {})}
                      {...(typeof account.publishedApps.count === 'number' ? { totalCount: account.publishedApps.count } : {})}
                      {...(account.publishedApps.ok ? {} : { error: 'This user\u2019s published apps could not be read.' })}
                      showStatus
                      dense
                      emptyText="This user has not published any apps."
                    />
                  </div>
                )}

                {/* SAID ON THE SCREEN, NOT ONLY IN A COMMENT. Without this line an absent section reads
                    as "this user has done nothing", when it actually means "we deliberately do not
                    look". The server sends the sentence so the screen cannot drift from the rule. */}
                {account.withheld && (
                  <p className="mt-4 text-[10px] leading-relaxed text-faint border-t border-line pt-3">{account.withheld}</p>
                )}

                <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-line">
                  <button
                    onClick={() => { void handleBan(account.uid, !account.wallet?.banned); setAccount(null); }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-on-accent ${account.wallet?.banned ? 'bg-emerald-600 hover:bg-emerald-500 text-on-accent' : 'bg-rose-600 hover:bg-rose-500 text-on-accent'}`}
                  >
                    <Shield size={13} /> {account.wallet?.banned ? 'Lift the suspension' : 'Suspend this account'}
                  </button>
                  <button onClick={() => setAccount(null)} className="px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs text-muted">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

          {activeTab === 'userreports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="flex items-center gap-2 text-lg font-black text-ink tracking-tight">
                  <Flag size={18} className="text-danger" /> User Reports
                  {userReports.length > 0 && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-rose-500/40 text-danger">
                      {userReports.length}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {(['open', 'all'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setReportFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${reportFilter === f ? 'bg-rose-600 text-on-accent' : 'bg-raised text-muted hover:bg-raised-hover'}`}
                    >{f === 'open' ? 'Needs a person' : 'All'}</button>
                  ))}
                  <button onClick={() => void fetchUserReports()} className="p-2 rounded-lg bg-raised hover:bg-raised-hover text-muted" aria-label="Refresh">
                    <RefreshCw size={14} className={reportsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {reportsLoading && userReports.length === 0 ? (
                <p className="text-xs text-faint">Loading reports…</p>
              ) : userReports.length === 0 ? (
                <p className="text-xs text-faint">
                  {reportFilter === 'open' ? 'Nothing waiting. Every report has been handled.' : 'No reports yet.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {pagedUserReports.visible.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => void openUserReport(r.id)}
                      className="w-full text-left rounded-xl border border-line bg-raised hover:bg-raised-hover p-3 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-line text-muted">
                          {r.target?.kind === 'app' ? 'App' : r.target?.kind === 'user' ? 'User' : problemKindLabel(r.problemKind) || 'Problem'}
                        </span>
                        {/* 🔴 THE REPLY BADGE OUTRANKS THE STATUS BADGE, and that ordering is the
                            point: a report the admin marked "reviewed" and the user then answered is
                            owed a response, and showing only "reviewed" is exactly how an answered
                            question goes unread and the reporter concludes nobody was listening. */}
                        {r.awaitingReply ? (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10 text-warn">
                            Replied — needs you
                          </span>
                        ) : r.status !== 'open' && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-emerald-500/30 text-success">{r.status}</span>
                        )}
                        {r.hasScreenshot && <PictureIcon size={12} className="text-faint" />}
                        <span className="text-[10px] text-faint ml-auto">{new Date(r.at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-ink mt-1.5 line-clamp-2">{r.message}</p>
                      <p className="text-[11px] text-faint mt-1">
                        From {r.reporter?.email || r.reporter?.name || r.reporter?.shortUid || 'unknown'}
                        {r.reported && <> · about {r.reported.email || r.reported.name || r.reported.shortUid}</>}
                      </p>
                    </button>
                  ))}
                  <LoadMore list={pagedUserReports} label="reports" />
                </div>
              )}

              {/* One report, in full. BOTH people are named, and the actions an admin actually needs
                  are right here — reading a complaint and then hunting for the account in another tab
                  is how reports stop getting handled. */}
              {openReport && (
                <div className="nb-sheet-overlay fixed inset-0 z-50 bg-scrim flex items-center justify-center" onClick={() => { setOpenReport(null); setReportReply(''); setReportReplyShot(''); setReportReplyNote(''); }}>
                  <div className="nb-sheet w-full max-w-lg overflow-y-auto bg-card border border-line rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
                    {openReport.loading ? (
                      <p className="text-sm text-muted">Opening…</p>
                    ) : openReport.error ? (
                      <p className="text-sm text-warn">{openReport.error}</p>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-base font-bold text-ink">Report</h4>
                          <button onClick={() => setOpenReport(null)} className="text-faint hover:text-ink p-1" aria-label="Close">✕</button>
                        </div>
                        {problemKindLabel(openReport.report?.problemKind) && (
                          <p className="mt-3 inline-block px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-400/30 text-[11px] font-bold text-accent-text">
                            {problemKindLabel(openReport.report?.problemKind)}
                          </p>
                        )}
                        <p className="text-sm text-ink whitespace-pre-wrap mt-3 bg-well rounded-xl p-3">{openReport.report?.message}</p>

                        <div className="grid grid-cols-2 gap-3 mt-4 text-[11px]">
                          <div className="rounded-xl border border-line p-3">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-1">Reported by</p>
                            <button onClick={() => void openAccount(openReport.report.reporterUid)} className="text-left text-ink break-all underline decoration-line hover:decoration-ink">
                              {openReport.reporter?.email || openReport.reporter?.shortUid || '—'}
                            </button>
                            <p className="text-faint break-all">{openReport.report?.reporterUid}</p>
                          </div>
                          <div className="rounded-xl border border-line p-3">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-1">About</p>
                            {openReport.reported ? (
                              <>
                                <button onClick={() => void openAccount(openReport.report.target.ownerUid)} className="text-left text-ink break-all underline decoration-line hover:decoration-ink">
                                  {openReport.reported.email || openReport.reported.shortUid}
                                </button>
                                <p className="text-faint break-all">{openReport.report?.target?.ownerUid}</p>
                                {openReport.reportsAgainstReported > 1 && (
                                  <p className="text-danger mt-1 font-semibold">{openReport.reportsAgainstReported} reports about this account</p>
                                )}
                              </>
                            ) : (
                              <p className="text-faint">Not about a person</p>
                            )}
                          </div>
                        </div>

                        {/* WHAT THE APP SAW FOR ITSELF (admin 2026-09-12: "problem hi samajh nahi aa
                            rahi fix kya karu?"). This block is the whole point of collecting any of
                            it — a fact gathered and not shown is the same as a fact not gathered, and
                            this screen used to print two of the eleven things we now know. */}
                        {openReport.report?.context && (() => {
                          const c = openReport.report.context;
                          const facts: string[] = [];
                          if (c.view) facts.push(`Screen: ${c.view}`);
                          if (c.platform) facts.push(c.platform);
                          if (c.viewport) facts.push(`${c.viewport}${c.dpr ? ` @${c.dpr}x` : ''}`);
                          if (c.language) facts.push(c.language);
                          if (c.connection) facts.push(c.connection);
                          if (c.online === false) facts.push('OFFLINE');
                          if (c.appBuild) facts.push(`app build ${c.appBuild}`);
                          if (c.build) facts.push(`web ${String(c.build).slice(0, 16).replace('T', ' ')}`);
                          return (
                            <div className="mt-3 space-y-1.5">
                              <p className="text-[10px] text-faint">{facts.join(' · ') || '—'}</p>
                              {/* 🔒 "Not measured" and "measured, nothing found" are printed as
                                  DIFFERENT lines on purpose. Collapsing them would send whoever
                                  reads this hunting for a layout bug that was never checked for. */}
                              <p className={`text-[10px] ${(c.overflow?.length ?? 0) > 0 ? 'text-warn' : 'text-faint'}`}>
                                {describeOverflow(
                                  c.overflowScanned === undefined
                                    ? null
                                    : { scanned: c.overflowScanned, truncated: !!c.overflowTruncated, findings: c.overflow ?? [] },
                                )}
                              </p>
                              {(c.overflow?.length ?? 0) > 0 && (
                                <ul className="text-[10px] text-warn font-mono pl-3 list-disc">
                                  {c.overflow.map((f, i) => (
                                    <li key={`${f.element}-${i}`}>{f.element} — {f.overflowPx}px past the edge</li>
                                  ))}
                                </ul>
                              )}
                              {(c.errors?.length ?? 0) > 0 && (
                                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2">
                                  <p className="text-[9px] uppercase tracking-widest font-black text-danger mb-1">
                                    Errors the browser recorded just before
                                  </p>
                                  <ul className="text-[10px] text-danger font-mono space-y-0.5 break-all">
                                    {c.errors.map((e, i) => <li key={`${e}-${i}`}>{e}</li>)}
                                  </ul>
                                </div>
                              )}
                              {c.userAgent && (
                                <p className="text-[9px] text-faint break-all">{c.userAgent}</p>
                              )}
                            </div>
                          );
                        })()}

                        {openReport.screenshot && (
                          <img src={openReport.screenshot} alt="Screenshot from the reporter" className="mt-3 w-full rounded-xl border border-line" />
                        )}

                        {/* THE CONVERSATION. Asking "which page?" is usually cheaper than any
                            amount of guessing, and until now there was no way to ask at all. */}
                        <div className="mt-4 rounded-xl border border-line bg-well p-3">
                          <p className="text-[9px] uppercase tracking-widest font-black text-faint mb-2">
                            Conversation with the reporter
                          </p>
                          {(openReport.report?.messages?.length ?? 0) === 0 ? (
                            <p className="text-[11px] text-faint">Nothing said yet. Ask them anything you need.</p>
                          ) : (
                            <div className="space-y-1.5 max-h-56 overflow-y-auto mb-2">
                              {openReport.report.messages.map((m: { from: string; text: string; at: number; shotId?: string }, i: number) => (
                                <div
                                  key={`${m.at}-${i}`}
                                  className={`text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5 ${
                                    m.from === 'admin'
                                      ? 'bg-indigo-500/10 border border-indigo-400/25 text-accent-text'
                                      : 'bg-raised border border-line text-body'
                                  }`}
                                >
                                  <span className="block text-[9px] uppercase tracking-widest font-black opacity-60 mb-0.5">
                                    {/* The user reads this as NavBharatAI — see the sheet. Here it is
                                        labelled "You" so the admin can follow their own thread. */}
                                    {m.from === 'admin' ? 'You (as NavBharatAI)' : 'Reporter'}
                                  </span>
                                  {m.text}
                                  {m.shotId && (
                                    <ReportShot
                                      src={`/api/admin/reports/${encodeURIComponent(openReport.report.id)}/shot/${encodeURIComponent(m.shotId)}`}
                                      headers={() => headers}
                                      alt={m.from === 'admin' ? 'Screenshot you sent' : 'Screenshot from the reporter'}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-end gap-2">
                            <textarea
                              value={reportReply}
                              onChange={(e) => setReportReply(e.target.value.slice(0, 1000))}
                              rows={2}
                              placeholder="Ask them something, or tell them it is fixed…"
                              className="flex-1 bg-well border border-line rounded-lg px-2.5 py-2 text-[12px] text-ink placeholder-faint outline-none focus:border-indigo-500/50 resize-none"
                            />
                            <button
                              onClick={() => void replyToReport(openReport.report.id)}
                              disabled={reportReplyBusy || (reportReply.trim().length === 0 && !reportReplyShot)}
                              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-on-accent"
                            >
                              {reportReplyBusy ? 'Sending…' : 'Send reply'}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              ref={adminReplyFileRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickAdminReplyShot(f); }}
                            />
                            <button
                              onClick={() => adminReplyFileRef.current?.click()}
                              disabled={reportReplyBusy}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-raised text-[10px] font-semibold text-body hover:bg-raised-hover disabled:opacity-40"
                            >
                              <PictureIcon size={12} /> {reportReplyShot ? 'Change screenshot' : 'Add screenshot'}
                            </button>
                            {reportReplyShot && (
                              <>
                                <img src={reportReplyShot} alt="Screenshot to send" className="w-7 h-7 rounded object-cover border border-line" />
                                <button onClick={() => setReportReplyShot('')} className="text-[10px] text-faint hover:text-body underline">Remove</button>
                              </>
                            )}
                          </div>
                          {reportReplyNote && (
                            <p className="mt-2 text-[10px] text-warn leading-snug">{reportReplyNote}</p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 mt-5">
                          <button onClick={() => void markUserReport(openReport.report.id, 'actioned')} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-on-accent">Acted on it</button>
                          <button onClick={() => void markUserReport(openReport.report.id, 'reviewed')} className="px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs font-bold text-ink">Read it</button>
                          <button onClick={() => void markUserReport(openReport.report.id, 'dismissed')} className="px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs text-muted">Dismiss</button>
                          {openReport.report?.target?.ownerUid && (
                            <button
                              onClick={() => { void handleBan(openReport.report.target.ownerUid, true); void markUserReport(openReport.report.id, 'actioned'); }}
                              className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-on-accent"
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

          {activeTab === 'apkreports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="flex items-center gap-2 text-lg font-black text-ink tracking-tight">
                  <Smartphone size={18} className="text-accent-text" /> APK Reports
                  {apkReports.length > 0 && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-rose-500/40 text-danger">
                      {apkReports.filter((r: any) => !r.fixed).length} open
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => void fetchApkReports()} className="p-2 rounded-lg bg-raised hover:bg-raised-hover text-muted" aria-label="Refresh">
                    <RefreshCw size={14} className={apkReportsLoading ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={downloadAllApkReports}
                    disabled={apkReports.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-raised hover:bg-raised-hover text-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  ><Download size={12} /> Download all</button>
                  <button
                    onClick={() => void clearApkReports()}
                    disabled={apkReports.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-raised hover:bg-raised-hover text-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  ><Trash2 size={12} /> Clear all</button>
                </div>
              </div>
              <p className="text-[11px] text-faint -mt-2">
                Sent automatically the moment a user's own Android/iOS store build fails on their GitHub —
                no button, no user action. Every row carries the classified cause, the log excerpt and a
                link to the full run on GitHub, so a fix never needs the user asked for more detail.
                Open a report to Download or Copy it as JSON; “Download all” takes the whole inbox in one file.
              </p>

              {apkReportsLoading && apkReports.length === 0 ? (
                <p className="text-xs text-faint">Loading reports…</p>
              ) : apkReports.length === 0 ? (
                <p className="text-xs text-faint">No failed store builds reported yet.</p>
              ) : (
                <div className="space-y-2">
                  {apkReports.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => void openApkReportById(r.id)}
                      className="w-full text-left rounded-xl border border-line bg-raised hover:bg-raised-hover p-3 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-line text-muted">
                          {r.building || r.workflow}
                        </span>
                        {r.fixed ? (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-emerald-500/30 text-success">Fixed</span>
                        ) : (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-rose-500/40 text-danger">Open</span>
                        )}
                        <span className="text-[10px] text-faint ml-auto">{new Date(r.reportedAt).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-ink mt-1.5 line-clamp-2">{r.failure?.why || 'Build failed — no cause could be read.'}</p>
                      <p className="text-[11px] text-faint mt-1">
                        {r.owner}/{r.repo} · {r.email || r.userId}
                        {r.failure?.stage && <> · stage: {r.failure.stage}</>}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {openApkReport && (
                <div className="nb-sheet-overlay fixed inset-0 z-50 bg-scrim flex items-center justify-center" onClick={() => setOpenApkReport(null)}>
                  <div className="nb-sheet w-full max-w-2xl max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] overflow-y-auto bg-card border border-line rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
                    {openApkReport.loading ? (
                      <p className="text-sm text-muted">Opening…</p>
                    ) : openApkReport.error ? (
                      <p className="text-sm text-warn">{openApkReport.error}</p>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-base font-bold text-ink">{openApkReport.owner}/{openApkReport.repo}</h4>
                            <p className="text-[11px] text-faint">{openApkReport.building || openApkReport.workflow} · reported {new Date(openApkReport.reportedAt).toLocaleString()}</p>
                          </div>
                          <button onClick={() => setOpenApkReport(null)} className="text-faint hover:text-ink p-1" aria-label="Close">✕</button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-4 text-[11px]">
                          <div className="rounded-xl border border-line p-3">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-1">Built by</p>
                            <p className="text-ink break-all">{openApkReport.email || openApkReport.userId}</p>
                          </div>
                          <div className="rounded-xl border border-line p-3">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-1">Duration</p>
                            <p className="text-ink">{openApkReport.durationSeconds != null ? `${openApkReport.durationSeconds}s` : '—'}</p>
                          </div>
                        </div>

                        {openApkReport.runUrl && (
                          <div className="mt-3">
                            <a
                              href={openApkReport.runUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-accent-text hover:text-accent-text underline decoration-indigo-300/30"
                            ><ExternalLink size={12} /> Open the full run on GitHub</a>
                            {/* HONEST ABOUT WHO OWNS THAT RUN: the build ran in the USER's own GitHub
                                account (mobileShip takes owner/repo from their connected account), so
                                this link opens only if that repository is public or shared with you.
                                Everything below is stored here and needs no GitHub access at all. */}
                            <p className="text-[10px] text-faint mt-1">
                              That run lives in the user's own GitHub account — the link opens only if the
                              repository is public or shared with you. Everything below is stored here.
                            </p>
                          </div>
                        )}

                        {openApkReport.steps?.length > 0 && (
                          <div className="mt-4">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-2">Steps</p>
                            <div className="space-y-1">
                              {openApkReport.steps.map((s: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-[11px]">
                                  <span className={`w-1.5 h-1.5 rounded-full ${s.state === 'failed' ? 'bg-rose-400' : s.state === 'done' ? 'bg-emerald-400' : 'bg-raised'}`} />
                                  <span className={s.state === 'failed' ? 'text-danger font-semibold' : 'text-muted'}>{s.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {openApkReport.failure && (
                          <div className="mt-4">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-1">Why it failed</p>
                            <p className="text-sm text-ink bg-well rounded-xl p-3 whitespace-pre-wrap">{openApkReport.failure.why}</p>
                            {openApkReport.failure.detail && Object.keys(openApkReport.failure.detail).length > 0 && (
                              <div className="mt-2 text-[11px] text-muted space-y-0.5">
                                {Object.entries(openApkReport.failure.detail).map(([k, v]: [string, any]) => (
                                  <p key={k}><span className="text-faint">{k}:</span> {String(v)}</p>
                                ))}
                              </div>
                            )}
                            <p className="text-[10px] text-faint mt-2">
                              {openApkReport.failure.navbharatCanFixItself
                                ? "NavBharatAI's self-heal can attempt to fix this class automatically."
                                : 'Outside the self-heal — needs a manual fix in the app or its build files.'}
                            </p>
                          </div>
                        )}

                        {openApkReport.failure?.logExcerpt?.length > 0 && (
                          <div className="mt-4">
                            <p className="text-faint uppercase tracking-widest text-[9px] font-black mb-1">
                              Log excerpt (failed step) · {openApkReport.failure.logExcerpt.length} lines — the complete log is on GitHub
                            </p>
                            <pre className="text-[10px] text-body bg-well rounded-xl p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
{openApkReport.failure.logExcerpt.join('\n')}
                            </pre>
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-5">
                          {openApkReport.fixed ? (
                            <button onClick={() => void markApkReport(openApkReport.id, false)} className="px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs font-bold text-ink">Reopen</button>
                          ) : (
                            <button onClick={() => void markApkReport(openApkReport.id, true)} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-on-accent">Mark fixed</button>
                          )}
                          {/* The whole stored report as a file — the log excerpt on screen scrolls,
                              so this is how the cause leaves this page intact. */}
                          <button onClick={() => downloadApkReport(openApkReport)} className="px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs font-bold text-ink inline-flex items-center gap-1.5"><Download size={12} /> Download</button>
                          <button onClick={() => copyApkReport(openApkReport)} className="px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs font-bold text-ink">Copy</button>
                          <button onClick={() => void deleteApkReportRow(openApkReport.id)} className="ml-auto px-3 py-2 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-xs font-bold text-on-accent inline-flex items-center gap-1.5"><Trash2 size={12} /> Delete</button>
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
                  <h3 className="flex items-center gap-2 text-lg font-black text-ink tracking-tight">
                    Build Reports
                    {/* THE ONE NUMBER WORTH SEEING FIRST (admin 2026-08-12): how many still need work.
                        Counted from the marks, so it can never disagree with the badges below it. */}
                    {(() => {
                      const open = openReportCount(buildReports);
                      return open > 0 ? (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 text-warn">{open} open</span>
                      ) : null;
                    })()}
                  </h3>
                  <p className="text-[11px] text-muted font-bold mt-0.5">Reports submitted by users via the “Report” button — admin-only. Download marks a report sent; “Mark fixed” is yours to set once the work is merged.</p>
                </div>
                <div className="flex items-center gap-2">
                  {/* SERVER NECESSITY (admin 2026-08-12) — see fetchNecessity. Behind a button because it
                      reads up to 500 build documents; nobody should pay that on every tab visit. */}
                  <button
                    onClick={fetchNecessity}
                    disabled={necessityLoading}
                    title="How many past apps were given a server they never needed? Every one of those could have skipped the sandbox."
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-amber-500/40 text-warn hover:text-ink hover:bg-amber-600/20 disabled:opacity-40"
                  >
                    <Server className={`w-3.5 h-3.5 ${necessityLoading ? 'animate-pulse' : ''}`} /> Server necessity
                  </button>
                  {/* SANDBOX HANDOVER (Phase 0 of the in-browser preview plan) — see fetchHandover. */}
                  <button
                    onClick={fetchHandover}
                    disabled={handoverLoading}
                    title="After a build finished, how much longer did its sandbox stay billable — and how much of that could the browser have served?"
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-violet-500/40 text-accent-text hover:text-ink hover:bg-violet-600/20 disabled:opacity-40"
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
                    className="text-[11px] font-bold px-2.5 py-2 rounded-xl bg-surface border border-line text-ink placeholder:text-faint w-[9.5rem] focus:outline-none focus:border-sky-500/50"
                  />
                  <button
                    onClick={fetchAppleDiag}
                    disabled={appleDiagLoading}
                    title="Is anything on OUR side stopping Sign in with Apple? Fetches our own public verification file exactly as Apple does."
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-sky-500/40 text-info hover:text-ink hover:bg-sky-600/20 disabled:opacity-40"
                  >
                    <Shield className={`w-3.5 h-3.5 ${appleDiagLoading ? 'animate-pulse' : ''}`} /> Apple sign-in
                  </button>
                  <button
                    onClick={fetchBuildReports}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-line text-muted hover:text-ink hover:bg-raised"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${buildReportsLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                  {/* Reclaim storage in one action (admin 2026-08-16). Each record can be ~1 MB; a cleared
                      inbox is real space back. Disabled when empty; confirms before it wipes. */}
                  <button
                    onClick={clearAllReports}
                    disabled={buildReports.length === 0}
                    title="Delete ALL build reports — frees their storage (cannot be undone)"
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-red-500/40 text-danger hover:text-ink hover:bg-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
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
                const icon = ok ? 'text-success' : unknown ? 'text-warn' : 'text-danger';
                const ring = ok ? 'border-emerald-500/25' : unknown ? 'border-amber-500/25' : 'border-red-500/25';
                const text = ok ? 'text-success' : unknown ? 'text-warn' : 'text-danger';
                return (
                  <div className={`bg-card border ${ring} rounded-[1.25rem] p-4 space-y-3`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Shield className={`w-4 h-4 ${icon}`} />
                      <h4 className="text-sm font-black text-ink tracking-tight">Sign in with Apple — is it us?</h4>
                      <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${ring} ${text}`}>
                        {appleDiag.verdict.replace(/-/g, ' ')}
                      </span>
                      {appleDiag.observedCode && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-line text-muted">
                          code: {appleDiag.observedCode}
                        </span>
                      )}
                    </div>
                    <p className={`text-[12px] ${text} font-bold leading-relaxed`}>{appleDiag.message}</p>
                    {appleDiag.nextStep && (
                      <div className="bg-surface border border-line rounded-xl p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-muted mb-1">Do this next</p>
                        <p className="text-[12px] text-ink font-bold leading-relaxed">{appleDiag.nextStep}</p>
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
                        <div key={label} className="bg-surface border border-line rounded-xl p-2.5">
                          <p className="text-[10px] font-black uppercase tracking-wider text-faint">{label}</p>
                          <p className="text-[12px] text-ink font-bold break-all">{value}</p>
                        </div>
                      ))}
                    </div>
                    {appleDiag.fetchError && (
                      <p className="text-[11px] text-warn font-bold break-all">Check failed with: {appleDiag.fetchError}</p>
                    )}
                  </div>
                );
              })()}

              {/* SERVER NECESSITY RESULT (admin 2026-08-12). The number that decides whether the
                  browser-native plan proceeds. Shown with its CAVEAT and a spot-check sample, never as a
                  bare percentage — this drives a large decision, and a number without its limits is how
                  a large change gets approved on a misunderstanding. */}
              {necessity && (
                <div className="bg-card border border-amber-500/25 rounded-[1.25rem] p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Server className="w-4 h-4 text-warn" />
                    <h4 className="text-sm font-black text-ink tracking-tight">Did these apps need a server?</h4>
                  </div>
                  <p className="text-[12px] text-warn font-bold leading-relaxed">{necessity.headline}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([
                      ['Server built, NOT needed', necessity.tally.builtButNotNeeded, 'text-warn', 'could have skipped the sandbox'],
                      ['Neither needed nor built', necessity.tally.neitherNeededNorBuilt, 'text-success', 'already browser-native'],
                      ['Genuinely needed one', necessity.tally.neededAndBuilt, 'text-info', 'E2B is required here'],
                      ['Needed, but missing', necessity.tally.neededButMissing, 'text-danger', 'a correctness gap, not a cost one'],
                    ] as const).map(([label, n, cls, hint]) => (
                      <div key={label} className="bg-surface border border-line rounded-xl p-3">
                        <div className={`text-2xl font-black tabular-nums ${cls}`}>{n}</div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-muted mt-1">{label}</div>
                        <div className="text-[10px] text-faint mt-0.5 leading-snug">{hint}</div>
                      </div>
                    ))}
                  </div>
                  {Object.keys(necessity.tally.reasonCounts).length > 0 && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted mb-1.5">Why a server was genuinely needed</div>
                      <div className="space-y-1">
                        {Object.entries(necessity.tally.reasonCounts).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                          <div key={reason} className="flex items-start gap-2 text-[11px] text-body">
                            <span className="tabular-nums font-black text-info shrink-0 w-6">{n}×</span>
                            <span className="leading-snug">{reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* SPOT-CHECK. A percentage produced by a classifier nobody has read is not evidence —
                      these are real builds the admin can recognise and disagree with. */}
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted font-bold hover:text-ink">Check it against {necessity.sample.length} real builds</summary>
                    <div className="mt-2 space-y-1.5">
                      {necessity.sample.map((s) => (
                        <div key={s.workspaceId} className="bg-surface border border-line rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${s.neededServer ? 'border-sky-500/40 text-info' : 'border-emerald-500/40 text-success'}`}>
                              {s.neededServer ? 'needed' : 'not needed'}
                            </span>
                            {s.builtServer && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-amber-500/40 text-warn">built one</span>}
                          </div>
                          <div className="text-[11px] text-body mt-1 leading-snug">{s.prompt || <span className="text-faint">(no prompt recorded)</span>}</div>
                          {s.reasons.length > 0 && <div className="text-[10px] text-muted mt-0.5">{s.reasons.join(' · ')}</div>}
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
                <div className="bg-card border border-violet-500/25 rounded-[1.25rem] p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Clock className="w-4 h-4 text-accent-text" />
                    <h4 className="text-sm font-black text-ink tracking-tight">Where does a sandbox's billed time go?</h4>
                  </div>
                  <p className="text-[12px] text-accent-text font-bold leading-relaxed">{handover.headline}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([
                      ['Real build work', `${handover.tally.buildHours}h`, 'text-info', 'a browser can never absorb this'],
                      ['Held after the build', `${handover.tally.heldAfterHours}h`, 'text-warn', 'the only window Phase 3 targets'],
                      ['Reclaimable', `${handover.tally.recoverableHours}h`, 'text-success', `frontend-only — ${handover.tally.frontendOnlyCount} builds`],
                      ['Could not measure', `${handover.tally.examined - handover.tally.measured}`, 'text-muted', 'excluded, never counted as zero'],
                    ] as const).map(([label, n, cls, hint]) => (
                      <div key={label} className="bg-surface border border-line rounded-xl p-3">
                        <div className={`text-2xl font-black tabular-nums ${cls}`}>{n}</div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-muted mt-1">{label}</div>
                        <div className="text-[10px] text-faint mt-0.5 leading-snug">{hint}</div>
                      </div>
                    ))}
                  </div>
                  {handover.minutes && handover.minutes.sessions > 0 && (
                    // WHERE DO THE MINUTES GO. The bill said ~29 min a session; a build is ~5-7 of work.
                    // "Idle" is the machine up with none of our operations running — a sweep/window
                    // problem. "Running" is our commands — a machine or workload problem. Different fixes.
                    <p className="text-[11px] text-muted leading-relaxed">
                      <span className="font-black text-ink">Where the minutes go</span> (last {handover.minutes.sessions} ended sessions):{' '}
                      up <span className="tabular-nums font-black text-ink">{handover.minutes.avgWallMin} min</span> ·{' '}
                      running our operations <span className="tabular-nums font-black text-info">{handover.minutes.avgBusyMin} min</span> ·{' '}
                      idle <span className="tabular-nums font-black text-warn">{handover.minutes.avgIdleMin} min</span>{' '}
                      <span className="text-faint">({Math.round(handover.minutes.idleShare * 100)}% of billed time was nobody's work)</span>
                    </p>
                  )}
                  {handover.starts && handover.starts.total > 0 && (
                    // WHY MACHINES START. 1,110 starts a month for one tester was the mystery; this is
                    // the table that ends it. A large "preview-door" share means the live frame is
                    // resuming paused machines; a large "files" share means reads are.
                    <p className="text-[11px] text-muted leading-relaxed">
                      <span className="font-black text-ink">Why machines started</span> (last {handover.starts.days} days, {handover.starts.total} starts):{' '}
                      {Object.entries(handover.starts.byReason).sort((a, b) => b[1] - a[1]).map(([reason, n], i) => (
                        <span key={reason}>{i > 0 ? ' · ' : ''}{reason} <span className="tabular-nums font-black text-ink">{n}</span></span>
                      ))}
                    </p>
                  )}
                  {handover.pauseCauses && handover.pauseCauses.total > 0 && (
                    // WHO STOPS THE MACHINES. Before the lifetime heartbeat, most sandboxes were expected to
                    // fall to the 20-minute orphan sweep — that expectation was arithmetic, not evidence.
                    // This row is the evidence. "Provider / unknown" is a machine we never stamped: E2B's
                    // own timer, a kill, or one still running — reported as unknown rather than guessed.
                    <p className="text-[11px] text-muted leading-relaxed">
                      <span className="font-black text-ink">Who stopped them:</span>{' '}
                      idle sweep <span className="tabular-nums font-black text-info">{handover.pauseCauses.idleSweep}</span> ·{' '}
                      orphan sweep <span className="tabular-nums font-black text-warn">{handover.pauseCauses.orphanSweep}</span> ·{' '}
                      sweep (cause not recorded) <span className="tabular-nums font-black text-body">{handover.pauseCauses.sweepUnattributed}</span> ·{' '}
                      provider / unknown <span className="tabular-nums font-black text-accent-text">{handover.pauseCauses.providerOrUnknown}</span>{' '}
                      <span className="text-faint">of {handover.pauseCauses.total} recent sandboxes. A rising "provider" share after 2026-09-11 is the six-minute lifetime doing the reaping.</span>
                    </p>
                  )}
                  {/* The extrapolation is kept visually APART from the measured numbers above, and says
                      what it is. The two must never be read as one row of equally solid figures. */}
                  {handover.projection.monthlyUsdEstimate > 0 && (
                    <div className="bg-surface border border-line rounded-xl p-3">
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted">Extrapolation, not a bill</div>
                      <div className="text-[12px] text-body mt-1 leading-snug">
                        Over the sample's <span className="tabular-nums font-black text-ink">{handover.projection.spanDays}</span> days that is{' '}
                        <span className="tabular-nums font-black text-success">{handover.projection.recoverableHoursPerDay}h/day</span> reclaimable ≈{' '}
                        <span className="tabular-nums font-black text-success">${handover.projection.monthlyUsdEstimate}/month</span>. Scaled from this
                        window at the measured sandbox rate — the real bill moves with usage.
                      </div>
                    </div>
                  )}
                  {Object.entries(handover.tally.unknown).some(([, n]) => n > 0) && (
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted mb-1.5">Why builds were excluded</div>
                      <div className="space-y-1">
                        {Object.entries(handover.tally.unknown).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([why, n]) => (
                          <div key={why} className="flex items-start gap-2 text-[11px] text-body">
                            <span className="tabular-nums font-black text-muted shrink-0 w-6">{n}×</span>
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
                    <summary className="cursor-pointer text-muted font-bold hover:text-ink">Check it against {handover.sample.length} real builds</summary>
                    <div className="mt-2 space-y-1.5">
                      {handover.sample.map((s) => (
                        <div key={s.workspaceId} className="bg-surface border border-line rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {s.known ? (
                              <>
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-sky-500/40 text-info">{s.buildMinutes}m build</span>
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-amber-500/40 text-warn">{s.heldAfterMinutes}m held</span>
                                {s.frontendOnly && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-emerald-500/40 text-success">reclaimable</span>}
                              </>
                            ) : (
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border border-line text-muted">not measurable · {s.why}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-body mt-1 leading-snug">{s.prompt || <span className="text-faint">(no prompt recorded)</span>}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* BUILD COSTS (admin 2026-09-14): real cost vs bill per tier × app size, measured from
                  the same durable records the list below reads. Admin-only by construction. */}
              <BuildCostCard adminToken={adminToken} />
              <ReferralCostCard adminToken={adminToken} />
              {/* FAILURE CATEGORY (admin 2026-09-16): which app TYPE fails most, and WHY — grouped from
                  the same durable per-workspace records the All Builds list below reads. */}
              <FailureCategoryCard adminToken={adminToken} />

              {/* ALL BUILDS (admin 2026-08-06): every user's every build — 0→100% report downloadable
                  WITHOUT the user pressing Report. The engine already records every build durably;
                  this is the admin's global window over that record. */}
              <div className="bg-card border border-indigo-500/20 rounded-[1.25rem] p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="w-4 h-4 text-accent-text" />
                  <h4 className="text-sm font-black text-ink tracking-tight">All builds — every user, no submit needed</h4>
                  <span className="text-[10px] text-muted font-bold">full 0→100% report per build, straight from the engine's own record</span>
                </div>
                {/* THE SAME COMPONENT THE USER-SUBMITTED INBOX RENDERS (admin 2026-09-14). It used
                    to be ~100 lines of bespoke JSX here and a different bar over there; now one
                    component draws both and one pure module (reportListFilter.ts) decides what each
                    control MEANS. That split is the point: a shared component keeps them LOOKING the
                    same, a shared module keeps them AGREEING — and only the second can be tested.

                    ⚠️ This list's filters go to the SERVER (see fetchAllBuilds): a date bound applied
                    in the browser would make "last 30 days" secretly mean "the newest 500 rows, some
                    of which are recent". The inbox filters in the browser because it already holds
                    every row. Same meanings, applied where each list can afford them. */}
                <ReportFilterBar
                  value={{ query: allBuildsSearch, status: allBuildsStatus, date: allBuildsDate, uid: allBuildsUid, tier: allBuildsTier }}
                  onChange={(next) => {
                    setAllBuildsSearch(next.query);
                    setAllBuildsStatus(next.status);
                    setAllBuildsDate(next.date);
                    setAllBuildsUid(next.uid);
                    setAllBuildsTier(next.tier);
                    // ⚠️ EXPLICIT OVERRIDES, and that is not a convenience. React state is set
                    // asynchronously, so fetching straight after the setters above would send the
                    // PREVIOUS values — the list would lag one click behind every control.
                    // Typing is deliberately NOT auto-fetched: that would be one request per
                    // keystroke. Enter (onSubmitSearch) and Load are what submit the search box.
                    if (next.query === allBuildsSearch) {
                      void fetchAllBuilds({ q: next.query, status: next.status, date: next.date, uid: next.uid, tier: next.tier });
                    }
                  }}
                  onSubmitSearch={() => void fetchAllBuilds()}
                  counts={allBuildsCounts}
                  users={allBuildsUsers}
                  trailing={(
                    <button
                      onClick={() => void fetchAllBuilds()}
                      className="shrink-0 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-on-accent"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${allBuildsLoading ? 'animate-spin' : ''}`} /> Load
                    </button>
                  )}
                />
                <p className="text-[10px] text-muted">
                  Showing {allBuilds.length}
                  {allBuildsFetched && allBuildsFetched.fetched >= allBuildsFetched.limit
                    /* Honest about the fetch ceiling: at the limit there may be OLDER builds this
                       list has not looked at, so "0 failed" must not read as "none exist". */
                    ? ` of the ${allBuildsFetched.fetched} most recent — narrow the date to see further back`
                    : allBuildsFetched ? ` of ${allBuildsFetched.fetched} loaded` : ''}
                </p>

                {allBuilds.length === 0 && !allBuildsLoading && (
                  <p className="text-[11px] text-muted">Press Load to list the most recently active builds across all users.</p>
                )}
                <div className="space-y-1.5 max-h-[28rem] overflow-y-auto">
                  {pagedAllBuilds.visible.map((b) => (
                    <div key={b.workspaceId} className="border border-line rounded-xl overflow-hidden">
                      <button
                        onClick={() => void expandWorkspaceBuilds(b.workspaceId)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-raised"
                      >
                        <span className={`shrink-0 w-2 h-2 rounded-full ${b.ok === true ? 'bg-emerald-400' : b.ok === false ? 'bg-rose-400' : 'bg-faint'}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12px] font-bold text-ink truncate">{b.prompt || b.summary || b.workspaceId}</span>
                          {/* The person first, in words. This line used to read `user RyN1xjbfr…`,
                              which is the Firebase UID -- correct, unreadable, and impossible to act
                              on. The uid stays available (title + workspace id) for matching against
                              logs, but it is no longer the only thing shown. */}
                          <span className="block text-[10px] truncate">
                            <span
                              className={b.owner?.anonymous ? 'text-warn' : 'text-info'}
                              title={b.ownerUid || 'no user id'}
                            >
                              {b.owner?.label || (b.ownerUid ? `id ${b.ownerUid.slice(0, 8)}…` : 'Signed-out user')}
                            </span>
                            <span className="text-muted">
                              {' · '}{b.savedAt ? new Date(b.savedAt).toLocaleString() : ''}
                            </span>
                          </span>
                          <span className="block text-[9px] text-faint font-mono truncate">{b.workspaceId}</span>
                        </span>
                        {/* ALREADY TAKEN? (admin 2026-09-14). The badge says only what we KNOW — that
                            the report left the admin's hands — never "someone is fixing it", which we
                            cannot know. Clicking it un-marks: a mis-tap that could not be undone would
                            HIDE a report that still needs work, the very failure this prevents. */}
                        {(() => {
                          const st = reportStatus(b.triage);
                          if (st === 'new') return null; // an untouched row needs no badge — the list is already dense
                          return (
                            <span
                              role="button"
                              tabIndex={0}
                              title={`${reportStatusHint(b.triage, (ms) => new Date(ms).toLocaleString())} — press to un-mark`}
                              onClick={(e) => { e.stopPropagation(); void markBuildTaken(b.workspaceId, { downloaded: false }); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void markBuildTaken(b.workspaceId, { downloaded: false }); } }}
                              className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-1 rounded-full border ${st === 'fixed' ? 'border-emerald-500/40 text-success' : 'border-sky-500/40 text-info'}`}
                            >{st === 'fixed' ? reportStatusLabel(st) : '📤 Taken'}</span>
                          );
                        })()}
                        {/* Sender · email · time · user type · charge · status — off the row, behind
                            one button, from the SAME pure function the other list uses. */}
                        <ReportInfoButton facts={allBuildRowFacts(b, Date.now())} />
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); void copyWorkspaceReport(b.workspaceId); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void copyWorkspaceReport(b.workspaceId); } }}
                          className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-success hover:bg-emerald-500/10"
                        >
                          ⧉ Copy session
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); void downloadWorkspaceReport(b.workspaceId); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void downloadWorkspaceReport(b.workspaceId); } }}
                          className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-indigo-500/40 text-accent-text hover:bg-indigo-500/10"
                        >
                          ⬇ Full session
                        </span>
                      </button>
                      {expandedWorkspace === b.workspaceId && (
                        <div className="border-t border-line bg-well px-3 py-2 space-y-1">
                          {expandedLoading && <p className="text-[11px] text-muted">Loading builds…</p>}
                          {!expandedLoading && expandedHistory.length === 0 && (
                            <p className="text-[11px] text-muted">Only the latest report exists for this workspace — use “Full session” above.</p>
                          )}
                          {/* NUMBERED 1st, 2nd, 3rd … in BUILD order (admin 2026-08-09). The list itself
                              arrives newest-first, so the position is counted from the far end — that way
                              "1st part" here means the same build as "1st part" in the session download,
                              which is ordered oldest → newest. */}
                          {!expandedLoading && expandedHistory.map((h, i) => (
                            <div key={h.id} className="flex items-center gap-3 py-1">
                              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${h.ok === true ? 'bg-emerald-400' : h.ok === false ? 'bg-rose-400' : 'bg-faint'}`} />
                              <span className="shrink-0 text-[10px] font-black text-muted tabular-nums w-9">{ordinal(expandedHistory.length - i)}</span>
                              <span className="flex-1 min-w-0 text-[11px] text-body truncate">
                                {h.startedAt ? new Date(h.startedAt).toLocaleString() : h.id} — {h.prompt || h.summary || 'build'}
                              </span>
                              <button
                                onClick={() => void copyWorkspaceReport(b.workspaceId, h.id)}
                                className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border border-emerald-500/30 text-success hover:text-ink hover:bg-emerald-500/10"
                              >
                                ⧉ Copy
                              </button>
                              <button
                                onClick={() => void downloadWorkspaceReport(b.workspaceId, h.id)}
                                className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border border-line text-muted hover:text-ink hover:bg-raised"
                              >
                                ⬇ This build
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <LoadMore list={pagedAllBuilds} label="apps" />
                </div>
              </div>

              {/* FIRST-PASS QUALITY (ROADMAP #1 Phase 0.2) — the headline engine number. A build that
                  healed itself is NOT counted as a success (50/50 law: a heal is a red flag), so this
                  deliberately reads lower than the delivered rate shown beside it. Honest by
                  construction: shows nothing rather than a fake 0% when no row carries the signal. */}
              {firstPass && firstPass.cleanRate !== null && (
                <div className="bg-card border border-line rounded-[1.25rem] p-4">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Target className="w-4 h-4 text-accent-text" />
                    <h4 className="text-sm font-black text-ink tracking-tight">First-pass quality</h4>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      firstPass.cleanRate >= FIRST_PASS_TARGET
                        ? 'bg-emerald-500/15 text-success border-emerald-500/30'
                        : 'bg-amber-500/15 text-warn border-amber-500/30'
                    }`}>
                      target {Math.round(FIRST_PASS_TARGET * 100)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div>
                      <p className="text-2xl font-black text-ink tabular-nums">{(firstPass.cleanRate * 100).toFixed(1)}%</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Right first time</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-success tabular-nums">{firstPass.clean}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Clean</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-warn tabular-nums">{firstPass.healed}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Needed repair</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-danger tabular-nums">{firstPass.failed}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Failed</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted leading-snug">{firstPassHeadline(firstPass)} <span className="text-faint">Across EVERY build by every user — not only the ones someone reported.</span></p>
                  {/* THE GAP IS THE SIGNAL (admin screenshot 2026-08-12). Complaints far below the
                      engine-wide rate is healthy self-selection — people report what broke. The two
                      being EQUAL would mean users are reporting a fair sample, which is much worse
                      news, and only showing both makes that visible. */}
                  {firstPass.reported && firstPass.reported.cleanRate !== null && (
                    <p className="text-[10px] text-muted mt-1.5 leading-snug">
                      Among the {firstPass.reported.total} build(s) users actually pressed “Report” on, {(firstPass.reported.cleanRate * 100).toFixed(1)}% were right first time.
                      {firstPass.cleanRate !== null && firstPass.reported.cleanRate < firstPass.cleanRate
                        ? ' Lower than the rate above, which is expected — people report what broke.'
                        : ' NOT lower than the rate above — users are reporting a fair sample, so the gap is not self-selection.'}
                    </p>
                  )}
                  {firstPass.skippedLegacy > 0 && (
                    <p className="text-[10px] text-muted mt-1.5 leading-snug">
                      {firstPass.skippedLegacy} older build(s) excluded — they predate this measurement and
                      carry no repair count. Counting them as clean would inflate the number.
                    </p>
                  )}
                  {firstPass.topHealCodes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-line">
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">
                        Repairs that fire most — prevent these upstream
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {firstPass.topHealCodes.map((h) => (
                          <span key={h.code} className="text-[10px] font-mono px-2 py-1 rounded-lg bg-raised border border-line text-body">
                            {h.code} <span className="text-warn font-bold">×{h.count}</span>
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
                <div className="bg-card border border-amber-500/20 rounded-[1.25rem] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-warn" />
                    <h4 className="text-sm font-black text-ink tracking-tight">Top failure patterns</h4>
                    <span className="text-[11px] text-muted font-bold">
                      {failureSummary.totalFailed} failed of {failureSummary.totalReports} report(s)
                    </span>
                  </div>
                  <div className="grid gap-1.5">
                    {failureSummary.patterns.map((p) => {
                      const pct = failureSummary.totalFailed > 0 ? Math.round((p.count / failureSummary.totalFailed) * 100) : 0;
                      return (
                        <div key={p.label} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 text-[12px] font-bold text-ink truncate" title={p.sample}>{p.label}</span>
                          <span className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                            <span className="block h-full bg-amber-500/70 rounded-full text-on-accent" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-16 shrink-0 text-right text-[11px] text-muted tabular-nums">{p.count} · {pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Build-time signal (M6-S6.1) — average / median / slowest builds, so speed is measurable. */}
              {!buildReportsLoading && buildTimeSummary.counted > 0 && (
                <div className="bg-card border border-sky-500/20 rounded-[1.25rem] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-info" />
                    <h4 className="text-sm font-black text-ink tracking-tight">Build speed</h4>
                    <span className="text-[11px] text-muted font-bold">across {buildTimeSummary.counted} build(s)</span>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <p className="text-[10px] text-muted font-black uppercase tracking-widest">Average</p>
                      <p className="text-xl font-black text-ink font-mono">{fmtDuration(buildTimeSummary.avgMs)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted font-black uppercase tracking-widest">Median</p>
                      <p className="text-xl font-black text-ink font-mono">{fmtDuration(buildTimeSummary.medianMs)}</p>
                    </div>
                    <div className="min-w-[180px]">
                      <p className="text-[10px] text-muted font-black uppercase tracking-widest mb-1">Slowest</p>
                      {buildTimeSummary.slowest.slice(0, 3).map((s, i) => (
                        <p key={i} className="text-[11px] text-muted truncate"><span className="text-warn font-bold font-mono">{fmtDuration(s.ms)}</span> · {s.app}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* THE SHARED FILTER BAR (admin 2026-09-14: "filter bhi all build report wala chahiye
                  dono me!!"). Identical to the one on All-builds — status chips with live counts, a
                  date range, a per-user picker, a search box and Clear — because both bars now render
                  from ONE component and agree through ONE pure module (reportListFilter.ts).

                  This inbox previously had no date range at all, so the list where users actually
                  complain could not be asked "is this still happening?". The tier select and the sort
                  toggle ride along as `trailing`: they are EXTRA here, not duplicates, and removing
                  them in the name of parity would have made this screen poorer. */}
              {!buildReportsLoading && buildReports.length > 0 && (
                <ReportFilterBar
                  value={reportFilters}
                  onChange={setReportFilters}
                  counts={reportCounts}
                  users={reportUsers}
                  searchPlaceholder="Search: app, sender, email, or the user's own words…"
                  trailing={(
                    <>
                      <select
                        value={reportSortKey}
                        onChange={(e) => setReportSortKey(e.target.value as ReportSortKey)}
                        className="shrink-0 bg-surface border border-line rounded-xl px-2.5 py-2 text-[11px] text-ink outline-none focus:border-indigo-500"
                        title="Sort by"
                        aria-label="Sort by"
                      >
                        <option value="time">Sort: Time</option>
                        <option value="name">Sort: Name</option>
                        <option value="app">Sort: App</option>
                        <option value="tier">Sort: User type</option>
                        <option value="charged">Sort: ₹ Charged</option>
                      </select>
                      <button
                        onClick={() => setReportSortAsc((v) => !v)}
                        className="shrink-0 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-2.5 py-2 rounded-xl border border-line text-muted hover:text-ink hover:bg-raised"
                        title={reportSortAsc ? 'Ascending' : 'Descending'}
                      >
                        <ArrowUpDown className="w-3.5 h-3.5" /> {reportSortAsc ? 'Asc' : 'Desc'}
                      </button>
                    </>
                  )}
                />
              )}

              {buildReportsLoading ? (
                <div className="flex items-center justify-center py-12 text-muted text-sm"><TirangaLoader className="w-5 h-5 mr-2" /> Loading reports…</div>
              ) : buildReports.length === 0 ? (
                <div className="bg-card border border-line rounded-[1.5rem] p-8 text-center text-muted text-sm">No build reports submitted yet.</div>
              ) : (
                <>
                  <p className="text-[11px] text-muted font-bold">
                    Showing {visibleBuildReports.length} of {buildReports.length} report(s)
                  </p>
                  {visibleBuildReports.length === 0 ? (
                    <div className="bg-card border border-line rounded-[1.5rem] p-8 text-center text-muted text-sm">No reports match these filters.</div>
                  ) : (
                    /* THE NINE-COLUMN TABLE IS GONE (admin 2026-09-14).
                       The capture that prompted this recorded the measurable half: on the admin's own
                       393 px phone its header cell reached **513 px past the right edge**, so Time,
                       User, Charged and Status were unreachable without a horizontal scroll nobody
                       discovers. `overflow-x-auto` did not fix that; it CAUSED it, by letting the row
                       grow instead of fit.

                       The rows now match All-builds exactly — a dot, the app, the person, the time,
                       and the same ⓘ button holding sender · email · time · user type · charge ·
                       status. "bahar ka UI ek dam clean aur clear ho." */
                    <div className="space-y-1.5">
                      {visibleBuildReports.map((r) => {
                        const st = reportStatus(r);
                        return (
                          <div key={r.id} className="border border-line rounded-xl overflow-hidden bg-card">
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => openBuildReport(r.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') openBuildReport(r.id); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-raised cursor-pointer"
                            >
                              <span className={`shrink-0 w-2 h-2 rounded-full ${r.ok === true ? 'bg-emerald-400' : r.ok === false ? 'bg-rose-400' : r.inFlight ? 'bg-amber-400' : 'bg-faint'}`} />
                              <span className="flex-1 min-w-0">
                                <span className="block text-[12px] font-bold text-ink truncate">{r.appLabel}</span>
                                <span className="block text-[10px] truncate">
                                  <span className="text-info">{personLabel(r.name, r.email, r.userId)}</span>
                                  <span className="text-muted">{' · '}{new Date(r.reportedAt).toLocaleString()}</span>
                                </span>
                                {/* THE USER'S OWN WORDS COME FIRST (admin 2026-08-28). `rootCause`
                                    below is the ENGINE's verdict on itself; this is the only line that
                                    can say the button does nothing, or that it built the wrong app. */}
                                {r.userNote && (
                                  <span title={r.userNote} className="block text-[10px] text-info truncate">“{r.userNote}”</span>
                                )}
                                {r.rootCause && <span className="block text-[10px] text-warn truncate">{r.rootCause}</span>}
                              </span>
                              {/* A report carrying the whole session says so, so the admin knows there
                                  are parts to choose from before opening it. */}
                              {(r.sessionParts ?? 1) > 1 && (
                                <span className="shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-indigo-500/40 text-accent-text">{r.sessionParts}p</span>
                              )}
                              {st !== 'new' && (
                                <span
                                  title={reportStatusHint(r, (ms) => new Date(ms).toLocaleString())}
                                  className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-1 rounded-full border ${st === 'fixed' ? 'border-emerald-500/40 text-success' : 'border-sky-500/40 text-info'}`}
                                >{st === 'fixed' ? '✅ Fixed' : '📤 Taken'}</span>
                              )}
                              <ReportInfoButton facts={submittedRowFacts(r, Date.now())} />
                              {/* stopPropagation so Delete never opens the report it is removing. */}
                              <button
                                onClick={(e) => { e.stopPropagation(); void deleteReport(r.id); }}
                                title="Delete this report (frees its storage)"
                                className="shrink-0 p-1.5 rounded-lg border border-line text-muted hover:text-danger hover:border-red-400/30 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Detail viewer for the selected report */}
              {(selectedReport || selectedReportLoading) && (
                <div className="nb-sheet-overlay fixed inset-0 z-50 flex items-center justify-center bg-scrim" onClick={() => setSelectedReport(null)}>
                  <div className="nb-sheet bg-surface border border-line rounded-[1.5rem] w-full max-w-3xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-line">
                      <div className="min-w-0">
                        <h4 className="text-sm font-black text-ink truncate">{selectedReport?.meta.appLabel ?? 'Loading…'}</h4>
                        {selectedReport && <p className="text-[10px] text-muted truncate">{selectedReport.meta.email || selectedReport.meta.userId || 'unknown'} · {new Date(selectedReport.meta.reportedAt).toLocaleString()} · {partsSummary(selectedReport)}</p>}
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
                          <span className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-wider px-2.5 py-2 rounded-xl border border-amber-500/50 text-warn bg-amber-500/10">
                            ⚠ Earlier builds could not be read — this may not be the whole session
                          </span>
                        )}
                        {/* ⚠️ THIS REPORT IS NOT THE WHOLE RECORD (admin 2026-09-20).
                            A report is capped twice on its way here — the recorder's own limits, then
                            Firestore's 900 KB ceiling — and until this chip existed neither said so.
                            A build that made 312 model calls was stored with 40 and read as a build
                            that made 40. The autopsy CLAUDE.md mandates begins "read the WHOLE report,
                            never a truncated tail", and the storage layer was quietly making that
                            impossible. See reportTruncation.ts.
                            A legacy report says "not recorded", never "complete" — the two are
                            different claims and only one of them is verified. */}
                        {(() => {
                          const state = readCompleteness(selectedReport?.report?.truncation);
                          if (!selectedReport || state === 'complete') return null;
                          const line = completenessLine(selectedReport.report?.truncation);
                          const hard = state === 'truncated';
                          return (
                            <span
                              title={line}
                              className={`shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-wider px-2.5 py-2 rounded-xl border ${hard
                                ? 'border-red-500/50 text-danger bg-red-500/10'
                                : 'border-line text-muted'}`}
                            >
                              {hard ? '⚠ Part of this report was dropped' : 'Completeness not recorded'}
                            </span>
                          );
                        })()}
                        {/* PART PICKER (admin 2026-08-09) — the record holds the whole 0→100% session,
                            so the admin chooses how much to take: All, or the 1st / 2nd / 3rd … build.
                            Only shown when there is genuinely more than one part to choose between. */}
                        {selectedParts.length > 1 && (
                          <select
                            value={reportPart}
                            onChange={(e) => setReportPart(e.target.value)}
                            aria-label="Which part of the report"
                            className="shrink-0 bg-surface border border-line rounded-xl px-2.5 py-2 text-[11px] font-bold text-ink focus:outline-none focus:border-indigo-500"
                          >
                            {selectedParts.map((p) => (
                              <option key={p.key} value={p.key}>{p.label}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={copySelectedReport}
                          disabled={!selectedPartJson}
                          className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-emerald-500/40 text-success hover:text-ink hover:bg-emerald-600/20 disabled:opacity-40"
                        >
                          <FileText className="w-3.5 h-3.5" /> Copy JSON
                        </button>
                        <button
                          onClick={downloadSelectedReport}
                          disabled={!selectedPartJson}
                          className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-indigo-500/40 text-accent-text hover:text-ink hover:bg-indigo-600/20 disabled:opacity-40"
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
                                ? 'border-emerald-500/60 text-success bg-emerald-600/20 hover:bg-emerald-600/30'
                                : 'border-line text-muted hover:text-ink hover:bg-raised'}`}
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
                          className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider px-3 py-2 rounded-xl border border-red-500/40 text-danger hover:text-ink hover:bg-red-600/20 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                        <button onClick={() => setSelectedReport(null)} className="shrink-0 whitespace-nowrap text-muted hover:text-ink px-2 py-2 rounded-xl hover:bg-raised">Close</button>
                      </div>
                    </div>
                    {/* THE COMPLAINT, IN FULL, ABOVE THE JSON (admin 2026-08-28).
                        The list row truncates it to one line; here it is shown whole and FIRST,
                        because it is the only part of this document the user wrote. Everything
                        below is the engine describing itself, which is exactly the evidence that
                        cannot notice "it built the wrong app". Rendered as plain text in a
                        pre-wrap block — never as markup — since it is untrusted user input. */}
                    {selectedReport?.meta.userNote && (
                      <div className="mx-4 mt-4 rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-info mb-1">What the user said</div>
                        <p className="text-[12px] leading-relaxed text-info whitespace-pre-wrap break-words">{selectedReport.meta.userNote}</p>
                      </div>
                    )}
                    <div className="flex-1 overflow-auto p-4">
                      {selectedReportLoading ? (
                        <div className="flex items-center justify-center py-12 text-muted text-sm"><TirangaLoader className="w-5 h-5 mr-2" /> Loading report…</div>
                      ) : (
                        // WHAT YOU SEE IS WHAT YOU COPY: the viewer renders the SAME bytes the two
                        // buttons hand over, so the chosen part can never differ from the read one.
                        <pre className="text-[11px] leading-relaxed text-body whitespace-pre-wrap break-words font-mono">{selectedPartJson || JSON.stringify(selectedReport?.report ?? {}, null, 2)}</pre>
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
              {/* ── BUILT APPS — every user's, twelve at a time, each with a preview (admin 2026-09-18) ──
                  *"sabhi users ki build app dikhni chahiye … 12-12 ke set me … sabhi ka preview chalna chahiye."*
                  The list, its paging and its previews are `admin/BuiltAppsPanel.tsx`; the Unpublish / Ban
                  confirmation stays in this file (see `moderating` above) and the panel only asks for it. */}
              <BuiltAppsPanel
                headers={headers}
                openAccount={(uid) => void openAccount(uid)}
                toast={toast}
                onModerate={(workspaceId, action) => { setModerating({ workspaceId, action }); setModerateReason(''); }}
                moderated={moderated}
              />

              {/* ── THE SAFETY QUEUE ───────────────────────────────────────────────────────────
                  🔒 NOT a chat browser, and the difference is structural: a clean message writes no
                  document at all, so there is nothing else here to browse. Each row is something the
                  automatic check stopped or questioned, with secrets and personal identifiers already
                  stripped from the extract. Kept 180 days, then deleted. */}
              <div className="bg-card border border-line rounded-[1.5rem] p-5 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="flex items-center gap-2 text-sm font-black text-ink uppercase tracking-tight">
                    <AlertTriangle size={15} className="text-warn" /> Safety queue
                    {Array.isArray(safetyFlags) && safetyFlags.length > 0 && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 text-warn">
                        {safetyFlags.length}
                      </span>
                    )}
                  </h3>
                  <button onClick={() => void fetchSafetyFlags()} className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-amber-500/40 transition-all">
                    Refresh
                  </button>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Messages the automatic check stopped or questioned. A clean message stores nothing at
                  all — this is the whole of what is kept, and only for 180 days.
                </p>
                {safetyError && (
                  <p className="text-[11px] text-warn">{safetyError} <button onClick={() => void fetchSafetyFlags()} className="underline">Retry</button></p>
                )}
                {!safetyError && safetyFlags !== null && safetyFlags.length === 0 && (
                  <p className="text-[11px] text-success">Nothing flagged.</p>
                )}
                {!safetyError && safetyFlags !== null && safetyFlags.length > 0 && (
                  <div className="space-y-1.5">
                    {safetyFlags.slice(0, 60).map((f: any) => (
                      <button
                        key={f.id}
                        onClick={() => void openAccount(f.uid)}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                          f.verdict === 'block' ? 'border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60' : 'border-amber-500/25 bg-amber-500/5 hover:border-amber-500/50'}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${f.verdict === 'block' ? 'bg-rose-500/20 text-danger' : 'bg-amber-500/20 text-warn'}`}>
                            {f.verdict}
                          </span>
                          <span className="text-[10px] font-mono text-muted">{f.ruleId}</span>
                          <span className="text-[10px] text-faint">· {f.surface}</span>
                          <span className="text-[10px] text-faint">· {new Date(f.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          {/* One flag is a maybe; six from one account is a pattern. Counting rows by
                              hand is how a reviewer misses the second kind. */}
                          {(f.flagsForThisAccount ?? 1) > 1 && (
                            <span className="text-[10px] font-bold text-danger">· {f.flagsForThisAccount} flags on this account</span>
                          )}
                        </div>
                        <p className="text-[11px] text-body mt-1 truncate">{f.label}</p>
                        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{f.description}</p>
                        {f.excerpt && (
                          <p className="text-[10px] text-faint mt-1 font-mono break-words">“{f.excerpt}”</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── WHO HAS +18 TURNED ON ──────────────────────────────────────────────────────
                  A list of SETTINGS, not of content: who turned a switch on and when. It does not
                  say what anybody built, and there is nothing here to read about a person — the same
                  line the account panel holds. */}
              <div className="bg-card border border-line rounded-[1.5rem] p-5 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="flex items-center gap-2 text-sm font-black text-ink uppercase tracking-tight">
                    <ShieldAlert size={15} className="text-danger" /> Adult content (18+) — who turned it on
                  </h3>
                  <button onClick={() => void fetchAdultOptIns()} className="px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink hover:border-rose-500/40 transition-all">
                    Refresh
                  </button>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Off for everyone by default. Turning it on allows lawful adult content in the user&apos;s own
                  apps and shows them 18+ apps on App Mart — it never unlocks anything the Terms prohibit,
                  and it is not available in the Android app at all.
                </p>
                {adultError && (
                  /* NOT ZERO WHEN WE COULD NOT READ IT — an empty list from a failed query would tell
                     the admin nobody has this on, which is the wrong thing to believe about it. */
                  <p className="text-[11px] text-warn">{adultError} <button onClick={() => void fetchAdultOptIns()} className="underline">Retry</button></p>
                )}
                {!adultError && adultOptIns !== null && adultOptIns.length === 0 && (
                  <p className="text-[11px] text-muted">Nobody has turned it on.</p>
                )}
                {!adultError && adultOptIns !== null && adultOptIns.length > 0 && (
                  <div className="space-y-1.5">
                    {pagedAdultOptIns.visible.map((u) => (
                      <button
                        key={u.userId}
                        onClick={() => void openAccount(u.userId)}
                        className="w-full flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2 text-left hover:border-rose-500/30 transition-colors"
                      >
                        <span className="text-xs text-ink truncate flex-1">{u.label}</span>
                        <span className="text-[10px] text-muted shrink-0">
                          {u.optedInAt ? `since ${u.optedInAt.slice(0, 10)}` : 'on'}
                        </span>
                      </button>
                    ))}
                    <LoadMore list={pagedAdultOptIns} label="accounts" />
                  </div>
                )}
              </div>

              {/* LICENCE EXPOSURE — the risks that were only ever written in a document.
                  Two runtime services run on free tiers their own terms reserve for NON-COMMERCIAL
                  use, while NavBharatAI charges money. Switching one off is a PAUSE; the fix is a
                  commercial plan, so every row says so in the admin's own words. */}
              {licenceRows && licenceRows.length > 0 && (
                <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Shield className="w-4 h-4 text-warn" />
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Licence exposure</h3>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${
                      licenceRows.some((r) => r.state === 'active') ? 'bg-amber-500/20 text-warn' : 'bg-emerald-500/20 text-success'
                    }`}>
                      {licenceRows.filter((r) => r.state === 'active').length} running
                    </span>
                  </div>
                  {licenceHeadline && <p className="text-[11px] text-muted font-medium leading-snug">{licenceHeadline}</p>}
                  <div className="space-y-3">
                    {licenceRows.map((row) => (
                      <div key={row.id} className="rounded-2xl border border-line bg-well p-4 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-black text-ink">{row.name}</p>
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            row.state === 'active' ? 'bg-amber-500/20 text-warn'
                              : row.state === 'switched-off' ? 'bg-raised text-muted'
                              : 'bg-raised text-faint'
                          }`}>
                            {row.state === 'active' ? 'Running' : row.state === 'switched-off' ? 'Switched off' : 'Not configured'}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted leading-snug">{row.restriction}</p>
                        <p className="text-[11px] text-muted leading-snug"><span className="text-faint">Powers:</span> {row.powers}</p>
                        <p className="text-[11px] text-success leading-snug"><span className="text-faint">The real fix:</span> {row.honestFix}</p>
                        <p className="text-[11px] text-muted leading-snug"><span className="text-faint">If switched off:</span> {row.whenOff}</p>
                        <p className="text-[10px] text-faint font-mono">
                          {row.killSwitch ? `Switch: set ${row.killSwitch}=off in Cloud Run` : `Switch: remove ${row.requires ?? 'its key'} — publishing then blocks, by design`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── P-SEC.3 — Two-Factor Authentication (TOTP) ── */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-success" />
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">Two-Factor Authentication</h3>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${mfaStatus?.enabled ? 'bg-emerald-500/20 text-success' : 'bg-raised text-muted'}`}>
                    {mfaStatus?.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-[11px] text-muted font-medium">
                  Require a time-based code from an authenticator app (Google Authenticator, Authy, 1Password) at admin login — protection against password leaks and SIM-swap attacks on SMS OTP.
                </p>

                {mfaStatus?.envManaged ? (
                  <p className="text-[10px] text-warn font-bold uppercase tracking-widest">
                    Managed by ADMIN_TOTP_SECRET on the server — enrolment is read-only here.
                  </p>
                ) : !mfaStatus?.enabled && !mfaEnroll ? (
                  <button onClick={startMfaEnroll} disabled={mfaBusy}
                    className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-on-accent rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95">
                    {mfaBusy ? 'Working…' : 'Enable 2FA'}
                  </button>
                ) : !mfaStatus?.enabled && mfaEnroll ? (
                  <div className="space-y-3">
                    <div className="bg-well border border-line rounded-2xl p-4 space-y-2">
                      <p className="text-[10px] text-muted font-black uppercase tracking-widest">1. Add this key to your authenticator app</p>
                      {/* data-nb-no-copy: this is a live TOTP secret. The floating page-copy button
                          puts the page's text on the clipboard and the admin pastes it into a chat —
                          so this block must be unreadable to it. See pageSnapshot.ts. */}
                      <code data-nb-no-copy="" className="block text-success font-mono text-sm break-all select-all">{mfaEnroll.secret}</code>
                      <p data-nb-no-copy="" className="text-[9px] text-muted break-all">Or paste this URI: <span className="font-mono">{mfaEnroll.otpauthUri}</span></p>
                    </div>
                    <p className="text-[10px] text-muted font-black uppercase tracking-widest">2. Enter the 6-digit code to confirm</p>
                    <div className="flex gap-2">
                      <input value={mfaCode} inputMode="numeric" maxLength={6}
                        onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="flex-1 bg-well border border-line rounded-2xl px-5 py-3 text-ink font-bold tracking-[0.3em] text-center outline-none focus:border-emerald-500" />
                      <button onClick={confirmMfaEnroll} disabled={mfaBusy || mfaCode.length !== 6}
                        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-on-accent rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95">
                        Confirm
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[10px] text-muted font-black uppercase tracking-widest">Enter a current code to disable 2FA</p>
                    <div className="flex gap-2">
                      <input value={mfaCode} inputMode="numeric" maxLength={6}
                        onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="flex-1 bg-well border border-line rounded-2xl px-5 py-3 text-ink font-bold tracking-[0.3em] text-center outline-none focus:border-red-500" />
                      <button onClick={disableMfa} disabled={mfaBusy || mfaCode.length !== 6}
                        className="px-5 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-on-accent rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95">
                        Disable
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {statCard('Failed Logins', analytics?.failedRequests || 0, 'Admin login failures', 'bg-red-500 text-on-accent', Shield)}
                {statCard('Website Hits', (analytics?.websiteHitsTotal || 0).toLocaleString(), analytics?.hitsSinceBoot ? 'Since this server started — resets on deploy' : 'All time requests', 'bg-sky-500 text-on-accent', Globe)}
                {statCard('Today Hits', (analytics?.websiteHitsToday || 0).toLocaleString(), `vs ${analytics?.websiteHitsYesterday || 0} yesterday`, 'bg-indigo-500 text-on-accent', Eye)}
              </div>

              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-danger" />
                  <h3 className="text-sm font-black text-ink uppercase tracking-tight">Recent Failed Login Attempts</h3>
                </div>
                <div className="space-y-2">
                  {(analytics?.failedLoginAttempts || []).length === 0 && <p className="text-[10px] text-muted uppercase font-bold">No failed attempts recorded.</p>}
                  {(analytics?.failedLoginAttempts || []).slice().reverse().map((attempt: any, i: number) => (
                    <div key={i} className="flex items-center justify-between bg-well rounded-xl px-4 py-2.5 border border-red-500/10">
                      <div>
                        <span className="text-danger font-mono text-[11px] font-black">{attempt.ip}</span>
                        {attempt.username && <span className="text-muted text-[9px] ml-2">tried: "{attempt.username}"</span>}
                      </div>
                      <span className="text-[9px] text-muted">{new Date(attempt.time).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rate-limited providers */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight">Rate Limited Providers</h3>
                <div className="space-y-2">
                  {Object.entries(analytics?.liveProviderStats || {})
                    .filter(([, s]: any) => s.cooldownUntil > Date.now())
                    .map(([name, s]: any) => (
                      <div key={name} className="flex justify-between items-center bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                        <span className="text-danger font-black uppercase font-mono text-[11px]">{name}</span>
                        <span className="text-[10px] text-danger">Cooldown: {Math.ceil((s.cooldownUntil - Date.now()) / 1000)}s remaining</span>
                      </div>
                    ))}
                  {Object.entries(analytics?.liveProviderStats || {}).filter(([, s]: any) => s.cooldownUntil > Date.now()).length === 0 && (
                    <p className="text-success font-bold text-[11px] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />All providers healthy — no rate limits active</p>
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
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight flex items-center gap-2">
                  <Bell className="w-4 h-4 text-success" /> App Update Notification
                </h3>
                {updateCohort?.latestVersionCode == null ? (
                  <p className="text-xs text-warn leading-relaxed">
                    ANDROID_LATEST_VERSION_CODE is not set in Cloud Run, so there is no release to announce.
                    Set it to the versionCode of the build you uploaded to Play, then reload.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted leading-relaxed">
                      {updateCohort?.summary || 'Checking which devices are behind…'}
                    </p>
                    {updateCohort?.truncated && (
                      <p className="text-[11px] text-warn">
                        Device scan hit its cap — the real number of stale devices is higher than shown.
                      </p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={fetchUpdateCohort}
                        disabled={updateBusy}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-raised text-body hover:bg-raised-hover disabled:opacity-50"
                      >
                        Refresh
                      </button>
                      <button
                        onClick={sendUpdateBroadcast}
                        disabled={updateBusy || !updateCohort || updateCohort.targetCount <= 0}
                        className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-on-accent hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {updateBusy ? 'Working…' : `Send update notification${updateCohort ? ` (${updateCohort.targetCount})` : ''}`}
                      </button>
                    </div>
                    <p className="text-[11px] text-faint leading-relaxed">
                      Only devices on an OLDER build are notified — anyone already up to date is skipped, and a
                      device that has not reported its version is never guessed at. Android only (there is no iOS
                      release). Tapping the notification opens the Play Store listing.
                    </p>
                  </>
                )}
              </div>

              {/* Maintenance Mode */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight flex items-center gap-2">
                  <Server className="w-4 h-4 text-danger" /> Maintenance Mode
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-ink font-bold">Site Maintenance</p>
                    <p className="text-[10px] text-muted">When enabled, users see a maintenance message</p>
                  </div>
                  <button onClick={() => { setMaintenanceModeState(!maintenanceMode); adminPost('/api/admin/settings', { maintenanceMode: !maintenanceMode }).then(() => toast('Maintenance mode updated!')); }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-black text-[11px] uppercase transition-all ${maintenanceMode ? 'bg-red-500/20 border-red-500/30 text-danger' : 'bg-emerald-500/10 border-emerald-500/20 text-success'}`}>
                    {maintenanceMode ? <><ToggleRight className="w-4 h-4" /> ON — Disable</> : <><ToggleLeft className="w-4 h-4" /> OFF — Enable</>}
                  </button>
                </div>
              </div>

              {/* Feature Flags */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight">Feature Flags</h3>
                <div className="space-y-3">
                  {Object.entries(featureFlags).map(([key, val]: any) => (
                    <div key={key} className="flex items-center justify-between bg-well rounded-xl px-4 py-3 border border-line">
                      <div>
                        <p className="text-sm text-ink font-bold capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                        <p className="text-[9px] text-muted uppercase font-bold">{val ? 'Enabled' : 'Disabled'}</p>
                      </div>
                      <button onClick={() => { const nf = { ...featureFlags, [key]: !val }; setFeatureFlagsState(nf); adminPost('/api/admin/settings', { featureFlags: nf }).then(() => toast(`${key} ${!val ? 'enabled' : 'disabled'}`)); }}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${val ? 'bg-emerald-500/10 border-emerald-500/20 text-success' : 'bg-raised border-line text-muted'}`}>
                        {val ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pricing Config */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight flex items-center gap-2">
                  <IndianRupee className="w-4 h-4 text-success" /> Pricing Configuration
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-accent-text font-black uppercase tracking-widest block mb-2">Coins per Rs.1</label>
                    <input type="number" value={pricingConfig.coinsPerRupee || 100} onChange={e => setPricingConfigState((p: any) => ({ ...p, coinsPerRupee: parseInt(e.target.value) }))}
                      className="w-full bg-well border border-line rounded-xl px-4 py-2.5 text-ink font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-accent-text font-black uppercase tracking-widest block mb-2">Referral Bonus %</label>
                    <input type="number" value={pricingConfig.referralBonusPct || 10} onChange={e => setPricingConfigState((p: any) => ({ ...p, referralBonusPct: parseInt(e.target.value) }))}
                      className="w-full bg-well border border-line rounded-xl px-4 py-2.5 text-ink font-mono outline-none focus:border-indigo-500" />
                  </div>
                </div>
                <button onClick={handleSettingsSave} className="px-5 py-2.5 bg-indigo-600 rounded-xl text-[11px] font-black uppercase tracking-wider text-on-accent hover:bg-indigo-700 transition-all active:scale-95">
                  Save Pricing
                </button>
              </div>

              {/* Send a message to users (admin 2026-07-30): delivers a real notification to ALL users
                  or to ONE specific user (by email). Users see it via the notification bell in the app. */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-warn" /> Message Users
                </h3>
                <textarea value={annMsg} onChange={e => setAnnMsg(e.target.value)} placeholder="Type your message to users..." rows={3}
                  className="w-full bg-well border border-line rounded-xl px-4 py-3 text-ink text-sm placeholder:text-muted outline-none focus:border-indigo-500 resize-none" />
                <div className="flex flex-wrap items-center gap-3">
                  <select value={annTarget} onChange={e => setAnnTarget(e.target.value)} className="bg-well border border-line rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-indigo-500">
                    <option value="all">All Users</option>
                    <option value="user">A Specific User</option>
                  </select>
                  {annTarget === 'user' && (
                    <input
                      type="email"
                      value={annEmail}
                      onChange={e => setAnnEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="flex-1 min-w-[200px] bg-well border border-line rounded-xl px-4 py-2.5 text-ink text-sm placeholder:text-muted outline-none focus:border-indigo-500"
                    />
                  )}
                  <button onClick={handleAnnouncement} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 rounded-xl text-[11px] font-black uppercase tracking-wider text-black transition-all active:scale-95">
                    Send Message
                  </button>
                </div>
                <p className="text-[10px] text-muted leading-relaxed">Delivered in-app via the notification bell. “All Users” reaches everyone; “A Specific User” reaches only that email.</p>
              </div>

              {/* Promo Codes */}
              <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-ink uppercase tracking-tight flex items-center gap-2">
                  <Tag className="w-4 h-4 text-accent-text" /> Promo Code Generator
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] text-accent-text font-black uppercase tracking-widest block mb-2">Code</label>
                    <input value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())} placeholder="SAVE50" className="w-full bg-well border border-line rounded-xl px-3 py-2.5 text-ink font-mono outline-none focus:border-indigo-500 uppercase" />
                  </div>
                  <div>
                    <label className="text-[10px] text-accent-text font-black uppercase tracking-widest block mb-2">Free Tokens</label>
                    <input type="number" value={promoTokens} onChange={e => setPromoTokens(e.target.value)} placeholder="500" className="w-full bg-well border border-line rounded-xl px-3 py-2.5 text-ink font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-accent-text font-black uppercase tracking-widest block mb-2">Discount %</label>
                    <input type="number" value={promoDiscount} onChange={e => setPromoDiscount(e.target.value)} placeholder="10" className="w-full bg-well border border-line rounded-xl px-3 py-2.5 text-ink font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-accent-text font-black uppercase tracking-widest block mb-2">Max Uses</label>
                    <input type="number" value={promoMaxUses} onChange={e => setPromoMaxUses(e.target.value)} placeholder="1" className="w-full bg-well border border-line rounded-xl px-3 py-2.5 text-ink font-mono outline-none focus:border-indigo-500" />
                  </div>
                </div>
                <button onClick={handlePromoCreate} className="px-5 py-2.5 bg-pink-600 hover:bg-pink-700 rounded-xl text-[11px] font-black uppercase tracking-wider text-on-accent transition-all active:scale-95 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Create Promo Code
                </button>

                {promos.length > 0 && (
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                        <th className="py-2 text-left">Code</th><th className="py-2 text-left">Tokens</th><th className="py-2 text-left">Discount</th><th className="py-2 text-left">Used</th><th className="py-2 text-left">Status</th>
                      </tr></thead>
                      <tbody className="divide-y divide-line">
                        {pagedPromos.visible.map((p: any) => (
                          <tr key={p.id} className="hover:bg-raised">
                            <td className="py-2 text-accent-text font-black font-mono">{p.code}</td>
                            <td className="py-2 text-warn font-mono">{p.freeTokens || 0}</td>
                            <td className="py-2 text-info font-mono">{p.discountPct || 0}%</td>
                            <td className="py-2 text-ink font-mono">{p.usedCount || 0}/{p.maxUses || 1}</td>
                            <td className="py-2"><span className={`text-[9px] font-black uppercase ${p.active ? 'text-success' : 'text-danger'}`}>{p.active ? 'Active' : 'Expired'}</span></td>
                          </tr>
                        ))}
                        <LoadMore list={pagedPromos} label="codes" colSpan={6} />
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
