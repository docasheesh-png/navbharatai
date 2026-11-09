import { qubaxConfig } from './qubax';
import type { TestChatBalance, TestChatBalanceCode } from '../../lib/testChatBot';

export const QUBAX_BALANCE_TIMEOUT_MS = 10_000;
export const QUBAX_BALANCE_MAX_BYTES = 16_384;
export type QubaxBalanceCode = TestChatBalanceCode;
export type QubaxBalanceSnapshot = TestChatBalance;

class BalanceFailure extends Error {
  constructor(readonly code: QubaxBalanceCode) { super('Qubax balance metadata unavailable.'); }
}

let pending = false;
/** Explicit metadata check only. Never inference, a spending authorization, or proof
 * that this key belongs to a previously funded account. No response body is logged. */
export async function readQubaxBalance(options: {
  signal?: AbortSignal; env?: Record<string, string | undefined>;
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
    const response = await fetch(`${cfg.baseURL}/billing/balance`, {
      method: 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    try {
      signal.throwIfAborted();
      if (!response.ok) throw new BalanceFailure(response.status === 401 ? 'authentication'
        : response.status === 403 ? 'permission' : response.status === 429 ? 'rate-limit' : 'provider-error');
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
        || !response.body) throw new BalanceFailure('invalid-response');
      const advertisedLength = response.headers.get('content-length');
      if (advertisedLength !== null && (!/^\d+$/.test(advertisedLength)
        || Number(advertisedLength) > QUBAX_BALANCE_MAX_BYTES)) throw new BalanceFailure('invalid-response');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let raw = '', bytes = 0;
      for (;;) {
        const item = await reader.read();
        signal.throwIfAborted();
        if (item.done) { complete = true; break; }
        bytes += item.value.byteLength;
        if (bytes > QUBAX_BALANCE_MAX_BYTES) throw new BalanceFailure('invalid-response');
        try { raw += decoder.decode(item.value, { stream: true }); }
        catch { throw new BalanceFailure('invalid-response'); }
      }
      try { raw += decoder.decode(); } catch { throw new BalanceFailure('invalid-response'); }
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new BalanceFailure('invalid-response'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BalanceFailure('invalid-response');
      const v = value as Record<string, unknown>;
      // Official example uses numeric micro-USD and USD. Preserve the authoritative
      // integer amount; missing, negative, inconsistent or unsafe amounts are unknown.
      if (v.currency !== 'USD' || !Number.isSafeInteger(v.balance_micros) || (v.balance_micros as number) < 0
        || typeof v.balance_usd !== 'number' || !Number.isFinite(v.balance_usd) || v.balance_usd < 0
        || Math.round(v.balance_usd * 1_000_000) !== v.balance_micros
        || Math.abs(v.balance_usd * 1_000_000 - (v.balance_micros as number)) > 0.01) throw new BalanceFailure('invalid-response');
      signal.throwIfAborted();
      return { status: 'available', currency: 'USD', balanceMicros: String(v.balance_micros), checkedAtMs: Date.now() };
    } finally {
      // Keep the single in-flight slot until uncooperative reads/cancellation settle.
      // The caller's deadline races this work and remains prompt even in that case.
      if (!complete) {
        try { if (reader) await reader.cancel(); else if (response.body) await response.body.cancel(); } catch { /* no raw error disclosure */ }
      }
      try { reader?.releaseLock(); } catch { /* pending cancellation may retain the lock */ }
    }
  })();
  void work.then(() => { pending = false; }, () => { pending = false; });
  try { return await Promise.race([work, cancelled]); }
  catch (error) { return { status: 'unknown', code: error instanceof BalanceFailure ? error.code
    : signal.aborted ? options.signal?.aborted ? 'cancelled' : 'timeout' : 'unavailable' }; }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); controller.abort(); }
}
