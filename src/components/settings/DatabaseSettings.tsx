import { useState, useEffect } from 'react';
import { Database, ExternalLink, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { listSecrets, saveSecret, deleteSecret } from '../../lib/secretsApi';
import { SupabaseConnectCard } from './SupabaseConnectCard';

type DbProvider = 'supabase' | 'firebase' | 'mongodb' | 'neon' | 'appwrite' | 'other';

interface DbConfig {
  provider: DbProvider;
  platformName?: string;
  credentials: Record<string, string>;
}

const DB_PROVIDERS: {
  id: DbProvider;
  label: string;
  keyLink: string;
  // `where` is a short, per-field navigation hint (admin 2026-07-18): shown next to each input so the
  // user knows EXACTLY where in their provider's dashboard that specific value lives — not just one link
  // for the whole provider. Written from the real provider consoles.
  fields: { key: string; label: string; placeholder: string; where?: string }[];
}[] = [
  {
    id: 'supabase', label: 'Supabase',
    keyLink: 'https://supabase.com/dashboard/project/_/settings/api',
    fields: [
      { key: 'url',     label: 'Project URL', placeholder: 'https://xxxx.supabase.co', where: 'Project Settings → API → Project URL' },
      { key: 'anonKey', label: 'Anon Key',     placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…', where: 'Project Settings → API → Project API keys → anon / public' },
    ],
  },
  {
    id: 'firebase', label: 'Firebase',
    keyLink: 'https://console.firebase.google.com/',
    fields: [
      { key: 'apiKey',            label: 'API Key',             placeholder: 'AIzaSy…',                         where: 'Project Settings → General → Your apps → SDK setup and configuration → apiKey' },
      { key: 'authDomain',        label: 'Auth Domain',         placeholder: 'your-project.firebaseapp.com',    where: 'Project Settings → General → Your apps → authDomain' },
      { key: 'projectId',         label: 'Project ID',          placeholder: 'your-project-id',                 where: 'Project Settings → General → Project ID' },
      { key: 'storageBucket',     label: 'Storage Bucket',      placeholder: 'your-project.appspot.com',        where: 'Project Settings → General → Your apps → storageBucket' },
      { key: 'messagingSenderId', label: 'Messaging Sender ID', placeholder: '123456789',                       where: 'Project Settings → Cloud Messaging → Sender ID' },
      { key: 'appId',             label: 'App ID',              placeholder: '1:123:web:abc',                   where: 'Project Settings → General → Your apps → appId' },
    ],
  },
  {
    id: 'mongodb', label: 'MongoDB Atlas',
    keyLink: 'https://cloud.mongodb.com/',
    fields: [
      { key: 'uri', label: 'Connection URI', placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net/mydb', where: 'Atlas → Database → Connect → Drivers → copy the SRV string (replace <password> with your DB user password)' },
    ],
  },
  {
    id: 'neon', label: 'Neon (Postgres)',
    keyLink: 'https://console.neon.tech/',
    fields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'postgresql://user:pass@ep-xxx.neon.tech/neondb', where: 'Neon Console → your project → Dashboard → Connection Details → Connection string (Pooled)' },
    ],
  },
  {
    id: 'appwrite', label: 'Appwrite',
    keyLink: 'https://cloud.appwrite.io/',
    fields: [
      { key: 'endpoint',  label: 'API Endpoint', placeholder: 'https://cloud.appwrite.io/v1', where: 'Appwrite Console → your project → Settings → API Endpoint (Cloud users: https://cloud.appwrite.io/v1)' },
      { key: 'projectId', label: 'Project ID',   placeholder: 'your-project-id',            where: 'Appwrite Console → your project → Settings → Project ID' },
    ],
  },
  {
    id: 'other', label: 'Other',
    keyLink: '',
    fields: [
      { key: 'platformName',     label: 'Platform Name',               placeholder: 'e.g. PlanetScale, Turso…', where: 'The name of your database provider — used only as a label so v5.0 knows which SDK to wire' },
      { key: 'connectionString', label: 'Connection String / API Key',  placeholder: 'mysql://… or your API key', where: "Your provider's dashboard → Connect / Connection string (or API key)" },
    ],
  },
];

/**
 * Maps DbProvider credentials to their corresponding .env variable names.
 * These are the exact names that BackendScaffolder writes into the sandbox .env.
 */
function buildEnvKeys(provider: DbProvider, credentials: Record<string, string>): Record<string, string> {
  switch (provider) {
    case 'supabase':
      return {
        VITE_SUPABASE_URL: credentials.url ?? '',
        VITE_SUPABASE_ANON_KEY: credentials.anonKey ?? '',
      };
    case 'firebase':
      return {
        VITE_FIREBASE_API_KEY: credentials.apiKey ?? '',
        VITE_FIREBASE_AUTH_DOMAIN: credentials.authDomain ?? '',
        VITE_FIREBASE_PROJECT_ID: credentials.projectId ?? '',
        VITE_FIREBASE_STORAGE_BUCKET: credentials.storageBucket ?? '',
        VITE_FIREBASE_MESSAGING_SENDER_ID: credentials.messagingSenderId ?? '',
        VITE_FIREBASE_APP_ID: credentials.appId ?? '',
      };
    case 'mongodb':
      return { MONGODB_URI: credentials.uri ?? '' };
    case 'neon':
      return { DATABASE_URL: credentials.connectionString ?? '' };
    case 'appwrite':
      return {
        VITE_APPWRITE_ENDPOINT: credentials.endpoint ?? '',
        VITE_APPWRITE_PROJECT_ID: credentials.projectId ?? '',
      };
    case 'other': {
      const val = credentials.connectionString || '';
      return val ? { DATABASE_URL: val } : {};
    }
  }
}

interface DatabaseSettingsProps {
  userId: string;
  /**
   * The workspace the one-tap database should be given the schema of.
   *
   * Without it the provisioner's schema step is unreachable and every one-tap database is created
   * EMPTY — the app is wired to a real database in which none of its tables exist, so the first query
   * fails on a table that was never created. The card has always accepted this; the screen simply
   * never passed it (see SupabaseConnectCard).
   */
  workspaceId?: string;
}

// The ONLY thing kept in localStorage now (SECURITY): the chosen provider marker — never the
// real credential values (those live ONLY in the encrypted Secrets & Keys vault).
interface DbMarker { provider: DbProvider; platformName?: string }

function readMarker(userId: string): DbMarker | null {
  try {
    const stored = localStorage.getItem(`engineer_db_${userId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<DbConfig>;
    if (!parsed?.provider) return null;
    return { provider: parsed.provider, ...(parsed.platformName ? { platformName: parsed.platformName } : {}) };
  } catch { return null; }
}

export function DatabaseSettings({ userId, workspaceId }: DatabaseSettingsProps) {
  const [provider, setProvider] = useState<DbProvider>(() => readMarker(userId)?.provider ?? 'supabase');
  // Credential inputs are NEVER pre-filled from storage — real values live encrypted in Secrets & Keys.
  const [formCreds, setFormCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [activeMarker, setActiveMarker] = useState<DbMarker | null>(() => readMarker(userId));

  // SECURITY MIGRATION (A): if an older build left plaintext credentials in localStorage, purge them
  // now — keep only the provider marker. The real values already live encrypted in Secrets & Keys.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`engineer_db_${userId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DbConfig>;
      if (parsed && (parsed as any).credentials) {
        const marker: DbMarker = { provider: parsed.provider as DbProvider, ...(parsed.platformName ? { platformName: parsed.platformName } : {}) };
        localStorage.setItem(`engineer_db_${userId}`, JSON.stringify(marker));
      }
    } catch { /* best-effort cleanup */ }
  }, [userId]);

  const handleSave = async () => {
    const providerDef = DB_PROVIDERS.find(p => p.id === provider);
    if (!providerDef) return;

    // Only the fields the user actually filled THIS time. A blank field means "keep the existing
    // encrypted value" — we never overwrite a saved secret with an empty string.
    const enteredCreds: Record<string, string> = {};
    for (const field of providerDef.fields) {
      const v = (formCreds[field.key] ?? '').trim();
      if (v) enteredCreds[field.key] = v;
    }

    // SECURITY (A): persist ONLY the provider marker locally — never the credential values.
    const marker: DbMarker = { provider, ...(provider === 'other' && (formCreds.platformName ?? '').trim() ? { platformName: formCreds.platformName.trim() } : {}) };
    try { localStorage.setItem(`engineer_db_${userId}`, JSON.stringify(marker)); } catch {}
    setActiveMarker(marker);

    // Sync to the encrypted Secrets & Keys vault (upsert only the values the user entered + the
    // provider marker; blank fields are left untouched so nothing is accidentally wiped).
    setSaving(true);
    try {
      // All vault calls go through the authenticated client (attaches the Firebase token) — raw fetches
      // here previously omitted it, so requireUserMatch rejected the sync (401) and nothing saved.
      const existing = await listSecrets(userId);

      const envKeys = buildEnvKeys(provider, enteredCreds);
      const upserts: { name: string; value: string }[] = [{ name: 'ENGINEER_DB_PROVIDER', value: provider }];
      for (const [name, value] of Object.entries(envKeys)) if (value) upserts.push({ name, value });

      // Upsert each: delete any existing secret with that name, then write the new value.
      for (const u of upserts) {
        await Promise.all(
          existing.filter(s => s.secret_name === u.name).map(s => deleteSecret(userId, s.id))
        );
        await saveSecret(userId, u.name, u.value);
      }

      // Clear the sensitive inputs from memory once they are safely in the encrypted vault.
      setFormCreds({});
      setSavedMsg('Saved! Credentials are encrypted in Secrets & Keys — NavBharatAI Pro v5.0 uses them automatically when it builds your app.');
    } catch {
      setSavedMsg('Could not reach Secrets & Keys — check your connection and try again.');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(''), 6000);
    }
  };

  const currentDef = DB_PROVIDERS.find(p => p.id === provider);
  const hasSavedConfig = !!activeMarker && activeMarker.provider === provider;

  return (
    <div className="space-y-6">
      <div className="px-1 py-4">
        <h2 className="text-2xl font-black text-white tracking-tight">Database</h2>
        <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Connect your own database provider</p>
      </div>

      {/* ONE-TAP path (ROADMAP #1 Phase 1). Renders nothing when this deployment has no Supabase OAuth
          app configured, so the manual form below stays the whole screen rather than sitting under a
          button that cannot work. Users who already have a project keep using the form unchanged. */}
      <SupabaseConnectCard workspaceId={workspaceId} onProvisioned={() => setActiveMarker({ provider: 'supabase' })} />

      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600/10 rounded-2xl flex items-center justify-center shrink-0">
            <Database className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wider">Your Database</h3>
            <p className="text-[10px] text-[#8b949e] font-medium mt-0.5">
              Credentials are encrypted in Secrets &amp; Keys. NavBharatAI Pro v5.0 detects your connected database and wires that exact provider into your app&apos;s .env automatically — it never creates a new one, and NavBharatAI never uses your database for itself.
            </p>
          </div>
        </div>

        {/* Provider selector */}
        <div>
          <label className="text-[11px] text-[#8b949e] font-semibold block mb-2 uppercase tracking-wider">Provider</label>
          <select
            value={provider}
            onChange={e => { setProvider(e.target.value as DbProvider); setFormCreds({}); }}
            className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50"
          >
            {DB_PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Security note: fields start blank on purpose — saved values live encrypted, not in the browser. */}
        {hasSavedConfig && (
          <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/15">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#8b949e] leading-relaxed">
              This database is saved. For your security, values aren&apos;t shown here — leave a field <span className="text-white font-semibold">blank to keep its current value</span>, or type a new one to update it.
            </p>
          </div>
        )}

        {/* Per-provider credential fields */}
        <div className="space-y-4">
          {currentDef?.fields.map(field => (
            <div key={field.key}>
              <label className="text-[11px] text-[#8b949e] font-semibold block mb-2 uppercase tracking-wider">{field.label}</label>
              <input
                type={['key', 'secret', 'password', 'anonkey'].some(k => field.key.toLowerCase().includes(k)) ? 'password' : 'text'}
                value={formCreds[field.key] ?? ''}
                onChange={e => setFormCreds(prev => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                autoComplete="off"
                className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-[#484f58] focus:outline-none focus:border-indigo-500/50 font-mono"
              />
              {/* Per-field "where to find this" hint (admin 2026-07-18) — points at the exact spot in the
                  provider's own dashboard where THIS value lives. */}
              {field.where && (
                <p className="mt-1.5 text-[11px] text-[#6e7681] leading-relaxed flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-[#484f58]" />
                  <span>Where to find this: <span className="text-[#8b949e]">{field.where}</span></span>
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Direct link to provider's key page */}
        {currentDef?.keyLink && (
          <a
            href={currentDef.keyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Get {currentDef.label} API keys
          </a>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold rounded-2xl transition-colors"
        >
          {saving ? <TirangaLoader className="w-5 h-5" /> : <Database className="w-5 h-5" />}
          {saving ? 'Saving…' : 'Save & Sync to Secrets'}
        </button>

        {/* Feedback */}
        {savedMsg && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            <p className="text-sm text-green-300">{savedMsg}</p>
          </div>
        )}

        {/* Active config indicator */}
        {activeMarker && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/3 border border-white/5">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
            <p className="text-sm text-[#8b949e]">
              Active: <span className="text-white font-bold">{DB_PROVIDERS.find(p => p.id === activeMarker.provider)?.label ?? activeMarker.provider}</span>
            </p>
          </div>
        )}
      </div>

      {/* How it works info card */}
      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-6 space-y-3">
        <h4 className="text-sm font-black text-white uppercase tracking-wider">How it works</h4>
        <ol className="space-y-2 text-[12px] text-[#8b949e]">
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">1.</span>
            Select your database provider and paste your credentials.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">2.</span>
            Credentials are AES-encrypted and stored under <strong className="text-white">Secrets &amp; Keys</strong>.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">3.</span>
            When <strong className="text-white">NavBharatAI Pro v5.0</strong> builds your app, it detects this connected database, wires that exact provider&apos;s SDK, and injects your keys into <code className="text-indigo-300">.env</code> automatically — it never creates a new or different database.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">4.</span>
            NavBharatAI's own database is <strong className="text-white">never</strong> used for your apps — you own 100% of your data.
          </li>
        </ol>
      </div>
    </div>
  );
}
