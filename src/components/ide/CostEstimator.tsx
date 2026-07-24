import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ToggleLeft,
  ToggleRight,
  Star,
  CheckCircle2,
  Circle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppType = 'static' | 'fullstack' | 'database' | 'media';
type Region = 'india' | 'sea' | 'us-eu' | 'global';

interface AppProfile {
  appType: AppType;
  mau: number;          // monthly active users (raw)
  storage: number;      // GB
  apiCalls: number;     // millions
  bandwidth: number;    // GB
  region: Region;
  auth: boolean;
  realtimeDb: boolean;
  fileStorage: boolean;
  emailSms: boolean;
  cdn: boolean;
  customDomain: boolean;
}

interface CostBreakdown {
  hosting: number;
  database: number;
  storage: number;
  auth: number;
  bandwidth: number;
}

interface PlatformCost {
  id: string;
  name: string;
  emoji: string;
  color: string;
  breakdown: CostBreakdown;
  total: number;
  bestFor: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const USD_TO_INR = 84;

const APP_TYPES: { id: AppType; label: string; desc: string }[] = [
  { id: 'static', label: 'Static / PWA', desc: 'HTML/CSS/JS, no server' },
  { id: 'fullstack', label: 'Full-stack Web App', desc: 'API + frontend + DB' },
  { id: 'database', label: 'Database-heavy App', desc: 'Lots of reads/writes' },
  { id: 'media', label: 'Media / Video App', desc: 'Large files, streaming' },
];

const REGIONS: { id: Region; label: string; mult: number }[] = [
  { id: 'india', label: 'India (cheapest)', mult: 0.75 },
  { id: 'sea', label: 'Southeast Asia', mult: 0.85 },
  { id: 'us-eu', label: 'US / Europe', mult: 1.0 },
  { id: 'global', label: 'Global (most expensive)', mult: 1.25 },
];

const LOG_LABELS = ['100', '1K', '10K', '100K', '1M'];
const MAU_VALUES = [100, 1_000, 10_000, 100_000, 1_000_000];

// ─── Cost Calculation Engine ──────────────────────────────────────────────────

function appTypeMultiplier(appType: AppType): number {
  return { static: 0.4, fullstack: 1.0, database: 1.6, media: 2.5 }[appType];
}

function calcFirebase(p: AppProfile): CostBreakdown {
  const mau = p.mau;
  // Hosting: free up to 10 GB, then $0.026/GB
  const hostingGB = p.storage * 0.1 * appTypeMultiplier(p.appType);
  const hosting = Math.max(0, hostingGB - 10) * 0.026;

  // Firestore: free 50K reads/day = 1.5M/month, $0.06/100K reads after
  const readsM = p.apiCalls * 0.6; // 60% reads
  const freeReadsM = 1.5;
  const paidReadsM = Math.max(0, readsM - freeReadsM);
  const database = paidReadsM * 0.6; // $0.06 per 100K = $0.6 per M

  // Storage: free 1 GB, $0.18/GB
  const storageBill = Math.max(0, p.storage - 1) * 0.18;

  // Auth: free 50K/month, $0.0055 per MAU after
  const authCost = p.auth ? Math.max(0, (mau - 50_000) * 0.0055) : 0;

  // Bandwidth: free 10 GB, $0.15/GB
  const bwBill = Math.max(0, p.bandwidth - 10) * 0.15;

  return {
    hosting,
    database,
    storage: storageBill,
    auth: authCost,
    bandwidth: bwBill,
  };
}

function calcVercel(p: AppProfile): CostBreakdown {
  // Vercel Pro $20/month base after free
  const mau = p.mau;
  const base = mau > 5000 ? 20 : 0;

  // PlanetScale: free 5 GB, $39/month Scaler for more
  const dbPlan = p.storage > 5 || p.apiCalls > 10 ? 39 : 0;

  // Storage on Vercel Blob: $0.023/GB
  const storageBill = p.fileStorage ? p.storage * 0.023 : 0;

  // Auth via NextAuth / free; Clerk ~$25 for scale
  const authCost = p.auth && mau > 10_000 ? 25 : 0;

  // Bandwidth: 100 GB free on Pro, $0.15/GB
  const bwBill = Math.max(0, p.bandwidth - 100) * 0.15;

  return {
    hosting: base,
    database: dbPlan,
    storage: storageBill,
    auth: authCost,
    bandwidth: bwBill,
  };
}

function calcRailway(p: AppProfile): CostBreakdown {
  // Railway: $5 base, then usage-based $0.000463/vCPU-sec
  const mau = p.mau;
  const cpuHours = (mau / 1000) * 0.5 * appTypeMultiplier(p.appType);
  const hosting = 5 + cpuHours * 1.67; // ~$0.000463/sec * 3600 = $1.67/hr

  // Postgres: $0.000231/GB-hr; ~168 hr/month = $0.039/GB/month
  const database = p.storage * 0.039 * (p.appType === 'database' ? 2 : 1);

  // Storage volumes: $0.25/GB/month
  const storageBill = p.fileStorage ? p.storage * 0.25 : 0;

  const authCost = p.auth && mau > 10_000 ? 15 : 0;

  // Egress: $0.10/GB after 100 GB
  const bwBill = Math.max(0, p.bandwidth - 100) * 0.10;

  return {
    hosting,
    database,
    storage: storageBill,
    auth: authCost,
    bandwidth: bwBill,
  };
}

function calcAWS(p: AppProfile): CostBreakdown {
  const mau = p.mau;
  // Amplify Hosting: $0.023/GB build + $0.15/GB served
  const hostingBw = p.bandwidth * 0.15;
  const hosting = 5 + hostingBw; // $5 base Amplify

  // RDS MySQL t3.micro: $13/month + storage $0.115/GB
  const rdsBase = p.appType !== 'static' ? 13 : 0;
  const database = rdsBase + p.storage * 0.115;

  // S3: $0.023/GB
  const storageBill = p.storage * 0.023;

  // Cognito: 50K free, $0.0055 per MAU
  const authCost = p.auth ? Math.max(0, (mau - 50_000) * 0.0055) : 0;

  // CloudFront: $0.0085/GB after 1 TB
  const bwBill = p.cdn ? Math.max(0, p.bandwidth - 1024) * 0.0085 + p.bandwidth * 0.009 : p.bandwidth * 0.09;

  return {
    hosting,
    database,
    storage: storageBill,
    auth: authCost,
    bandwidth: bwBill,
  };
}

function calcSupabase(p: AppProfile): CostBreakdown {
  const mau = p.mau;
  // Free tier up to 500 MB DB, 5 GB storage, 50K MAU
  // Pro: $25/month
  const base = mau > 50_000 || p.storage > 0.5 ? 25 : 0;

  // DB compute: $0.01317/hour for small; ~$9.58/month
  const database = p.appType !== 'static' && base > 0 ? 9.58 + (p.storage - 8) * 0.125 : 0;

  // Storage: $0.021/GB after 100 GB on Pro
  const storageBill = p.fileStorage ? Math.max(0, p.storage - (base > 0 ? 100 : 1)) * 0.021 : 0;

  // Auth: built-in, free up to 50K, $0.00325 per MAU after
  const authCost = p.auth ? Math.max(0, (mau - 50_000) * 0.00325) : 0;

  // Bandwidth: 250 GB free on Pro, $0.09/GB
  const bwBill = Math.max(0, p.bandwidth - (base > 0 ? 250 : 2)) * 0.09;

  return {
    hosting: base,
    database,
    storage: storageBill,
    auth: authCost,
    bandwidth: bwBill,
  };
}

function applyRegion(cost: CostBreakdown, region: Region): CostBreakdown {
  const mult = REGIONS.find((r) => r.id === region)?.mult ?? 1;
  return {
    hosting: cost.hosting * mult,
    database: cost.database * mult,
    storage: cost.storage * mult,
    auth: cost.auth,       // auth is per-user, not regional
    bandwidth: cost.bandwidth * mult,
  };
}

function totalUSD(bd: CostBreakdown): number {
  return bd.hosting + bd.database + bd.storage + bd.auth + bd.bandwidth;
}

function badge(usd: number): { label: string; color: string } {
  if (usd === 0) return { label: 'Free Tier', color: 'bg-green-900/60 text-green-300 border border-green-700' };
  if (usd < 20) return { label: 'Affordable', color: 'bg-blue-900/60 text-blue-300 border border-blue-700' };
  if (usd < 100) return { label: 'Mid Range', color: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700' };
  return { label: 'Enterprise', color: 'bg-red-900/60 text-red-300 border border-red-700' };
}

function computePlatforms(profile: AppProfile): PlatformCost[] {
  const platforms: PlatformCost[] = [
    {
      id: 'firebase',
      name: 'Firebase (Google)',
      emoji: '🔥',
      color: '#F57C00',
      breakdown: applyRegion(calcFirebase(profile), profile.region),
      total: 0,
      bestFor: 'Realtime apps, mobile backends',
    },
    {
      id: 'vercel',
      name: 'Vercel + PlanetScale',
      emoji: '▲',
      color: '#374151',
      breakdown: applyRegion(calcVercel(profile), profile.region),
      total: 0,
      bestFor: 'Next.js apps, fast deploys',
    },
    {
      id: 'railway',
      name: 'Railway',
      emoji: '🚂',
      color: '#8B5CF6',
      breakdown: applyRegion(calcRailway(profile), profile.region),
      total: 0,
      bestFor: 'Full-stack with containers',
    },
    {
      id: 'aws',
      name: 'AWS (Amplify + RDS)',
      emoji: '☁️',
      color: '#FF9900',
      breakdown: applyRegion(calcAWS(profile), profile.region),
      total: 0,
      bestFor: 'Enterprise, high compliance',
    },
    {
      id: 'supabase',
      name: 'Supabase',
      emoji: '⚡',
      color: '#3FCF8E',
      breakdown: applyRegion(calcSupabase(profile), profile.region),
      total: 0,
      bestFor: 'Postgres apps, open source',
    },
  ];
  return platforms.map((p) => ({ ...p, total: totalUSD(p.breakdown) }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(usd: number, annual: boolean): { inr: string; usd: string } {
  const mult = annual ? 12 * 0.8 : 1;
  const u = usd * mult;
  const r = u * USD_TO_INR;
  const fmtNum = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n < 1 ? n.toFixed(2) : n.toFixed(0);
  return { inr: `₹${fmtNum(r)}`, usd: `$${fmtNum(u)}` };
}

function fmtLine(usd: number, annual: boolean): string {
  const { inr, usd: u } = fmt(usd, annual);
  return `${inr} (${u})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CostEstimator: React.FC = () => {
  const [profile, setProfile] = useState<AppProfile>({
    appType: 'fullstack',
    mau: 1,           // index 0-4 for log scale
    storage: 10,
    apiCalls: 1,      // millions
    bandwidth: 50,
    region: 'india',
    auth: true,
    realtimeDb: false,
    fileStorage: false,
    emailSms: false,
    cdn: false,
    customDomain: true,
  });

  const [mauIdx, setMauIdx] = useState(1); // index into MAU_VALUES
  const [annual, setAnnual] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const resolvedProfile = { ...profile, mau: MAU_VALUES[mauIdx] };
  const platforms = useMemo(() => computePlatforms(resolvedProfile), [resolvedProfile]);
  const cheapest = useMemo(() => [...platforms].sort((a, b) => a.total - b.total)[0], [platforms]);

  // ── Download handler ──
  const handleDownload = () => {
    const lines: string[] = [
      '=== Cloud Cost Estimator Report ===',
      `Generated: ${new Date().toLocaleDateString('en-IN')}`,
      `Billing: ${annual ? 'Annual (20% discount)' : 'Monthly'}`,
      '',
      '--- App Profile ---',
      `App Type: ${APP_TYPES.find((a) => a.id === profile.appType)?.label}`,
      `MAU: ${MAU_VALUES[mauIdx].toLocaleString()}`,
      `Storage: ${profile.storage} GB`,
      `API Calls: ${profile.apiCalls}M/month`,
      `Bandwidth: ${profile.bandwidth} GB/month`,
      `Region: ${REGIONS.find((r) => r.id === profile.region)?.label}`,
      '',
      '--- Cost Comparison ---',
      ...platforms.map((p) => {
        const { inr, usd } = fmt(p.total, annual);
        return `${p.emoji} ${p.name}: ${inr}/mo (${usd}/mo)`;
      }),
      '',
      `Best Option: ${cheapest.name} — ${fmt(cheapest.total, annual).inr}/month`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloud-cost-report.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (field: keyof AppProfile) =>
    setProfile((p) => ({ ...p, [field]: !p[field] }));

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">💰</span>
          <span className="font-semibold text-base text-white/90">Cloud Cost Estimator</span>
          <span className="text-xs text-white/40 ml-2">Know your app's hosting cost</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Annual toggle */}
          <button
            onClick={() => setAnnual((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors"
          >
            {annual ? (
              <ToggleRight size={18} className="text-blue-400" />
            ) : (
              <ToggleLeft size={18} />
            )}
            {annual ? 'Annual (20% off)' : 'Monthly'}
          </button>
          {/* Export */}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-xs text-white/80 transition-colors"
          >
            <Download size={13} />
            Download Report
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── Left: App Profile (~320px) ─── */}
        <div className="w-80 shrink-0 border-r border-white/10 flex flex-col overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* App Type */}
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">App Type</p>
              <div className="grid grid-cols-2 gap-2">
                {APP_TYPES.map((at) => (
                  <button
                    key={at.id}
                    onClick={() => setProfile((p) => ({ ...p, appType: at.id }))}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      profile.appType === at.id
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-white/10 bg-[#161b22] text-white/60 hover:border-white/20'
                    }`}
                  >
                    <div className="text-xs font-medium">{at.label}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{at.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* MAU Slider */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-white/50">Monthly Active Users</span>
                <span className="text-xs font-mono text-blue-400">{LOG_LABELS[mauIdx]}</span>
              </div>
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                value={mauIdx}
                onChange={(e) => setMauIdx(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
                {LOG_LABELS.map((l) => <span key={l}>{l}</span>)}
              </div>
            </div>

            {/* Storage */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-white/50">Storage Needed</span>
                <span className="text-xs font-mono text-blue-400">{profile.storage} GB</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1000}
                step={0.1}
                value={profile.storage}
                onChange={(e) => setProfile((p) => ({ ...p, storage: Number(e.target.value) }))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
                <span>0.1 GB</span><span>1 TB</span>
              </div>
            </div>

            {/* API Calls */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-white/50">API Calls / Month</span>
                <span className="text-xs font-mono text-blue-400">{profile.apiCalls}M</span>
              </div>
              <input
                type="range"
                min={0.001}
                max={100}
                step={0.001}
                value={profile.apiCalls}
                onChange={(e) => setProfile((p) => ({ ...p, apiCalls: Number(e.target.value) }))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
                <span>1K</span><span>100M</span>
              </div>
            </div>

            {/* Bandwidth */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-white/50">Bandwidth / Month</span>
                <span className="text-xs font-mono text-blue-400">
                  {profile.bandwidth >= 1024
                    ? `${(profile.bandwidth / 1024).toFixed(1)} TB`
                    : `${profile.bandwidth} GB`}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10240}
                step={1}
                value={profile.bandwidth}
                onChange={(e) => setProfile((p) => ({ ...p, bandwidth: Number(e.target.value) }))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
                <span>1 GB</span><span>10 TB</span>
              </div>
            </div>

            {/* Region */}
            <div>
              <p className="text-xs text-white/50 mb-1">Region</p>
              <select
                value={profile.region}
                onChange={(e) => setProfile((p) => ({ ...p, region: e.target.value as Region }))}
                className="w-full bg-[#161b22] border border-white/10 rounded-md px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-blue-500"
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Features */}
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Features</p>
              <div className="space-y-2">
                {(
                  [
                    { key: 'auth', label: 'Authentication (Firebase/Cognito)' },
                    { key: 'realtimeDb', label: 'Realtime Database' },
                    { key: 'fileStorage', label: 'File Storage' },
                    { key: 'emailSms', label: 'Email / SMS notifications' },
                    { key: 'cdn', label: 'CDN' },
                    { key: 'customDomain', label: 'Custom Domain + SSL' },
                  ] as { key: keyof AppProfile; label: string }[]
                ).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer group">
                    <button
                      onClick={() => toggle(key)}
                      className="shrink-0 text-blue-400"
                    >
                      {profile[key] ? (
                        <CheckCircle2 size={15} className="text-blue-400" />
                      ) : (
                        <Circle size={15} className="text-white/30 group-hover:text-white/50" />
                      )}
                    </button>
                    <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right: Results ─── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Recommendation Banner */}
            <div className="flex items-center justify-between bg-green-900/30 border border-green-700/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Star size={15} className="text-green-400 shrink-0" />
                <span className="text-sm text-green-300">
                  For your app{' '}
                  <span className="font-semibold text-white">{cheapest.name}</span>{' '}
                  sabse sasta rahega:{' '}
                  <span className="font-mono font-bold text-green-300">
                    {fmt(cheapest.total, annual).inr}/month
                  </span>
                </span>
              </div>
              <button className="shrink-0 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors">
                Start Free
              </button>
            </div>

            {/* Platform Cards */}
            <div className="space-y-2">
              {[...platforms]
                .sort((a, b) => a.total - b.total)
                .map((p, i) => {
                  const { inr, usd } = fmt(p.total, annual);
                  const b = badge(p.total);
                  const isCheapest = i === 0;
                  return (
                    <div
                      key={p.id}
                      className={`bg-[#161b22] rounded-xl border transition-all ${
                        isCheapest ? 'border-green-700/60' : 'border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3 p-3">
                        {/* Platform info */}
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
                          style={{ backgroundColor: `${p.color}22`, border: `1px solid ${p.color}44` }}
                        >
                          {p.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-white">{p.name}</span>
                            {isCheapest && (
                              <span className="text-[10px] bg-green-900/50 text-green-300 border border-green-700/50 px-1.5 py-0.5 rounded">
                                Best
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${b.color}`}>
                              {b.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-white/40 mt-0.5">{p.bestFor}</div>
                        </div>
                        {/* Price */}
                        <div className="text-right shrink-0">
                          <div className="text-base font-bold font-mono" style={{ color: p.color }}>
                            {inr}
                          </div>
                          <div className="text-xs text-white/40 font-mono">{usd}/mo</div>
                        </div>
                      </div>

                      {/* Breakdown bar */}
                      <div className="px-3 pb-3">
                        <div className="grid grid-cols-5 gap-1 text-[10px]">
                          {(
                            [
                              { key: 'hosting', label: 'Hosting', color: 'bg-blue-500' },
                              { key: 'database', label: 'Database', color: 'bg-purple-500' },
                              { key: 'storage', label: 'Storage', color: 'bg-yellow-500' },
                              { key: 'auth', label: 'Auth', color: 'bg-pink-500' },
                              { key: 'bandwidth', label: 'Bandwidth', color: 'bg-cyan-500' },
                            ] as { key: keyof CostBreakdown; label: string; color: string }[]
                          ).map(({ key, label, color }) => (
                            <div key={key} className="text-center">
                              <div className="text-white/40 mb-0.5">{label}</div>
                              <div className={`h-1 rounded-full mb-0.5 ${color} opacity-60`} />
                              <div className="text-white/60 font-mono">
                                {fmtLine(p.breakdown[key], annual).split(' ')[0]}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Assumptions Panel */}
            <div className="bg-[#161b22] rounded-xl border border-white/10 overflow-hidden">
              <button
                onClick={() => setAssumptionsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-white/60 hover:text-white/80 transition-colors"
              >
                <span className="font-medium">Assumptions &amp; Notes</span>
                {assumptionsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {assumptionsOpen && (
                <div className="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-white/50 border-t border-white/5 pt-3">
                  {[
                    '1 DB read ≈ 0.5 KB data transfer',
                    'Average session duration = 5 min',
                    'USD → INR rate = ₹84',
                    'Free tiers counted before billing',
                    'Firebase Firestore: $0.06/100K reads',
                    'Firebase Auth: free up to 50K MAU',
                    'Vercel Pro: $20/month base',
                    'PlanetScale Scaler: $39/month',
                    'Railway: $0.000463/vCPU-sec usage',
                    'AWS RDS t3.micro: ~$13/month',
                    'S3 storage: $0.023/GB/month',
                    'Supabase Pro: $25/month base',
                    'Annual billing includes 20% discount',
                    'Regional pricing varies ±25%',
                    'Auth addons billed per MAU over limit',
                    'Bandwidth rates after free tier apply',
                  ].map((note, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-white/20 mt-0.5">•</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CostEstimator;
