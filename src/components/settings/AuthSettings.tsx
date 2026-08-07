import { useState, useEffect } from 'react';
import { Lock, ExternalLink, CheckCircle2, ShieldCheck, Database } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { listSecrets, saveSecret, deleteSecret } from '../../lib/secretsApi';

// Authentication settings (admin 2026-07-29) — connect a login/signup provider for the apps
// NavBharatAI Pro builds. Mirrors DatabaseSettings/StorageSettings: the chosen provider + credentials
// are AES-encrypted in the Secrets & API Keys vault (never in the browser), and the server's
// `userAuthContext` tells the builder to wire that exact provider for all auth. Clerk/Auth0 are
// dedicated auth providers; Supabase/Firebase auth also comes with the Database connection.

type AuthProvider = 'clerk' | 'auth0' | 'supabase' | 'firebase';

// The marker secret name — MUST match AUTH_PROVIDER_MARKER in src/server/AgentV3/userAuthContext.ts.
const AUTH_PROVIDER_MARKER = 'AUTH_PROVIDER';

interface AuthProviderDef {
  id: AuthProvider;
  label: string;
  keyLink: string;
  sharesWithDb?: boolean;
  fields: { key: string; label: string; placeholder: string; where?: string }[];
}

const AUTH_PROVIDERS: AuthProviderDef[] = [
  {
    id: 'clerk', label: 'Clerk',
    keyLink: 'https://dashboard.clerk.com/last-active?path=api-keys',
    fields: [
      { key: 'VITE_CLERK_PUBLISHABLE_KEY', label: 'Publishable Key', placeholder: 'pk_test_…', where: 'Clerk Dashboard → API Keys → Publishable key' },
      { key: 'CLERK_SECRET_KEY', label: 'Secret Key', placeholder: 'sk_test_…', where: 'Clerk Dashboard → API Keys → Secret key (server-side only)' },
    ],
  },
  {
    id: 'auth0', label: 'Auth0',
    keyLink: 'https://manage.auth0.com/#/applications',
    fields: [
      { key: 'VITE_AUTH0_DOMAIN', label: 'Domain', placeholder: 'your-tenant.us.auth0.com', where: 'Auth0 Dashboard → Applications → your app → Settings → Domain' },
      { key: 'VITE_AUTH0_CLIENT_ID', label: 'Client ID', placeholder: 'abcd1234…', where: 'Auth0 Dashboard → Applications → your app → Settings → Client ID' },
    ],
  },
  {
    id: 'supabase', label: 'Supabase Auth', sharesWithDb: true,
    keyLink: 'https://supabase.com/dashboard/project/_/settings/api',
    fields: [
      { key: 'VITE_SUPABASE_URL', label: 'Project URL', placeholder: 'https://xxxx.supabase.co', where: 'Project Settings → API → Project URL' },
      { key: 'VITE_SUPABASE_ANON_KEY', label: 'Anon Key', placeholder: 'eyJhbGci…', where: 'Project Settings → API → Project API keys → anon / public' },
    ],
  },
  {
    id: 'firebase', label: 'Firebase Auth', sharesWithDb: true,
    keyLink: 'https://console.firebase.google.com/',
    fields: [
      { key: 'VITE_FIREBASE_API_KEY', label: 'API Key', placeholder: 'AIzaSy…', where: 'Project Settings → General → Your apps → apiKey' },
      { key: 'VITE_FIREBASE_AUTH_DOMAIN', label: 'Auth Domain', placeholder: 'your-project.firebaseapp.com', where: 'Project Settings → General → Your apps → authDomain' },
      { key: 'VITE_FIREBASE_PROJECT_ID', label: 'Project ID', placeholder: 'your-project-id', where: 'Project Settings → General → Project ID' },
      { key: 'VITE_FIREBASE_APP_ID', label: 'App ID', placeholder: '1:123:web:abc', where: 'Project Settings → General → Your apps → appId' },
    ],
  },
];

interface AuthMarker { provider: AuthProvider }

function readMarker(userId: string): AuthMarker | null {
  try {
    const stored = localStorage.getItem(`nbai_auth_${userId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<AuthMarker>;
    if (!parsed?.provider) return null;
    return { provider: parsed.provider };
  } catch { return null; }
}

interface AuthSettingsProps {
  userId: string;
}

export function AuthSettings({ userId }: AuthSettingsProps) {
  const [provider, setProvider] = useState<AuthProvider>(() => readMarker(userId)?.provider ?? 'clerk');
  const [formCreds, setFormCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [activeMarker, setActiveMarker] = useState<AuthMarker | null>(() => readMarker(userId));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`nbai_auth_${userId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && (parsed as { credentials?: unknown }).credentials) {
        localStorage.setItem(`nbai_auth_${userId}`, JSON.stringify({ provider: parsed.provider }));
      }
    } catch { /* best-effort cleanup */ }
  }, [userId]);

  const handleSave = async () => {
    const providerDef = AUTH_PROVIDERS.find(p => p.id === provider);
    if (!providerDef) return;

    const enteredCreds: Record<string, string> = {};
    for (const field of providerDef.fields) {
      const v = (formCreds[field.key] ?? '').trim();
      if (v) enteredCreds[field.key] = v;
    }

    const marker: AuthMarker = { provider };
    try { localStorage.setItem(`nbai_auth_${userId}`, JSON.stringify(marker)); } catch {}
    setActiveMarker(marker);

    setSaving(true);
    try {
      const existing = await listSecrets(userId);

      const upserts: { name: string; value: string }[] = [{ name: AUTH_PROVIDER_MARKER, value: provider }];
      for (const [name, value] of Object.entries(enteredCreds)) if (value) upserts.push({ name, value });

      for (const u of upserts) {
        await Promise.all(
          existing.filter(s => s.secret_name === u.name).map(s => deleteSecret(userId, s.id)),
        );
        await saveSecret(userId, u.name, u.value);
      }

      setFormCreds({});
      setSavedMsg('Saved! Credentials are encrypted in Secrets & API Keys — NavBharatAI Pro wires this login provider into your app automatically when it builds.');
    } catch {
      setSavedMsg('Could not reach Secrets & API Keys — check your connection and try again.');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(''), 6000);
    }
  };

  const currentDef = AUTH_PROVIDERS.find(p => p.id === provider);
  const hasSavedConfig = !!activeMarker && activeMarker.provider === provider;

  return (
    <div className="space-y-6">
      <div className="px-1 py-4">
        <h2 className="text-2xl font-black text-white tracking-tight">Authentication</h2>
        <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Connect your login / signup provider</p>
      </div>

      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600/10 rounded-2xl flex items-center justify-center shrink-0">
            <Lock className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wider">Your Login</h3>
            <p className="text-[10px] text-[#8b949e] font-medium mt-0.5">
              For user login &amp; signup. Credentials are encrypted in Secrets &amp; Keys. NavBharatAI Pro detects your connected auth provider and wires its real SDK into your app&apos;s .env automatically — it never rolls its own password auth or asks you to set one up.
            </p>
          </div>
        </div>

        {/* Supabase/Firebase auth comes with the Database connection — say so, so the user doesn't
            double-configure. */}
        <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-white/3 border border-white/5">
          <Database className="w-4 h-4 text-[#8b949e] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            Already using <span className="text-white font-semibold">Firebase</span> or <span className="text-white font-semibold">Supabase</span> as your <span className="text-white font-semibold">Database</span>? Their login is included there — pick <span className="text-white font-semibold">Clerk</span> or <span className="text-white font-semibold">Auth0</span> here only if you want a dedicated auth provider instead.
          </p>
        </div>

        {/* Provider selector */}
        <div>
          <label className="text-[11px] text-[#8b949e] font-semibold block mb-2 uppercase tracking-wider">Provider</label>
          <select
            value={provider}
            onChange={e => { setProvider(e.target.value as AuthProvider); setFormCreds({}); }}
            className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50"
          >
            {AUTH_PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.label}{p.sharesWithDb ? ' (also in Database)' : ''}</option>
            ))}
          </select>
        </div>

        {hasSavedConfig && (
          <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/15">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#8b949e] leading-relaxed">
              This auth provider is saved. For your security, values aren&apos;t shown here — leave a field <span className="text-white font-semibold">blank to keep its current value</span>, or type a new one to update it.
            </p>
          </div>
        )}

        {/* Per-provider credential fields */}
        <div className="space-y-4">
          {currentDef?.fields.map(field => (
            <div key={field.key}>
              <label className="text-[11px] text-[#8b949e] font-semibold block mb-2 uppercase tracking-wider">{field.label}</label>
              <input
                type={['secret', 'key'].some(k => field.key.toLowerCase().includes(k)) && !field.key.toLowerCase().includes('publishable') ? 'password' : 'text'}
                value={formCreds[field.key] ?? ''}
                onChange={e => setFormCreds(prev => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                autoComplete="off"
                className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-[#484f58] focus:outline-none focus:border-indigo-500/50 font-mono"
              />
              {field.where && (
                <p className="mt-1.5 text-[11px] text-[#6e7681] leading-relaxed flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-[#484f58]" />
                  <span>Where to find this: <span className="text-[#8b949e]">{field.where}</span></span>
                </p>
              )}
            </div>
          ))}
        </div>

        {currentDef?.keyLink && (
          <a
            href={currentDef.keyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Get your {currentDef.label} keys
          </a>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold rounded-2xl transition-colors"
        >
          {saving ? <TirangaLoader className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          {saving ? 'Saving…' : 'Save & Sync to Secrets'}
        </button>

        {savedMsg && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            <p className="text-sm text-green-300">{savedMsg}</p>
          </div>
        )}

        {activeMarker && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/3 border border-white/5">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
            <p className="text-sm text-[#8b949e]">
              Active: <span className="text-white font-bold">{AUTH_PROVIDERS.find(p => p.id === activeMarker.provider)?.label ?? activeMarker.provider}</span>
            </p>
          </div>
        )}
      </div>

      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-6 space-y-3">
        <h4 className="text-sm font-black text-white uppercase tracking-wider">How it works</h4>
        <ol className="space-y-2 text-[12px] text-[#8b949e]">
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">1.</span>
            Select your auth provider and paste your keys.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">2.</span>
            Keys are AES-encrypted and stored under <strong className="text-white">Secrets &amp; Keys</strong>.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">3.</span>
            When <strong className="text-white">NavBharatAI Pro</strong> builds your app, it detects this connected provider and wires real login/signup/sessions with its SDK — no home-grown password auth.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">4.</span>
            Your users authenticate against <strong className="text-white">your own</strong> provider — you own your user accounts.
          </li>
        </ol>
      </div>
    </div>
  );
}

export default AuthSettings;
