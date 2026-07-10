import { useEffect, useRef, useState } from 'react';

/**
 * 🧪 Test Chat — an ISOLATED page for validating AWS Bedrock GLM-5 independently.
 *
 * It talks to exactly one backend endpoint, POST /api/test-chat, which itself talks ONLY to AWS
 * Bedrock (SigV4, AWS SDK v3). It does not use — and cannot affect — the production chat/provider
 * system. On any AWS error the COMPLETE raw response is shown verbatim (no generic messages).
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface TestChatStatus {
  enabled: boolean;
  region: string;
  modelConfigured: boolean;
  modelId: string | null;
  credsConfigured: boolean;
  authMode?: 'bearer' | 'sigv4' | 'none';
}

interface TestChatResult {
  ok: boolean;
  text: string | null;
  apiUsed: 'mantle' | 'none';
  region?: string;
  modelId?: string | null;
  endpoint?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
  requestId?: string | null;
  httpStatus?: number | null;
  error?: unknown;
  logs?: Array<{ at: string; level: string; message: string; data?: unknown }>;
}

function Json({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="text-gray-500">null</span>;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="whitespace-pre-wrap break-words text-xs bg-black/40 text-gray-200 rounded p-2 overflow-x-auto max-h-72 overflow-y-auto">
      {text}
    </pre>
  );
}

export function TestChat(_props: { userId?: string }) {
  const [status, setStatus] = useState<TestChatStatus | null>(null);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<TestChatResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/test-chat/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, loading]);

  async function send() {
    const message = input.trim();
    if (!message || loading) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', content: message }]);
    setLoading(true);
    setLast(null);
    try {
      const res = await fetch('/api/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data: TestChatResult = await res.json().catch(() => ({
        ok: false,
        text: null,
        apiUsed: 'none',
        error: { name: 'ParseError', message: `Non-JSON response (HTTP ${res.status}).` },
      }));
      setLast(data);
      if (data.ok && data.text) {
        setTurns((t) => [...t, { role: 'assistant', content: data.text as string }]);
      } else {
        // Show the COMPLETE raw AWS error verbatim in the transcript, no generic masking.
        const raw =
          typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
        setTurns((t) => [
          ...t,
          { role: 'assistant', content: `❌ AWS Bedrock error (raw):\n${raw}` },
        ]);
      }
    } catch (e) {
      const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setLast({ ok: false, text: null, apiUsed: 'none', error: raw });
      setTurns((t) => [...t, { role: 'assistant', content: `❌ Network error (raw):\n${raw}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d1117] text-gray-100">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <h1 className="text-lg font-semibold flex items-center gap-2">🧪 Test Chat</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Isolated AWS Bedrock GLM-5 validation. Talks only to AWS Bedrock — never the production
          chat/providers.
        </p>
        {status && (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span
              className={`px-2 py-0.5 rounded ${
                status.enabled ? 'bg-green-900/60 text-green-300' : 'bg-yellow-900/60 text-yellow-300'
              }`}
            >
              {status.enabled ? 'Enabled' : 'Disabled (set TEST_CHAT_ENABLED=true)'}
            </span>
            <span className="px-2 py-0.5 rounded bg-white/5 text-gray-300">region: {status.region}</span>
            <span
              className={`px-2 py-0.5 rounded ${
                status.modelConfigured ? 'bg-white/5 text-gray-300' : 'bg-red-900/60 text-red-300'
              }`}
            >
              model: {status.modelId || 'NOT SET (BEDROCK_GLM_MODEL)'}
            </span>
            <span
              className={`px-2 py-0.5 rounded ${
                status.credsConfigured ? 'bg-white/5 text-gray-300' : 'bg-red-900/60 text-red-300'
              }`}
            >
              AWS auth:{' '}
              {status.credsConfigured
                ? status.authMode === 'bearer'
                  ? 'bearer token'
                  : status.authMode === 'sigv4'
                    ? 'access key'
                    : 'configured'
                : 'NOT SET'}
            </span>
          </div>
        )}
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {turns.length === 0 && (
          <div className="text-sm text-gray-500">
            Type <code className="bg-white/10 px-1 rounded">hi</code> and press Send — the reply comes
            directly from AWS Bedrock GLM-5.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-full text-left rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                t.role === 'user' ? 'bg-blue-600/80 text-white' : 'bg-white/10 text-gray-100'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">
                {t.role === 'user' ? 'User' : 'Assistant'}
              </div>
              {t.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-sm text-gray-400">Calling AWS Bedrock…</div>}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/10 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message for AWS Bedrock GLM-5…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium"
        >
          Send
        </button>
      </div>

      {/* Debug panel — the full forensic detail for validating the integration */}
      {last && (
        <div className="border-t border-white/10 p-3 space-y-2 max-h-[45vh] overflow-y-auto">
          <div className="text-xs font-semibold text-gray-300 flex flex-wrap gap-3">
            <span>Debug</span>
            <span>API: {last.apiUsed}</span>
            <span>ok: {String(last.ok)}</span>
            {last.httpStatus != null && <span>HTTP: {last.httpStatus}</span>}
            {last.requestId && <span>requestId: {last.requestId}</span>}
          </div>
          {last.endpoint && (
            <div className="text-[11px] text-gray-400 break-all">endpoint: {last.endpoint}</div>
          )}
          <details open={!last.ok}>
            <summary className="text-xs text-gray-400 cursor-pointer">Raw error</summary>
            <Json value={last.error} />
          </details>
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer">Request payload</summary>
            <Json value={last.requestPayload} />
          </details>
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer">Response payload</summary>
            <Json value={last.responsePayload} />
          </details>
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer">Logs</summary>
            <Json value={last.logs} />
          </details>
        </div>
      )}
    </div>
  );
}
