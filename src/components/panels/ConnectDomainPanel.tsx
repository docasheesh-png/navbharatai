import React, { useState } from 'react';
import { Globe, ExternalLink, ChevronLeft, CheckCircle2, Info, Copy, Check, Loader2, RefreshCw } from 'lucide-react';

/**
 * ConnectDomainPanel — connect a user's own custom domain (e.g. from Hostinger
 * or GoDaddy) to their NavBharatAI site, via Cloudflare for SaaS.
 *
 * Real flow: enter domain → POST /api/domains/connect creates a Cloudflare
 * custom hostname and returns the EXACT DNS records to add → user adds them at
 * their registrar → "Check status" polls /api/domains/status until verified +
 * SSL active. Honest throughout: it shows real pending/active state and never
 * claims a domain is connected when it isn't.
 */

interface RegistrarOption {
  id: string;
  label: string;
  dnsUrl?: string;
}

const REGISTRARS: RegistrarOption[] = [
  { id: 'hostinger', label: 'Hostinger', dnsUrl: 'https://hpanel.hostinger.com/domain' },
  { id: 'godaddy', label: 'GoDaddy', dnsUrl: 'https://dcc.godaddy.com/manage/dns' },
  { id: 'cloudflare', label: 'Cloudflare', dnsUrl: 'https://dash.cloudflare.com' },
  { id: 'namecheap', label: 'Namecheap', dnsUrl: 'https://ap.www.namecheap.com/domains/list/' },
  { id: 'bigrock', label: 'BigRock', dnsUrl: 'https://manage.bigrock.com/' },
  { id: 'google', label: 'Google / Squarespace', dnsUrl: 'https://account.squarespace.com/domains' },
  { id: 'other', label: 'Other / Not sure' },
];

interface DnsRecord { type: string; name: string; value: string; note?: string; }
interface ConnectResult {
  hostname: string;
  status: string;
  sslStatus: string;
  active: boolean;
  records: DnsRecord[];
}

interface ConnectDomainPanelProps {
  onBack?: () => void;
}

export const ConnectDomainPanel: React.FC<ConnectDomainPanelProps> = ({ onBack }) => {
  const [domain, setDomain] = useState('');
  const [registrar, setRegistrar] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const selected = REGISTRARS.find(r => r.id === registrar);
  const domainValid = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(cleanDomain);

  const copy = (txt: string, key: string) => {
    navigator.clipboard.writeText(txt).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  const connect = async () => {
    if (!domainValid || busy) return;
    setBusy(true); setError(null);
    try {
      // Attach the Firebase ID token — the server now requires an authenticated owner before
      // provisioning a Cloudflare hostname and stores the mapping under the VERIFIED uid.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const { auth } = await import('../../lib/firebase');
        const tok = await auth.currentUser?.getIdToken();
        if (tok) headers.Authorization = `Bearer ${tok}`;
      } catch { /* best-effort; server will 401 if unauthenticated */ }
      const res = await fetch('/api/domains/connect', {
        method: 'POST',
        headers,
        body: JSON.stringify({ domain: cleanDomain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not start the connection.'); return; }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    if (!domainValid || checking) return;
    setChecking(true); setError(null);
    try {
      const res = await fetch(`/api/domains/status?domain=${encodeURIComponent(cleanDomain)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not check status.'); return; }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[#0d1117] text-white">
      <div className="max-w-2xl mx-auto px-5 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#8b949e] hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">Connect my website</h2>
            <p className="text-[11px] text-[#8b949e]">Point your own domain to your NavBharatAI site, with automatic HTTPS.</p>
          </div>
        </div>

        {/* Step 1 — domain */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Step 1 — Your domain</label>
          <div className="flex gap-2">
            <input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') connect(); }}
              placeholder="e.g. myshop.com"
              className="flex-1 bg-[#161b22] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-500/50"
            />
            <button
              onClick={connect}
              disabled={!domainValid || busy}
              className="px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              {busy ? 'Starting…' : 'Connect'}
            </button>
          </div>
          {domain && !domainValid && (
            <p className="text-[10px] text-red-400">Enter a valid domain like myshop.com (no https://, no slashes).</p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <Info className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/90">{error}</p>
          </div>
        )}

        {/* Step 2 — registrar (helper to open DNS page) */}
        {result && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Step 2 — Where is your domain's DNS?</label>
            <select
              value={registrar}
              onChange={e => setRegistrar(e.target.value)}
              className="w-full bg-[#161b22] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-500/50 appearance-none"
            >
              <option value="">Select your provider…</option>
              {REGISTRARS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            {selected?.dnsUrl && (
              <button
                onClick={() => window.open(selected.dnsUrl, '_blank', 'noopener,noreferrer')}
                className="flex items-center gap-2 text-[12px] text-indigo-300 hover:text-indigo-200"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open {selected.label} DNS settings
              </button>
            )}
          </div>
        )}

        {/* Step 3 — the real DNS records to add */}
        {result && (
          <div className="space-y-3">
            <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Step 3 — Add these DNS records</label>
            <div className="space-y-2">
              {result.records.map((rec, i) => (
                <div key={i} className="px-4 py-3 rounded-xl bg-[#161b22] border border-white/10 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">{rec.type}</span>
                    {rec.note && <span className="text-[10px] text-[#586069]">{rec.note}</span>}
                  </div>
                  <Field label="Name" value={rec.name} k={`n${i}`} copied={copied} onCopy={copy} />
                  <Field label="Value" value={rec.value} k={`v${i}`} copied={copied} onCopy={copy} />
                </div>
              ))}
            </div>

            {/* Status + check */}
            <div className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl border ${result.active ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
              <div className="flex items-center gap-2 min-w-0">
                {result.active
                  ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  : <Loader2 className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />}
                <span className={`text-[11px] truncate ${result.active ? 'text-green-200' : 'text-amber-200/90'}`}>
                  {result.active
                    ? `Live! ${result.hostname} is connected with HTTPS.`
                    : `Pending — add the records above, then check. (verification: ${result.status}, SSL: ${result.sslStatus})`}
                </span>
              </div>
              {!result.active && (
                <button
                  onClick={checkStatus}
                  disabled={checking}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium disabled:opacity-40"
                >
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Check
                </button>
              )}
            </div>
            <p className="text-[10px] text-[#586069] leading-relaxed">
              DNS changes can take a few minutes to a few hours to take effect. Once verified, Cloudflare issues a free SSL certificate automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

function Field({ label, value, k, copied, onCopy }: { label: string; value: string; k: string; copied: string | null; onCopy: (v: string, k: string) => void; }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-[#586069] w-10 shrink-0 uppercase">{label}</span>
      <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-[#c9d1d9] bg-black/30 rounded px-2 py-1">{value}</code>
      <button onClick={() => onCopy(value, k)} className="shrink-0 text-[#8b949e] hover:text-white" title="Copy">
        {copied === k ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
