import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * PROXY HOP CHECK — is the server reading each visitor's REAL address? (queue Q-154, admin 2026-10-05:
 * "navbharatai.com/admin/api/admin/proxy-hops open hi nahi ho raha hai").
 *
 * Every per-address limit (admin login lockout, OTP sends, guest quota) keys on the address the server
 * trusts, and that depends on ONE number: how many proxies sit in front of it (`TRUSTED_PROXY_HOPS`). The
 * route that measures it needs the admin token header, which an address bar cannot send — so the
 * measurement was only reachable with a command-line tool. This card sends the token and shows the answer.
 */
interface HopReport {
  yourAddress: string | null;
  measuredHops: number | null;
  trustedHops: number;
  verdict: 'correct' | 'mismatch' | 'no-proxy';
}

export function isHopReport(v: unknown): v is HopReport {
  const r = v as HopReport | null;
  return !!r && typeof r === 'object' && typeof r.trustedHops === 'number'
    && (r.verdict === 'correct' || r.verdict === 'mismatch' || r.verdict === 'no-proxy');
}

const proxies = (n: number | null) => `${n} ${n === 1 ? 'proxy' : 'proxies'}`;

/** The one sentence the card shows for a report. PURE. */
export function hopVerdictText(r: HopReport): string {
  if (r.verdict === 'correct') {
    return `Correct. Your request passed through ${proxies(r.measuredHops)}, and the server trusts exactly ${r.trustedHops} — so it reads every visitor's real address, and nobody can choose their own.`;
  }
  if (r.verdict === 'mismatch') {
    return `Mismatch. Your request passed through ${proxies(r.measuredHops)}, but the server trusts ${r.trustedHops}. Per-address limits are keyed on the wrong address. TRUSTED_PROXY_HOPS (clientAddress.ts) must be changed to ${r.measuredHops} — a code change.`;
  }
  return 'This request did not come through the hosting proxy, so it cannot measure anything. Open the admin panel on navbharatai.com (not a local or preview address) and check again.';
}

export function ProxyHopsCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [report, setReport] = useState<HopReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/admin/proxy-hops', { headers: { 'x-admin-token': adminToken }, cache: 'no-store' });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error((body && typeof body.error === 'string' && body.error) || `The check answered ${r.status}.`);
      if (!isHopReport(body)) throw new Error('The check answered in an unexpected shape.');
      setReport(body);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const ok = report?.verdict === 'correct';
  return (
    <div className="bg-card border border-line rounded-[1.5rem] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="flex items-center gap-2 text-sm font-black text-ink uppercase tracking-tight">
          {ok ? <CheckCircle2 size={15} className="text-success" /> : <AlertTriangle size={15} className="text-warn" />}
          Visitor address check
        </h3>
        <button onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-raised border border-line text-[10px] font-black uppercase tracking-wider text-ink transition-all">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Check again
        </button>
      </div>
      <p className="text-[11px] text-muted leading-relaxed">
        Rate limits (admin login, OTP sends, the free guest quota) count each visitor by address. This checks, using
        your own request, that the server reads the real one.
      </p>
      {loading && !report && <p className="text-[11px] text-muted">Checking…</p>}
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {report && (
        <div className="space-y-1">
          <p className={`text-[12px] font-bold ${ok ? 'text-success' : 'text-warn'}`}>{hopVerdictText(report)}</p>
          {report.yourAddress && <p className="text-[10px] text-faint">Your address as the proxy saw it: {report.yourAddress}</p>}
        </div>
      )}
    </div>
  );
}
