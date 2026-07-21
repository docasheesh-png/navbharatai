// NbaiDomainConnect — the workspace-scoped "connect your own domain" flow for the Publish surface
// (Hosting Slice 3). Firebase-native custom domains are PER-APP (the domain attaches to this
// workspace's dedicated Firebase site), so this component is always scoped to a workspaceId.
//
// Real flow: enter domain -> POST /api/domains/nbai/connect (creates the Firebase custom domain on
// the workspace's site, returns the EXACT DNS records) -> user adds them at their registrar ->
// "Check" polls /api/domains/nbai/status until ownership + host + SSL are all active. Honest
// throughout: it shows the real pending/active state and never claims a domain is connected when it
// isn't. Gated by the server flag (the caller only renders this when custom domains are enabled).

import { useState } from 'react';
import { Globe, ChevronLeft, CheckCircle2, Copy, Check, RefreshCw, Info } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

interface DnsRecord { type: string; name: string; value: string; note?: string; }
interface DomainStatus {
  domain: string;
  active: boolean;
  ownershipState: string;
  hostState: string;
  sslState: string;
  records: DnsRecord[];
}

export interface NbaiDomainConnectProps {
  workspaceId: string;
  onBack: () => void;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { auth } = await import('../../lib/firebase');
    const tok = await auth.currentUser?.getIdToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* best-effort; the server will 401 if unauthenticated */ }
  return headers;
}

export function NbaiDomainConnect({ workspaceId, onBack }: NbaiDomainConnectProps) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DomainStatus | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const domainValid = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(cleanDomain);

  const copy = (txt: string, key: string) => {
    navigator.clipboard.writeText(txt).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  const connect = async () => {
    if (!domainValid || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/domains/nbai/connect', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId, domain: cleanDomain }),
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
      const params = new URLSearchParams({ workspaceId, domain: cleanDomain });
      const res = await fetch(`/api/domains/nbai/status?${params.toString()}`, { headers: await authHeaders() });
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors" title="Back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div>
          <h3 className="text-sm font-bold text-white">Connect your own domain</h3>
          <p className="text-[11px] text-zinc-400">Point your domain at this app on NavBharatAI — free HTTPS included.</p>
        </div>
      </div>

      {/* Step 1 — domain */}
      <div className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
          placeholder="e.g. myshop.com"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60"
        />
        <button
          onClick={connect}
          disabled={!domainValid || busy}
          className="px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
        >
          {busy ? <TirangaLoader className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
          {busy ? 'Starting…' : 'Connect'}
        </button>
      </div>
      {domain && !domainValid && (
        <p className="text-[10px] text-red-400">Enter a valid domain like myshop.com (no https://, no slashes).</p>
      )}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <Info className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-200/90">{error}</p>
        </div>
      )}

      {/* Step 2 — the real DNS records + live status */}
      {result && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Add these DNS records at your registrar</span>
          {result.records.length === 0 && (
            <p className="text-[11px] text-zinc-400">No records needed right now — check the status below.</p>
          )}
          {result.records.map((rec, i) => (
            <div key={i} className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">{rec.type}</span>
                {rec.note && <span className="text-[10px] text-zinc-500">{rec.note}</span>}
              </div>
              <Field label="Name" value={rec.name} k={`n${i}`} copied={copied} onCopy={copy} />
              <Field label="Value" value={rec.value} k={`v${i}`} copied={copied} onCopy={copy} />
            </div>
          ))}

          <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${result.active ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
            <div className="flex items-center gap-2 min-w-0">
              {result.active
                ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                : <TirangaLoader className="w-4 h-4 shrink-0" />}
              <span className={`text-[11px] truncate ${result.active ? 'text-green-200' : 'text-amber-200/90'}`}>
                {result.active
                  ? `Live! ${result.domain} is connected with HTTPS.`
                  : `Pending — add the records, then check. (ownership: ${short(result.ownershipState)}, host: ${short(result.hostState)}, SSL: ${short(result.sslState)})`}
              </span>
            </div>
            {!result.active && (
              <button
                onClick={checkStatus}
                disabled={checking}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium disabled:opacity-40 text-zinc-200"
              >
                {checking ? <TirangaLoader className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />} Check
              </button>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            DNS changes can take a few minutes to a few hours. Publish your app once after connecting, so the
            domain serves your latest build. HTTPS is issued automatically once the records resolve.
          </p>
        </div>
      )}
    </div>
  );
}

/** Trim the API's verbose state enums (OWNERSHIP_ACTIVE -> active) for the status line. */
function short(state: string): string {
  return (state || '').replace(/^[A-Z]+_/, '').toLowerCase() || 'pending';
}

function Field({ label, value, k, copied, onCopy }: { label: string; value: string; k: string; copied: string | null; onCopy: (v: string, k: string) => void; }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 w-10 shrink-0 uppercase">{label}</span>
      <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-zinc-200 bg-black/40 rounded px-2 py-1">{value}</code>
      <button onClick={() => onCopy(value, k)} className="shrink-0 text-zinc-400 hover:text-white" title="Copy">
        {copied === k ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default NbaiDomainConnect;
