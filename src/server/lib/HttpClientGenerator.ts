// U-4 (verified recipe modules) — resilient HTTP client (fetchJson with timeout, dependency-free).
//
// The single most common way a server request hangs FOREVER: a bare `await fetch(url)` to a third-party API
// that stops responding. `fetch` has NO default timeout, so one slow upstream ties up the request (and, under
// load, exhausts the server). The other silent bug is treating a 4xx/5xx as success (fetch only rejects on a
// network error, not on an HTTP error status). So this recipe ships a correct client:
// fetchJson() adds an AbortController timeout (so a dead upstream fails FAST with a clear error, never hangs),
// throws on a non-2xx status with the status + body snippet, and returns parsed JSON. Dependency-free (native
// fetch + AbortController), no env keys. Pairs with the retry recipe. PURE builder; correct and complete — no
// TODO stubs (the real-features rule). Unit-tested.

export interface HttpClientConfig {
  files: Record<string, string>;
  instructions: string;
}

const HTTP_SERVER = `export interface FetchJsonOptions extends RequestInit {
  /** Abort (and reject) after this many ms. Default 10000. Prevents a dead upstream from hanging the request. */
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super('HTTP ' + status + ' for ' + url + (body ? ': ' + body.slice(0, 200) : ''));
    this.name = 'HttpError';
  }
}

// fetch JSON with a real timeout and honest error handling. Rejects with a clear TimeoutError if the upstream
// does not respond in time (native fetch would hang forever), throws HttpError on any non-2xx status (native
// fetch resolves on 4xx/5xx — a classic silent bug), and returns the parsed JSON body on success.
//   const user = await fetchJson<User>('https://api.example.com/users/1', { timeoutMs: 5000 });
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 10000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, url, body);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const e = new Error('Request to ' + url + ' timed out after ' + timeoutMs + 'ms');
      e.name = 'TimeoutError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
`;

const INSTRUCTIONS =
  'Resilient HTTP client wired at server/lib/http.ts (no dependency). Replace bare fetch to third-party APIs ' +
  'with await fetchJson(url, { timeoutMs, headers, method, body }): it adds a REAL timeout (default 10s) so a ' +
  'dead upstream fails fast instead of hanging the request forever, throws HttpError on any non-2xx status ' +
  '(native fetch does NOT — it resolves on 4xx/5xx, a classic silent bug), and returns parsed JSON. Wrap it ' +
  'with the retry recipe for automatic backoff on transient failures. No API key needed.';

export function generateHttpClientIntegration(): HttpClientConfig {
  return {
    files: { 'server/lib/http.ts': HTTP_SERVER },
    instructions: INSTRUCTIONS,
  };
}
