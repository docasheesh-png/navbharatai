import { useState, useEffect } from 'react';
import { HardDrive, ExternalLink, CheckCircle2, ShieldCheck, Database } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { listSecrets, saveSecret, deleteSecret } from '../../lib/secretsApi';

// Storage settings (admin 2026-07-29) — connect a STANDALONE file-storage provider for uploads.
// Mirrors DatabaseSettings exactly: the chosen provider + credentials are AES-encrypted in the
// Secrets & API Keys vault (never in the browser), and the server's `userStorageContext` + the real
// `StorageGenerator` recipe pick them up so NavBharatAI Pro wires real direct-to-storage uploads
// into the built app. Firebase/Supabase storage already comes with the Database connection — this
// screen is for S3-compatible (AWS S3 / Cloudflare R2 / Supabase Storage / MinIO) and Cloudinary.

type StorageProvider = 's3' | 'cloudinary';

// The marker secret name — MUST match STORAGE_PROVIDER_MARKER in src/server/AgentV3/userStorageContext.ts.
const STORAGE_PROVIDER_MARKER = 'STORAGE_PROVIDER';

interface StorageProviderDef {
  id: StorageProvider;
  label: string;
  keyLink: string;
  fields: { key: string; label: string; placeholder: string; where?: string; optional?: boolean }[];
}

const STORAGE_PROVIDERS: StorageProviderDef[] = [
  {
    id: 's3', label: 'S3-compatible (AWS S3 / Cloudflare R2 / Supabase / MinIO)',
    keyLink: 'https://console.aws.amazon.com/iam/home#/security_credentials',
    fields: [
      { key: 'S3_BUCKET', label: 'Bucket Name', placeholder: 'my-app-uploads', where: 'Your S3/R2 console → the bucket you created' },
      { key: 'S3_REGION', label: 'Region', placeholder: 'ap-south-1', where: 'The bucket region (for R2 use "auto")' },
      { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: 'AKIA…', where: 'IAM → Users → your user → Security credentials → Access keys' },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', placeholder: '••••••••', where: 'Shown once when you create the access key — server-side only' },
      { key: 'S3_ENDPOINT', label: 'Endpoint (optional)', placeholder: 'https://<account>.r2.cloudflarestorage.com', where: 'Only for a non-AWS S3-compatible provider (R2 / Supabase / MinIO)', optional: true },
      { key: 'S3_PUBLIC_BASE', label: 'Public Base URL (optional)', placeholder: 'https://cdn.myapp.com', where: 'Optional — the public base URL your objects are served from', optional: true },
    ],
  },
  {
    id: 'cloudinary', label: 'Cloudinary',
    keyLink: 'https://console.cloudinary.com/settings/api-keys',
    fields: [
      { key: 'CLOUDINARY_CLOUD_NAME', label: 'Cloud Name', placeholder: 'your-cloud-name', where: 'Cloudinary Console → Settings → Product environment / Cloud name' },
      { key: 'CLOUDINARY_API_KEY', label: 'API Key', placeholder: '123456789012345', where: 'Cloudinary Console → Settings → API Keys' },
      { key: 'CLOUDINARY_API_SECRET', label: 'API Secret', placeholder: '••••••••', where: 'Cloudinary Console → Settings → API Keys (server-side only)' },
    ],
  },
];

interface StorageMarker { provider: StorageProvider }

function readMarker(userId: string): StorageMarker | null {
  try {
    const stored = localStorage.getItem(`nbai_storage_${userId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StorageMarker>;
    if (!parsed?.provider) return null;
    return { provider: parsed.provider };
  } catch { return null; }
}

interface StorageSettingsProps {
  userId: string;
}

export function StorageSettings({ userId }: StorageSettingsProps) {
  const [provider, setProvider] = useState<StorageProvider>(() => readMarker(userId)?.provider ?? 's3');
  // Credential inputs are NEVER pre-filled from storage — real values live encrypted in Secrets & API Keys.
  const [formCreds, setFormCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [activeMarker, setActiveMarker] = useState<StorageMarker | null>(() => readMarker(userId));

  // SECURITY: if an older build ever left plaintext values in localStorage, keep only the marker.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`nbai_storage_${userId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && (parsed as { credentials?: unknown }).credentials) {
        localStorage.setItem(`nbai_storage_${userId}`, JSON.stringify({ provider: parsed.provider }));
      }
    } catch { /* best-effort cleanup */ }
  }, [userId]);

  const handleSave = async () => {
    const providerDef = STORAGE_PROVIDERS.find(p => p.id === provider);
    if (!providerDef) return;

    // Only the fields the user actually filled THIS time. A blank field means "keep the existing
    // encrypted value" — we never overwrite a saved secret with an empty string.
    const enteredCreds: Record<string, string> = {};
    for (const field of providerDef.fields) {
      const v = (formCreds[field.key] ?? '').trim();
      if (v) enteredCreds[field.key] = v;
    }

    // SECURITY: persist ONLY the provider marker locally — never the credential values.
    const marker: StorageMarker = { provider };
    try { localStorage.setItem(`nbai_storage_${userId}`, JSON.stringify(marker)); } catch {}
    setActiveMarker(marker);

    setSaving(true);
    try {
      const existing = await listSecrets(userId);

      // Upsert the provider marker + each entered credential (env-var name = the field key).
      const upserts: { name: string; value: string }[] = [{ name: STORAGE_PROVIDER_MARKER, value: provider }];
      for (const [name, value] of Object.entries(enteredCreds)) if (value) upserts.push({ name, value });

      for (const u of upserts) {
        await Promise.all(
          existing.filter(s => s.secret_name === u.name).map(s => deleteSecret(userId, s.id)),
        );
        await saveSecret(userId, u.name, u.value);
      }

      setFormCreds({});
      setSavedMsg('Saved! Credentials are encrypted in Secrets & API Keys — NavBharatAI Pro wires this storage into your app automatically when it builds.');
    } catch {
      setSavedMsg('Could not reach Secrets & API Keys — check your connection and try again.');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(''), 6000);
    }
  };

  const currentDef = STORAGE_PROVIDERS.find(p => p.id === provider);
  const hasSavedConfig = !!activeMarker && activeMarker.provider === provider;

  return (
    <div className="space-y-6">
      <div className="px-1 py-4">
        <h2 className="text-2xl font-black text-white tracking-tight">Storage</h2>
        <p className="text-[11px] text-[#484f58] font-bold uppercase tracking-[0.2em] mt-1">Connect your own file / image storage</p>
      </div>

      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600/10 rounded-2xl flex items-center justify-center shrink-0">
            <HardDrive className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wider">Your Storage</h3>
            <p className="text-[10px] text-[#8b949e] font-medium mt-0.5">
              For file &amp; image uploads. Credentials are encrypted in Secrets &amp; Keys. NavBharatAI Pro detects your connected storage and wires real direct-to-storage uploads into your app&apos;s .env automatically — your keys never leave your storage, and NavBharatAI never uses it for itself.
            </p>
          </div>
        </div>

        {/* Firebase/Supabase already give storage via the Database connection — say so, so the user
            doesn't double-configure. */}
        <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-white/3 border border-white/5">
          <Database className="w-4 h-4 text-[#8b949e] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            Using <span className="text-white font-semibold">Firebase</span> or <span className="text-white font-semibold">Supabase</span>? Their storage comes with your <span className="text-white font-semibold">Database</span> connection — you only need this screen for AWS S3, Cloudflare R2 or Cloudinary.
          </p>
        </div>

        {/* Provider selector */}
        <div>
          <label className="text-[11px] text-[#8b949e] font-semibold block mb-2 uppercase tracking-wider">Provider</label>
          <select
            value={provider}
            onChange={e => { setProvider(e.target.value as StorageProvider); setFormCreds({}); }}
            className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50"
          >
            {STORAGE_PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {hasSavedConfig && (
          <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/15">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#8b949e] leading-relaxed">
              This storage is saved. For your security, values aren&apos;t shown here — leave a field <span className="text-white font-semibold">blank to keep its current value</span>, or type a new one to update it.
            </p>
          </div>
        )}

        {/* Per-provider credential fields */}
        <div className="space-y-4">
          {currentDef?.fields.map(field => (
            <div key={field.key}>
              <label className="text-[11px] text-[#8b949e] font-semibold block mb-2 uppercase tracking-wider">{field.label}</label>
              <input
                type={['secret', 'key'].some(k => field.key.toLowerCase().includes(k)) && !field.key.toLowerCase().includes('cloud_name') ? 'password' : 'text'}
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
            Get your {provider === 's3' ? 'S3' : 'Cloudinary'} keys
          </a>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold rounded-2xl transition-colors"
        >
          {saving ? <TirangaLoader className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}
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
              Active: <span className="text-white font-bold">{STORAGE_PROVIDERS.find(p => p.id === activeMarker.provider)?.label ?? activeMarker.provider}</span>
            </p>
          </div>
        )}
      </div>

      <div className="bg-[#161b22] border border-white/5 rounded-[2.5rem] p-6 space-y-3">
        <h4 className="text-sm font-black text-white uppercase tracking-wider">How it works</h4>
        <ol className="space-y-2 text-[12px] text-[#8b949e]">
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">1.</span>
            Select your storage provider and paste your credentials.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">2.</span>
            Credentials are AES-encrypted and stored under <strong className="text-white">Secrets &amp; Keys</strong>.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">3.</span>
            When <strong className="text-white">NavBharatAI Pro</strong> builds your app, it detects this connected storage and wires a real direct-to-storage upload (the browser uploads straight to your bucket via a presigned/signed URL — the secret never leaves the server).
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold shrink-0">4.</span>
            Your files live in <strong className="text-white">your own</strong> storage — NavBharatAI never stores your uploads.
          </li>
        </ol>
      </div>
    </div>
  );
}

export default StorageSettings;
