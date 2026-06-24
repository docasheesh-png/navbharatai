import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Users, Zap, IndianRupee, Activity, Shield, Settings, Server, Plus, Search, AlertTriangle, CheckCircle2, Megaphone, Tag, ToggleLeft, ToggleRight, Cpu, TrendingUp, Eye, UserCheck, Globe, Database } from 'lucide-react';
// @ts-ignore -- XSquare is a valid export in installed lucide-react 0.546.0
import { XSquare as BanIcon } from 'lucide-react';

interface AdminDashboardProps {
  adminToken: string;
  onLogout: () => void;
}

type TabId = 'overview' | 'users' | 'engines' | 'revenue' | 'security' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'overview',  label: 'Overview',    icon: Activity },
  { id: 'users',     label: 'Users',        icon: Users },
  { id: 'engines',   label: 'AI Engines',   icon: Cpu },
  { id: 'revenue',   label: 'Revenue',      icon: IndianRupee },
  { id: 'security',  label: 'Security',     icon: Shield },
  { id: 'settings',  label: 'Settings',     icon: Settings },
];

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

  // Announcement
  const [annMsg, setAnnMsg] = useState('');
  const [annTarget, setAnnTarget] = useState('all');

  // Token adjust
  const [tokenDelta, setTokenDelta] = useState('');
  const [tokenReason, setTokenReason] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  const headers = { 'x-admin-token': adminToken, 'Content-Type': 'application/json' };

  const toast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000); };

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
    try {
      const r = await fetch(`/api/admin/users?sort=${userSort}&search=${encodeURIComponent(userSearch)}`, { headers });
      const d = await r.json();
      setUsers(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
    finally { setUsersLoading(false); }
  }, [adminToken, userSort, userSearch]);

  const fetchPromos = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/promo', { headers });
      const d = await r.json();
      setPromos(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
  }, [adminToken]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);
  useEffect(() => { if (activeTab === 'users') fetchUsers(); }, [activeTab, fetchUsers]);
  useEffect(() => { if (activeTab === 'settings') fetchPromos(); }, [activeTab, fetchPromos]);

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

  const handleSettingsSave = async () => {
    const r = await adminPost('/api/admin/settings', { maintenanceMode, featureFlags, pricingConfig, providerEnabled });
    if (r.ok) toast('Settings saved!');
    else toast('Error saving settings');
  };

  const handleAnnouncement = async () => {
    if (!annMsg) return;
    const r = await adminPost('/api/admin/announcement', { message: annMsg, target: annTarget });
    if (r.ok) { toast('Announcement sent!'); setAnnMsg(''); }
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
          onClick={() => { sessionStorage.removeItem('admin_token'); onLogout(); }}
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
          <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-4" />
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
                        <tr><td colSpan={7} className="py-10 text-center"><RefreshCw className="w-5 h-5 animate-spin text-indigo-400 mx-auto" /></td></tr>
                      )}
                      {!usersLoading && users.length === 0 && (
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
            </div>
          )}

          {/* ── SECURITY TAB ── */}
          {activeTab === 'security' && (
            <div className="space-y-6">
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

              {/* Announcement */}
              <div className="bg-[#161b22] border border-white/10 rounded-[1.5rem] p-6 space-y-4">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-amber-400" /> Send Announcement
                </h3>
                <textarea value={annMsg} onChange={e => setAnnMsg(e.target.value)} placeholder="Type your announcement message..." rows={3}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-[#8b949e] outline-none focus:border-indigo-500 resize-none" />
                <div className="flex items-center gap-3">
                  <select value={annTarget} onChange={e => setAnnTarget(e.target.value)} className="bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500">
                    <option value="all">All Users</option>
                    <option value="pro">Pro Users</option>
                    <option value="free">Free Users</option>
                  </select>
                  <button onClick={handleAnnouncement} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 rounded-xl text-[11px] font-black uppercase tracking-wider text-black transition-all active:scale-95">
                    Send Announcement
                  </button>
                </div>
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
