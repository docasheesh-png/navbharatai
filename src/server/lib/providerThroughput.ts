import { randomUUID } from 'node:crypto';
import type { DiagnosticAdapter } from './providerDiagnosticRunner';
import { providerLoadCorpus } from './providerLoadCorpus';

/** Owner t124u (2026-10-29): Surplus and CheaperInference must each sustain 1000 working
 * responses/minute. This harness fires N unique prompts (fresh run salt + ordinal, so no
 * cache hit can fake a pass) with a bounded worker pool and one retry per failed attempt. */
export interface ThroughputInput { requests: number; concurrency: number; retries: number; maxOutputTokens: number }
export interface ThroughputResult {
  runId: string; provider: string; model: string; requests: number; concurrency: number;
  ok: number; pass: number; fail: number; errors: Record<string, number>; retried: number;
  durationMs: number; rpm: number; workingRpm: number; p50Ms: number | null; p95Ms: number | null; costUsd: number;
}
export const THROUGHPUT_MAX_REQUESTS = 20_000;
export function parseThroughputInput(body: unknown): ThroughputInput | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number, lo: number, hi: number) => v === undefined ? d : Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi ? v as number : NaN;
  const r = { requests: int(b.requests, 100, 1, THROUGHPUT_MAX_REQUESTS), concurrency: int(b.concurrency, 100, 1, 2000),
    retries: int(b.retries, 1, 0, 3), maxOutputTokens: int(b.maxOutputTokens, 64, 1, 4096) };
  return Object.values(r).some(Number.isNaN) ? null : r;
}
function reason(e: unknown): string {
  const x = e as { code?: unknown; httpStatus?: unknown; name?: unknown };
  const code = typeof x?.code === 'string' ? x.code : typeof x?.name === 'string' ? x.name : 'error';
  return typeof x?.httpStatus === 'number' ? `${code}:${x.httpStatus}` : code;
}
function answer(text: string): unknown { const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''); return JSON.parse(t); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function runThroughput(provider: string, adapter: DiagnosticAdapter, input: ThroughputInput, now = () => performance.now()): Promise<ThroughputResult> {
  const runId = randomUUID(), salt = runId.slice(0, 8);
  const corpus = providerLoadCorpus(input.requests);
  const lat: number[] = [], errors: Record<string, number> = {};
  let next = 0, ok = 0, pass = 0, retried = 0, cost = 0;
  const started = now();
  async function one(i: number) {
    const q = corpus[i];
    const prompt = `[run ${salt}-${i}] ${q.prompt}`;
    for (let attempt = 0; attempt <= input.retries; attempt++) {
      const t0 = now();
      try {
        const r = await adapter.call(prompt, AbortSignal.timeout(90_000));
        lat.push(now() - t0); ok++; cost += r.amount ?? 0;
        let good = false; try { good = same(answer(r.text), q.expected); } catch { /* fail */ }
        if (good) pass++;
        return;
      } catch (e) {
        const k = reason(e); errors[k] = (errors[k] ?? 0) + 1;
        if (attempt < input.retries) { retried++; await new Promise(r => setTimeout(r, 250 * (attempt + 1))); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(input.concurrency, input.requests) }, async () => {
    while (next < input.requests) await one(next++);
  }));
  const durationMs = Math.max(1, Math.round(now() - started));
  lat.sort((a, b) => a - b);
  const pct = (p: number) => lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]) : null;
  return { runId, provider, model: adapter.model, requests: input.requests, concurrency: input.concurrency, ok, pass,
    fail: input.requests - ok, errors, retried, durationMs, rpm: Math.round(ok * 60000 / durationMs),
    workingRpm: Math.round(pass * 60000 / durationMs), p50Ms: pct(0.5), p95Ms: pct(0.95), costUsd: Number(cost.toFixed(6)) };
}
