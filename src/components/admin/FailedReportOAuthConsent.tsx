import { useEffect, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';

/** Rendered after existing admin login/MFA. A connection always needs explicit consent. */
export function FailedReportOAuthConsent({ token }: { token: string }) {
  // Read once, and only in a browser: the page is also rendered on the server (renderToStaticMarkup),
  // where there is no `window` and therefore no pending OAuth request to show.
  const [id] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('oauth_request')));
  const [request, setRequest] = useState<{ clientName: string; redirectUri: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setRequest(null); setError('');
    void fetch(`/api/v1/admin/failedbr/oauth/request/${encodeURIComponent(id)}`, { cache: 'no-store', headers: adminHeaders(token) })
      .then(async res => { if (!res.ok) throw new Error('Connection request or admin sign-in expired. Start again from your AI client.'); return res.json(); })
      .then(data => { if (typeof data.clientName !== 'string' || typeof data.redirectUri !== 'string') throw new Error('Unreadable connection request.'); if (active) setRequest(data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, token]);
  if (!id) return null;
  const decide = async (approve: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/v1/admin/failedbr/oauth/request/${encodeURIComponent(id)}`, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }) });
      if (!res.ok) throw new Error('Connection could not be completed. Start again from the AI client.');
      const data = await res.json();
      if (typeof data.redirect !== 'string') throw new Error('Unreadable connection response.');
      window.location.assign(data.redirect);
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed.'); setBusy(false); }
  };
  return <section aria-label="Approve AI connection" className="rounded-2xl border border-line bg-card p-4 space-y-4">
    <h2 className="text-xl font-serif text-ink">Connect your AI tool</h2>
    {error && <p role="alert">{error}</p>}
    {!request && !error && <p role="status">Loading connection request…</p>}
    {request && <>
      <p><strong>{request.clientName}</strong> requests read-only access to all retained failed build reports, which may include private user build data.</p>
      <p className="break-all">Return address: <code>{request.redirectUri}</code></p>
      <p>Client names are self-reported. Approve only a connection you just started and recognize. Access lasts up to 30 days; revoke it below at any time.</p>
      <div className="flex gap-3"><button disabled={busy} onClick={() => void decide(true)} className="rounded-xl border border-line px-4 py-2">Approve read-only access</button><button disabled={busy} onClick={() => void decide(false)} className="rounded-xl border border-line px-4 py-2">Deny</button></div>
    </>}
  </section>;
}
