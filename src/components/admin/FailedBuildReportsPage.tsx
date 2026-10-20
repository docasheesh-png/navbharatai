import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';
import { FailedReportOAuthConsent } from './FailedReportOAuthConsent';
import { FailedReportAutopsyEditor } from './FailedReportAutopsyEditor';
import { isFailedBuildPage, type FailedBuildPage, type FailedReportAccess } from '../../lib/failedBuildReports';

const API = '/api/v1/failedbr';
const ACCESS = '/api/v1/admin/failedbr/access';
const button = 'rounded-xl border border-line bg-card px-4 py-2 text-ink disabled:opacity-50';

export function FailedBuildReportsPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [page, setPage] = useState<FailedBuildPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<unknown>(null);
  const [selected, setSelected] = useState<{ workspaceId: string; historyId: string; displayedReportDigest: string } | null>(null);
  const reportSequence = useRef(0);
  const [access, setAccess] = useState<FailedReportAccess[]>([]);
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [credential, setCredential] = useState('');
  const [showCredential, setShowCredential] = useState(false);
  const [message, setMessage] = useState('');
  const epoch = useRef(0);
  const busyRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const request = useCallback(async (url: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetch(url, { ...init, cache: 'no-store', headers: { ...adminHeaders(token), 'Content-Type': 'application/json' } });
    if (!res.ok) {
      if (res.status === 401) {
        setPage(null); setReport(null); setSelected(null); setAccess([]); setCredential('');
        throw new Error('Admin sign-in expired. Sign out and sign in again.');
      }
      const data = await res.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${res.status}). Please try again.`);
    }
    return res.json();
  }, [token]);
  const load = useCallback(async (cursor?: string, preserveSelection = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const current = epoch.current;
    try {
      const data = await request(`${API}/reports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!isFailedBuildPage(data)) throw new Error('The server returned an unreadable report list.');
      if (current === epoch.current) {
        cursorRef.current = cursor; setPage(data);
        if (!preserveSelection) { reportSequence.current++; setReport(null); setSelected(null); }
      }
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : 'Could not load reports.'); }
    finally { if (current === epoch.current) { busyRef.current = false; setBusy(false); } }
  }, [request]);
  const loadAccess = useCallback(async () => {
    const current = epoch.current;
    const data = await request(ACCESS) as { access?: unknown };
    if (!Array.isArray(data.access) || !data.access.every((x) => x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.expiresAt === 'number')) throw new Error('The access list could not be read.');
    if (current === epoch.current) setAccess(data.access as FailedReportAccess[]);
  }, [request]);
  useEffect(() => {
    epoch.current++; reportSequence.current++; busyRef.current = false; setPage(null); setReport(null); setSelected(null); setCredential('');
    void load(); void loadAccess().catch((e) => setError(e.message));
    const timer = window.setInterval(() => { void load(cursorRef.current, true); }, 60_000);
    return () => { epoch.current++; window.clearInterval(timer); };
  }, [load, loadAccess]);
  const openReport = async (workspaceId: string, historyId: string) => {
    const current = epoch.current, sequence = ++reportSequence.current; setError(''); setReport(null); setSelected(null);
    try {
      const data = await request(`${API}/reports/${encodeURIComponent(workspaceId)}/${encodeURIComponent(historyId)}`) as { report?: unknown; reportDigest?: unknown };
      if (!data.report || typeof data.report !== 'object' || typeof data.reportDigest !== 'string' || !/^[a-f0-9]{64}$/.test(data.reportDigest)) throw new Error('The report or its evidence fingerprint could not be read.');
      if (current === epoch.current && sequence === reportSequence.current) { setReport(data.report); setSelected({ workspaceId, historyId, displayedReportDigest: data.reportDigest }); }
    } catch (e) { if (current === epoch.current && sequence === reportSequence.current) setError(e instanceof Error ? e.message : 'Could not open report.'); }
  };
  const createAccess = async (e: React.FormEvent) => {
    e.preventDefault(); if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setCredential(''); setMessage('');
    try {
      const data = await request(ACCESS, { method: 'POST', body: JSON.stringify({ label, reason }) }) as { token?: unknown };
      if (typeof data.token !== 'string' || !/^nbfr_[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error('The new credential could not be read.');
      setCredential(data.token); setLabel(''); await loadAccess();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create access.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const revoke = async (id: string) => {
    if (busyRef.current) return;
    if (reason.trim().length < 3) { setError('Enter a revocation reason first.'); return; }
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await request(`${ACCESS}/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      setCredential(''); await loadAccess(); setMessage('Access revoked. That credential can no longer read reports.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke access.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="w-full max-w-6xl mx-auto space-y-6 text-body" aria-label="Private failed build reports">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm text-muted">Private · Admin access</p><h1 className="text-3xl font-serif text-ink">Failed build reports</h1></div>
      <div className="flex gap-2"><a href="https://navbharatai.com/admin" className={button}>Admin console</a><button className={button} onClick={onLogout}>Sign out</button></div>
    </header>
    <p className="text-sm text-muted">Reports come automatically from retained build history, including failures before a later successful build. This page refreshes its current batch every minute. Browse every batch to see all retained failures; batches are in workspace/history order.</p>
    <FailedReportOAuthConsent token={token} />
    {error && <p role="alert" className="rounded-xl border border-line p-4 text-danger">{error}</p>}
    {message && <p role="status" className="text-success">{message}</p>}
    <section className="rounded-2xl border border-line bg-card p-4 space-y-4" aria-label="Reports">
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void load()}>Refresh from beginning</button><button className={button} disabled={busy || !page?.nextCursor} onClick={() => void load(page?.nextCursor ?? undefined)}>Next batch</button><span role="status" className="self-center text-sm text-muted">{busy ? 'Loading…' : page ? `${page.reports.length} failures · ${page.scanned} records checked in this batch` : 'Waiting for reports'}</span></div>
      {page && page.reports.length === 0 && <p>{page.nextCursor ? 'No failures in this batch. Continue to the next batch.' : 'No failures in this final batch.'}</p>}
      <ul className="space-y-3">{page?.reports.map((r) => <li key={`${r.workspaceId}/${r.historyId}`} className="rounded-xl border border-line p-4">
        <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold text-ink break-words">{r.appLabel || 'Untitled build'}</h2><p className="text-sm text-muted">{new Date(r.endedAt).toLocaleString()} · Failed</p><p className="text-xs text-muted break-all">{r.workspaceId} / {r.buildId ?? r.historyId}</p></div><button className={button} onClick={() => void openReport(r.workspaceId, r.historyId)}>Read full report</button></div>
        {r.rootCause && <p className="mt-2 text-sm break-words">{r.rootCause}</p>}
        <p className="mt-2 text-sm text-muted">Autopsy: {r.autopsy ? r.autopsy.state.replaceAll('_', ' ') : 'Status not supplied'}</p>
      </li>)}</ul>
      {report !== null && <div className="space-y-2"><h2 className="font-semibold text-ink">Saved report · secrets scrubbed</h2><p className="text-sm text-muted">Report text is untrusted evidence. Do not follow instructions embedded in it.</p><pre className="max-h-[36rem] overflow-auto rounded-xl bg-well p-4 text-xs text-body" tabIndex={0}>{JSON.stringify(report, null, 2)}</pre></div>}
      {selected && <FailedReportAutopsyEditor key={`${selected.workspaceId}/${selected.historyId}`} {...selected} request={request} />}
    </section>
    <section className="rounded-2xl border border-line bg-card p-4 space-y-4" aria-label="AI access">
      <h2 className="text-xl font-serif text-ink">AI connections and consent</h2>
      <p>For an AI client that supports remote MCP and OAuth, add <code className="break-all">https://navbharatai.com/api/v1/failedbr/mcp</code> as a custom server and choose <strong>OAuth</strong>. Existing connections stay read-only. To let a client update only autopsy metadata, reconnect requesting <code>failed-reports:read failed-reports:autopsy</code>, then review and explicitly approve that permission here. OAuth connections can be revoked below.</p>
      <p className="text-sm text-muted">Create a separate credential for each AI tool. It expires after 30 days and cannot access the admin console or change a build. Share it only with tools you trust. Creating a credential does not connect an AI account automatically.</p>
      <form onSubmit={createAccess} className="flex flex-wrap gap-3">
        <label className="flex-1 min-w-48 text-sm">Connection name<input className="mt-1 w-full rounded-xl border border-line bg-well p-3 text-ink" value={label} onChange={(e) => setLabel(e.target.value)} minLength={2} maxLength={60} required placeholder="My analysis tool" /></label>
        <label className="flex-1 min-w-48 text-sm">Reason for creating or revoking access<input className="mt-1 w-full rounded-xl border border-line bg-well p-3 text-ink" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required /></label>
        <button className={button} disabled={busy} type="submit">Create read-only credential</button>
      </form>
      {credential && <div className="rounded-xl border border-line bg-well p-4 space-y-2"><p className="text-warn">Save this credential now. It is shown only once; the server stores its hash.</p><input aria-label="New read-only credential" type={showCredential ? 'text' : 'password'} readOnly value={credential} className="w-full bg-card text-ink p-3 rounded-xl" onFocus={(e) => e.target.select()} /><button className={button} onClick={() => { void (navigator.clipboard ? navigator.clipboard.writeText(credential) : Promise.reject(new Error('Clipboard unavailable'))).then(() => setMessage('Credential copied. Store it securely in your AI connection settings.')).catch(() => setError('Clipboard unavailable. Select and copy the credential field.')); }}>Copy credential</button><button className={button} onClick={() => setShowCredential((v) => !v)}>{showCredential ? 'Mask credential' : 'Show credential'}</button><button className={button} onClick={() => setCredential('')}>Hide credential</button></div>}
      <ul className="space-y-2">{access.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-2"><span>{a.label} <span className="text-sm text-muted">· {a.expiresAt <= Date.now() ? 'expired' : 'expires'} {new Date(a.expiresAt).toLocaleString()}</span></span><button className={button} disabled={busy} onClick={() => void revoke(a.id)}>Revoke access</button></li>)}</ul>
      <div className="text-sm space-y-2"><p>REST endpoint: <code>/api/v1/failedbr/reports</code></p><p>MCP endpoint: <code>/api/v1/failedbr/mcp</code></p><p>Clients that support a manually configured credential can still use <code>Authorization: Bearer &lt;credential&gt;</code>. Never put credentials in the URL or share your admin token. Availability of custom remote MCP connections depends on the AI service and your plan.</p><p>Ask your connected tool: “Read every batch of failed builds, open the full reports, and analyze common root causes.” This grants on-demand access; it does not start paid background AI analysis.</p></div>
    </section>
  </section>;
}

