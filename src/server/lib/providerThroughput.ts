import { randomUUID } from 'node:crypto';
import type { DiagnosticAdapter } from './providerDiagnosticRunner';
import { providerLoadCorpus } from './providerLoadCorpus';

/** Owner t124u (2026-10-29): Surplus and CheaperInference must each sustain 1000 working
 * responses/minute. This harness fires N unique prompts (fresh run salt + ordinal, so no
 * cache hit can fake a pass) with a bounded worker pool and one retry per failed attempt. */
/** maxOutputTokens undefined = provider default, exactly like the working single diagnostic test.
 * DNA (prod 05004): the panel forced max_tokens=64; both default models reason before answering,
 * so the 64-token budget was spent on hidden reasoning and the visible content came back blank
 * (Surplus empty_response:200, CheaperInference EMPTY_RESPONSE) — and still billed. */
export interface ThroughputInput { requests: number; concurrency: number; retries: number; maxOutputTokens?: number }
/** Below this a reasoning model routinely returns an empty visible answer. */
export const THROUGHPUT_MIN_OUTPUT_TOKENS = 512;
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
    retries: int(b.retries, 2, 0, 3) };
  if (Object.values(r).some(Number.isNaN)) return null;
  if (b.maxOutputTokens === undefined || b.maxOutputTokens === null) return r;
  const m = int(b.maxOutputTokens, 0, 1, 8192);
  // Clamp up instead of rejecting so older clients sending 64 stop starving reasoning models.
  return Number.isNaN(m) ? null : { ...r, maxOutputTokens: Math.max(THROUGHPUT_MIN_OUTPUT_TOKENS, m) };
}
function reason(e: unknown): string {
  const x = e as { code?: unknown; httpStatus?: unknown; name?: unknown };
  const code = typeof x?.code === 'string' ? x.code : typeof x?.name === 'string' ? x.name : 'error';
  return typeof x?.httpStatus === 'number' ? `${code}:${x.httpStatus}` : code;
}
/** Grade the model's real answer: drop leaked <think> blocks and fences, then accept the whole text
 * or its last JSON-looking line. A bare unquoted string answer counts for string expectations. */
export function gradeAnswer(text: string, expected: unknown): boolean {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const cands = [t, ...t.split('\n').map(l => l.trim()).filter(Boolean).reverse()];
  for (const c of cands) { try { if (same(JSON.parse(c), expected)) return true; } catch { /* next */ } }
  return typeof expected === 'string' && t.replace(/^["'`]|["'`.]$/g, '') === expected;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const NON_RETRYABLE = /^(configuration|authentication|invalid_request|AUTH|CONFIGURATION|POLICY_BLOCKED|SAFETY_REFUSAL|ABORTED)(:|$)/;
/** Retry only transient failures; jittered exponential backoff so a 429/blank burst is not re-fired in lockstep. */
export function shouldRetryThroughput(reasonKey: string): boolean { return !NON_RETRYABLE.test(reasonKey); }

export interface ThroughputProgress { done: number; ok: number; pass: number; requests: number; elapsedMs: number }
/** Safe, enumerable reason for a throughput failure: code/name/http status only, never a message or prompt. */
export function throughputFailureReason(e: unknown): string { return reason(e); }
export async function runThroughput(provider: string, adapter: DiagnosticAdapter, input: ThroughputInput, now = () => performance.now(),
  onProgress?: (p: ThroughputProgress) => void): Promise<ThroughputResult> {
  const runId = randomUUID(), salt = runId.slice(0, 8);
  const corpus = providerLoadCorpus(input.requests);
  const lat: number[] = [], errors: Record<string, number> = {};
  let next = 0, done = 0, ok = 0, pass = 0, retried = 0, cost = 0;
  const started = now();
  async function one(i: number) {
    const q = corpus[i];
    const prompt = `[run ${salt}-${i}] ${q.prompt}`;
    for (let attempt = 0; attempt <= input.retries; attempt++) {
      const t0 = now();
      try {
        const r = await adapter.call(prompt, AbortSignal.timeout(90_000));
        lat.push(now() - t0); ok++; cost += Number(r.amount ?? 0) || 0;
        if (gradeAnswer(r.text, q.expected)) pass++;
        done++; onProgress?.({ done, ok, pass, requests: input.requests, elapsedMs: Math.round(now() - started) });
        return;
      } catch (e) {
        const k = reason(e); errors[k] = (errors[k] ?? 0) + 1;
        const last = attempt >= input.retries || !shouldRetryThroughput(k);
        if (last) { done++; onProgress?.({ done, ok, pass, requests: input.requests, elapsedMs: Math.round(now() - started) }); }
        if (last) return;
        retried++; await new Promise(r => setTimeout(r, Math.min(8_000, 500 * 2 ** attempt) * (0.5 + Math.random())));
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
