import React, { useState, useCallback } from 'react';
import {
  Bug, Wand2, Copy, Check, ChevronDown, ChevronRight,
  Loader2, Clock, X, History, Shield,
  Lightbulb, Search, Code2, CheckCircle2
} from 'lucide-react';

interface AIDebuggerProps {
  files?: Record<string, string>;
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

function generateMockResponse(error: string, code: string): DebugResult {
  const lower = error.toLowerCase();

  if (lower.includes('undefined') || lower.includes('cannot read')) {
    return {
      rootCause:
        "Aap ek aisi property access kar rahe ho jo `undefined` ya `null` object pe hai. Yeh tab hota hai jab variable initialize nahi hua ya async data abhi load nahi hua.",
      fix: `// Option 1: Optional chaining use karo
const value = obj?.property?.nestedProp;

// Option 2: Default value with nullish coalescing
const name = user?.name ?? 'Anonymous';

// Option 3: Guard clause
if (!data || !data.items) {
  return; // ya loading state show karo
}
const first = data.items[0];`,
      explanation: [
        "JavaScript mein `undefined.property` access karne pe TypeError throw hota hai.",
        "Yeh aksar async operations mein hota hai jab data fetch hone se pehle render ho jata hai.",
        "Optional chaining (`?.`) operator safely `undefined` return karta hai instead of throwing.",
        "Nullish coalescing (`??`) fallback value provide karta hai jab value null/undefined ho.",
      ],
      prevention: [
        "Hamesha optional chaining (`?.`) use karo nested objects ke liye.",
        "API responses ke liye loading/error states rakho.",
        "TypeScript strict mode enable karo — yeh compile time pe hi pakad lega.",
        "Default prop values aur default state values define karo.",
      ],
    };
  }

  if (lower.includes('module') || lower.includes('cannot find module') || lower.includes('import')) {
    return {
      rootCause:
        "Module resolve nahi ho pa raha — ya toh package install nahi hai, path galat hai, ya export/import mismatch hai.",
      fix: `# Step 1: Package install karo (agar missing hai)
npm install <package-name>

# Step 2: Relative path check karo
// Galat:
import { Foo } from './components/Foo'
// Sahi (file extension check karo):
import { Foo } from './components/Foo.tsx'

# Step 3: Named vs default export match karo
// Export:
export const MyComponent = () => ...
// Import:
import { MyComponent } from './MyComponent'`,
      explanation: [
        "Node.js aur bundlers (Vite/webpack) modules ko file system pe dhundhte hain.",
        "Agar package.json mein dependency nahi hai toh `npm install` se add karo.",
        "Relative paths case-sensitive hote hain Linux pe — check karo capitalization.",
        "Named exports `{}` se import hote hain, default exports bina `{}` ke.",
      ],
      prevention: [
        "TypeScript `moduleResolution: bundler` ya `node16` use karo.",
        "Import paths ke liye VS Code auto-complete use karo typos avoid karne ke liye.",
        "Path aliases configure karo (e.g., `@/components/...`) clean imports ke liye.",
        "Baad mein `npm ci` run karo ensure karne ke liye sab dependencies install hain.",
      ],
    };
  }

  if (lower.includes('cors') || lower.includes('cross-origin')) {
    return {
      rootCause:
        "Browser ne request block ki kyunki server ne proper CORS headers nahi bheje. Yeh browser security feature hai jo cross-origin requests restrict karta hai.",
      fix: `// Backend (Express.js example) pe CORS headers add karo:
import cors from 'cors';

app.use(cors({
  origin: ['http://localhost:5173', 'https://yourdomain.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// Ya specific route pe:
app.get('/api/data', cors(), (req, res) => {
  res.json({ data: 'ok' });
});`,
      explanation: [
        "CORS (Cross-Origin Resource Sharing) browser ki security policy hai.",
        "Jab frontend aur backend alag origins pe hote hain (different domain/port), browser preflight OPTIONS request bhejta hai.",
        "Server ko `Access-Control-Allow-Origin` header return karna hota hai.",
        "Development mein localhost ports alag hone se bhi CORS trigger hota hai.",
      ],
      prevention: [
        "Development ke liye Vite proxy use karo (`vite.config.ts` mein `server.proxy`).",
        "Production mein allowed origins whitelist karo, `*` use mat karo credentials ke saath.",
        "HTTPS ensure karo production mein — mixed content bhi block hota hai.",
        "API gateway (like nginx) use karo reverse proxy ke liye.",
      ],
    };
  }

  if (lower.includes('usestate') || lower.includes('useffect') || lower.includes('hook') || lower.includes('react')) {
    return {
      rootCause:
        "React Hook rules violate ho rahi hain — ya toh hook conditionally call ho rahi hai, ya non-component function mein, ya component render ke bahar.",
      fix: `// Galat — conditional hook call:
function MyComponent({ show }) {
  if (show) {
    const [val, setVal] = useState(0); // ERROR!
  }
}

// Sahi — hooks hamesha top level pe:
function MyComponent({ show }) {
  const [val, setVal] = useState(0); // Always called
  if (!show) return null;
  return <div>{val}</div>;
}

// Agar useState import bhool gaye:
import React, { useState, useEffect } from 'react';`,
      explanation: [
        "React hooks sirf function components ya custom hooks ke andar call ho sakte hain.",
        "Hooks hamesha same order mein call hone chahiye — loops/conditions ke andar nahi.",
        "Yeh rule React ke internal hook state array ke order par depend karta hai.",
        "Custom hooks ka naam `use` se start hona chahiye.",
      ],
      prevention: [
        "ESLint plugin `eslint-plugin-react-hooks` install karo — yeh automatically detect karta hai.",
        "Hooks ko component ke top pe define karo, kisi bhi early return se pehle.",
        "Conditional logic hook ke andar rakho, hook ko condition ke andar nahi.",
      ],
    };
  }

  return {
    rootCause:
      "Stack trace se lag raha hai ek runtime error hai. Code execution ek unexpected state mein pahunch gaya jiske liye handle nahi tha.",
    fix: `// General debugging approach:

// 1. Error boundary add karo React apps mein
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <h2>Kuch galat hua. Reload karo.</h2>;
    return this.props.children;
  }
}

// 2. Try-catch with meaningful messages
try {
  const result = riskyOperation();
} catch (error) {
  console.error('Operation failed:', error);
  // User-friendly error handle karo
}

// 3. Type narrowing
if (typeof value === 'string') {
  value.toUpperCase(); // safe
}`,
    explanation: [
      "Error stack trace upar se neeche padho — pehli line actual error hai, baaki call stack hai.",
      "Apni files ki lines dhundho stack trace mein (node_modules wali ignore karo).",
      "Browser DevTools mein breakpoints lagao reproduce karne ke liye.",
      "Console.log se values check karo problematic line ke aas paas.",
    ],
    prevention: [
      "TypeScript strict mode enable karo (`strict: true` in tsconfig.json).",
      "Error boundaries use karo React component trees mein.",
      "Input validation karo app boundaries pe (API responses, user input).",
      "Unit tests likho edge cases cover karne ke liye.",
    ],
  };
}

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

export const AIDebugger: React.FC<AIDebuggerProps> = ({ files }) => {
  const [activeTab, setActiveTab] = useState<ErrorTab>('JS/TS Error');
  const [errorText, setErrorText] = useState('');
  const [codeContext, setCodeContext] = useState('');
  const [codeContextOpen, setCodeContextOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [copiedFix, setCopiedFix] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
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

    try {
      const res = await fetch('/api/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: errorText,
          code: codeContext,
          errorType: activeTab,
          files: files ?? {},
        }),
      });
      if (!res.ok) throw new Error('API error');
      const data: DebugResult = await res.json();
      setResult(data);
      const entry: HistoryEntry = {
        id: Date.now().toString(),
        errorType: detectedType ?? activeTab,
        errorSnippet: errorText.slice(0, 100),
        timestamp: new Date().toISOString(),
        fix: data.fix.slice(0, 200),
      };
      saveHistory(entry);
      refreshHistory();
    } catch {
      const mock = generateMockResponse(errorText, codeContext);
      setResult(mock);
      const entry: HistoryEntry = {
        id: Date.now().toString(),
        errorType: detectedType ?? activeTab,
        errorSnippet: errorText.slice(0, 100),
        timestamp: new Date().toISOString(),
        fix: mock.fix.slice(0, 200),
      };
      saveHistory(entry);
      refreshHistory();
    } finally {
      clearInterval(stepInterval);
      setIsLoading(false);
    }
  }, [errorText, codeContext, activeTab, files, detectedType, refreshHistory]);

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

  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{ background: '#0d1117', color: '#e6edf3' }}
    >
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
                  color: activeTab === tab ? '#818cf8' : '#8b949e',
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
              placeholder="Error ya stack trace yahan paste karo..."
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
                style={{ color: '#8b949e' }}
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
                  placeholder="Relevant code snippet paste karo..."
                  rows={3}
                  className="w-full resize-none text-xs font-mono rounded p-2 outline-none"
                  style={{
                    background: '#161b22',
                    color: '#c9d1d9',
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
              style={{ color: '#8b949e', border: '1px solid rgba(255,255,255,0.1)' }}
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
                    color: '#8b949e',
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
              <Bug className="w-12 h-12" style={{ color: '#8b949e' }} />
              <p className="text-sm" style={{ color: '#8b949e' }}>
                Error paste karo, AI instant fix dega
              </p>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="flex items-center gap-2">
                <Loader2
                  className="w-5 h-5 animate-spin"
                  style={{ color: '#818cf8' }}
                />
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
                            ? '#c9d1d9'
                            : '#8b949e',
                      }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result cards */}
          {!isLoading && result && (
            <div className="flex flex-col gap-3">
              {/* Root Cause */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: '#161b22',
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
                <p className="text-sm leading-relaxed" style={{ color: '#c9d1d9' }}>
                  {result.rootCause}
                </p>
              </div>

              {/* Fix */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: '#161b22',
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
                        color: '#8b949e',
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
                    {files && Object.keys(files).length > 0 && (
                      <button
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          background: 'rgba(34,197,94,0.15)',
                          color: '#86efac',
                          border: '1px solid rgba(34,197,94,0.3)',
                        }}
                      >
                        Apply to File
                      </button>
                    )}
                  </div>
                </div>
                <pre
                  className="text-xs rounded p-3 overflow-x-auto"
                  style={{
                    background: '#0d1117',
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
                  background: '#161b22',
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
                      <span style={{ color: '#c9d1d9' }}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Prevention */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: '#161b22',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderLeftWidth: '3px',
                  borderLeftColor: '#f59e0b',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4" style={{ color: '#f59e0b' }} />
                  <span className="text-sm font-semibold" style={{ color: '#fcd34d' }}>
                    Aage se kaise bachein
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {result.prevention.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 shrink-0" style={{ color: '#f59e0b' }}>
                        •
                      </span>
                      <span style={{ color: '#c9d1d9' }}>{tip}</span>
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
          background: '#161b22',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Toggle button */}
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          className="flex items-center gap-2 px-2 py-3 border-b shrink-0"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#8b949e' }}
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
              <p className="text-xs text-center mt-4" style={{ color: '#8b949e' }}>
                Abhi koi history nahi
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
                    style={{ color: '#8b949e' }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <p
                  className="text-xs truncate"
                  style={{ color: '#8b949e', maxWidth: 200 }}
                >
                  {entry.errorSnippet}
                </p>
                <div className="flex items-center gap-1" style={{ color: '#6e7681' }}>
                  <Clock className="w-3 h-3" />
                  <span style={{ fontSize: 10 }}>{formatTime(entry.timestamp)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
