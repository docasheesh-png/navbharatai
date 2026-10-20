import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isFailedReportAutopsyView, type FailedReportAutopsyInput, type FailedReportAutopsyView } from '../../lib/failedReportAutopsy';

const inputClass = 'mt-1 w-full rounded-xl border border-line bg-well p-2 text-ink';
const buttonClass = 'rounded-xl border border-line bg-card px-4 py-2 text-ink disabled:opacity-50';
const empty = (): Omit<FailedReportAutopsyInput, 'mutationId' | 'expectedRevision' | 'reportDigest'> => ({
  status: 'in_progress', summary: '', ledgerUrl: '', counts: { total: 0, resolved: 0, blocked: 0 },
  blockers: '', verification: null, reason: '',
});
export function FailedReportAutopsyEditor({ workspaceId, historyId, displayedReportDigest, request }: {
  workspaceId: string; historyId: string; displayedReportDigest: string; request: (url: string, init?: RequestInit) => Promise<unknown>;
}) {
  const [view, setView] = useState<FailedReportAutopsyView | null>(null);
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<FailedReportAutopsyInput | null>(null);
  const epoch = useRef(0);
  const locked = useRef(false);
  const endpoint = `/api/v1/failedbr/reports/${encodeURIComponent(workspaceId)}/${encodeURIComponent(historyId)}/autopsy`;
  const accept = (data: unknown) => {
    if (!isFailedReportAutopsyView(data)) throw new Error('The server returned unreadable autopsy metadata.');
    setView(data); setDraft(data.record ? {
      status: data.state === 'stale' ? 'in_progress' : data.record.status, summary: data.record.summary,
      ledgerUrl: data.record.ledgerUrl, counts: data.record.counts, blockers: data.record.blockers,
      verification: data.record.verification, reason: '',
    } : empty());
    return data;
  };
  const reload = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    const current = epoch.current;
    try {
      const data = await request(endpoint);
      if (current === epoch.current) { accept(data); setPending(null); }
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : 'Could not read autopsy metadata.'); }
    finally { if (current === epoch.current) { locked.current = false; setBusy(false); } }
  }, [endpoint, request]);
  useEffect(() => {
    epoch.current++; locked.current = false; setView(null); setDraft(empty()); setPending(null); void reload();
    return () => { epoch.current++; };
  }, [reload]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked.current || !view || view.reportDigest !== displayedReportDigest) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    const current = epoch.current;
    const update: FailedReportAutopsyInput = pending ?? { ...draft, expectedRevision: view.revision,
      reportDigest: displayedReportDigest, mutationId: crypto.randomUUID() };
    setPending(update);
    try {
      const data = await request(endpoint, { method: 'POST', body: JSON.stringify(update) });
      if (current === epoch.current) {
        const saved = accept(data); setPending(null);
        setMessage(saved.state === 'stale' ? 'The retained report changed. Showing the current saved review, which no longer applies to the new evidence.' :
          saved.record?.mutationId !== update.mutationId ? 'Another review superseded this save. Showing the current saved review, not the earlier result.' :
            'Autopsy metadata saved. The original build report was not changed.');
      }
    } catch (e) {
      if (current === epoch.current) setError(`${e instanceof Error ? e.message : 'Save could not be confirmed.'} Reload to check the current state, or retry the same save. Do not assume it succeeded.`);
    } finally { if (current === epoch.current) { locked.current = false; setBusy(false); } }
  };
  const verification = draft.verification;
  const evidenceChanged = view !== null && view.reportDigest !== displayedReportDigest;
  return <section className="rounded-xl border border-line bg-card p-4 space-y-3" aria-label="Autopsy metadata">
    <h2 className="font-semibold text-ink">Autopsy review</h2>
    <p className="text-sm text-muted">Only this review metadata is editable. Saved diagnostic evidence is never edited or deleted. Status and evidence are reviewer attestations, not automatic verification of a fix.</p>
    <p role="status">{view ? `Current status: ${view.state.replaceAll('_', ' ')} · revision ${view.revision}` : 'Reading autopsy status…'}</p>
    {view?.state === 'stale' && <p className="text-warn">The retained report changed after the last review. Re-read it; the old done status does not apply.</p>}
    {evidenceChanged && <p role="alert" className="text-warn">The saved report is newer than the report displayed above. Open the full report again before editing this review.</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {message && <p role="status" className="text-success">{message}</p>}
    <button type="button" className={buttonClass} disabled={busy} onClick={() => void reload()}>Reload saved review</button>
    {view && <form onSubmit={save} className="space-y-3">
      <fieldset disabled={busy || pending !== null || evidenceChanged} className="space-y-3">
        <label className="block text-sm">Review status<select className={inputClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as FailedReportAutopsyInput['status'] })}>
          <option value="in_progress">In progress</option><option value="blocked">Blocked, requires action</option><option value="done">Autopsy done</option>
        </select></label>
        <label className="block text-sm">Review summary<textarea className={inputClass} minLength={20} maxLength={4000} required value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
        <label className="block text-sm">Pinned item ledger URL<input className={inputClass} type="url" maxLength={1000} required={draft.status === 'done'} value={draft.ledgerUrl} onChange={e => setDraft({ ...draft, ledgerUrl: e.target.value })} placeholder="https://github.com/docasheesh-png/navbharatai/blob/COMMIT/docs/ledger.md" /></label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{(['total', 'resolved', 'blocked'] as const).map(key => <label key={key} className="block text-sm">{key === 'total' ? 'Total items' : key === 'resolved' ? 'Resolved items' : 'Blocked items'}<input className={inputClass} type="number" min={0} max={10000} step={1} required value={draft.counts[key]} onChange={e => setDraft({ ...draft, counts: { ...draft.counts, [key]: Number(e.target.value) } })} /></label>)}</div>
        <label className="block text-sm">Blockers: what, why, required action, already tried<textarea className={inputClass} maxLength={4000} value={draft.blockers} onChange={e => setDraft({ ...draft, blockers: e.target.value })} /></label>
        <label className="block text-sm"><input type="checkbox" checked={verification !== null} onChange={e => setDraft({ ...draft, verification: e.target.checked ? { scope: 'source_and_tests', commitSha: '', pullRequestUrl: '', ciRunUrl: '', testSummary: '' } : null })} /> Attach verification evidence</label>
        {verification && <div className="space-y-3">
          <label className="block text-sm">What was verified<select className={inputClass} value={verification.scope} onChange={e => setDraft({ ...draft, verification: { ...verification, scope: e.target.value as 'source_and_tests' | 'historical_app' } })}><option value="source_and_tests">Source and regression tests only</option><option value="historical_app">Historical application runtime also verified</option></select></label>
          <p className="text-sm text-muted">Source fixes and passing tests do not prove that an old application was rebuilt or now works. Record the exact limits.</p>
          {(['commitSha', 'pullRequestUrl', 'ciRunUrl', 'testSummary'] as const).map(key => <label key={key} className="block text-sm">{{ commitSha: 'Verified commit (40 characters)', pullRequestUrl: 'Merged pull request URL', ciRunUrl: 'Successful exact-head CI run URL', testSummary: 'Regression, reversion proof and verification limits' }[key]}<input className={inputClass} required maxLength={key === 'testSummary' ? 4000 : 1000} value={verification[key]} onChange={e => setDraft({ ...draft, verification: { ...verification, [key]: e.target.value } })} /></label>)}
        </div>}
        <label className="block text-sm">Reason for this change<input className={inputClass} minLength={3} maxLength={500} required value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></label>
      </fieldset>
      <p className="text-sm text-muted">Autopsy done requires a full pinned ledger, every item resolved, no blockers, and merged-fix plus exact-head CI evidence. A terminal-cause glance is not a completed autopsy.</p>
      <button className={buttonClass} disabled={busy || evidenceChanged} type="submit">{busy ? 'Saving…' : pending ? 'Retry same save' : 'Save autopsy metadata'}</button>
    </form>}
  </section>;
}
