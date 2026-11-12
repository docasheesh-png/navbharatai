import { qubaxConfig } from './qubax';

export const QUBAX_BALANCE_TIMEOUT_MS = 10_000;
export const QUBAX_BALANCE_MAX_BYTES = 16_384;
export type QubaxBalanceCode = 'disabled' | 'configuration' | 'cancelled' | 'busy' | 'timeout' | 'authentication' | 'permission' | 'rate-limit' | 'provider-error' | 'invalid-response' | 'unavailable';
export type QubaxBalanceSnapshot = { status: 'unknown'; code: QubaxBalanceCode } | { status: 'available'; currency: 'USD'; balanceMicros: string; checkedAtMs: number };

class BalanceFailure extends Error {
  constructor(readonly code: QubaxBalanceCode) { super('Qubax balance metadata unavailable.'); }
}

let pending = false;
/** Explicit metadata read. It does not start a chat call or authorize spending. */
export async function readQubaxBalance(options: {
  signal?: AbortSignal; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch;
} = {}): Promise<QubaxBalanceSnapshot> {
  let cfg: ReturnType<typeof qubaxConfig>;
  try { cfg = qubaxConfig(options.env); } catch { return { status: 'unknown', code: 'configuration' }; }
  if (!cfg.enabled) return { status: 'unknown', code: 'disabled' };
  if (!cfg.apiKey) return { status: 'unknown', code: 'configuration' };
  if (options.signal?.aborted) return { status: 'unknown', code: 'cancelled' };
  if (pending) return { status: 'unknown', code: 'busy' };
  pending = true;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(), QUBAX_BALANCE_TIMEOUT_MS);
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new BalanceFailure(options.signal?.aborted ? 'cancelled' : 'timeout'));
    signal.addEventListener('abort', abort, { once: true });
  });
  const work = (async (): Promise<QubaxBalanceSnapshot> => {
    signal.throwIfAborted();
    const response = await (options.fetchImpl ?? fetch)(`${cfg.baseURL}/billing/balance`, {
      method: 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    try {
      signal.throwIfAborted();
      if (!response.ok) throw new BalanceFailure(response.status === 401 ? 'authentication'
        : response.status === 403 ? 'permission' : response.status === 429 ? 'rate-limit' : 'provider-error');
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw new BalanceFailure('invalid-response');
      const advertisedLength = response.headers.get('content-length');
      if (advertisedLength !== null && (!/^\d+$/.test(advertisedLength) || Number(advertisedLength) > QUBAX_BALANCE_MAX_BYTES)) throw new BalanceFailure('invalid-response');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let raw = '', bytes = 0;
      for (;;) {
        const item = await reader.read();
        signal.throwIfAborted();
        if (item.done) { complete = true; break; }
        bytes += item.value.byteLength;
        if (bytes > QUBAX_BALANCE_MAX_BYTES) throw new BalanceFailure('invalid-response');
        try { raw += decoder.decode(item.value, { stream: true }); } catch { throw new BalanceFailure('invalid-response'); }
      }
      try { raw += decoder.decode(); } catch { throw new BalanceFailure('invalid-response'); }
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new BalanceFailure('invalid-response'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BalanceFailure('invalid-response');
      const row = value as Record<string, unknown>;
      if (row.currency !== 'USD' || !Number.isSafeInteger(row.balance_micros) || (row.balance_micros as number) < 0
        || typeof row.balance_usd !== 'number' || !Number.isFinite(row.balance_usd) || row.balance_usd < 0
        || Math.round(row.balance_usd * 1_000_000) !== row.balance_micros) throw new BalanceFailure('invalid-response');
      return { status: 'available', currency: 'USD', balanceMicros: String(row.balance_micros), checkedAtMs: Date.now() };
    } finally {
      if (!complete) { try { if (reader) await reader.cancel(); else if (response.body) await response.body.cancel(); } catch { /* no body is retained */ } }
      try { reader?.releaseLock(); } catch { /* a pending read may still own the lock */ }
    }
  })();
  void work.then(() => { pending = false; }, () => { pending = false; });
  try { return await Promise.race([work, cancelled]); }
  catch (error) { return { status: 'unknown', code: error instanceof BalanceFailure ? error.code : signal.aborted ? (options.signal?.aborted ? 'cancelled' : 'timeout') : 'unavailable' }; }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); controller.abort(); }
}
