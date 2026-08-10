import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import { authJsonHeaders as authHeaders } from '../../lib/authHeaders';

/**
 * REAL workspace logs — the live record of the app the user is building, from two genuine sources:
 *
 *  1. BUILD LOG — the durable v5.0 live-event channel (GET /api/agentv3/live). It replays the
 *     build's real narration / file-change / result events from seq 0 and keeps polling while a
 *     build is running, so this screen shows the same progress the Pro v5.0 chat shows — synced
 *     across Settings, Code Studio and the v5.0 panel because they share one workspaceId.
 *  2. RUNTIME ERRORS — the preview-error records the diagnostics store captured from the app's own
 *     browser console (GET /api/agentv3/diagnostics → previewErrors). These are the user's OWN
 *     app's console errors — no internal/vendor detail is ever rendered here (white-label law).
 *
 * Honesty rules: every line shown is a real captured event; empty states say exactly why they are
 * empty (no build yet / no errors captured) — nothing is simulated.
 */
export interface WorkspaceLogsProps {
  workspaceId?: string;
  userId?: string;
  email?: string;
}

type LogLine = { kind: 'narration' | 'file' | 'done' | 'info'; text: string; ts: number };

const LIVE_POLL_ACTIVE_MS = 2500;   // while a build is running
const LIVE_POLL_IDLE_MS = 10000;    // idle watch — cheap, keeps the view live if a build starts
const MAX_LINES = 400;              // bounded scrollback


function fmtTime(ts: number): string {
  try { return new Date(ts).toLocaleTimeString(); } catch { return ''; }
}

export const WorkspaceLogs: React.FC<WorkspaceLogsProps> = ({ workspaceId, userId, email }) => {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [previewErrors, setPreviewErrors] = useState<Array<{ ts: number; source: string; message: string }>>([]);
  const [diagLoading, setDiagLoading] = useState(false);
  const seqRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll only while the user is at the bottom (don't yank them while reading history).
  useEffect(() => {
    if (stickToBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const onScroll = () => {
    const el = scrollBoxRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const pollLive = useCallback(async () => {
    if (!workspaceId || !userId) return;
    try {
      const params = new URLSearchParams({ sinceSeq: String(seqRef.current), workspaceId });
      params.set('userId', userId);
      if (email) params.set('email', email);
      const res = await fetch(`/api/agentv3/live?${params.toString()}`, { headers: await authHeaders() });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) return;
      seqRef.current = typeof j.seq === 'number' ? j.seq : seqRef.current;
      setRunning(Boolean(j.running));
      const events: any[] = Array.isArray(j.events) ? j.events : [];
      if (events.length > 0) {
        const next: LogLine[] = [];
        for (const ev of events) {
          if (!ev || typeof ev !== 'object') continue;
          if (ev.type === 'narration' && typeof ev.text === 'string' && ev.text.trim()) {
            next.push({ kind: 'narration', text: ev.text.trim(), ts: ev.ts || Date.now() });
          } else if (ev.type === 'file_changed' && ev.change?.path) {
            const verb = ev.change.kind === 'delete' ? 'deleted' : ev.change.kind === 'create' ? 'created' : 'updated';
            next.push({ kind: 'file', text: `${verb} ${ev.change.path}`, ts: ev.ts || Date.now() });
          } else if (ev.type === 'result') {
            next.push({ kind: 'done', text: ev.ok === false ? 'Build finished with problems.' : 'Build finished.', ts: ev.ts || Date.now() });
          }
        }
        if (next.length > 0) setLines((cur) => [...cur, ...next].slice(-MAX_LINES));
      }
    } catch { /* network hiccup — next poll retries */ }
    finally { setLoaded(true); }
  }, [workspaceId, userId, email]);

  const fetchDiagnostics = useCallback(async () => {
    if (!workspaceId) return;
    setDiagLoading(true);
    try {
      const params = new URLSearchParams({ workspaceId });
      if (userId) params.set('userId', userId);
      if (email) params.set('email', email);
      const res = await fetch(`/api/agentv3/diagnostics?${params.toString()}`, { headers: await authHeaders() });
      const j = await res.json().catch(() => null);
      const errs = j?.diagnostics?.previewErrors;
      // WHITE-LABEL: only the app's OWN browser-console records are surfaced — never internal
      // report fields (issues, llmCalls, provider telemetry), which stay admin-only.
      setPreviewErrors(Array.isArray(errs)
        ? errs.filter((e: any) => e && typeof e.message === 'string')
            .map((e: any) => ({ ts: Number(e.ts) || 0, source: String(e.source || ''), message: String(e.message) }))
            .slice(-30)
        : []);
    } catch { /* keep the last known list */ }
    finally { setDiagLoading(false); }
  }, [workspaceId, userId, email]);

  // Live poll loop — fast while a build runs, slow idle watch otherwise.
  useEffect(() => {
    if (!workspaceId || !userId) { setLoaded(true); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      await pollLive();
      if (stopped) return;
      timer = setTimeout(tick, running ? LIVE_POLL_ACTIVE_MS : LIVE_POLL_IDLE_MS);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [workspaceId, userId, pollLive, running]);

  // Runtime errors: load once, refresh when a build completes (a 'done' line arrived).
  const doneCount = lines.filter((l) => l.kind === 'done').length;
  useEffect(() => { void fetchDiagnostics(); }, [fetchDiagnostics, doneCount]);

  const colorFor = (k: LogLine['kind']) =>
    k === 'done' ? 'text-emerald-400' : k === 'file' ? 'text-sky-400' : k === 'info' ? 'text-[#8b949e]' : 'text-[#c9d1d9]';

  if (!userId) {
    return <div className="p-6 text-white text-center text-sm">Please log in to see your app&apos;s logs.</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white">
      {/* Build log */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e] flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          Build log
          {running && <span className="text-amber-400 normal-case font-bold tracking-normal">— build running…</span>}
        </span>
      </div>
      <div ref={scrollBoxRef} onScroll={onScroll} className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 font-mono text-[11px] leading-relaxed select-text">
        {!loaded && <div className="text-[#8b949e]">Loading logs…</div>}
        {loaded && lines.length === 0 && (
          <div className="text-[#8b949e]">
            No build activity recorded yet for this workspace. Start a build in NavBharatAI Pro v5.0 chat — its live progress will appear here.
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`${colorFor(l.kind)} whitespace-pre-wrap break-words`}>
            <span className="text-[#484f58] select-none">{fmtTime(l.ts)} </span>
            {l.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Runtime errors from the app's own browser console */}
      <div className="border-t border-white/10 shrink-0 max-h-[38%] flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#8b949e] flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Runtime errors ({previewErrors.length})
          </span>
          <button
            onClick={() => void fetchDiagnostics()}
            disabled={diagLoading}
            className="p-1 text-[#8b949e] hover:text-white hover:bg-white/5 rounded disabled:opacity-40"
            aria-label="Refresh runtime errors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="overflow-y-auto no-scrollbar px-3 py-2 font-mono text-[11px] leading-relaxed select-text">
          {previewErrors.length === 0 ? (
            <div className="text-[#8b949e]">No runtime errors captured from your app&apos;s preview. Open the Preview — any console error it hits is recorded here.</div>
          ) : (
            previewErrors.map((e, i) => (
              <div key={i} className="text-red-400 whitespace-pre-wrap break-words mb-1">
                <span className="text-[#484f58] select-none">{e.ts ? fmtTime(e.ts) : ''} </span>
                {e.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
