// Full-App Debugger — the "scan a whole app" panel (admin request 2026-07-24).
//
// The AI Debugger's single-error mode analyzes ONE pasted error. This panel is the second mode: pick a
// SOURCE — an app you built with NavBharatAI Pro, or a connected GitHub repository — and NavBharatAI
// reads its real files, finds real problems, and lists each with an exact file:line + a fix suggestion.
//
// Two layers run on the server and stream back here as NDJSON: a deterministic static scan over every
// file (its findings carry a "Verified" badge) + an AI semantic pass over the source files. Honest
// throughout — real counts, an explicit degraded note when the deep pass is briefly unavailable, and
// nothing here (or from the server) names any underlying AI provider (white-label).

import React, { useState, useCallback, useEffect } from 'react';
import {
  Bug, Loader2, Github, Box, RefreshCw, AlertTriangle, ShieldCheck,
  ChevronDown, ChevronRight, FileSearch, CheckCircle2, Sparkles, Wrench,
} from 'lucide-react';
import { authJsonHeaders } from '../../lib/authHeaders';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  category: string;
  problem: string;
  suggestion: string;
  source: 'static' | 'ai';
}
interface ProjectHealth {
  score: number;
  verdict: string;
  topCategories: Array<{ category: string; count: number }>;
}
interface ScanSummary {
  filesTotal: number;
  filesStaticScanned: number;
  filesAiScanned: number;
  filesAiSkippedForBudget: number;
  counts: Record<Severity, number>;
  total: number;
  health: ProjectHealth;
}
interface DeepDive { rootCause: string; fix: string; explanation: string[]; prevention: string[]; }
interface DeepDiveState { loading?: boolean; error?: string; result?: DeepDive; }
interface ProApp { workspaceId: string; label: string; fileCount: number; savedAt: number; }
interface Repo { full_name: string; name: string; }

interface AppScanPanelProps {
  /** The project currently open in the editor (an extra, real, always-available source). */
  files?: Record<string, string>;
  /**
   * Auto-fix: hand the findings to the NavBharatAI Pro v5 page for the SCANNED app (admin 2026-07-24).
   * Only wired for a Pro v5 app source — the v5 builder then really fixes that app's files.
   */
  onAutoFixInV5?: (workspaceId: string, text: string) => void;
}

/** Build the fix instruction v5 receives — the real, ranked findings with file:line + suggested fix. */
function buildFixPrompt(findings: Finding[], health?: ProjectHealth): string {
  const top = findings.slice(0, 40);
  const lines = top.map((f, i) => {
    const loc = `${f.file}${f.line ? `:${f.line}` : ''}`;
    const fix = f.suggestion ? `\n   Suggested fix: ${f.suggestion}` : '';
    return `${i + 1}. [${f.severity.toUpperCase()}] ${loc} — ${f.problem}${fix}`;
  });
  const more = findings.length > top.length ? `\n\n(+${findings.length - top.length} more lower-priority issues.)` : '';
  const header = health
    ? `NavBharatAI's debugger scanned this app (health ${health.score}/100) and found ${findings.length} issue${findings.length === 1 ? '' : 's'}. Please fix them in the actual project files:`
    : `NavBharatAI's debugger found ${findings.length} issue${findings.length === 1 ? '' : 's'} in this app. Please fix them in the actual project files:`;
  return `${header}\n\n${lines.join('\n')}${more}\n\nApply real fixes to the code, then make sure the app still builds and runs correctly.`;
}

type SourceKind = 'pro' | 'github' | 'current';

const SEV_STYLE: Record<Severity, { bg: string; fg: string; label: string }> = {
  critical: { bg: 'rgba(220,38,38,0.15)', fg: '#f87171', label: 'CRITICAL' },
  high: { bg: 'rgba(239,68,68,0.12)', fg: '#fb923c', label: 'HIGH' },
  medium: { bg: 'rgba(245,158,11,0.12)', fg: '#fcd34d', label: 'MEDIUM' },
  low: { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8', label: 'LOW' },
};

export const AppScanPanel: React.FC<AppScanPanelProps> = ({ files, onAutoFixInV5 }) => {
  const [kind, setKind] = useState<SourceKind>('pro');
  const [proApps, setProApps] = useState<ProApp[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [ghToken, setGhToken] = useState<string | null>(null);
  const [selectedPro, setSelectedPro] = useState<string>('');
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState('');

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [progress, setProgress] = useState<{ batch: number; total: number; files: string[] } | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  // For the deep-dive investigation: the scanned file map (github/open project) + the active source.
  const [scannedFiles, setScannedFiles] = useState<Record<string, string> | null>(null);
  const [activeSource, setActiveSource] = useState<{ kind: SourceKind; workspaceId?: string } | null>(null);
  const [deepDive, setDeepDive] = useState<Record<number, DeepDiveState>>({});

  // Load the two source lists: the user's Pro v5 apps (auth) + connected GitHub repos (gh_token).
  const loadSources = useCallback(async () => {
    setLoadingSources(true);
    setSourcesError('');
    // Pro v5 apps
    try {
      const res = await fetch('/api/app-debug/sources', { headers: await authJsonHeaders() });
      if (res.ok) {
        const data = await res.json();
        setProApps(Array.isArray(data?.proV5Apps) ? data.proV5Apps : []);
      } else if (res.status === 401) {
        setProApps([]);
      }
    } catch {
      setSourcesError('Could not load your NavBharatAI Pro apps — please try again.');
    }
    // GitHub repos (only if the account is already connected in the IDE)
    let token: string | null = null;
    try { token = localStorage.getItem('gh_token'); } catch { token = null; }
    setGhToken(token);
    if (token) {
      try {
        const res = await fetch('/api/github/repos', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const list = await res.json();
          setRepos(Array.isArray(list) ? list.map((r: any) => ({ full_name: r.full_name, name: r.name })) : []);
        }
      } catch { /* leave repos empty — honest "none loaded" state */ }
    }
    setLoadingSources(false);
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const hasCurrent = !!files && Object.keys(files).length > 0;

  const resetResults = () => {
    setFindings([]); setSummary(null); setNotes([]); setRunError(''); setProgress(null); setExpanded({}); setDeepDive({});
  };

  const handleEvent = useCallback((evt: any) => {
    switch (evt?.type) {
      case 'meta':
        setPhase('Reading files…');
        break;
      case 'progress':
        setPhase('Deep-scanning source files…');
        setProgress({ batch: evt.batch, total: evt.totalBatches, files: Array.isArray(evt.files) ? evt.files : [] });
        break;
      case 'findings':
        // Live liveness only; the authoritative, de-duplicated list arrives in `done`.
        if (Array.isArray(evt.findings)) setFindings((prev) => prev.length ? prev : []);
        break;
      case 'note':
        if (typeof evt.message === 'string') setNotes((n) => [...n, evt.message]);
        break;
      case 'done':
        if (Array.isArray(evt.findings)) setFindings(evt.findings);
        if (evt.summary) setSummary(evt.summary);
        if (typeof evt.note === 'string') setNotes((n) => [...n, evt.note]);
        setProgress(null);
        setPhase('');
        break;
      case 'error':
        setRunError(typeof evt.message === 'string' ? evt.message : 'The scan failed — please try again.');
        break;
      default:
        break;
    }
  }, []);

  const streamRun = useCallback(async (payload: any, headers: Record<string, string>) => {
    const res = await fetch('/api/app-debug/run', { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      throw new Error((data && typeof data.error === 'string' && data.error) || 'The scan could not be started — please try again.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) { try { handleEvent(JSON.parse(line)); } catch { /* skip a partial line */ } }
      }
    }
    const tail = buf.trim();
    if (tail) { try { handleEvent(JSON.parse(tail)); } catch { /* ignore */ } }
  }, [handleEvent]);

  const handleScan = useCallback(async () => {
    resetResults();
    setRunning(true);
    setPhase('Starting scan…');
    try {
      if (kind === 'pro') {
        if (!selectedPro) throw new Error('Choose one of your NavBharatAI Pro apps to scan.');
        setScannedFiles(null); // the server holds the files; investigate loads them by workspaceId
        setActiveSource({ kind: 'pro', workspaceId: selectedPro });
        await streamRun({ source: 'workspace', workspaceId: selectedPro }, await authJsonHeaders());
      } else if (kind === 'current') {
        if (!hasCurrent) throw new Error('There is no open project in the editor to scan.');
        setScannedFiles(files || null);
        setActiveSource({ kind: 'current' });
        await streamRun({ source: 'github', files }, await authJsonHeaders());
      } else {
        if (!selectedRepo) throw new Error('Choose a GitHub repository to scan.');
        if (!ghToken) throw new Error('Connect your GitHub account in the IDE first, then reload this list.');
        const [owner, repo] = selectedRepo.split('/');
        setPhase('Fetching repository files…');
        const fetchRes = await fetch('/api/github/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ghToken}` },
          body: JSON.stringify({ owner, repo }),
        });
        const fetchData = await fetchRes.json().catch(() => null);
        if (!fetchRes.ok || !fetchData?.files || Object.keys(fetchData.files).length === 0) {
          throw new Error((fetchData && typeof fetchData.error === 'string' && fetchData.error) || 'Could not read the repository files.');
        }
        setScannedFiles(fetchData.files);
        setActiveSource({ kind: 'github' });
        await streamRun({ source: 'github', files: fetchData.files }, await authJsonHeaders());
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'The scan failed — please try again.');
    } finally {
      setRunning(false);
      setPhase('');
      setProgress(null);
    }
  }, [kind, selectedPro, selectedRepo, ghToken, hasCurrent, files, streamRun]);

  // Deep-dive: ask NavBharatAI for the root cause + full fix of ONE finding, using its real file.
  const investigate = useCallback(async (index: number, f: Finding) => {
    setDeepDive((d) => ({ ...d, [index]: { loading: true } }));
    try {
      const body: any = { problem: `${f.problem}${f.suggestion ? ` (suggested: ${f.suggestion})` : ''}`, file: f.file, line: f.line };
      if (activeSource?.kind === 'pro') {
        body.source = 'workspace';
        body.workspaceId = activeSource.workspaceId;
      } else if (scannedFiles && typeof scannedFiles[f.file] === 'string') {
        body.code = scannedFiles[f.file];
      }
      const res = await fetch('/api/app-debug/investigate', { method: 'POST', headers: await authJsonHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && typeof data.error === 'string' && data.error) || 'The investigation could not be completed — please try again.');
      setDeepDive((d) => ({ ...d, [index]: { result: {
        rootCause: typeof data.rootCause === 'string' ? data.rootCause : '',
        fix: typeof data.fix === 'string' ? data.fix : '',
        explanation: Array.isArray(data.explanation) ? data.explanation.filter((x: unknown) => typeof x === 'string') : [],
        prevention: Array.isArray(data.prevention) ? data.prevention.filter((x: unknown) => typeof x === 'string') : [],
      } } }));
    } catch (e) {
      setDeepDive((d) => ({ ...d, [index]: { error: e instanceof Error ? e.message : 'Investigation failed.' } }));
    }
  }, [activeSource, scannedFiles]);

  const canScan = !running && (
    (kind === 'pro' && !!selectedPro) ||
    (kind === 'github' && !!selectedRepo) ||
    (kind === 'current' && hasCurrent)
  );

  const scannedLine = summary
    ? `Scanned ${summary.filesStaticScanned} file${summary.filesStaticScanned === 1 ? '' : 's'}` +
      (summary.filesAiSkippedForBudget > 0
        ? ` · deep AI pass covered ${summary.filesAiScanned} (${summary.filesAiSkippedForBudget} more not deep-scanned this run)`
        : summary.filesAiScanned > 0 ? ` · deep AI pass covered ${summary.filesAiScanned}` : '')
    : '';

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: '#0d1117', color: '#e6edf3' }}>
      {/* Source picker */}
      <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-2 mb-3">
          <FileSearch className="w-4 h-4" style={{ color: '#818cf8' }} />
          <span className="text-sm font-semibold">Scan a whole app for problems</span>
          <button
            onClick={loadSources}
            disabled={loadingSources || running}
            title="Reload sources"
            className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{ color: '#8b949e', border: '1px solid rgba(255,255,255,0.1)', opacity: loadingSources ? 0.5 : 1 }}
          >
            <RefreshCw className={`w-3 h-3 ${loadingSources ? 'animate-spin' : ''}`} /> Reload
          </button>
        </div>

        {/* Source-kind tabs */}
        <div className="flex items-center gap-2 mb-3">
          <SourceTab active={kind === 'pro'} onClick={() => setKind('pro')} icon={<Box className="w-3.5 h-3.5" />} label="NavBharatAI Pro app" />
          <SourceTab active={kind === 'github'} onClick={() => setKind('github')} icon={<Github className="w-3.5 h-3.5" />} label="GitHub repo" />
          {hasCurrent && (
            <SourceTab active={kind === 'current'} onClick={() => setKind('current')} icon={<Bug className="w-3.5 h-3.5" />} label="Open project" />
          )}
        </div>

        {/* Source list */}
        <div className="max-h-40 overflow-y-auto rounded" style={{ scrollbarWidth: 'thin' }}>
          {kind === 'pro' && (
            proApps.length === 0
              ? <Empty text={loadingSources ? 'Loading your apps…' : 'No NavBharatAI Pro apps found yet. Build an app with NavBharatAI Pro, then it will appear here.'} />
              : proApps.map((a) => (
                <Choice key={a.workspaceId} selected={selectedPro === a.workspaceId} onClick={() => setSelectedPro(a.workspaceId)} title={a.label} sub={`${a.fileCount} files`} />
              ))
          )}
          {kind === 'github' && (
            !ghToken
              ? <Empty text="Connect your GitHub account in the IDE (Code Studio → GitHub) first, then press Reload." />
              : repos.length === 0
                ? <Empty text={loadingSources ? 'Loading repositories…' : 'No repositories loaded. Press Reload.'} />
                : repos.map((r) => (
                  <Choice key={r.full_name} selected={selectedRepo === r.full_name} onClick={() => setSelectedRepo(r.full_name)} title={r.name} sub={r.full_name} />
                ))
          )}
          {kind === 'current' && (
            <Empty text={`The project currently open in the editor (${Object.keys(files || {}).length} files) will be scanned.`} />
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleScan}
            disabled={!canScan}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: '#4f46e5', color: 'white', opacity: canScan ? 1 : 0.5 }}
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSearch className="w-3.5 h-3.5" />}
            {running ? 'Scanning…' : 'Scan for problems'}
          </button>
          {sourcesError && <span className="text-xs" style={{ color: '#f87171' }}>{sourcesError}</span>}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin' }}>
        {/* Running / progress */}
        {running && (
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex items-center gap-2 text-sm" style={{ color: '#818cf8' }}>
              <Loader2 className="w-4 h-4 animate-spin" /> {phase || 'Scanning…'}
            </div>
            {progress && (
              <div className="text-xs" style={{ color: '#8b949e' }}>
                Batch {progress.batch}/{progress.total} · reading{' '}
                <span style={{ color: '#c9d1d9' }}>{progress.files.slice(0, 3).join(', ')}{progress.files.length > 3 ? ` +${progress.files.length - 3} more` : ''}</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {runError && (
          <div className="rounded-lg border px-4 py-3 text-sm flex items-start gap-2 mb-4"
            style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{runError}</span>
          </div>
        )}

        {/* Health header */}
        {summary && (
          <div className="mb-3 flex items-center gap-3 rounded-lg p-3" style={{ background: '#161b22', border: '1px solid rgba(255,255,255,0.07)' }}>
            {(() => {
              const s = summary.health.score;
              const col = s >= 75 ? '#22c55e' : s >= 50 ? '#fcd34d' : s >= 25 ? '#fb923c' : '#f87171';
              return (
                <div className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 52, height: 52, border: `3px solid ${col}` }}>
                  <span className="text-lg font-bold" style={{ color: col }}>{s}</span>
                </div>
              );
            })()}
            <div className="min-w-0">
              <div className="text-sm font-semibold" style={{ color: '#e6edf3' }}>App health {summary.health.score}/100</div>
              <div className="text-xs" style={{ color: '#8b949e' }}>{summary.health.verdict}</div>
              {summary.health.topCategories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {summary.health.topCategories.map((c) => (
                    <span key={c.category} className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(255,255,255,0.05)', color: '#8b949e', fontSize: 10 }}>
                      {c.category} · {c.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Auto-fix in NavBharatAI Pro (only for a scanned Pro v5 app — v5 fixes that app's real files) */}
        {summary && findings.length > 0 && onAutoFixInV5 && activeSource?.kind === 'pro' && activeSource.workspaceId && (
          <button
            onClick={() => onAutoFixInV5(activeSource.workspaceId!, buildFixPrompt(findings, summary.health))}
            className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold w-full justify-center"
            style={{ background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', color: 'white' }}
            title="Opens this app in NavBharatAI Pro with the fixes ready to apply"
          >
            <Wrench className="w-4 h-4" /> Auto-fix these in NavBharatAI Pro
          </button>
        )}

        {/* Summary bar */}
        {summary && (
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
                <span key={s} className="px-2 py-0.5 rounded text-xs font-semibold"
                  style={{ background: SEV_STYLE[s].bg, color: SEV_STYLE[s].fg }}>
                  {summary.counts[s]} {SEV_STYLE[s].label}
                </span>
              ))}
              <span className="text-xs" style={{ color: '#8b949e' }}>· {summary.total} total</span>
            </div>
            {scannedLine && <div className="text-xs" style={{ color: '#6e7681' }}>{scannedLine}</div>}
          </div>
        )}

        {/* Honest notes (degraded deep pass, budget skips, etc.) */}
        {notes.map((n, i) => (
          <div key={i} className="text-xs mb-2 flex items-start gap-1.5" style={{ color: '#fcd34d' }}>
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> <span>{n}</span>
          </div>
        ))}

        {/* Findings list */}
        {summary && findings.length === 0 && !runError && (
          <div className="flex flex-col items-center justify-center gap-2 py-10" style={{ color: '#22c55e' }}>
            <CheckCircle2 className="w-10 h-10" />
            <p className="text-sm">No problems found — {summary.filesStaticScanned} files scanned clean.</p>
          </div>
        )}

        {findings.map((f, i) => {
          const st = SEV_STYLE[f.severity] || SEV_STYLE.low;
          const open = expanded[i] ?? (f.severity === 'critical' || f.severity === 'high');
          return (
            <div key={i} className="rounded-lg mb-2" style={{ background: '#161b22', border: '1px solid rgba(255,255,255,0.07)', borderLeft: `3px solid ${st.fg}` }}>
              <button onClick={() => setExpanded((e) => ({ ...e, [i]: !open }))} className="w-full flex items-start gap-2 px-3 py-2 text-left">
                {open ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#8b949e' }} /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#8b949e' }} />}
                <span className="px-1.5 py-0.5 rounded text-xs font-semibold shrink-0" style={{ background: st.bg, color: st.fg, fontSize: 10 }}>{st.label}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm" style={{ color: '#c9d1d9' }}>{f.problem}</span>
                  <span className="flex items-center gap-2 mt-0.5 text-xs" style={{ color: '#6e7681' }}>
                    <span className="font-mono truncate">{f.file}{f.line ? `:${f.line}` : ''}</span>
                    <span className="px-1 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>{f.category}</span>
                    {f.source !== 'ai' && (
                      <span className="flex items-center gap-0.5" style={{ color: '#22c55e' }} title="Deterministic — verified, not AI-guessed">
                        <ShieldCheck className="w-3 h-3" /> Verified
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {open && (
                <div className="px-3 pb-3 pl-8 flex flex-col gap-2">
                  {f.suggestion && (
                    <div className="rounded p-2 text-xs" style={{ background: '#0d1117', color: '#7ee787', border: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      <span style={{ color: '#86efac', fontWeight: 600 }}>Suggested fix: </span>{f.suggestion}
                    </div>
                  )}
                  {/* Deep-dive investigation */}
                  {(() => {
                    const dd = deepDive[i];
                    if (dd?.result) {
                      const r = dd.result;
                      return (
                        <div className="rounded p-2.5 text-xs flex flex-col gap-2" style={{ background: '#0d1117', border: '1px solid rgba(59,130,246,0.25)' }}>
                          {r.rootCause && <div><span style={{ color: '#93c5fd', fontWeight: 600 }}>Root cause: </span><span style={{ color: '#c9d1d9' }}>{r.rootCause}</span></div>}
                          {r.fix && (
                            <pre className="rounded p-2 overflow-x-auto" style={{ background: '#161b22', color: '#7ee787', border: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.fix}</pre>
                          )}
                          {r.explanation.length > 0 && (
                            <ol className="flex flex-col gap-1 list-none">
                              {r.explanation.map((s, k) => (
                                <li key={k} className="flex items-start gap-1.5"><span style={{ color: '#60a5fa' }}>{k + 1}.</span><span style={{ color: '#c9d1d9' }}>{s}</span></li>
                              ))}
                            </ol>
                          )}
                          {r.prevention.length > 0 && (
                            <div style={{ color: '#8b949e' }}>
                              <span style={{ color: '#fcd34d', fontWeight: 600 }}>Prevent it: </span>{r.prevention.join(' ')}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (dd?.error) return <div className="text-xs" style={{ color: '#f87171' }}>{dd.error}</div>;
                    return (
                      <button
                        onClick={() => investigate(i, f)}
                        disabled={dd?.loading}
                        className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                        style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)', opacity: dd?.loading ? 0.6 : 1 }}
                      >
                        {dd?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {dd?.loading ? 'Investigating…' : 'Investigate & fix'}
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty initial state */}
        {!running && !summary && !runError && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <FileSearch className="w-12 h-12" style={{ color: '#8b949e' }} />
            <p className="text-sm text-center" style={{ color: '#8b949e' }}>
              Pick an app or repository above and NavBharatAI will read every file<br />and list the real problems it finds, with fixes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const SourceTab: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
    style={{ background: active ? 'rgba(129,140,248,0.15)' : 'rgba(255,255,255,0.04)', color: active ? '#818cf8' : '#8b949e', border: `1px solid ${active ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.08)'}` }}>
    {icon}{label}
  </button>
);

const Choice: React.FC<{ selected: boolean; onClick: () => void; title: string; sub: string }> = ({ selected, onClick, title, sub }) => (
  <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2 text-left rounded transition-colors"
    style={{ background: selected ? 'rgba(129,140,248,0.12)' : 'transparent' }}>
    <span className="w-3 h-3 rounded-full shrink-0" style={{ border: `2px solid ${selected ? '#818cf8' : '#484f58'}`, background: selected ? '#818cf8' : 'transparent' }} />
    <span className="flex-1 min-w-0">
      <span className="block text-sm truncate" style={{ color: '#c9d1d9' }}>{title}</span>
      <span className="block text-xs truncate font-mono" style={{ color: '#6e7681' }}>{sub}</span>
    </span>
  </button>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-xs px-3 py-4 text-center" style={{ color: '#8b949e' }}>{text}</p>
);
