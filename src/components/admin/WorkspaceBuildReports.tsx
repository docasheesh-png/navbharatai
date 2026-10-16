// ONE APP'S BUILD REPORTS — the body of the "v" button on every card in Admin → Apps (admin 2026-10-15:
// "apps ke andar hi har app me ek 'v' button ho, click krne se us app ka build report open ho jaye").
//
// It adds NO new data and NO new route: it reads `GET /api/admin/all-builds/:workspaceId` — the same
// answer the All builds card's expand row reads — and hands Copy / Download back to the dashboard's own
// `copyWorkspaceReport` / `downloadWorkspaceReport`. That is deliberate. Those two functions also write the
// "taken" mark (admin 2026-09-14: one report must not reach two sessions), so a second copy of them here
// would let a report leave the admin's hands UNMARKED — the exact failure that mark exists to prevent.
//
// Honest states, each its own message: loading · the server said there is no report for this app (a build
// that never recorded one) · the request failed (with Try again) · reports found. Nothing is drawn from a
// guess: a field the record does not hold reads "not recorded", never a blank that looks like "fine".

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { ordinal } from '../adminReportParts';

export interface BuildHistoryItem {
  id: string;
  startedAt?: number;
  ok?: boolean;
  prompt?: string;
  summary?: string;
}

/** What the headline needs from the latest full report. Every field optional — a legacy record holds fewer. */
export interface LatestBuildFacts {
  startedAt?: number;
  ok?: boolean;
  summary?: string;
  rootCause?: string;
  prompt?: string;
}

export type WorkspaceReportsAnswer =
  | { kind: 'found'; latest: LatestBuildFacts | null; history: BuildHistoryItem[] }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

/** Read the route's answer into one of the three outcomes. PURE — the component's only view of a response. */
export function readWorkspaceReports(status: number, body: unknown): WorkspaceReportsAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (status === 404) return { kind: 'none' };
  if (status < 200 || status >= 300) {
    return { kind: 'error', message: typeof b.error === 'string' && b.error ? b.error : `The server answered ${status}.` };
  }
  if (!Array.isArray(b.history) && (b.latest === undefined || b.latest === null)) {
    return { kind: 'error', message: 'The server answered in a shape this screen does not know.' };
  }
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object' && typeof (h as Record<string, unknown>).id === 'string')
    .map((h) => ({
      id: h.id as string,
      startedAt: typeof h.startedAt === 'number' ? h.startedAt : undefined,
      ok: typeof h.ok === 'boolean' ? h.ok : undefined,
      prompt: typeof h.prompt === 'string' ? h.prompt : undefined,
      summary: typeof h.summary === 'string' ? h.summary : undefined,
    }));
  const l = b.latest && typeof b.latest === 'object' ? (b.latest as Record<string, unknown>) : null;
  const latest: LatestBuildFacts | null = l ? {
    startedAt: typeof l.startedAt === 'number' ? l.startedAt : undefined,
    ok: typeof l.ok === 'boolean' ? l.ok : undefined,
    summary: typeof l.summary === 'string' ? l.summary : undefined,
    rootCause: typeof l.rootCause === 'string' ? l.rootCause : undefined,
    prompt: typeof l.prompt === 'string' ? l.prompt : undefined,
  } : null;
  return { kind: 'found', latest, history };
}

export interface WorkspaceBuildReportsProps {
  workspaceId: string;
  headers: Record<string, string>;
  /** The dashboard's own copy / download — they write the "taken" mark too. `buildId` omitted = the whole session. */
  onCopy: (workspaceId: string, buildId?: string) => void;
  onDownload: (workspaceId: string, buildId?: string) => void;
}

const BTN = 'shrink-0 min-h-[32px] text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border';

function Dot({ ok }: { ok?: boolean }) {
  return <span className={`shrink-0 w-2 h-2 rounded-full ${ok === true ? 'bg-success' : ok === false ? 'bg-danger' : 'bg-faint'}`} aria-hidden />;
}

/** What the panel shows for one settled answer. Presentational, so a static render can prove every state. */
export function WorkspaceReportsView({ answer, workspaceId, onCopy, onDownload, onRetry }: {
  answer: WorkspaceReportsAnswer;
  workspaceId: string;
  onCopy: (workspaceId: string, buildId?: string) => void;
  onDownload: (workspaceId: string, buildId?: string) => void;
  onRetry: () => void;
}) {
  const a = answer;
  if (a.kind === 'none') {
    return <p className="text-[12px] text-muted" role="status">No build report was recorded for this app — it has no builds on file. (A build that stopped before writing its record leaves none.)</p>;
  }
  if (a.kind === 'error') {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-[12px] font-bold text-danger">Could not load this app's reports. {a.message}</p>
        <button onClick={onRetry} className={`${BTN} border-line text-body hover:text-ink inline-flex items-center gap-1.5`}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Try again
        </button>
      </div>
    );
  }
  const { latest, history } = a;
  return (
    <div className="space-y-3">
      {/* THE HEADLINE — the latest build, in the engine's own words. */}
      <div className="rounded-xl bg-well border border-line px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Dot ok={latest?.ok} />
          <span className="text-[10px] font-black uppercase tracking-wider text-muted">Latest build</span>
          <span className="text-[11px] font-bold text-ink">
            {latest?.ok === true ? 'Succeeded' : latest?.ok === false ? 'Did not succeed' : 'Outcome not recorded'}
          </span>
          {latest?.startedAt ? <span className="text-[10px] text-faint">{new Date(latest.startedAt).toLocaleString()}</span> : null}
        </div>
        <p className="text-[11px] text-body leading-relaxed break-words">{latest?.summary || 'No summary was recorded for this build.'}</p>
        {latest?.rootCause ? <p className="text-[11px] text-warn leading-relaxed break-words">Root cause: {latest.rootCause}</p> : null}
      </div>

      {/* THE WHOLE 0→100% SESSION — every recorded build of this app, oldest to newest. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onCopy(workspaceId)} className={`${BTN} border-success text-success hover:bg-success/10`}>⧉ Copy session</button>
        <button onClick={() => onDownload(workspaceId)} className={`${BTN} border-accent text-accent-text hover:bg-accent/10`}>⬇ Full session</button>
        <span className="text-[10px] text-faint">{history.length} earlier build{history.length === 1 ? '' : 's'} on file</span>
      </div>

      {history.length === 0 ? (
        <p className="text-[11px] text-muted">Only the latest report exists for this app — “Full session” above is that report.</p>
      ) : (
        <ul className="space-y-1">
          {/* NUMBERED 1st, 2nd, 3rd … in BUILD order, counted from the far end of the newest-first list, so "1st"
              here is the same build as "1st part" in the session download (the All builds card does the same). */}
          {history.map((h, i) => (
            <li key={h.id} className="flex items-center gap-3 py-1">
              <Dot ok={h.ok} />
              <span className="shrink-0 text-[10px] font-black text-muted tabular-nums w-9">{ordinal(history.length - i)}</span>
              <span className="flex-1 min-w-0 text-[11px] text-body truncate">
                {h.startedAt ? new Date(h.startedAt).toLocaleString() : h.id} — {h.prompt || h.summary || 'build'}
              </span>
              <button onClick={() => onCopy(workspaceId, h.id)} className={`${BTN} border-success text-success hover:bg-success/10`}>⧉ Copy</button>
              <button onClick={() => onDownload(workspaceId, h.id)} className={`${BTN} border-line text-muted hover:text-ink hover:bg-raised`}>⬇ This build</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WorkspaceBuildReports({ workspaceId, headers, onCopy, onDownload }: WorkspaceBuildReportsProps) {
  const [state, setState] = useState<{ s: 'loading' } | { s: 'done'; answer: WorkspaceReportsAnswer }>({ s: 'loading' });

  const load = useCallback(async () => {
    setState({ s: 'loading' });
    try {
      const r = await fetch(`/api/admin/all-builds/${encodeURIComponent(workspaceId)}`, { headers });
      const body = await r.json().catch(() => null);
      setState({ s: 'done', answer: readWorkspaceReports(r.status, body) });
    } catch (e) {
      setState({ s: 'done', answer: { kind: 'error', message: e instanceof Error ? e.message : 'Could not reach the server.' } });
    }
  }, [workspaceId, headers]);

  useEffect(() => { void load(); }, [load]);

  if (state.s === 'loading') {
    return <p className="flex items-center gap-2 text-[12px] font-bold text-muted" role="status"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading this app's builds…</p>;
  }
  return <WorkspaceReportsView answer={state.answer} workspaceId={workspaceId} onCopy={onCopy} onDownload={onDownload} onRetry={() => void load()} />;
}
