import React, { useState, useEffect, useCallback } from 'react';
import {
  Send, Clock, Copy, Check, Trash2, Plus, ChevronDown,
  ArrowRight, Save, RefreshCcw, Globe
} from 'lucide-react';
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

const QUICK_TESTS: { label: string; method: HttpMethod; url: string; body?: string }[] = [
  { label: 'Test /api/health', method: 'GET', url: 'http://localhost:3000/api/health' },
  { label: 'Test /api/ai-chat', method: 'POST', url: 'http://localhost:3000/api/ai-chat', body: '{"message":"Hello"}' },
  { label: 'Test /api/sda-chat', method: 'POST', url: 'http://localhost:3000/api/sda-chat', body: '{"message":"Hello"}' },
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

  useEffect(() => { saveHistory(history); }, [history]);

  const addToHistory = useCallback((cfg: Omit<RequestConfig, 'id' | 'savedAt'>) => {
    const entry: RequestConfig = { ...cfg, id: crypto.randomUUID(), savedAt: new Date() };
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

    const init: RequestInit = { method, headers: activeHeaders };
    if (['POST', 'PUT', 'PATCH'].includes(method) && body.trim()) {
      init.body = body.trim();
    }

    const start = performance.now();
    try {
      const res = await fetch(finalUrl, init);
      const elapsed = Math.round(performance.now() - start);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      const resBody = await res.text();

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: tryPrettyJson(resBody),
        time: elapsed,
      });

      addToHistory({ name: saveName || finalUrl, method, url: finalUrl, headers, body });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('network')
          ? `Network error: ${msg}\n\nThis may be a CORS issue. Ensure the server allows requests from this origin, or use a proxy.`
          : `Request failed: ${msg}`
      );
    } finally {
      setLoading(false);
    }
  }, [url, method, params, headers, body, authToken, saveName, addToHistory]);

  const handleQuickTest = (qt: typeof QUICK_TESTS[0]) => {
    setMethod(qt.method);
    setUrl(qt.url);
    if (qt.body) setBody(qt.body);
    setActiveTab(qt.body ? 'body' : 'params');
  };

  const loadFromHistory = (cfg: RequestConfig) => {
    setMethod(cfg.method);
    setUrl(cfg.url);
    setHeaders(cfg.headers);
    setBody(cfg.body);
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

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'params', label: 'Params' },
    { id: 'headers', label: 'Headers' },
    { id: 'body', label: 'Body' },
    { id: 'auth', label: 'Auth' },
  ];

  return (
    <div className="flex h-full bg-[#0d1117] text-gray-200 font-mono text-sm overflow-hidden">
      {/* ── History sidebar ────────────────────────────────────────── */}
      <div className="w-[200px] shrink-0 bg-[#161b22] border-r border-[#30363d] flex flex-col">
        <div className="px-3 py-2 border-b border-[#30363d] flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
          <Clock size={12} /> History
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 && (
            <p className="text-xs text-gray-600 px-3 py-4 text-center">No saved requests</p>
          )}
          {history.map(cfg => (
            <button
              key={cfg.id}
              onClick={() => loadFromHistory(cfg)}
              className="w-full text-left px-3 py-2 hover:bg-[#21262d] border-b border-[#21262d] transition-colors group"
            >
              <div className={cn('text-[10px] font-bold', METHOD_COLORS[cfg.method])}>{cfg.method}</div>
              <div className="text-xs text-gray-300 truncate">{cfg.name}</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-gray-600 truncate">{cfg.url}</span>
                <button
                  onClick={e => { e.stopPropagation(); setHistory(prev => prev.filter(h => h.id !== cfg.id)); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
                >
                  <Trash2 size={10} />
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
              className="w-full text-left flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded px-1.5 py-1 transition-colors"
            >
              <ArrowRight size={10} className="shrink-0" />
              <span className="truncate">{qt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* URL bar */}
        <div className="px-4 py-3 bg-[#161b22] border-b border-[#30363d] flex items-center gap-2">
          {/* Method selector */}
          <div className="relative">
            <button
              onClick={() => setMethodOpen(o => !o)}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-bold transition-colors',
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
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />

          <button
            onClick={handleSend}
            disabled={loading || !url.trim()}
            className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white text-xs font-semibold transition-colors"
          >
            {loading ? <RefreshCcw size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>

          <button
            onClick={() => setShowSaveInput(s => !s)}
            title="Save request"
            className="p-1.5 text-gray-500 hover:text-indigo-400 transition-colors"
          >
            <Save size={16} />
          </button>
        </div>

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
        <div className="h-[50%] flex flex-col border-b border-[#30363d] overflow-hidden">
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
        <div className="h-[50%] flex flex-col overflow-hidden">
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
                <RefreshCcw size={14} className="animate-spin" /> Sending request...
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
