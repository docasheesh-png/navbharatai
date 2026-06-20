import { useState } from 'react';
import { Database, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';

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
  fields: { key: string; label: string; placeholder: string }[];
}[] = [
  {
    id: 'supabase', label: 'Supabase',
    keyLink: 'https://supabase.com/dashboard/project/_/settings/api',
    fields: [
      { key: 'url',     label: 'Project URL', placeholder: 'https://xxxx.supabase.co' },
      { key: 'anonKey', label: 'Anon Key',     placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…' },
    ],
  },
  {
    id: 'firebase', label: 'Firebase',
    keyLink: 'https://console.firebase.google.com/',
    fields: [
      { key: 'apiKey',            label: 'API Key',             placeholder: 'AIzaSy…' },
      { key: 'authDomain',        label: 'Auth Domain',         placeholder: 'your-project.firebaseapp.com' },
      { key: 'projectId',         label: 'Project ID',          placeholder: 'your-project-id' },
      { key: 'storageBucket',     label: 'Storage Bucket',      placeholder: 'your-project.appspot.com' },
      { key: 'messagingSenderId', label: 'Messaging Sender ID', placeholder: '123456789' },
      { key: 'appId',             label: 'App ID',              placeholder: '1:123:web:abc' },
    ],
  },
  {
    id: 'mongodb', label: 'MongoDB Atlas',
    keyLink: 'https://cloud.mongodb.com/',
    fields: [
      { key: 'uri', label: 'Connection URI', placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net/mydb' },
    ],
  },
  {
    id: 'neon', label: 'Neon (Postgres)',
    keyLink: 'https://console.neon.tech/',
    fields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'postgresql://user:pass@ep-xxx.neon.tech/neondb' },
    ],
  },
  {
    id: 'appwrite', label: 'Appwrite',
    keyLink: 'https://cloud.appwrite.io/',
    fields: [
      { key: 'endpoint',  label: 'API Endpoint', placeholder: 'https://cloud.appwrite.io/v1' },
      { key: 'projectId', label: 'Project ID',   placeholder: 'your-project-id' },
    ],
  },
  {
    id: 'other', label: 'Other',
    keyLink: '',
    fields: [
      { key: 'platformName',     label: 'Platform Name',               placeholder: 'e.g. PlanetScale, Turso…' },
      { key: 'connectionString', label: 'Connection String / API Key',  placeholder: 'mysql://… or your API key' },
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
}

export function DatabaseSettings({ userId }: DatabaseSettingsProps) {
  const [provider, setProvider] = useState<DbProvider>(() => {
    try {
      const stored = localStorage.getItem(`engineer_db_${userId}`);
      if (stored) return (JSON.parse(stored) as DbConfig).provider;
    } catch {}
    return 'supabase';
  });

  const [formCreds, setFormCreds] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem(`engineer_db_${userId}`);
      if (stored) return (JSON.parse(stored) as DbConfig).credentials ?? {};
    } catch {}
    return {};
  });

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [activeConfig, setActiveConfig] = useState<DbConfig | null>(() => {
    try {
      const stored = localStorage.getItem(`engineer_db_${userId}`);
      if (stored) return JSON.parse(stored) as DbConfig;
    } catch {}
    return null;
  });

  const handleSave = async () => {
    const providerDef = DB_PROVIDERS.find(p => p.id === provider);
    if (!providerDef) return;

    const credentials: Record<string, string> = {};
    for (const field of providerDef.fields) {
      credentials[field.key] = formCreds[field.key] ?? '';
    }

    const newConfig: DbConfig = {
      provider,
      credentials,
      ...(provider === 'other' && formCreds.platformName ? { platformName: formCreds.platformName } : {}),
    };

    // Persist to localStorage — EngineerAIChat reads from here to pass in request body
    try {
      localStorage.setItem(`engineer_db_${userId}`, JSON.stringify(newConfig));
    } catch {}
    setActiveConfig(newConfig);

    // Sync to Firestore Secrets & Keys (upsert: delete old matching entries, add new ones)
    setSaving(true);
    try {
      const existingRes = await fetch(`/api/secrets/${userId}`);
      const existing: { id: string; secret_name: string }[] = existingRes.ok ? await existingRes.json() : [];

      const envKeys = buildEnvKeys(provider, credentials);
      const managedNames = [...Object.keys(envKeys), 'ENGINEER_DB_PROVIDER'];

      // Soft-delete any previously saved secrets with the same names
      await Promise.all(
        existing
          .filter(s => managedNames.includes(s.secret_name))
          .map(s => fetch(`/api/secrets/${userId}/${s.id}`, { method: 'DELETE' }))
      );

      // Save provider name so the agent can read which SDK to scaffold
      await fetch(`/api/secrets/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret_name: 'ENGINEER_DB_PROVIDER', secret_value: provider }),
      });

      // Save each non-empty env var as an encrypted secret
      await Promise.all(
        Object.entries(envKeys)
          .filter(([, v]) => v)
          .map(([name, value]) =>
            fetch(`/api/secrets/${userId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret_name: name, secret_value: value }),
            })
          )
      );

      setSavedMsg('Saved! Credentials are encrypted in Secrets & Keys and available to Engineer AI.');
    } catch {
      setSavedMsg('Saved locally. Could not sync to Secrets & Keys — check your connection.');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(''), 6000);
    }
  };

  const currentDef = DB_PROVIDERS.find(p => p.id === provider);

  return (
    <div className="space-y-6">
      <div className="px-1 py-4">
        <h2 className="text-2xl font-black text-white tracking-tight">Database</h2>
        <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Connect your own database provider</p>
      </div>

      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600/10 rounded-2xl flex items-center justify-center shrink-0">
            <Database className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wider">Your Database</h3>
            <p className="text-[10px] text-[#8b949e] font-medium mt-0.5">
              Credentials are encrypted in Secrets &amp; Keys. Engineer AI injects them into your app's .env automatically — NavBharatAI never uses them for itself.
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
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
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
        {activeConfig && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/3 border border-white/5">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
            <p className="text-sm text-[#8b949e]">
              Active: <span className="text-white font-bold">{DB_PROVIDERS.find(p => p.id === activeConfig.provider)?.label ?? activeConfig.provider}</span>
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
            When Engineer AI builds your app, it scaffolds the SDK file and injects your keys into <code className="text-indigo-300">.env</code> automatically.
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
