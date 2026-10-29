import { randomUUID } from 'node:crypto';
import type { DiagnosticAdapter } from './providerDiagnosticRunner';

/** Throughput exam corpus (v2). DNA (prod 05006/05007): with thinking disabled the v1 load corpus asked for
 * 13-digit squares mod n and 25-char string reversals — tasks a no-reasoning model gets wrong by capability,
 * not by format (Surplus correct 31/100, 140/1000; CI 983/1000). The throughput panel measures *working replies*,
 * so every task here is single-step and deterministic, still unique per ordinal (numbers derive from it) and per
 * run (salt in the prompt), and graded exactly. The batch load corpus (providerLoadCorpus) is unchanged. */
export interface ThroughputQuestion { id: string; prompt: string; expected: unknown }
const WORDS = ['apple', 'river', 'tiger', 'lemon', 'cloud', 'stone', 'maple', 'ocean', 'pearl', 'frost', 'eagle', 'ember'];
export function throughputCorpus(count: number): ThroughputQuestion[] {
  return Array.from({ length: count }, (_, i) => {
    const x = 10 + (i * 7) % 80, y = 10 + (i * 13) % 80, d = 2 + i % 8, w = WORDS[i % WORDS.length];
    let task: string, expected: unknown;
    switch (i % 6) {
      case 0: task = `What is ${x} + ${y}? Reply with only the number.`; expected = x + y; break;
      case 1: task = `What is ${x} * ${d}? Reply with only the number.`; expected = x * d; break;
      case 2: { const z = x === y ? x + 1 : y; task = `Which number is larger, ${x} or ${z}? Reply with only that number.`; expected = Math.max(x, z); break; }
      case 3: { const a = [x + 100, y, d]; task = `Sort ascending: [${a.join(', ')}]. Reply with only the JSON array.`; expected = a.slice().sort((p, q) => p - q); break; }
      case 4: task = `Write the word "${w}" in uppercase letters. Reply with only the word.`; expected = w.toUpperCase(); break;
      default: task = `What is ${x + y} - ${y}? Reply with only the number.`; expected = x;
    }
    return { id: `throughput-v2-${i}`, prompt: task, expected };
  });
}

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
  durationMs: number; rpm: number; finalConcurrency: number; minConcurrency: number;
  mismatchSamples: Array<{ id: string; expected: string; actual: string }>; workingRpm: number; p50Ms: number | null; p95Ms: number | null; costUsd: number;
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
/** Grade the model's real answer: drop leaked <think> blocks, fences and markdown, then accept the whole text,
 * any line, an `Answer:`-prefixed value, a single-key wrapper object ({"answer": 42}), a numeric string for a
 * numeric expectation, or — for short replies only (<= 200 chars) — the last JSON array / number in the text.
 * DNA (prod 05006): with thinking disabled Surplus answered correctly but in human shape ("Answer: 42",
 * {"result": 42}, "**42**", "The sorted list is [..]") and the strict JSON-only grader scored those wrong
 * (ok 100 / correct 31). Uniqueness is untouched: every prompt still carries the run salt + ordinal. */
export function gradeAnswer(text: string, expected: unknown): boolean {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').replace(/\*\*|__/g, '').trim();
  const strip = (c: string) => c.trim().replace(/^(?:the\s+)?(?:final\s+)?(?:answer|result|output|word|number)(?:\s+is)?\s*[:=]?\s+|^(?:final\s+)?(?:answer|result|output)\s*[:=]\s*/i, '').trim().replace(/[.;]$/, '').trim();
  const lines = t.split('\n').map(strip).filter(Boolean);
  const cands = [strip(t), ...lines.slice().reverse()];
  if (t.length <= 200) {
    const arr = t.match(/\[[^\[\]]*\]/g); if (arr) cands.push(arr[arr.length - 1]);
    if (typeof expected === 'number') { const nums = t.match(/-?\d+(?:\.\d+)?/g); if (nums) cands.push(nums[nums.length - 1]); }
  }
  for (const c of cands) {
    let v: unknown; try { v = JSON.parse(c); } catch { v = undefined; }
    if (v !== undefined && matches(v, expected)) return true;
    if (typeof expected === 'string' && c.replace(/^["'`]|["'`]$/g, '') === expected) return true;
  }
  return false;
}
function matches(v: unknown, expected: unknown): boolean {
  if (same(v, expected)) return true;
  if (typeof expected === 'number' && typeof v === 'string' && v.trim() !== '' && Number(v) === expected) return true;
  if (v && typeof v === 'object' && !Array.isArray(v)) { const vals = Object.values(v); if (vals.length === 1) return matches(vals[0], expected); }
  return false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const NON_RETRYABLE = /^(configuration|authentication|invalid_request|AUTH|CONFIGURATION|POLICY_BLOCKED|SAFETY_REFUSAL|ABORTED)(:|$)|:(401|403)$/;
const RATE_LIMITED = /^(rate_limit|rate_limited|RATE_LIMIT)(:|$)|:429$/i;
/** 429s get extra attempts beyond `retries`: the adaptive gate below already slowed the run down, so these are not hammering. */
export const THROUGHPUT_RATE_LIMIT_EXTRA_RETRIES = 12;
export function isRateLimitedThroughput(reasonKey: string): boolean { return RATE_LIMITED.test(reasonKey); }
/** Retry only transient failures; jittered exponential backoff so a 429/blank burst is not re-fired in lockstep. */
export function shouldRetryThroughput(reasonKey: string): boolean { return !NON_RETRYABLE.test(reasonKey); }

export interface ThroughputProgress { done: number; ok: number; pass: number; requests: number; elapsedMs: number }
/** Safe, enumerable reason for a throughput failure: code/name/http status only, never a message or prompt. */
export function throughputFailureReason(e: unknown): string { return reason(e); }
/** AIMD gate: cut allowed in-flight by half on a 429 (honouring Retry-After), +1 per success back up to the
 * requested ceiling. DNA (prod 05006, CI 1000/200): fixed 200 in-flight produced RATE_LIMIT x1254 and burned 836
 * retries for 582 ok; the supplier sustains far fewer concurrent calls, so the run must find that level itself. */
class AdaptiveGate {
  limit: number; min: number; private inFlight = 0; private waiters: Array<() => void> = []; private pauseUntil = 0; private lastCut = 0;
  constructor(readonly max: number, private readonly floor: number, private readonly clock: () => number) { this.limit = max; this.min = max; }
  async acquire() {
    for (;;) {
      const wait = this.pauseUntil - this.clock();
      if (wait > 0) { await sleep(wait); continue; }
      if (this.inFlight < this.limit) { this.inFlight++; return; }
      await new Promise<void>(r => this.waiters.push(r));
    }
  }
  release() { this.inFlight--; this.waiters.shift()?.(); }
  success() { if (this.limit < this.max) { this.limit++; this.waiters.shift()?.(); } }
  rateLimited(retryAfterMs?: number) {
    const t = this.clock();
    if (t - this.lastCut > 1_000) { this.limit = Math.max(this.floor, Math.floor(this.limit / 2)); this.min = Math.min(this.min, this.limit); this.lastCut = t; }
    const pause = Math.min(10_000, Math.max(250, retryAfterMs ?? 1_000));
    this.pauseUntil = Math.max(this.pauseUntil, t + pause);
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function retryAfter(e: unknown): number | undefined { const v = (e as { retryAfterMs?: unknown })?.retryAfterMs; return typeof v === 'number' && v > 0 ? v : undefined; }
const preview = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 160);

export async function runThroughput(provider: string, adapter: DiagnosticAdapter, input: ThroughputInput, now = () => performance.now(),
  onProgress?: (p: ThroughputProgress) => void): Promise<ThroughputResult> {
  const runId = randomUUID(), salt = runId.slice(0, 8);
  const corpus = throughputCorpus(input.requests);
  const lat: number[] = [], errors: Record<string, number> = {}, mismatchSamples: ThroughputResult['mismatchSamples'] = [];
  let next = 0, done = 0, ok = 0, pass = 0, retried = 0, cost = 0;
  const workers = Math.min(input.concurrency, input.requests);
  const gate = new AdaptiveGate(workers, Math.min(workers, 4), now);
  const started = now();
  const progress = () => { done++; onProgress?.({ done, ok, pass, requests: input.requests, elapsedMs: Math.round(now() - started) }); };
  async function one(i: number) {
    const q = corpus[i];
    const prompt = `[run ${salt}-${i}] ${q.prompt}`;
    let failures = 0, rateLimits = 0;
    for (;;) {
      let backoff = 0;
      await gate.acquire();
      const t0 = now();
      try {
        const r = await adapter.call(prompt, AbortSignal.timeout(90_000));
        lat.push(now() - t0); ok++; cost += Number(r.amount ?? 0) || 0; gate.success();
        if (gradeAnswer(r.text, q.expected)) pass++;
        else if (mismatchSamples.length < 8) mismatchSamples.push({ id: q.id, expected: preview(q.expected), actual: preview(r.text) });
        progress(); return;
      } catch (e) {
        const k = reason(e); errors[k] = (errors[k] ?? 0) + 1;
        const limited = isRateLimitedThroughput(k);
        if (limited) { rateLimits++; gate.rateLimited(retryAfter(e)); } else failures++;
        const last = !shouldRetryThroughput(k) || failures > input.retries
          || (limited && rateLimits > input.retries + THROUGHPUT_RATE_LIMIT_EXTRA_RETRIES);
        if (last) { progress(); return; }
        retried++;
        if (!limited) backoff = (Math.min(8_000, 500 * 2 ** (failures - 1)) * (0.5 + Math.random()));
      } finally { gate.release(); }
      if (backoff) await sleep(backoff);
    }
  }
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < input.requests) await one(next++);
  }));
  const durationMs = Math.max(1, Math.round(now() - started));
  lat.sort((a, b) => a - b);
  const pct = (p: number) => lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]) : null;
  return { runId, provider, model: adapter.model, requests: input.requests, concurrency: input.concurrency, ok, pass,
    fail: input.requests - ok, errors, retried, durationMs, rpm: Math.round(ok * 60000 / durationMs),
    workingRpm: Math.round(pass * 60000 / durationMs), p50Ms: pct(0.5), p95Ms: pct(0.95), costUsd: Number(cost.toFixed(6)),
    finalConcurrency: gate.limit, minConcurrency: gate.min, mismatchSamples };
}
