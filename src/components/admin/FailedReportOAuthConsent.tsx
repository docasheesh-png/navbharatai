import { useEffect, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';

/** Rendered after existing admin login/MFA. A connection always needs explicit consent. */
export function FailedReportOAuthConsent({ token }: { token: string }) {
  // Read once, and only in a browser: the page is also rendered on the server (renderToStaticMarkup),
  // where there is no `window` and therefore no pending OAuth request to show.
  const [id] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('oauth_request')));
  const [request, setRequest] = useState<{ clientName: string; redirectUri: string; scope: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setRequest(null); setError('');
    void fetch(`/api/v1/admin/failedbr/oauth/request/${encodeURIComponent(id)}`, { cache: 'no-store', headers: adminHeaders(token) })
      .then(async res => { if (!res.ok) throw new Error('Connection request or admin sign-in expired. Start again from your AI client.'); return res.json(); })
      .then(data => {
        if (!data || typeof data.clientName !== 'string' || typeof data.redirectUri !== 'string' || !['failed-reports:read', 'failed-reports:read failed-reports:autopsy'].includes(data.scope)) throw new Error('Unreadable connection permissions. Start again from your AI client.');
        if (active) setRequest(data);
      })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, token]);
  if (!id) return null;
  const decide = async (approve: boolean) => {
    if (busy || !request) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/v1/admin/failedbr/oauth/request/${encodeURIComponent(id)}`, { method: 'POST', cache: 'no-store', headers: { ...adminHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ approve, scope: request.scope }) });
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
      <p><strong>{request.clientName}</strong> requests {request.scope.includes('failed-reports:autopsy') ? 'read access to reports and permission to update their separate autopsy metadata' : 'read-only access'}.</p>
      <p>Read access includes all retained failed build reports, which may include private user build data.</p>
      {request.scope.includes('failed-reports:autopsy') && <p>Autopsy write access allows this client to update review status, root-cause findings, fix and test evidence, and completion notes. It cannot change or delete the original reports, modify application or engine code, or manage administrator settings or connections.</p>}
      <p className="break-all">Return address: <code>{request.redirectUri}</code></p>
      <p>Client names are self-reported. Approve only a connection you just started and recognize. Access lasts up to 30 days; revoke it below at any time.</p>
      <div className="flex gap-3"><button disabled={busy} onClick={() => void decide(true)} className="rounded-xl border border-line px-4 py-2">{request.scope.includes('failed-reports:autopsy') ? 'Approve report reads and autopsy writes' : 'Approve read-only access'}</button><button disabled={busy} onClick={() => void decide(false)} className="rounded-xl border border-line px-4 py-2">Deny</button></div>
    </>}
  </section>;
}
