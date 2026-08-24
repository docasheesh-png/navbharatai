/**
 * My Profile — full-page view.
 *
 * Sections:
 *   1. Profile card   — avatar, name, email, member-since, edit
 *   2. Wallet summary — balance, monthly spend, budget limit (links to Billing)
 *   3. Build history  — This Week | This Month | Custom date range
 *   4. Personal info  — editable display name, bio, phone
 *   5. Connected accounts — Google / GitHub status
 */
import { useEffect, useState, useCallback } from 'react';
import { User, Wallet, Clock, CheckCircle2, Circle, AlertCircle, ChevronRight, Edit3, Save, X, CalendarDays, Zap, Activity, LogOut, AlertTriangle, Smartphone } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import type { User as FirebaseUser } from 'firebase/auth';
import { ApiKeysCard } from './ApiKeysCard';
import { panelWidth, panelColumns, type DeviceMode } from '../../lib/panelWidth';
import { maskPhone } from '../../lib/phoneNumber';
import { VerifyPhoneSheet } from '../VerifyPhoneSheet';
import { auth as firebaseAuth } from '../../lib/firebase';

// ── Types mirroring server responses ──────────────────────────────────────────

interface ProfileData {
  userId: string;
  displayName: string;
  bio: string;
  phone: string;
  photoUrl: string;
  budgetLimitInr: number;
  updatedAt: number;
  createdAt: number;
}

interface WalletData {
  remainingBalance: number;
  totalBalance: number;
  tokenBalance: number;
  lastRechargeAt: string | null;
}

interface MonthlySpend {
  month: string;
  totalBuilds: number;
  totalCostUsd: number;
  updatedAt: number;
}

interface BuildRecord {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  costInr: number;
  status: 'completed' | 'failed' | 'cancelled';
  progressPercent: number;
  tier: string;
  fileCount: number;
}

interface HistorySummary {
  totalBuilds: number;
  completedBuilds: number;
  failedBuilds: number;
  cancelledBuilds: number;
  totalCostInr: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ProfilePageProps {
  /** The app's ALREADY-RESOLVED device mode. Required so this page can never again hand a desktop
   *  screen a phone-width column (admin report 2026-08-19). See src/lib/panelWidth.ts. */
  effectiveDeviceMode: DeviceMode;
  user: FirebaseUser | null;
  onNavigateToBilling: () => void;
  onClose?: () => void;
  /** Called when the user clicks "Settings" shortcut. */
  onNavigateToSettings: () => void;
  onLogout: () => void;
}

type PeriodTab = 'week' | 'month' | 'custom';

function periodLabel(p: PeriodTab) {
  if (p === 'week') return 'This Week';
  if (p === 'month') return 'This Month';
  return 'Custom Range';
}

function formatDate(ts: number) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
}

function formatDuration(ms: number) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function StatusBadge({ status, progress }: { status: BuildRecord['status']; progress: number }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" /> Completed
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold border border-red-500/20">
        <Circle className="w-3 h-3" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold border border-amber-500/20">
      <AlertCircle className="w-3 h-3" /> Cancelled {progress > 0 ? `(${progress}%)` : ''}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfilePage({ effectiveDeviceMode, user, onNavigateToBilling, onNavigateToSettings, onLogout }: ProfilePageProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpend | null>(null);
  // U-5 — real cost alerts (spend vs budget) from /api/profile/cost-alerts.
  interface CostAlertReport {
    budgetSet: boolean; budgetInr: number; spendInr: number; remainingInr: number; usedPct: number;
    alerts: Array<{ id: string; severity: 'warning' | 'critical'; title: string; detail: string }>;
  }
  const [costAlerts, setCostAlerts] = useState<CostAlertReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  // Verify-number sheet, opened from the mobile row above. Reloads on success so the row re-reads the
  // auth record rather than showing a state this component invented.
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [saving, setSaving] = useState(false);

  // Budget
  const [editBudget, setEditBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  // History
  const [period, setPeriod] = useState<PeriodTab>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyRecords, setHistoryRecords] = useState<BuildRecord[]>([]);
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const idToken = useCallback(async () => {
    if (!user) return null;
    try { return await user.getIdToken(); } catch { return null; }
  }, [user]);

  const fetchProfile = useCallback(async () => {
    const token = await idToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load profile');
      const data = await res.json();
      setProfile(data.profile);
      setWallet(data.wallet);
      setMonthlySpend(data.monthlyAiSpend);
      // U-5 — cost alerts (spend vs budget); best-effort, never blocks the profile.
      try {
        const ar = await fetch('/api/profile/cost-alerts', { headers: { Authorization: `Bearer ${token}` } });
        if (ar.ok) setCostAlerts(await ar.json());
      } catch { /* non-fatal — banner simply doesn't render */ }
    } catch { /* best-effort */ } finally {
      setLoading(false);
    }
  }, [idToken]);

  const fetchHistory = useCallback(async (p: PeriodTab, from?: string, to?: string) => {
    const token = await idToken();
    if (!token) return;
    setHistoryLoading(true);
    try {
      let url = `/api/profile/history?period=${p}`;
      if (p === 'custom' && from && to) {
        url += `&from=${new Date(from).getTime()}&to=${new Date(to).getTime() + 86399999}`;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHistoryRecords(data.records ?? []);
      setHistorySummary(data.summary ?? null);
    } catch { /* best-effort */ } finally {
      setHistoryLoading(false);
    }
  }, [idToken]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);
  useEffect(() => { fetchHistory(period); }, [period, fetchHistory]);

  const startEdit = () => {
    setEditName(profile?.displayName ?? user?.displayName ?? '');
    setEditBio(profile?.bio ?? '');
    setEditPhone(profile?.phone ?? '');
    setEditPhotoUrl(profile?.photoUrl ?? user?.photoURL ?? '');
    setEditing(true);
    setSaveError('');
    setSaveSuccess(false);
  };

  const cancelEdit = () => setEditing(false);

  const saveProfile = async () => {
    const token = await idToken();
    if (!token) return;
    setSaving(true); setSaveError(''); setSaveSuccess(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: editName, bio: editBio, phone: editPhone, photoUrl: editPhotoUrl }),
      });
      if (!res.ok) throw new Error('Save failed');
      await fetchProfile();
      setEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveBudget = async () => {
    const token = await idToken();
    if (!token) return;
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) { setSaveError('Enter a valid amount (0 to remove the limit).'); return; }
    setSavingBudget(true);
    try {
      await fetch('/api/profile/budget', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetLimitInr: val }),
      });
      await fetchProfile();
      setEditBudget(false);
    } catch { /* best-effort */ } finally {
      setSavingBudget(false);
    }
  };

  const avatarUrl = profile?.photoUrl || user?.photoURL || '';
  const displayName = profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User';
  const memberSince = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : 'Unknown';

  if (!user) {
    return (
      <div className="flex-1 bg-[#0d1117] flex items-center justify-center">
        <p className="text-[#8b949e] text-sm">Sign in to view your profile.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#0d1117] overflow-y-auto">
      {/* It portals to document.body, so where it sits in this tree does not matter — what matters is
          that it is OUTSIDE the conditional early-returns above, or a signed-out render would unmount
          a sheet mid-verification. */}
      <VerifyPhoneSheet
        auth={firebaseAuth}
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        reason="A verified number keeps your account yours, and it is what lets you import a project from GitHub or a .zip."
        onVerified={() => window.location.reload()}
        onSignInInstead={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { signIn: 'phone' } }))}
      />
      {/* Width follows the app's View Mode, from the one shared rule — this page used to carry its
          own hard-coded max-w-3xl, which is how a 1920px screen ended up showing a narrow column with
          empty space beside it. The cards flow into two columns on a desktop so the room is actually
          used, instead of each row being stretched across the screen. */}
      <div className={`${panelWidth(effectiveDeviceMode)} mx-auto px-4 py-8 ${effectiveDeviceMode === 'desktop' ? panelColumns(effectiveDeviceMode) : 'space-y-6'}`}>

        {/* ── Profile Card ─────────────────────────────────────────────────── */}
        <div className="bg-[#161b22] border border-white/5 rounded-3xl p-6 space-y-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-20 h-20 rounded-2xl object-cover border border-white/10" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <span className="text-3xl font-black text-indigo-400">{displayName.charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-white truncate">{displayName}</h1>
              <p className="text-xs text-[#8b949e] mt-0.5">{user.email}</p>
              {/* MOBILE VERIFICATION (admin 2026-08-22). Shown here because otherwise the ONLY way to
                  verify would be to attempt an import and be refused — a feature you can only reach by
                  first failing at something else is not finished. `phoneNumber` is on the auth record
                  only once a phone credential is really linked, so its presence IS the verification;
                  nothing here asks the server or can disagree with it. */}
              <p className="text-[11px] mt-1 flex items-center gap-1.5">
                <Smartphone className="w-3 h-3 text-[#484f58]" />
                {user.phoneNumber ? (
                  <span className="text-emerald-400 font-mono">{maskPhone(user.phoneNumber)} · verified</span>
                ) : (
                  <>
                    <span className="text-[#8b949e]">Mobile not verified</span>
                    <button
                      onClick={() => setVerifyOpen(true)}
                      className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
                    >
                      Verify
                    </button>
                  </>
                )}
              </p>
              <p className="text-[10px] text-[#484f58] mt-1 font-mono">Member since {memberSince}</p>
              {saveSuccess && (
                <span className="text-[10px] text-emerald-400 font-bold mt-1 block">✓ Profile saved</span>
              )}
            </div>

            {!editing && (
              <button
                onClick={startEdit}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-[11px] font-bold text-white transition-all"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>

          {/* Edit Form */}
          {editing && (
            <div className="space-y-3 border-t border-white/5 pt-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Display Name</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  maxLength={80}
                  placeholder="Your name"
                  className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Bio</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="A short description about yourself"
                  className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Phone</label>
                  <input
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    maxLength={20}
                    placeholder="+91 XXXXX XXXXX"
                    className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Photo URL</label>
                  <input
                    value={editPhotoUrl}
                    onChange={e => setEditPhotoUrl(e.target.value)}
                    placeholder="https://…"
                    className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#484f58] focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all disabled:opacity-50"
                >
                  {saving ? <TirangaLoader className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  Save Changes
                </button>
                <button onClick={cancelEdit} className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/8 text-[#8b949e] rounded-xl text-xs font-bold transition-all">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* Bio display */}
          {!editing && profile?.bio && (
            <p className="text-sm text-[#8b949e] border-t border-white/5 pt-3">{profile.bio}</p>
          )}

          {/* Connected accounts */}
          <div className="flex items-center gap-3 border-t border-white/5 pt-3">
            <span className="text-[10px] font-bold text-[#484f58] uppercase tracking-widest">Connected:</span>
            {user.providerData.map(p => (
              <span key={p.providerId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-[10px] font-bold text-[#8b949e] border border-white/10">
                {p.providerId === 'google.com' ? '🔵 Google' : p.providerId === 'github.com' ? '⚫ GitHub' : p.providerId}
              </span>
            ))}
          </div>
        </div>

        {/* ── Wallet Summary ───────────────────────────────────────────────── */}
        <div className="bg-[#161b22] border border-white/5 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-indigo-400" />
              <h2 className="text-xs font-black text-white uppercase tracking-widest">Wallet & Usage</h2>
            </div>
            <button onClick={onNavigateToBilling} className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors">
              Manage Billing <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-[#484f58] text-xs">
              <TirangaLoader className="w-3.5 h-3.5" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-[#0d1117] rounded-2xl p-4 border border-white/5 space-y-1">
                <p className="text-[10px] font-bold text-[#484f58] uppercase tracking-widest">Balance</p>
                <p className="text-2xl font-black text-white">₹{(wallet?.remainingBalance ?? 0).toFixed(2)}</p>
              </div>
              <div className="bg-[#0d1117] rounded-2xl p-4 border border-white/5 space-y-1">
                <p className="text-[10px] font-bold text-[#484f58] uppercase tracking-widest">This Month</p>
                <p className="text-2xl font-black text-amber-400">
                  {monthlySpend ? `₹${(monthlySpend.totalCostUsd * 84).toFixed(2)}` : '₹0.00'}
                </p>
                <p className="text-[10px] text-[#484f58]">{monthlySpend?.totalBuilds ?? 0} builds</p>
              </div>
              <div className="bg-[#0d1117] rounded-2xl p-4 border border-white/5 space-y-1 col-span-2 sm:col-span-1">
                <p className="text-[10px] font-bold text-[#484f58] uppercase tracking-widest">Monthly Budget</p>
                {!editBudget ? (
                  <>
                    <p className="text-2xl font-black text-white">
                      {profile?.budgetLimitInr ? `₹${profile.budgetLimitInr}` : '—'}
                    </p>
                    <button onClick={() => { setEditBudget(true); setBudgetInput(String(profile?.budgetLimitInr ?? '')); }}
                      className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300">
                      {profile?.budgetLimitInr ? 'Change limit' : 'Set a limit'}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      placeholder="0 = no limit"
                      className="w-24 bg-[#161b22] border border-white/20 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <button onClick={saveBudget} disabled={savingBudget}
                      className="px-2 py-1 bg-indigo-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-50">
                      {savingBudget ? '…' : 'OK'}
                    </button>
                    <button onClick={() => setEditBudget(false)}
                      className="px-2 py-1 bg-white/5 text-[#8b949e] rounded-lg text-[10px] font-bold">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── U-5 Cost alerts (real spend vs budget) ─────────────────────── */}
          {costAlerts && costAlerts.alerts.length > 0 && (
            <div className="mt-3 space-y-2">
              {costAlerts.alerts.map(a => (
                <div key={a.id}
                  className={`rounded-2xl p-3 border flex items-start gap-3 ${
                    a.severity === 'critical'
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-amber-500/10 border-amber-500/30'}`}>
                  <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div>
                    <p className={`text-xs font-black ${a.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>{a.title}</p>
                    <p className="text-[11px] text-[#8b949e] mt-0.5">{a.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Build History ────────────────────────────────────────────────── */}
        <div className="bg-[#161b22] border border-white/5 rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <h2 className="text-xs font-black text-white uppercase tracking-widest">Build History</h2>
          </div>

          {/* Period tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['week', 'month', 'custom'] as PeriodTab[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${period === p ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-[#0d1117] border-white/5 text-[#8b949e] hover:border-white/20'}`}
              >
                {periodLabel(p)}
              </button>
            ))}
          </div>

          {/* Custom date range */}
          {period === 'custom' && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-[#484f58] uppercase tracking-widest">From</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-[#484f58] uppercase tracking-widest">To</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <button onClick={() => fetchHistory('custom', customFrom, customTo)}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all">
                <CalendarDays className="w-3 h-3" /> Apply
              </button>
            </div>
          )}

          {/* Summary row */}
          {historySummary && historySummary.totalBuilds > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Total', value: historySummary.totalBuilds, color: 'text-white' },
                { label: 'Completed', value: historySummary.completedBuilds, color: 'text-emerald-400' },
                { label: 'Failed', value: historySummary.failedBuilds, color: 'text-red-400' },
                { label: 'Spent', value: `₹${historySummary.totalCostInr.toFixed(2)}`, color: 'text-amber-400' },
              ].map(s => (
                <div key={s.label} className="bg-[#0d1117] rounded-xl p-3 border border-white/5 text-center">
                  <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-[#484f58] font-bold uppercase tracking-widest">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* History table */}
          {historyLoading ? (
            <div className="flex items-center gap-2 text-[#484f58] text-xs py-4">
              <TirangaLoader className="w-3.5 h-3.5" /> Loading history…
            </div>
          ) : historyRecords.length === 0 ? (
            <div className="text-center py-8 text-[#484f58] text-sm">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No builds found for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr>
                    {['Build', 'Date', 'Duration', 'Files', 'Cost', 'Status'].map(h => (
                      <th key={h} className="text-left text-[10px] font-black text-[#484f58] uppercase tracking-widest pb-2 px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyRecords.map(r => (
                    <tr key={r.id} className="group">
                      <td className="bg-[#0d1117] rounded-l-xl px-3 py-3 text-white font-medium max-w-[180px]">
                        <span className="truncate block">{r.title || 'Untitled build'}</span>
                      </td>
                      <td className="bg-[#0d1117] px-3 py-3 text-[#8b949e] text-xs whitespace-nowrap">
                        {formatDate(r.createdAt)}
                      </td>
                      <td className="bg-[#0d1117] px-3 py-3 text-[#8b949e] text-xs whitespace-nowrap">
                        {r.durationMs > 0 ? formatDuration(r.durationMs) : '—'}
                      </td>
                      <td className="bg-[#0d1117] px-3 py-3 text-[#8b949e] text-xs">
                        {r.fileCount > 0 ? r.fileCount : '—'}
                      </td>
                      <td className="bg-[#0d1117] px-3 py-3 font-mono text-xs whitespace-nowrap">
                        {r.costInr > 0
                          ? <span className="text-white">₹{r.costInr.toFixed(2)}</span>
                          : <span className="text-emerald-400 font-bold">Free</span>}
                      </td>
                      <td className="bg-[#0d1117] rounded-r-xl px-3 py-3">
                        <StatusBadge status={r.status} progress={r.progressPercent} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Quick Links ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onNavigateToBilling}
            className="flex items-center gap-3 bg-[#161b22] border border-white/5 rounded-2xl p-4 hover:border-indigo-500/30 transition-all group"
          >
            <Zap className="w-5 h-5 text-orange-400" />
            <div className="text-left">
              <p className="text-sm font-black text-white">Add Balance</p>
              <p className="text-[10px] text-[#484f58]">Recharge via UPI / Card</p>
            </div>
            <ChevronRight className="w-4 h-4 text-[#484f58] ml-auto group-hover:text-indigo-400 transition-colors" />
          </button>
          <button
            onClick={onNavigateToSettings}
            className="flex items-center gap-3 bg-[#161b22] border border-white/5 rounded-2xl p-4 hover:border-indigo-500/30 transition-all group"
          >
            <User className="w-5 h-5 text-indigo-400" />
            <div className="text-left">
              <p className="text-sm font-black text-white">App Settings</p>
              <p className="text-[10px] text-[#484f58]">Keys, database, deploy</p>
            </div>
            <ChevronRight className="w-4 h-4 text-[#484f58] ml-auto group-hover:text-indigo-400 transition-colors" />
          </button>
        </div>

        {/* ── API Keys (U-7) ───────────────────────────────────────────────── */}
        <ApiKeysCard getToken={idToken} />

        {/* ── Logout ───────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 pt-4">
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-[#484f58] hover:text-red-400 transition-colors text-sm font-bold"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>

      </div>
    </div>
  );
}
