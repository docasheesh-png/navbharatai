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
import { usePagedList } from '../../hooks/usePagedList';
import { LoadMore } from '../../components/common/LoadMore';
import { User, Wallet, Clock, CheckCircle2, Circle, AlertCircle, ChevronRight, Edit3, Save, X, CalendarDays, Zap, Activity, LogOut, AlertTriangle, Smartphone, ShieldCheck, Mail, Loader2, Gift, Copy, Globe, Share2 } from 'lucide-react';
import { Github } from '../ui/BrandIcons';
import { TirangaLoader } from '../ui/TirangaLoader';
import type { User as FirebaseUser } from 'firebase/auth';
import { PublishedAppsCard } from './PublishedAppsCard';
import { publishedAppRows, type PublishedAppRow } from '../../lib/publishedAppsView';
import { panelWidth, panelColumns, type DeviceMode } from '../../lib/panelWidth';
import { isApplePlatform } from '../../lib/storePurchase';
import { nativePlatformName } from '../../lib/mobileNative';
import { maskPhone } from '../../lib/phoneNumber';
import { VerifyPhoneSheet } from '../VerifyPhoneSheet';
import { ReferralEarningsSheet } from '../ReferralEarningsSheet';
import { useReferralProgress } from '../../hooks/useReferralProgress';
import { shareReferral } from '../../lib/shareReferral';
import { auth as firebaseAuth } from '../../lib/firebase';
import { sendVerificationEmail, linkGithubAccount, isGithubLinked, describeLinkGithubError } from '../../lib/accountVerificationActions';
import { consumeProfileFocus, scrollToProfileVerifications, PROFILE_FOCUS_EVENT, PROFILE_VERIFICATIONS_ID } from '../../lib/profileFocus';

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
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-success text-[10px] font-bold border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" /> Completed
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-danger text-[10px] font-bold border border-red-500/20">
        <Circle className="w-3 h-3" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-warn text-[10px] font-bold border border-amber-500/20">
      <AlertCircle className="w-3 h-3" /> Cancelled {progress > 0 ? `(${progress}%)` : ''}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProfilePage({ effectiveDeviceMode, user, onNavigateToBilling, onNavigateToSettings, onLogout }: ProfilePageProps) {
  /**
   * 🍎 The SAME predicate the purchase rail decides on (`isApplePlatform`), never a second rule —
   * two questions about one fact are how a surface drifts out of compliance while the other stays in.
   */
  const purchasesBlocked = isApplePlatform(nativePlatformName());
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
  // Verify-number sheet, opened from the Verifications card below. Reloads on success so the row
  // re-reads the auth record rather than showing a state this component invented.
  const [verifyOpen, setVerifyOpen] = useState(false);

  // Referral code + the "Earning" list of who has used it. `useReferralProgress` is the SAME source
  // ReferralPanel already reads (Billing → Refer a Friend) — Android-only by construction, so this
  // card is silent on the website exactly as the rest of the referral surface already is.
  const referral = useReferralProgress(user?.uid);
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  /** Only set when sharing genuinely could not happen — a dismissed sheet says nothing. */
  const [shareNote, setShareNote] = useState<string | null>(null);
  // ── Verifications card (admin 2026-09-16: "3 verification button add karo — email, phone, github,
  // jo referral system me use ho") ─────────────────────────────────────────────────────────────────
  // `emailVerified` / `providerData` live ON the Firebase `user` object; these two mirror them into
  // component state so a completed action re-renders this card without waiting for the PARENT to hand
  // down a new `user` object (which it may never do — `.reload()` and a link both mutate the SAME
  // Firebase User in place). Re-synced from `user` on every prop change via the effect below, so
  // switching accounts or a genuine parent refresh is never shadowed by a stale local copy.
  const [emailVerified, setEmailVerified] = useState(user?.emailVerified ?? false);
  const [githubLinked, setGithubLinked] = useState(isGithubLinked(user));
  useEffect(() => {
    setEmailVerified(user?.emailVerified ?? false);
    setGithubLinked(isGithubLinked(user));
  }, [user]);

  // "Complete →" from the rewards checklist lands HERE, on the Verifications card — on a fresh mount
  // (the one-shot flag) or while the page is already open (the event). See lib/profileFocus.ts.
  useEffect(() => {
    if (consumeProfileFocus()) scrollToProfileVerifications();
    const onFocus = () => { consumeProfileFocus(); scrollToProfileVerifications(); };
    window.addEventListener(PROFILE_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(PROFILE_FOCUS_EVENT, onFocus);
  }, []);

  // ── Published apps (admin 2026-09-17: "kitne app published huyi hai, woh bhi dikhe") ───────────
  // `null` is NOT an empty list: it means "not read yet". The card needs the difference, because
  // "you have published nothing" and "we could not read your apps" are opposite statements to make
  // to somebody about their own work.
  const [publishedApps, setPublishedApps] = useState<PublishedAppRow[] | null>(null);
  const [publishedMeta, setPublishedMeta] = useState<{ used: number; cap: number; planName: string | null } | null>(null);
  const [publishedError, setPublishedError] = useState('');

  const [verifyBusy, setVerifyBusy] = useState<'email' | 'github' | null>(null);
  const [verifyError, setVerifyError] = useState<{ which: 'email' | 'github'; text: string } | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const handleVerifyEmail = async () => {
    if (!user || !user.email) return;
    setVerifyBusy('email'); setVerifyError(null);
    try {
      await sendVerificationEmail(user);
      setEmailSent(true);
    } catch (e: any) {
      setVerifyError({ which: 'email', text: e?.message || 'Could not send the verification email. Please try again.' });
    } finally {
      setVerifyBusy(null);
    }
  };

  const refreshEmailStatus = async () => {
    if (!user) return;
    setVerifyBusy('email');
    try {
      await user.reload();
      setEmailVerified(user.emailVerified);
      // A newly verified email is a referral step that may now be paid — refreshing the progress is
      // what lets the automatic claim (useReferralProgress) pick it up without a second tap.
      if (user.emailVerified) { setEmailSent(false); referral.refresh(); }
    } finally {
      setVerifyBusy(null);
    }
  };

  const handleConnectGithub = async () => {
    setVerifyBusy('github'); setVerifyError(null);
    try {
      const outcome = await linkGithubAccount(firebaseAuth);
      if (outcome === 'ok') { setGithubLinked(true); referral.refresh(); }
      // 'cancelled' and 'redirecting' need no message — a closed popup is silent, and a redirect
      // navigates the page away (App.tsx's own getRedirectResult finishes it on return).
    } catch (e) {
      setVerifyError({ which: 'github', text: describeLinkGithubError(e) });
    } finally {
      setVerifyBusy(null);
    }
  };
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
  const pagedHistoryRecords = usePagedList(historyRecords);
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
      // The person's own published apps. Best-effort and separate, like the alerts above: this list
      // must never be able to stop the profile itself from rendering.
      //
      // 🔎 NO NEW ROUTE. `/api/agentv3/my-published-apps` already answers exactly this question for
      // the signed-in caller (it is what the Publish sheet's own list reads) and is scoped to the
      // verified uid on the server — so this screen can never see another account's apps, whatever
      // it asks for.
      try {
        const pr = await fetch('/api/agentv3/my-published-apps', { headers: { Authorization: `Bearer ${token}` } });
        if (pr.ok) {
          const pd = await pr.json();
          setPublishedApps(publishedAppRows(pd?.apps));
          setPublishedMeta({
            used: Number(pd?.used ?? 0),
            cap: Number(pd?.cap ?? 0),
            planName: typeof pd?.planName === 'string' ? pd.planName : null,
          });
          setPublishedError('');
        } else {
          setPublishedError('Your published apps could not be loaded just now.');
        }
      } catch {
        setPublishedError('Your published apps could not be loaded just now.');
      }
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
      <div className="flex-1 bg-surface flex items-center justify-center">
        <p className="text-muted text-sm">Sign in to view your profile.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface overflow-y-auto">
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
        <div className="bg-card border border-line rounded-3xl p-6 space-y-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-20 h-20 rounded-2xl object-cover border border-line" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <span className="text-3xl font-black text-accent-text">{displayName.charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-ink truncate">{displayName}</h1>
              <p className="text-xs text-muted mt-0.5">{user.email}</p>
              {/* Mobile status, at a glance next to the name — the ACTION button for it lives in the
                  Verifications card below, so there is exactly one "Verify" per step, not two doing
                  the same thing. `phoneNumber` is on the auth record only once a credential is really
                  linked, so its presence IS the verification; nothing here asks the server or can
                  disagree with it (admin 2026-08-22). */}
              {user.phoneNumber && (
                <p className="text-[11px] mt-1 flex items-center gap-1.5 text-success font-mono">
                  <Smartphone className="w-3 h-3" /> {maskPhone(user.phoneNumber)} · verified
                </p>
              )}
              <p className="text-[10px] text-faint mt-1 font-mono">Member since {memberSince}</p>
              {saveSuccess && (
                <span className="text-[10px] text-success font-bold mt-1 block">✓ Profile saved</span>
              )}
            </div>

            {!editing && (
              <button
                onClick={startEdit}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-raised hover:bg-raised-hover border border-line rounded-xl text-[11px] font-bold text-ink transition-all"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>

          {/* Edit Form */}
          {editing && (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Display Name</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  maxLength={80}
                  placeholder="Your name"
                  className="w-full bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Bio</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="A short description about yourself"
                  className="w-full bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-indigo-500/50 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Phone</label>
                  <input
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    maxLength={20}
                    placeholder="+91 XXXXX XXXXX"
                    className="w-full bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Photo URL</label>
                  <input
                    value={editPhotoUrl}
                    onChange={e => setEditPhotoUrl(e.target.value)}
                    placeholder="https://…"
                    className="w-full bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>
              {saveError && <p className="text-xs text-danger">{saveError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-xl text-xs font-black transition-all disabled:opacity-50"
                >
                  {saving ? <TirangaLoader className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  Save Changes
                </button>
                <button onClick={cancelEdit} className="flex items-center gap-1.5 px-4 py-2 bg-raised hover:bg-raised-hover text-muted rounded-xl text-xs font-bold transition-all">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* Bio display */}
          {!editing && profile?.bio && (
            <p className="text-sm text-muted border-t border-line pt-3">{profile.bio}</p>
          )}

          {/* Connected accounts */}
          <div className="flex items-center gap-3 border-t border-line pt-3">
            <span className="text-[10px] font-bold text-faint uppercase tracking-widest">Connected:</span>
            {user.providerData.map(p => (
              <span key={p.providerId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-raised text-[10px] font-bold text-muted border border-line">
                {p.providerId === 'google.com' ? '🔵 Google' : p.providerId === 'github.com' ? '⚫ GitHub' : p.providerId}
              </span>
            ))}
          </div>
        </div>

        {/* ── Refer and earn ──────────────────────────────────────────────────
            ADMIN 2026-09-17: the headline leads with what the user GETS ("refer and earn tokens
            worth ₹1,500"), not with the words "Your Referral Code". The amount is read from
            `capRupees` — the server's own `REFERRER_LIFETIME_CAP_TOKENS` — and never typed here, so
            an admin who retunes the cap cannot leave a stale number promising money on this screen. */}
        {referral.enabled && (
          <div className="bg-card border border-amber-500/20 rounded-3xl p-6 space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Gift className="w-4 h-4 text-warn shrink-0" />
                <h2 className="text-xs font-black text-ink uppercase tracking-widest">
                  Refer &amp; earn tokens worth ₹{referral.capRupees}
                </h2>
              </div>
              <button
                onClick={() => setEarningsOpen(true)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-600"
              >
                Earning
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-3.5">
              <span className="font-mono text-base font-black tracking-widest text-warn">{referral.code ?? '—'}</span>
              <button
                disabled={!referral.code}
                onClick={() => {
                  navigator.clipboard?.writeText(referral.shareMessage || referral.code || '');
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-raised px-4 py-2 text-[10px] font-black uppercase tracking-widest text-ink transition-all hover:bg-raised-hover disabled:opacity-40"
              >
                <Copy className="h-3 w-3" /> {codeCopied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {/* SHARE — the device's own sheet, so the code reaches WhatsApp / Instagram / anywhere
                the person already talks to their friends. Called straight from the click handler:
                browsers require a user gesture for `navigator.share`, and an `await` before it can
                spend that gesture. A device with no share sheet copies instead and says so, rather
                than being a button that does nothing. */}
            <button
              disabled={!referral.code}
              onClick={async () => {
                const outcome = await shareReferral(
                  referral.shareMessage || referral.code || '', undefined, navigator,
                );
                if (outcome === 'copied') { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); }
                if (outcome === 'failed') setShareNote('Could not open sharing on this device — use Copy instead.');
                // 'dismissed' says nothing at all: the user closed the sheet, which is a decision.
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-600 disabled:opacity-40"
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
            {shareNote && <p className="text-[11px] font-semibold text-warn">{shareNote}</p>}

            <p className="text-[11px] font-bold text-muted">
              Earned so far: <span className="text-success">₹{referral.earnedRupees}</span> of ₹{referral.capRupees}
              {referral.capReached && <span className="ml-1 text-warn">— you have reached the maximum.</span>}
            </p>
          </div>
        )}
        <ReferralEarningsSheet userId={user.uid} open={earningsOpen} onClose={() => setEarningsOpen(false)} />
        {/* ── Verifications (admin 2026-09-16) ────────────────────────────────
            One real button per step — click it, the verification actually starts, and a step already
            done shows as done. Verifying all three (plus applying a friend's referral code, in the
            Refer a Friend screen) is what the referral bonus is paid against. */}
        <div id={PROFILE_VERIFICATIONS_ID} className="bg-card border border-line rounded-3xl p-6 space-y-3 scroll-mt-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent-text" />
            <h2 className="text-xs font-black text-ink uppercase tracking-widest">Verifications</h2>
          </div>
          <p className="text-[11px] text-muted -mt-1">
            Verifying these keeps your account recoverable — and each one unlocks part of your referral bonus.
          </p>

          <div className="space-y-2 pt-1">
            {/* Email */}
            <div className="bg-surface rounded-2xl p-4 border border-line">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Mail className="w-4 h-4 text-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-ink">Email verification</p>
                    <p className="text-[10px] text-faint truncate">{user.email || 'No email on this account'}</p>
                  </div>
                </div>
                {emailVerified ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-success text-[10px] font-bold border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" /> Verified
                  </span>
                ) : user.email ? (
                  <button
                    onClick={emailSent ? refreshEmailStatus : handleVerifyEmail}
                    disabled={verifyBusy === 'email'}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-on-accent rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                  >
                    {verifyBusy === 'email' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {emailSent ? 'Refresh' : 'Verify'}
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] font-bold text-faint">Not available</span>
                )}
              </div>
              {emailSent && !emailVerified && (
                <p className="text-[10px] text-warn mt-2">
                  We sent a link to {user.email}. Open it, then press Refresh here.
                </p>
              )}
              {verifyError?.which === 'email' && (
                <p className="text-[10px] text-danger mt-2">{verifyError.text}</p>
              )}
            </div>

            {/* Phone */}
            <div className="bg-surface rounded-2xl p-4 border border-line flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone className="w-4 h-4 text-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-ink">Phone verification</p>
                  <p className="text-[10px] text-faint truncate">{user.phoneNumber ? maskPhone(user.phoneNumber) : 'Not linked yet'}</p>
                </div>
              </div>
              {user.phoneNumber ? (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-success text-[10px] font-bold border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" /> Verified
                </span>
              ) : (
                <button
                  onClick={() => setVerifyOpen(true)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                >
                  Verify
                </button>
              )}
            </div>

            {/* GitHub */}
            <div className="bg-surface rounded-2xl p-4 border border-line">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Github className="w-4 h-4 text-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-ink">GitHub verification</p>
                    <p className="text-[10px] text-faint truncate">Lets you import and deploy your own repos too</p>
                  </div>
                </div>
                {githubLinked ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-success text-[10px] font-bold border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </span>
                ) : (
                  <button
                    onClick={handleConnectGithub}
                    disabled={verifyBusy === 'github'}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-on-accent rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                  >
                    {verifyBusy === 'github' && <Loader2 className="w-3 h-3 animate-spin" />}
                    Connect
                  </button>
                )}
              </div>
              {verifyError?.which === 'github' && (
                <p className="text-[10px] text-danger mt-2">{verifyError.text}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Published Apps (admin 2026-09-17) ────────────────────────────────
            Above the wallet, because it is the only section on this page about something the person
            MADE. Each row opens in the real browser, never inside the app's own WebView. */}
        <div className="bg-card border border-line rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-success" />
            <h2 className="text-xs font-black text-ink uppercase tracking-widest">Your Published Apps</h2>
          </div>
          <PublishedAppsCard
            rows={publishedApps ?? []}
            loading={publishedApps === null && !publishedError}
            {...(publishedError ? { error: publishedError } : {})}
            {...(publishedMeta ? { used: publishedMeta.used, cap: publishedMeta.cap, planName: publishedMeta.planName } : {})}
            emptyText="You have not published any apps yet. Build one with NavBharatAI Pro and press Publish — it gets a permanent link you can share with anyone."
          />
        </div>

        {/* ── Wallet Summary ───────────────────────────────────────────────── */}
        <div className="bg-card border border-line rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-accent-text" />
              <h2 className="text-xs font-black text-ink uppercase tracking-widest">Wallet & Usage</h2>
            </div>
            <button onClick={onNavigateToBilling} className="flex items-center gap-1 text-[10px] font-bold text-accent-text hover:text-accent-text transition-colors">
              Manage Billing <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-faint text-xs">
              <TirangaLoader className="w-3.5 h-3.5" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-surface rounded-2xl p-4 border border-line space-y-1">
                <p className="text-[10px] font-bold text-faint uppercase tracking-widest">Balance</p>
                <p className="text-2xl font-black text-ink">₹{(wallet?.remainingBalance ?? 0).toFixed(2)}</p>
              </div>
              <div className="bg-surface rounded-2xl p-4 border border-line space-y-1">
                <p className="text-[10px] font-bold text-faint uppercase tracking-widest">This Month</p>
                <p className="text-2xl font-black text-warn">
                  {monthlySpend ? `₹${(monthlySpend.totalCostUsd * 84).toFixed(2)}` : '₹0.00'}
                </p>
                <p className="text-[10px] text-faint">{monthlySpend?.totalBuilds ?? 0} builds</p>
              </div>
              <div className="bg-surface rounded-2xl p-4 border border-line space-y-1 col-span-2 sm:col-span-1">
                <p className="text-[10px] font-bold text-faint uppercase tracking-widest">Monthly Budget</p>
                {!editBudget ? (
                  <>
                    <p className="text-2xl font-black text-ink">
                      {profile?.budgetLimitInr ? `₹${profile.budgetLimitInr}` : '—'}
                    </p>
                    <button onClick={() => { setEditBudget(true); setBudgetInput(String(profile?.budgetLimitInr ?? '')); }}
                      className="text-[10px] font-bold text-accent-text hover:text-accent-text">
                      {profile?.budgetLimitInr ? 'Change limit' : 'Set a limit'}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      placeholder="0 = no limit"
                      className="w-24 bg-card border border-line rounded-lg px-2 py-1 text-sm text-ink focus:outline-none focus:border-indigo-500"
                    />
                    <button onClick={saveBudget} disabled={savingBudget}
                      className="px-2 py-1 bg-indigo-600 text-on-accent rounded-lg text-[10px] font-bold disabled:opacity-50">
                      {savingBudget ? '…' : 'OK'}
                    </button>
                    <button onClick={() => setEditBudget(false)}
                      className="px-2 py-1 bg-raised text-muted rounded-lg text-[10px] font-bold">
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
                  <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${a.severity === 'critical' ? 'text-danger' : 'text-warn'}`} />
                  <div>
                    <p className={`text-xs font-black ${a.severity === 'critical' ? 'text-danger' : 'text-warn'}`}>{a.title}</p>
                    <p className="text-[11px] text-muted mt-0.5">{a.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Build History ────────────────────────────────────────────────── */}
        <div className="bg-card border border-line rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent-text" />
            <h2 className="text-xs font-black text-ink uppercase tracking-widest">Build History</h2>
          </div>

          {/* Period tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['week', 'month', 'custom'] as PeriodTab[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${period === p ? 'bg-indigo-600 border-indigo-500 text-on-accent' : 'bg-surface border-line text-muted hover:border-line'}`}
              >
                {periodLabel(p)}
              </button>
            ))}
          </div>

          {/* Custom date range */}
          {period === 'custom' && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-faint uppercase tracking-widest">From</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="bg-surface border border-line rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-faint uppercase tracking-widest">To</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="bg-surface border border-line rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-indigo-500/50" />
              </div>
              <button onClick={() => fetchHistory('custom', customFrom, customTo)}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-xl text-xs font-bold transition-all">
                <CalendarDays className="w-3 h-3" /> Apply
              </button>
            </div>
          )}

          {/* Summary row */}
          {historySummary && historySummary.totalBuilds > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Total', value: historySummary.totalBuilds, color: 'text-ink' },
                { label: 'Completed', value: historySummary.completedBuilds, color: 'text-success' },
                { label: 'Failed', value: historySummary.failedBuilds, color: 'text-danger' },
                { label: 'Spent', value: `₹${historySummary.totalCostInr.toFixed(2)}`, color: 'text-warn' },
              ].map(s => (
                <div key={s.label} className="bg-surface rounded-xl p-3 border border-line text-center">
                  <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-faint font-bold uppercase tracking-widest">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* History table */}
          {historyLoading ? (
            <div className="flex items-center gap-2 text-faint text-xs py-4">
              <TirangaLoader className="w-3.5 h-3.5" /> Loading history…
            </div>
          ) : historyRecords.length === 0 ? (
            <div className="text-center py-8 text-faint text-sm">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No builds found for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr>
                    {['Build', 'Date', 'Duration', 'Files', 'Cost', 'Status'].map(h => (
                      <th key={h} className="text-left text-[10px] font-black text-faint uppercase tracking-widest pb-2 px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedHistoryRecords.visible.map(r => (
                    <tr key={r.id} className="group">
                      <td className="bg-surface rounded-l-xl px-3 py-3 text-ink font-medium max-w-[180px]">
                        <span className="truncate block">{r.title || 'Untitled build'}</span>
                      </td>
                      <td className="bg-surface px-3 py-3 text-muted text-xs whitespace-nowrap">
                        {formatDate(r.createdAt)}
                      </td>
                      <td className="bg-surface px-3 py-3 text-muted text-xs whitespace-nowrap">
                        {r.durationMs > 0 ? formatDuration(r.durationMs) : '—'}
                      </td>
                      <td className="bg-surface px-3 py-3 text-muted text-xs">
                        {r.fileCount > 0 ? r.fileCount : '—'}
                      </td>
                      <td className="bg-surface px-3 py-3 font-mono text-xs whitespace-nowrap">
                        {r.costInr > 0
                          ? <span className="text-ink">₹{r.costInr.toFixed(2)}</span>
                          : <span className="text-success font-bold">Free</span>}
                      </td>
                      <td className="bg-surface rounded-r-xl px-3 py-3">
                        <StatusBadge status={r.status} progress={r.progressPercent} />
                      </td>
                    </tr>
                  ))}
                  <LoadMore list={pagedHistoryRecords} label="entries" colSpan={2} />
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Quick Links ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onNavigateToBilling}
            className="flex items-center gap-3 bg-card border border-line rounded-2xl p-4 hover:border-indigo-500/30 transition-all group"
          >
            <Zap className="w-5 h-5 text-warn" />
            {/*
              🍎 The label names UPI / Card — an OUTSIDE payment method — and on iOS that is exactly
              what Apple's anti-steering rule forbids an app from pointing at. The button itself is
              safe (it only opens Wallet & Billing, which states honestly that top-up is unavailable
              there), so only the promise is changed: the screen it opens is still worth reaching for
              the balance and the history.
            */}
            <div className="text-left">
              <p className="text-sm font-black text-ink">{purchasesBlocked ? 'Wallet' : 'Add Balance'}</p>
              <p className="text-[10px] text-faint">{purchasesBlocked ? 'Balance and history' : 'Recharge via UPI / Card'}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-faint ml-auto group-hover:text-accent-text transition-colors" />
          </button>
          <button
            onClick={onNavigateToSettings}
            className="flex items-center gap-3 bg-card border border-line rounded-2xl p-4 hover:border-indigo-500/30 transition-all group"
          >
            <User className="w-5 h-5 text-accent-text" />
            <div className="text-left">
              <p className="text-sm font-black text-ink">App Settings</p>
              <p className="text-[10px] text-faint">Keys, database, deploy</p>
            </div>
            <ChevronRight className="w-4 h-4 text-faint ml-auto group-hover:text-accent-text transition-colors" />
          </button>
        </div>

        {/* API keys MOVED to Home → Developer Tools (admin 2026-09-17) — a developer's tool does not
            belong at the bottom of the page a non-technical user meets first. Not copied: one door. */}

        {/* ── Logout ───────────────────────────────────────────────────────── */}
        <div className="border-t border-line pt-4">
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-faint hover:text-danger transition-colors text-sm font-bold"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>

      </div>
    </div>
  );
}
