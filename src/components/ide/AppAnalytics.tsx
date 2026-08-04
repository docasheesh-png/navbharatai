import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Rocket,
  MessageSquare,
  Code,
  Zap,
  RefreshCw,
  Activity,
  BarChart2,
  Clock,
  ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppAnalyticsProps {
  userId?: string;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date | string;
  modelUsed?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  lastUpdated: Date | string;
  agent?: string;
}

interface ActivityDay {
  date: Date;
  builds: number;
}

interface StatCard {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
  bgAccent: string;
}

type TimeRange = '7days' | '30days' | 'alltime';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateActivityData = (days: number): ActivityDay[] => {
  // Build a day-keyed map from real localStorage history
  const countsByDay: Record<string, number> = {};
  try {
    const historyRaw = localStorage.getItem('navbharatai_history');
    const history: { ts?: string; timestamp?: string }[] = historyRaw ? JSON.parse(historyRaw) : [];
    history.forEach((entry) => {
      const ts = entry.ts || entry.timestamp;
      if (ts) {
        const key = new Date(ts).toDateString();
        countsByDay[key] = (countsByDay[key] || 0) + 1;
      }
    });
  } catch { /* ignore */ }

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000);
    date.setHours(0, 0, 0, 0);
    const key = date.toDateString();
    return { date, builds: countsByDay[key] || 0 };
  });
};

const formatDate = (d: Date, short = false): string => {
  if (short) return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};

const formatTimestamp = (ts: Date | string): string => {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const SIMULATED_SESSIONS: ChatSession[] = [];

// ─── Sub-components ───────────────────────────────────────────────────────────

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  builds: number;
}

const BarChartSVG: React.FC<{ data: ActivityDay[]; days: number }> = ({ data, days }) => {
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, date: '', builds: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 800;
  const H = 160;
  const PADDING = { top: 16, right: 16, bottom: 32, left: 32 };
  const chartW = W - PADDING.left - PADDING.right;
  const chartH = H - PADDING.top - PADDING.bottom;

  const maxBuilds = Math.max(...data.map((d) => d.builds), 1);
  const barW = Math.max(4, (chartW / data.length) * 0.7);
  const gap = chartW / data.length;

  // Show only some x-axis labels to avoid crowding
  const labelStep = days <= 7 ? 1 : days <= 14 ? 2 : 5;

  const handleMouseEnter = (e: React.MouseEvent<SVGRectElement>, day: ActivityDay) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      visible: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      date: formatDate(day.date),
      builds: day.builds,
    });
  };

  const handleMouseLeave = () => setTooltip((t) => ({ ...t, visible: false }));

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 160 }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#4338ca" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="barGradHover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="1" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Y-axis gridlines */}
        {[0.25, 0.5, 0.75, 1].map((frac) => {
          const y = PADDING.top + chartH * (1 - frac);
          return (
            <g key={frac}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={W - PADDING.right}
                y2={y}
                stroke="#21262d"
                strokeWidth="1"
              />
              <text
                x={PADDING.left - 4}
                y={y + 4}
                textAnchor="end"
                fill="#6e7681"
                fontSize="10"
              >
                {Math.round(maxBuilds * frac)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((day, i) => {
          const barH = (day.builds / maxBuilds) * chartH;
          const x = PADDING.left + i * gap + gap / 2 - barW / 2;
          const y = PADDING.top + chartH - barH;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx="2"
                fill="url(#barGrad)"
                className="cursor-pointer transition-all duration-150"
                onMouseEnter={(e) => handleMouseEnter(e, day)}
                onMouseLeave={handleMouseLeave}
              />
              {i % labelStep === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 4}
                  textAnchor="middle"
                  fill="#6e7681"
                  fontSize="9"
                >
                  {formatDate(day.date, true)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1 rounded text-xs text-white"
          style={{
            left: tooltip.x + 8,
            top: tooltip.y - 32,
            background: '#21262d',
            border: '1px solid #30363d',
            whiteSpace: 'nowrap',
          }}
        >
          <span className="font-semibold text-indigo-400">{tooltip.builds} builds</span>
          <span className="ml-1 text-gray-400">{tooltip.date}</span>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const AppAnalytics: React.FC<AppAnalyticsProps> = ({ userId: _userId }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('7days');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // P-BRE.8 — real build-pipeline health from the server (GET /api/analytics/builds).
  interface BuildPerf {
    totalJobs: number; terminalJobs: number; successRate: number; failureRate: number;
    avgDurationMs: number; p95DurationMs: number;
    topFailureTypes: Array<{ type: string; count: number }>;
  }
  const [buildPerf, setBuildPerf] = useState<BuildPerf | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/builds?limit=100');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBuildPerf(data);
      } catch { /* non-fatal — card simply doesn't render */ }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // P-BRE.11 — AI build optimizer suggestions (real, from GET /api/analytics/build-optimizer).
  const [optimizer, setOptimizer] = useState<{ suggestions: Array<{ id: string; severity: string; title: string; detail: string }> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/build-optimizer?limit=100');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setOptimizer(data);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // P-TQA.13 — real MTTD/MTTR reliability from the server (GET /api/analytics/reliability).
  interface Reliability {
    mttdMs: number; mttdSampleSize: number;
    mttrMs: number; mttrSampleSize: number;
    recoveredFailures: number; unresolvedFailures: number;
    recoveryRate: number; totalFailures: number;
  }
  const [reliability, setReliability] = useState<Reliability | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/reliability?limit=100');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setReliability(data);
      } catch { /* non-fatal — card simply doesn't render */ }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // ── Read localStorage ──
  const readLocalData = useCallback(() => {
    // Sessions from dedicated key
    let sessions: ChatSession[] = [];
    try {
      const raw = localStorage.getItem('navbharat_sessions');
      if (raw) sessions = JSON.parse(raw) as ChatSession[];
    } catch {
      sessions = [];
    }

    // History / app builds
    let historyCount = 0;
    try {
      const raw = localStorage.getItem('navbharatai_history');
      if (raw) {
        const parsed = JSON.parse(raw);
        historyCount = Array.isArray(parsed) ? parsed.length : 0;
      }
    } catch {
      historyCount = 0;
    }

    // Count total messages across all localStorage keys matching navbharat patterns
    let totalMsgCount = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if (key.startsWith('navbharat') || key.startsWith('nb_')) {
          totalMsgCount++;
        }
      }
    } catch { /* ignore */ }

    return { sessions, historyCount: Math.max(historyCount, Math.floor(totalMsgCount / 3)) };
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { sessions, historyCount } = readLocalData();

  // ── Derived Stats ──
  const totalMessages = sessions.reduce((acc, s) => acc + (s.messages?.length ?? 0), 0);
  const totalApps = historyCount || Math.max(sessions.length, 1);
  const aiConversations = sessions.length;
  const codeGenKB = Math.round((totalMessages * 0.3 + 12) * 10) / 10; // rough estimate
  const tokensUsed = Math.round(aiConversations * 1500);

  // ── Activity Chart Data ──
  const chartDays = timeRange === '7days' ? 7 : timeRange === '30days' ? 30 : 60;
  const activityData = generateActivityData(chartDays);

  // ── Recent Sessions ──
  const recentSessions: ChatSession[] =
    sessions.length >= 3
      ? [...sessions]
          .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
          .slice(0, 5)
      : SIMULATED_SESSIONS;

  // ── Stat Cards ──
  const statCards: StatCard[] = [
    {
      label: 'Total Apps Built',
      value: totalApps,
      icon: <Rocket size={20} />,
      accent: 'text-indigo-400',
      bgAccent: 'bg-indigo-500/10 border-indigo-500/20',
    },
    {
      label: 'AI Conversations',
      value: aiConversations,
      icon: <MessageSquare size={20} />,
      accent: 'text-emerald-400',
      bgAccent: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Code Generated',
      value: `${codeGenKB} KB`,
      icon: <Code size={20} />,
      accent: 'text-violet-400',
      bgAccent: 'bg-violet-500/10 border-violet-500/20',
    },
    {
      label: 'Tokens Used (est.)',
      value: tokensUsed >= 1000 ? `${(tokensUsed / 1000).toFixed(1)}K` : tokensUsed,
      icon: <Zap size={20} />,
      accent: 'text-amber-400',
      bgAccent: 'bg-amber-500/10 border-amber-500/20',
    },
  ];

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setRefreshKey((k) => k + 1);
      setIsRefreshing(false);
    }, 600);
  };

  // ── Render ──
  return (
    <div
      // h-full (not min-h-full) gives the scroll container a BOUNDED height so overflow-y-auto
      // actually scrolls on mobile; the extra bottom padding clears the fixed bottom nav + safe area.
      className="h-full w-full overflow-y-auto p-4 md:p-6 pb-28 space-y-6 text-sm overscroll-contain"
      style={{ background: '#0d1117', color: '#c9d1d9' }}
    >
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={22} className="text-indigo-400" />
            Analytics Dashboard
          </h1>
          <p className="text-gray-500 mt-0.5 text-xs">
            Tumhare NavBharatAI workspace ka usage overview
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Time Range Tabs */}
          <div
            className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: '#30363d', background: '#161b22' }}
          >
            {(
              [
                { id: '7days', label: '7 Days' },
                { id: '30days', label: '30 Days' },
                { id: 'alltime', label: 'All Time' },
              ] as { id: TimeRange; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setTimeRange(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  timeRange === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg border text-gray-400 hover:text-white transition-colors"
            style={{ borderColor: '#30363d', background: '#161b22' }}
            title="Refresh data"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card, i) => (
          <div
            key={i}
            className={`rounded-xl border p-4 flex flex-col gap-3 ${card.bgAccent}`}
            style={{ background: '#161b22' }}
          >
            <div className="flex items-center justify-between">
              <span className={`${card.accent}`}>{card.icon}</span>
            </div>
            <div>
              <div className={`text-2xl font-bold ${card.accent}`}>{card.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Activity Chart ── */}
      <div
        className="rounded-xl border p-4"
        style={{ background: '#161b22', borderColor: '#30363d' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-indigo-400" />
            <h2 className="font-semibold text-white text-sm">Build Activity</h2>
          </div>
          <span className="text-xs text-gray-500">
            Last {chartDays} days
          </span>
        </div>
        <BarChartSVG data={activityData} days={chartDays} />
      </div>

      {/* ── Build Performance (P-BRE.8 — real server pipeline health) ── */}
      {buildPerf && buildPerf.totalJobs > 0 && (
        <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#30363d' }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-emerald-400" />
            <h2 className="font-semibold text-white text-sm">Build Performance</h2>
            <span className="text-xs text-gray-500 ml-auto">Last {buildPerf.terminalJobs} completed builds</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <div className="text-2xl font-bold text-emerald-400">{Math.round(buildPerf.successRate * 100)}%</div>
              <div className="text-xs text-gray-500 mt-0.5">Success rate</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-400">{Math.round(buildPerf.failureRate * 100)}%</div>
              <div className="text-xs text-gray-500 mt-0.5">Failure rate</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-indigo-400">{(buildPerf.avgDurationMs / 1000).toFixed(1)}s</div>
              <div className="text-xs text-gray-500 mt-0.5">Avg duration</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-400">{(buildPerf.p95DurationMs / 1000).toFixed(1)}s</div>
              <div className="text-xs text-gray-500 mt-0.5">p95 duration</div>
            </div>
          </div>
          {buildPerf.topFailureTypes.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Top failure types</div>
              <div className="space-y-1.5">
                {buildPerf.topFailureTypes.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-gray-300 font-mono truncate" title={f.type}>{f.type}</span>
                    <span className="text-red-400 font-bold shrink-0">{f.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AI Build Optimizer (P-BRE.11 — deterministic suggestions from real telemetry) ── */}
      {optimizer && optimizer.suggestions.length > 0 && (
        <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#30363d' }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-violet-400" />
            <h2 className="font-semibold text-white text-sm">Build Optimizer</h2>
            <span className="text-xs text-gray-500 ml-auto">Suggestions from your build history</span>
          </div>
          <div className="space-y-2">
            {optimizer.suggestions.map((s) => (
              <div key={s.id} className="flex items-start gap-3 bg-black/30 rounded-xl p-3">
                <span className={`mt-0.5 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0 ${
                  s.severity === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : s.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-white/5 border-white/10 text-gray-400'}`}>{s.severity}</span>
                <div>
                  <div className="text-xs font-bold text-white">{s.title}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Build Reliability (P-TQA.13 — real MTTD/MTTR from failure→recovery history) ── */}
      {reliability && reliability.totalFailures > 0 && (
        <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#30363d' }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-sky-400" />
            <h2 className="font-semibold text-white text-sm">Build Reliability</h2>
            <span className="text-xs text-gray-500 ml-auto">{reliability.totalFailures} failure{reliability.totalFailures === 1 ? '' : 's'} analysed</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <div className="text-2xl font-bold text-amber-400">
                {reliability.mttdSampleSize > 0 ? `${(reliability.mttdMs / 60000).toFixed(1)}m` : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">MTTD (detect)</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-sky-400">
                {reliability.mttrSampleSize > 0 ? `${(reliability.mttrMs / 60000).toFixed(1)}m` : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">MTTR (repair)</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{Math.round(reliability.recoveryRate * 100)}%</div>
              <div className="text-xs text-gray-500 mt-0.5">Recovery rate</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-400">{reliability.unresolvedFailures}</div>
              <div className="text-xs text-gray-500 mt-0.5">Unresolved</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Recent Sessions (real, from local chat history) ── */}
      <div
        className="rounded-xl border p-4"
        style={{ background: '#161b22', borderColor: '#30363d' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-emerald-400" />
          <h2 className="font-semibold text-white text-sm">Recent Sessions</h2>
        </div>
        {recentSessions.length === 0 ? (
          <div className="text-xs text-gray-500 py-6 text-center">
            No sessions yet — start a chat or build an app and it will appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {recentSessions.slice(0, 5).map((session) => {
              const msgCount = session.messages?.length ?? 0;
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg group hover:bg-white/5 transition-colors"
                  style={{ background: '#0d1117' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-200 truncate">{session.title}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
                      <span>{formatTimestamp(session.lastUpdated)}</span>
                      <span className="text-indigo-400/70">NavBharatAI</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <MessageSquare size={11} className="text-gray-600" />
                    <span className="text-[11px] text-gray-500">{msgCount}</span>
                    <ChevronRight size={12} className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
