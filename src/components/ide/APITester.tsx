import React, { useState, useEffect, useCallback } from 'react';
import {
  Send, Clock, Copy, Check, Trash2, Plus, ChevronDown,
  ArrowRight, Save, RefreshCcw, Globe, X, ShieldAlert
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface APITesterProps {}

interface KVRow {
  key: string;
  value: string;
  enabled: boolean;
}

interface RequestConfig {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers: KVRow[];
  body: string;
  savedAt: Date;
}

interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type ActiveTab = 'params' | 'headers' | 'body' | 'auth';

// ─── Constants ────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green-400',
  POST: 'text-blue-400',
  PUT: 'text-orange-400',
  DELETE: 'text-red-400',
  PATCH: 'text-yellow-400',
};

const METHOD_BG: Record<HttpMethod, string> = {
  GET: 'bg-green-500/10 border-green-500/30',
  POST: 'bg-blue-500/10 border-blue-500/30',
  PUT: 'bg-orange-500/10 border-orange-500/30',
  DELETE: 'bg-red-500/10 border-red-500/30',
  PATCH: 'bg-yellow-500/10 border-yellow-500/30',
};

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const LS_KEY = 'navbharatai_api_history';
const MAX_HISTORY = 20;

// Quick tests point at REAL same-origin NavBharatAI endpoints (admin autopsy 2026-07-21) — the old
// presets hit http://localhost:3000, a dev-only host that 404s for every deployed user. Relative
// URLs resolve against the app's own origin, so these return live data on web and in the app.
const QUICK_TESTS: { label: string; method: HttpMethod; url: string; body?: string }[] = [
  { label: 'GET /api/capabilities', method: 'GET', url: '/api/capabilities' },
  { label: 'GET /api/release/gate', method: 'GET', url: '/api/release/gate' },
  { label: 'GET /api/knowledge-base', method: 'GET', url: '/api/knowledge-base' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeClass(status: number): string {
  if (status >= 200 && status < 300) return 'bg-green-500/20 text-green-300 border-green-500/40';
  if (status >= 400 && status < 500) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
  if (status >= 500) return 'bg-red-500/20 text-red-300 border-red-500/40';
  return 'bg-gray-500/20 text-gray-300 border-gray-500/40';
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function buildUrl(base: string, params: KVRow[]): string {
  const active = params.filter(p => p.enabled && p.key.trim());
  if (!active.length) return base;
  const qs = active.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
}

// SECURITY: never persist auth/secret-bearing headers to localStorage history (they'd sit in plaintext
// on disk). The Auth-tab Bearer token is already kept out of history; this also strips a manually-typed
// Authorization/Cookie/api-key header before saving. The user re-enters the secret when replaying — safer.
const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|x-auth-token|x-access-token|x-secret)$/i;

function stripSensitiveHeaders(rows: KVRow[]): KVRow[] {
  return rows.filter((r) => !SENSITIVE_HEADER_RE.test((r.key || '').trim()));
}

function loadHistory(): RequestConfig[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RequestConfig[];
  } catch {
    return [];
  }
}

function saveHistory(history: RequestConfig[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const KVEditor: React.FC<{
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  showCheckbox?: boolean;
}> = ({ rows, onChange, showCheckbox = true }) => {
  const update = (idx: number, field: keyof KVRow, val: string | boolean) => {
    const next = rows.map((r, i) => i === idx ? { ...r, [field]: val } : r);
    onChange(next);
  };
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { key: '', value: '', enabled: true }]);

  return (
    <div className="space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          {showCheckbox && (
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={e => update(i, 'enabled', e.target.checked)}
              className="accent-indigo-500 shrink-0"
            />
          )}
          <input
            value={row.key}
            onChange={e => update(i, 'key', e.target.value)}
            placeholder="Key"
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <input
            value={row.value}
            onChange={e => update(i, 'value', e.target.value)}
            placeholder="Value"
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <button onClick={() => remove(i)} className="text-gray-600 hover:text-red-400 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 mt-1"
      >
        <Plus size={12} /> Add row
      </button>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const APITester: React.FC<APITesterProps> = () => {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('params');
  const [params, setParams] = useState<KVRow[]>([{ key: '', value: '', enabled: true }]);
  const [headers, setHeaders] = useState<KVRow[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [body, setBody] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RequestConfig[]>(loadHistory);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [copied, setCopied] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [showRawHeaders, setShowRawHeaders] = useState(false);
  // History is a slide-out drawer now (mobile-friendly) instead of a permanent half-screen column.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Route via the SSRF-guarded server proxy (default ON) so cross-origin APIs work despite browser
  // CORS. Turn off for a direct browser fetch (same-origin or CORS-enabled endpoints).
  const [useProxy, setUseProxy] = useState(true);

  useEffect(() => { saveHistory(history); }, [history]);

  const addToHistory = useCallback((cfg: Omit<RequestConfig, 'id' | 'savedAt'>) => {
    // Never write a secret-bearing header to localStorage (see stripSensitiveHeaders).
    const entry: RequestConfig = { ...cfg, headers: stripSensitiveHeaders(cfg.headers), id: crypto.randomUUID(), savedAt: new Date() };
    setHistory(prev => [entry, ...prev].slice(0, MAX_HISTORY));
  }, []);

  const handleSend = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    const finalUrl = buildUrl(url.trim(), params);
    const activeHeaders: Record<string, string> = {};
    headers.filter(h => h.enabled && h.key.trim()).forEach(h => {
      activeHeaders[h.key] = h.value;
    });
    if (authToken.trim()) {
      activeHeaders['Authorization'] = `Bearer ${authToken.trim()}`;
    }

    const reqBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && body.trim() ? body.trim() : undefined;
    // Same-origin / relative URLs have no CORS problem and the proxy needs an absolute URL — always
    // fetch those directly. The proxy is only for cross-origin absolute URLs.
    const sameOrigin = finalUrl.startsWith('/') || (typeof window !== 'undefined' && finalUrl.startsWith(window.location.origin));
    const routeViaProxy = useProxy && !sameOrigin;
    const start = performance.now();
    try {
      let status: number, statusText: string, resHeaders: Record<string, string>, resBody: string, truncated = false;
      if (routeViaProxy) {
        // Route through NavBharatAI's SSRF-guarded server proxy so cross-origin APIs (which the
        // browser would block with CORS) actually return a response. The server fetches, we render.
        const pr = await fetch('/api/devtools/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: finalUrl, method, headers: activeHeaders, body: reqBody }),
        });
        const data = await pr.json().catch(() => null);
        if (!pr.ok || !data) throw new Error((data && data.error) || `Proxy error (${pr.status}).`);
        status = data.status; statusText = data.statusText || ''; resHeaders = data.headers || {};
        resBody = String(data.body ?? ''); truncated = !!data.truncated;
      } else {
        // Direct browser fetch (same-origin or a CORS-enabled API).
        const init: RequestInit = { method, headers: activeHeaders };
        if (reqBody !== undefined) init.body = reqBody;
        const res = await fetch(finalUrl, init);
        status = res.status; statusText = res.statusText; resHeaders = {};
        res.headers.forEach((v, k) => { resHeaders[k] = v; });
        resBody = await res.text();
      }
      const elapsed = Math.round(performance.now() - start);
      setResponse({
        status,
        statusText,
        headers: resHeaders,
        body: tryPrettyJson(resBody) + (truncated ? '\n\n…(response truncated at 5 MB)' : ''),
        time: elapsed,
      });
      addToHistory({ name: saveName || finalUrl, method, url: finalUrl, headers, body });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        !routeViaProxy && (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('failed to fetch'))
          ? `Network/CORS error: ${msg}\n\nTip: turn ON "Route via NavBharatAI" to bypass CORS.`
          : `Request failed: ${msg}`
      );
    } finally {
      setLoading(false);
    }
  }, [url, method, params, headers, body, authToken, saveName, addToHistory, useProxy]);

  const handleQuickTest = (qt: typeof QUICK_TESTS[0]) => {
    setMethod(qt.method);
    setUrl(qt.url);
    if (qt.body) setBody(qt.body);
    setActiveTab(qt.body ? 'body' : 'params');
    setHistoryOpen(false); // dismiss the drawer after picking (mobile-friendly)
  };

  const loadFromHistory = (cfg: RequestConfig) => {
    setMethod(cfg.method);
    setUrl(cfg.url);
    setHeaders(cfg.headers);
    setBody(cfg.body);
    setHistoryOpen(false); // dismiss the drawer after picking (mobile-friendly)
  };

  const handleCopy = () => {
    if (!response) return;
    navigator.clipboard.writeText(response.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveRequest = () => {
    if (!url.trim()) return;
    addToHistory({ name: saveName || url, method, url, headers, body });
    setSaveName('');
    setShowSaveInput(false);
  };

  const formatJson = () => {
    setBody(tryPrettyJson(body));
  };

  // Safety: an absolute http:// target sends the request (and any token) in PLAINTEXT on the wire.
  // Relative/same-origin URLs inherit the page's HTTPS, so they are not flagged.
  const insecureTarget = /^http:\/\//i.test(url.trim());

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'params', label: 'Params' },
    { id: 'headers', label: 'Headers' },
    { id: 'body', label: 'Body' },
    { id: 'auth', label: 'Auth' },
  ];

  return (
    <div className="relative flex h-full bg-[#0d1117] text-gray-200 font-mono text-sm overflow-hidden">
      {/* ── History slide-out drawer (mobile-friendly) ─────────────── */}
      {historyOpen && (
        <div className="absolute inset-0 bg-black/50 z-30" onClick={() => setHistoryOpen(false)} aria-hidden />
      )}
      <div
        className={cn(
          'absolute top-0 left-0 h-full w-[270px] max-w-[82%] bg-[#161b22] border-r border-[#30363d] z-40 flex flex-col transition-transform duration-200 ease-out',
          historyOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="px-3 py-2.5 border-b border-[#30363d] flex items-center justify-between text-xs text-gray-400 uppercase tracking-wide">
          <span className="flex items-center gap-2"><Clock size={12} /> History</span>
          <button onClick={() => setHistoryOpen(false)} className="p-1 -mr-1 text-gray-500 hover:text-gray-200 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 && (
            <p className="text-xs text-gray-600 px-3 py-4 text-center">No saved requests</p>
          )}
          {history.map(cfg => (
            <button
              key={cfg.id}
              onClick={() => loadFromHistory(cfg)}
              className="w-full text-left px-3 py-2.5 hover:bg-[#21262d] border-b border-[#21262d] transition-colors group"
            >
              <div className={cn('text-[10px] font-bold', METHOD_COLORS[cfg.method])}>{cfg.method}</div>
              <div className="text-xs text-gray-300 truncate">{cfg.name}</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-gray-600 truncate">{cfg.url}</span>
                <button
                  onClick={e => { e.stopPropagation(); setHistory(prev => prev.filter(h => h.id !== cfg.id)); }}
                  className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1 -mr-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </button>
          ))}
        </div>
        {/* Quick tests */}
        <div className="border-t border-[#30363d] px-2 py-2 space-y-1">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Quick Tests</p>
          {QUICK_TESTS.map(qt => (
            <button
              key={qt.label}
              onClick={() => handleQuickTest(qt)}
              className="w-full text-left flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded px-1.5 py-1.5 transition-colors"
            >
              <ArrowRight size={10} className="shrink-0" />
              <span className="truncate">{qt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area (full width) ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — wraps into two rows on narrow screens so nothing gets clipped */}
        <div className="px-2 sm:px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex flex-col gap-2">
          {/* Row 1: history toggle + method + URL */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              title="History & quick tests"
              className="relative flex items-center gap-1.5 px-2 py-1.5 rounded border border-[#30363d] text-gray-400 hover:text-gray-200 hover:border-indigo-500/50 transition-colors shrink-0"
            >
              <Clock size={14} />
              <span className="hidden sm:inline text-xs">History</span>
              {history.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[9px] leading-none rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center">
                  {history.length}
                </span>
              )}
            </button>

            {/* Method selector */}
            <div className="relative shrink-0">
              <button
                onClick={() => setMethodOpen(o => !o)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold transition-colors',
                  METHOD_BG[method], METHOD_COLORS[method]
                )}
              >
                {method} <ChevronDown size={12} />
              </button>
              {methodOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[#161b22] border border-[#30363d] rounded shadow-xl z-50">
                  {HTTP_METHODS.map(m => (
                    <button
                      key={m}
                      onClick={() => { setMethod(m); setMethodOpen(false); }}
                      className={cn('block w-full text-left px-4 py-1.5 text-xs font-bold hover:bg-[#21262d] transition-colors', METHOD_COLORS[m])}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="https://api.example.com/endpoint"
              className="flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Row 2: send + save + CORS toggle (wraps as needed) */}
          <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
            <button
              onClick={handleSend}
              disabled={loading || !url.trim()}
              className="flex items-center justify-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white text-xs font-semibold transition-colors flex-1 sm:flex-none"
            >
              {loading ? <TirangaLoader size={14} /> : <Send size={14} />}
              Send
            </button>

            <button
              onClick={() => setShowSaveInput(s => !s)}
              title="Save request"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#30363d] text-gray-500 hover:text-indigo-400 hover:border-indigo-500/50 transition-colors text-xs shrink-0"
            >
              <Save size={14} /> <span className="hidden sm:inline">Save</span>
            </button>

            {/* CORS bypass toggle — route cross-origin requests through NavBharatAI's SSRF-guarded proxy. */}
            <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer select-none" title="Cross-origin APIs are blocked by the browser (CORS). Routing through NavBharatAI's server fetches them for you.">
              <input
                type="checkbox"
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                className="accent-indigo-500"
              />
              Route via NavBharatAI (bypass CORS)
            </label>
          </div>
        </div>

        {/* Safety: warn when the target is unencrypted http:// */}
        {insecureTarget && (
          <div className="flex items-start gap-2 px-2 sm:px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-400">
            <ShieldAlert size={13} className="shrink-0 mt-0.5" />
            <span>This is an <b>http://</b> (unencrypted) URL — the request and any auth token travel in plaintext. Prefer <b>https://</b> where the API supports it.</span>
          </div>
        )}

        {/* Save request input */}
        {showSaveInput && (
          <div className="px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center gap-2">
            <Globe size={14} className="text-gray-500 shrink-0" />
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="Request name (optional)"
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleSaveRequest}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded text-white transition-colors"
            >
              Save
            </button>
          </div>
        )}

        {/* Top half: request config */}
        <div className="flex-1 min-h-0 flex flex-col border-b border-[#30363d] overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-[#30363d] bg-[#161b22] shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-2 text-xs transition-colors',
                  activeTab === tab.id
                    ? 'text-indigo-400 border-b-2 border-indigo-500 bg-[#0d1117]'
                    : 'text-gray-500 hover:text-gray-300'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">
            {activeTab === 'params' && (
              <KVEditor rows={params} onChange={setParams} />
            )}
            {activeTab === 'headers' && (
              <KVEditor rows={headers} onChange={setHeaders} />
            )}
            {activeTab === 'body' && (
              <div className="h-full flex flex-col gap-2">
                {['POST', 'PUT', 'PATCH'].includes(method) ? (
                  <>
                    <div className="flex justify-end">
                      <button
                        onClick={formatJson}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        <RefreshCcw size={10} /> Format JSON
                      </button>
                    </div>
                    <textarea
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      placeholder='{"key": "value"}'
                      className="flex-1 w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none font-mono"
                      rows={8}
                    />
                  </>
                ) : (
                  <p className="text-xs text-gray-600 mt-4 text-center">
                    Body is not available for {method} requests.
                  </p>
                )}
              </div>
            )}
            {activeTab === 'auth' && (
              <div className="space-y-3">
                <label className="block text-xs text-gray-400">Bearer Token</label>
                <input
                  value={authToken}
                  onChange={e => setAuthToken(e.target.value)}
                  placeholder="Enter token..."
                  type="password"
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-gray-600">
                  Adds <code className="text-indigo-400">Authorization: Bearer &lt;token&gt;</code> header.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom half: response */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] shrink-0">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Response</span>
            {response && (
              <div className="flex items-center gap-3">
                <span className={cn('px-2 py-0.5 rounded border text-xs font-bold', statusBadgeClass(response.status))}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock size={11} /> {response.time}ms
                </span>
                <button
                  onClick={() => setShowRawHeaders(s => !s)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  {showRawHeaders ? 'Body' : 'Headers'}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-400 transition-colors"
                >
                  {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 bg-[#0d1117]">
            {loading && (
              <div className="flex items-center gap-2 text-indigo-400 text-xs">
                <TirangaLoader size={14} /> Sending request...
              </div>
            )}
            {error && (
              <pre className="text-xs text-red-400 whitespace-pre-wrap leading-relaxed">{error}</pre>
            )}
            {!loading && !error && !response && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
                <Send size={24} className="opacity-30" />
                <p className="text-xs">Hit Send to get a response</p>
              </div>
            )}
            {response && !showRawHeaders && (
              <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{response.body}</pre>
            )}
            {response && showRawHeaders && (
              <div className="space-y-1">
                {Object.entries(response.headers).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <span className="text-indigo-400 shrink-0">{k}:</span>
                    <span className="text-gray-300 break-all">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default APITester;
