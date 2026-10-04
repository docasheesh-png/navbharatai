// "What your app does" — the user's view of the Change Engine's memory of their app (History tab).
//
// Three plain answers no other builder gives: which features the app has and whether each was SEEN working
// in a real browser, which problems are still open, and what each change did (including when a change lost
// something that used to work). Every string comes from the server's white-labelled view
// (changeEngine/publicView.ts) — this component never sees a code, a vendor or a model.
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Hammer, ChevronDown, ChevronRight } from 'lucide-react';
import { authJsonHeaders } from '../../lib/authHeaders';

export interface PublicAppMemory {
  available: boolean;
  requirements?: Array<{ id: string; label: string; status: 'working' | 'built' | 'pending' | 'missing' }>;
  openIssues?: Array<{ id: string; severity: 'warning' | 'error'; message: string; fixing: boolean }>;
  openIssueCount?: number;
  changes?: Array<{ id: string; ts: number; summary: string; kind: string; outcome: string; lost: number }>;
}

const STATUS_TEXT = {
  working: 'Seen working',
  built: 'Built',
  pending: 'Not confirmed yet',
  missing: 'Missing since the last change',
} as const;

function StatusIcon({ status }: { status: keyof typeof STATUS_TEXT }) {
  if (status === 'working') return <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" aria-hidden />;
  if (status === 'built') return <Hammer className="w-3.5 h-3.5 text-info shrink-0" aria-hidden />;
  if (status === 'missing') return <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden />;
  return <Circle className="w-3.5 h-3.5 text-muted shrink-0" aria-hidden />;
}

export function AppMemoryCard({ workspaceId, userId, email, refreshKey }: { workspaceId: string; userId?: string; email?: string; refreshKey?: unknown }) {
  const [data, setData] = useState<PublicAppMemory | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        if (userId) params.set('userId', userId);
        if (email) params.set('email', email);
        const res = await fetch(`/api/agentv3/app-memory?${params.toString()}`, { headers: await authJsonHeaders() });
        const j = res.ok ? await res.json().catch(() => null) : null;
        if (!cancelled) setData(j && typeof j === 'object' ? (j as PublicAppMemory) : { available: false });
      } catch {
        if (!cancelled) setData({ available: false });
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, userId, email, refreshKey]);

  return <AppMemoryView data={data} />;
}

/** The pure render, split out so it can be checked without a network. Renders nothing until there is something. */
export function AppMemoryView({ data, initiallyOpen = true }: { data: PublicAppMemory | null; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!data?.available) return null;
  const reqs = data.requirements ?? [];
  const issues = data.openIssues ?? [];
  const changes = data.changes ?? [];
  if (reqs.length === 0 && issues.length === 0 && changes.length === 0) return null;
  const working = reqs.filter((r) => r.status === 'working').length;

  return (
    <section className="rounded border border-line bg-card" aria-label="What your app does">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink touch-manipulation"
      >
        {open ? <ChevronDown className="w-4 h-4 text-muted" aria-hidden /> : <ChevronRight className="w-4 h-4 text-muted" aria-hidden />}
        <span className="font-medium">What your app does</span>
        <span className="ml-auto text-[11px] text-muted">
          {working}/{reqs.length} seen working{data.openIssueCount ? ` · ${data.openIssueCount} open` : ''}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 text-xs">
          {reqs.length > 0 && (
            <ul className="space-y-1">
              {reqs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-body">
                  <StatusIcon status={r.status} />
                  <span className="truncate">{r.label}</span>
                  <span className={`ml-auto shrink-0 text-[11px] ${r.status === 'missing' ? 'text-danger' : 'text-muted'}`}>{STATUS_TEXT[r.status]}</span>
                </li>
              ))}
            </ul>
          )}
          {issues.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Still open</div>
              <ul className="space-y-1">
                {issues.map((i) => (
                  <li key={i.id} className="flex items-start gap-2 text-body">
                    <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${i.severity === 'error' ? 'text-danger' : 'text-warn'}`} aria-hidden />
                    <span>{i.message}{i.fixing ? <span className="text-muted"> — being worked on</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changes.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Changes</div>
              <ul className="space-y-1.5">
                {changes.map((c) => (
                  <li key={c.id} className="text-body">
                    <div className="flex items-center gap-2">
                      <span className="text-ink">{c.kind}</span>
                      <span className="text-muted">· {c.outcome}</span>
                      <span className="ml-auto text-[11px] text-faint">{c.ts ? new Date(c.ts).toLocaleString() : ''}</span>
                    </div>
                    {c.summary && <div className="text-muted truncate">{c.summary}</div>}
                    {c.lost > 0 && <div className="text-danger">This change lost {c.lost} feature{c.lost === 1 ? '' : 's'} that used to work.</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
