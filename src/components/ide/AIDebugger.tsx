import React, { useState, useCallback } from 'react';
import { Bug, Wand2, Copy, Check, ChevronDown, ChevronRight, Clock, X, History, Shield, Lightbulb, Search, Code2, CheckCircle2, FileSearch } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { AppScanPanel } from './AppScanPanel';

interface AIDebuggerProps {
  files?: Record<string, string>;
  /** Auto-fix handoff to the Pro v5 page for the scanned app (admin 2026-07-24). */
  onAutoFixInV5?: (workspaceId: string, text: string) => void;
}

type ErrorTab = 'JS/TS Error' | 'CSS Issue' | 'Network Error' | 'Build Error' | 'React Error';

interface DebugResult {
  rootCause: string;
  fix: string;
  explanation: string[];
  prevention: string[];
}

interface HistoryEntry {
  id: string;
  errorType: string;
  errorSnippet: string;
  timestamp: string;
  fix: string;
}

const ERROR_TABS: ErrorTab[] = ['JS/TS Error', 'CSS Issue', 'Network Error', 'Build Error', 'React Error'];

const QUICK_TEMPLATES = [
  "Cannot read properties of undefined",
  "Module not found",
  "CORS error",
  "useState not defined",
  "Unexpected token",
];

const STORAGE_KEY = 'navbharatai_debug_history';

function detectErrorType(error: string): string {
  if (/TypeError/i.test(error)) return 'TypeError';
  if (/ReferenceError/i.test(error)) return 'ReferenceError';
  if (/SyntaxError/i.test(error)) return 'SyntaxError';
  if (/CORS|cross-origin/i.test(error)) return 'CORS Error';
  if (/404|Not Found/i.test(error)) return 'Network 404';
  if (/500|Internal Server/i.test(error)) return 'Network 500';
  if (/Module not found|Cannot find module/i.test(error)) return 'Module Error';
  if (/useState|useEffect|Hook/i.test(error)) return 'React Hook Error';
  if (/Unexpected token|Parsing/i.test(error)) return 'Parse Error';
  if (/Cannot read/i.test(error)) return 'TypeError';
  return 'Unknown Error';
}

// generateMockResponse REMOVED (admin autopsy 2026-07-20): it rendered a canned, fake "AI
// analysis" whenever the real API failed — including the years the /api/debug route did not even
// exist — presenting fabricated output as real (rule-2 violation). Failures are now shown honestly.

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entry: HistoryEntry): void {
  try {
    const history = loadHistory();
    const updated = [entry, ...history].slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export const AIDebugger: React.FC<AIDebuggerProps> = ({ files, onAutoFixInV5 }) => {
  const [activeTab, setActiveTab] = useState<ErrorTab>('JS/TS Error');
  const [errorText, setErrorText] = useState('');
  const [codeContext, setCodeContext] = useState('');
  const [codeContextOpen, setCodeContextOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');
  const [copiedFix, setCopiedFix] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  // Two modes: paste a single error, or scan a whole app (a Pro v5 app / GitHub repo / open project).
  const [mode, setMode] = useState<'single' | 'app'>('single');
  const detectedType = errorText.trim() ? detectErrorType(errorText) : null;

  const loadingStepLabels = [
    'Reading stack trace...',
    'Identifying root cause...',
    'Generating fix...',
  ];

  const refreshHistory = useCallback(() => {
    setHistory(loadHistory());
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!errorText.trim()) return;
    setIsLoading(true);
    setResult(null);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((s) => (s < 2 ? s + 1 : s));
    }, 900);

    setAnalyzeError('');
    try {
      const res = await fetch('/api/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: errorText,
          code: codeContext,
          errorType: activeTab,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data && typeof data.error === 'string' && data.error)
          || 'The analysis service could not be reached — please try again.');
      }
      const parsed: DebugResult = {
        rootCause: typeof data.rootCause === 'string' ? data.rootCause : '',
        fix: typeof data.fix === 'string' ? data.fix : '',
        explanation: Array.isArray(data.explanation) ? data.explanation.filter((x: unknown) => typeof x === 'string') : [],
        prevention: Array.isArray(data.prevention) ? data.prevention.filter((x: unknown) => typeof x === 'string') : [],
      };
      setResult(parsed);
      const entry: HistoryEntry = {
        id: Date.now().toString(),
        errorType: detectedType ?? activeTab,
        errorSnippet: errorText.slice(0, 100),
        timestamp: new Date().toISOString(),
        fix: parsed.fix.slice(0, 200),
      };
      saveHistory(entry);
      refreshHistory();
    } catch (e) {
      // HONEST failure — no canned fake analysis, ever. The user sees the real reason and can retry.
      setResult(null);
      setAnalyzeError(e instanceof Error ? e.message : 'The analysis failed — please try again.');
    } finally {
      clearInterval(stepInterval);
      setIsLoading(false);
    }
  }, [errorText, codeContext, activeTab, detectedType, refreshHistory]);

  const handleCopyFix = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.fix).then(() => {
      setCopiedFix(true);
      setTimeout(() => setCopiedFix(false), 2000);
    });
  }, [result]);

  const handleClear = () => {
    setErrorText('');
    setCodeContext('');
    setResult(null);
    setAnalyzeError('');
  };

  const handleTemplate = (template: string) => {
    setErrorText(template);
    setResult(null);
  };

  const handleHistoryRestore = (entry: HistoryEntry) => {
    setErrorText(entry.errorSnippet);
    setResult(null);
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter((h) => h.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setHistory(updated);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const modeBtn = (m: 'single' | 'app') => ({
    background: mode === m ? 'rgba(129,140,248,0.15)' : 'rgba(255,255,255,0.04)',
    color: mode === m ? '#818cf8' : 'var(--text-muted)',
    border: `1px solid ${mode === m ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.08)'}`,
  });

  return (
    <div
      className="flex flex-col h-full w-full overflow-hidden"
      style={{ background: 'var(--surface-base)', color: 'var(--text-body)' }}
    >
      {/* Mode toggle: paste a single error, or scan a whole app */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <button onClick={() => setMode('single')} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium" style={modeBtn('single')}>
          <Wand2 className="w-3.5 h-3.5" /> Single Error
        </button>
        <button onClick={() => setMode('app')} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium" style={modeBtn('app')}>
          <FileSearch className="w-3.5 h-3.5" /> Full App Scan
        </button>
      </div>

      {mode === 'app' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <AppScanPanel files={files} onAutoFixInV5={onAutoFixInV5} />
        </div>
      ) : (
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* ── TOP SECTION (40%) ── */}
        <div
          className="flex flex-col border-b"
          style={{ height: '40%', borderColor: 'rgba(255,255,255,0.1)' }}
        >
          {/* Error type tabs */}
          <div
            className="flex items-center gap-0 border-b px-4 shrink-0"
            style={{ borderColor: 'rgba(255,255,255,0.1)' }}
          >
            {ERROR_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-2 text-xs font-medium transition-colors relative"
                style={{
                  color: activeTab === tab ? '#818cf8' : 'var(--text-muted)',
                }}
              >
                {tab}
                {activeTab === tab && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                    style={{ background: '#818cf8' }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Error textarea */}
          <div className="flex flex-col flex-1 min-h-0 px-4 pt-3 gap-2">
            <textarea
              value={errorText}
              onChange={(e) => setErrorText(e.target.value)}
              placeholder="Paste your error or stack trace here..."
              className="flex-1 min-h-0 resize-none text-xs font-mono rounded p-3 outline-none"
              style={{
                background: '#1a0a0a',
                color: '#f87171',
                borderLeft: '4px solid #ef4444',
                border: '1px solid rgba(239,68,68,0.3)',
                borderLeftWidth: '4px',
              }}
              spellCheck={false}
            />

            {/* Collapsible code context */}
            <div className="shrink-0">
              <button
                onClick={() => setCodeContextOpen((o) => !o)}
                className="flex items-center gap-1 text-xs mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                {codeContextOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <Code2 className="w-3 h-3" />
                Code context (optional)
              </button>
              {codeContextOpen && (
                <textarea
                  value={codeContext}
                  onChange={(e) => setCodeContext(e.target.value)}
                  placeholder="Paste the relevant code snippet..."
                  rows={3}
                  className="w-full resize-none text-xs font-mono rounded p-2 outline-none"
                  style={{
                    background: 'var(--surface-card)',
                    color: 'var(--text-body)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 shrink-0">
            <button
              onClick={handleAnalyze}
              disabled={!errorText.trim() || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-opacity"
              style={{
                background: '#4f46e5',
                color: 'white',
                opacity: !errorText.trim() || isLoading ? 0.5 : 1,
              }}
            >
              <Wand2 className="w-3.5 h-3.5" />
              AI se Fix Maango
            </button>

            <button
              onClick={handleClear}
              className="px-3 py-1.5 rounded text-xs transition-colors"
              style={{ color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Clear
            </button>

            {detectedType && (
              <span
                className="px-2 py-0.5 rounded text-xs font-mono"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
              >
                {detectedType}
              </span>
            )}

            <div className="flex-1" />

            {/* Quick templates */}
            <div className="flex flex-wrap gap-1">
              {QUICK_TEMPLATES.map((t) => (
                <button
                  key={t}
                  onClick={() => handleTemplate(t)}
                  className="px-2 py-0.5 rounded text-xs transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-muted)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── BOTTOM SECTION (60%) ── */}
        <div
          className="flex-1 min-h-0 overflow-y-auto p-4"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#30363d transparent' }}
        >
          {/* Empty state */}
          {!isLoading && !result && (
            <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
              <Bug className="w-12 h-12" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Paste an error and AI will instantly suggest a fix
              </p>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="flex items-center gap-2">
                <TirangaLoader className="w-5 h-5" />
                <span className="text-sm font-medium" style={{ color: '#818cf8' }}>
                  Analyzing error...
                </span>
              </div>
              <div className="flex flex-col gap-2 w-56">
                {loadingStepLabels.map((label, i) => (
                  <div key={label} className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0 transition-all"
                      style={{
                        background:
                          loadingStep > i
                            ? '#22c55e'
                            : loadingStep === i
                            ? '#818cf8'
                            : '#30363d',
                        boxShadow:
                          loadingStep === i
                            ? '0 0 6px #818cf8'
                            : 'none',
                      }}
                    />
                    <span
                      className="text-xs"
                      style={{
                        color:
                          loadingStep > i
                            ? '#22c55e'
                            : loadingStep === i
                            ? 'var(--text-body)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Honest failure banner — the real reason, never a canned fake analysis */}
          {!isLoading && analyzeError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-start gap-2">
              <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{analyzeError}</span>
            </div>
          )}

          {/* Result cards */}
          {!isLoading && result && (
            <div className="flex flex-col gap-3">
              {/* Root Cause */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'var(--surface-card)',
                  borderLeft: '3px solid #ef4444',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderLeftWidth: '3px',
                  borderLeftColor: '#ef4444',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Search className="w-4 h-4" style={{ color: '#ef4444' }} />
                  <span className="text-sm font-semibold" style={{ color: '#fca5a5' }}>
                    Root Cause
                  </span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
                  {result.rootCause}
                </p>
              </div>

              {/* Fix */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderLeftWidth: '3px',
                  borderLeftColor: '#22c55e',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" style={{ color: '#22c55e' }} />
                    <span className="text-sm font-semibold" style={{ color: '#86efac' }}>
                      Fix
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyFix}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        color: 'var(--text-muted)',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {copiedFix ? (
                        <Check className="w-3 h-3" style={{ color: '#22c55e' }} />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedFix ? 'Copied!' : 'Copy'}
                    </button>
                    {/* "Apply to File" was REMOVED here (admin 2026-08-21). It sat beside the working
                        "Copy" button, promising to write the AI's suggested fix straight into the
                        user's code — and it had NO onClick at all, so it never did. It could not have:
                        this component receives `files` READ-ONLY (`files?: Record<string, string>`) and
                        has no write path, which is presumably why the handler was never added.

                        It was not fixable as labelled either. This tab analyses an error the user
                        PASTES IN; there is no workspace and no identified target, so "apply to file"
                        has no defined destination or insertion point. Picking one would mean guessing
                        which file and where — inventing the thing the button claims to know.

                        The real auto-fix path already exists and is genuinely wired: the App Scan tab
                        scans a chosen Pro workspace and hands its findings to NavBharatAI Pro v5 via
                        `onAutoFixInV5`, which knows the workspace and can really edit the code. "Copy"
                        below delivers the fix text meanwhile. */}
                  </div>
                </div>
                <pre
                  className="text-xs rounded p-3 overflow-x-auto"
                  style={{
                    background: 'var(--surface-base)',
                    color: '#7ee787',
                    border: '1px solid rgba(255,255,255,0.06)',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {result.fix}
                </pre>
              </div>

              {/* Explanation */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderLeftWidth: '3px',
                  borderLeftColor: '#3b82f6',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4" style={{ color: '#3b82f6' }} />
                  <span className="text-sm font-semibold" style={{ color: '#93c5fd' }}>
                    Explanation
                  </span>
                </div>
                <ol className="flex flex-col gap-1.5 list-none">
                  {result.explanation.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span
                        className="mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ color: 'var(--text-body)' }}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Prevention */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderLeftWidth: '3px',
                  borderLeftColor: '#f59e0b',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4" style={{ color: '#f59e0b' }} />
                  <span className="text-sm font-semibold" style={{ color: '#fcd34d' }}>
                    How to avoid this in future
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {result.prevention.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 shrink-0" style={{ color: '#f59e0b' }}>
                        •
                      </span>
                      <span style={{ color: 'var(--text-body)' }}>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── HISTORY SIDEBAR ── */}
      <div
        className="flex flex-col shrink-0 border-l"
        style={{
          width: historyOpen ? 240 : 36,
          borderColor: 'rgba(255,255,255,0.1)',
          background: 'var(--surface-card)',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Toggle button */}
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          className="flex items-center gap-2 px-2 py-3 border-b shrink-0"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'var(--text-muted)' }}
        >
          <History className="w-4 h-4 shrink-0" />
          {historyOpen && (
            <span className="text-xs font-medium whitespace-nowrap">History</span>
          )}
        </button>

        {historyOpen && (
          <div
            className="flex flex-col gap-1 overflow-y-auto p-2 flex-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#30363d transparent' }}
          >
            {history.length === 0 && (
              <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
                No history yet
              </p>
            )}
            {history.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleHistoryRestore(entry)}
                className="group flex flex-col gap-1 w-full text-left rounded p-2 transition-colors hover:bg-white/5 relative"
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0"
                    style={{
                      background: 'rgba(239,68,68,0.15)',
                      color: '#f87171',
                      fontSize: 10,
                    }}
                  >
                    {entry.errorType}
                  </span>
                  <button
                    onClick={(e) => handleDeleteHistory(entry.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <p
                  className="text-xs truncate"
                  style={{ color: 'var(--text-muted)', maxWidth: 200 }}
                >
                  {entry.errorSnippet}
                </p>
                <div className="flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                  <Clock className="w-3 h-3" />
                  <span style={{ fontSize: 10 }}>{formatTime(entry.timestamp)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
};
