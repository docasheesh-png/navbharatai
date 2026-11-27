/**
 * Kadam 6 (admin 2026-11-27): the game bench's SMOKE set runs weekly against production, about $6 a week.
 * Every build is real money, so the workflow's bounds are pinned here by reading the YAML itself:
 * a weekly schedule, the smoke set, one repetition, a hard timeout, BENCH_CONFIRM=yes only in this one
 * scheduled job (never in CI, never on a pull request), and a clean SKIP when its secrets are not set.
 * Also locks the two helpers it depends on: the per-build token refresh and the honest job summary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { benchmarkTokenSource, type TokenFetch } from '../scripts/lib/reliabilityRequest';
import { gameBenchMarkdown } from '../src/server/AgentV3/reliability/gameBench';
import type { BenchResultFile, BenchRun } from '../src/server/AgentV3/reliability/benchHarness';

const FILE = '.github/workflows/game-bench-weekly.yml';
const raw = readFileSync(FILE, 'utf8');
type Step = { id?: string; name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, unknown> };
const wf = yaml.load(raw) as { on: Record<string, unknown>; concurrency?: { group?: string; 'cancel-in-progress'?: boolean }; jobs: Record<string, { 'timeout-minutes'?: number; steps: Step[] }> };
const jobs = Object.values(wf.jobs);
const job = jobs[0];
const runStep = job.steps.find((s) => s.run?.includes('scripts/agentv3-reliability-bench.ts'))!;

describe('the weekly game bench workflow', () => {
  it('runs on a weekly schedule and by hand — never on a push or a pull request', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const crons = (wf.on.schedule as Array<{ cron: string }>).map((c) => c.cron);
    expect(crons).toHaveLength(1);
    const [, , dom, month, dow] = crons[0].split(/\s+/);
    expect([dom, month]).toEqual(['*', '*']);
    expect(dow).toMatch(/^[0-6]$/); // one day a week
  });

  it('has one job with a hard timeout under GitHub\'s 360-minute ceiling, and paid runs never overlap', () => {
    expect(jobs).toHaveLength(1);
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(330);
    // Per-build timeout × 15 prompts must fit inside the job timeout.
    expect(Number(runStep.env!.BENCH_TIMEOUT_S) * 15 / 60).toBeLessThan(job['timeout-minutes']!);
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('runs the game SMOKE set, once, on an explicit tier, with BENCH_CONFIRM=yes', () => {
    expect(runStep.env).toMatchObject({ BENCH_FIXTURE: 'game', BENCH_SET: 'smoke', BENCH_RUNS: '1', BENCH_POWER_LEVEL: 'weak', BENCH_CONFIRM: 'yes' });
    expect(runStep.env!.BENCH_ONLY).toBeUndefined();
    // A fixed ID token would expire mid-run; the workflow hands over a refresh token.
    expect(runStep.env!.BENCH_FIREBASE_REFRESH_TOKEN).toMatch(/secrets\.GAME_BENCH_REFRESH_TOKEN/);
    expect(runStep.env!.BENCH_BASE_URL).toMatch(/secrets\.GAME_BENCH_BASE_URL/);
    expect(runStep.env!.BENCH_AUTH_TOKEN).toBeUndefined();
  });

  it('BENCH_CONFIRM=yes appears in this workflow only — no other workflow (CI included) can start a paid run', () => {
    const others = readdirSync('.github/workflows').filter((f) => /\.ya?ml$/.test(f) && f !== 'game-bench-weekly.yml');
    expect(others).toContain('ci.yml');
    for (const f of others) {
      const text = readFileSync(join('.github/workflows', f), 'utf8');
      expect(text, f).not.toMatch(/BENCH_CONFIRM/);
      expect(text, f).not.toMatch(/agentv3-reliability-bench|bench:reliability/);
    }
    expect(job.steps.filter((s) => s.env && 'BENCH_CONFIRM' in s.env)).toEqual([runStep]);
  });

  it('skips cleanly without its secrets: the guard runs first and gates every other step', () => {
    const [guard, ...rest] = job.steps;
    expect(guard.id).toBe('guard');
    expect(guard.if).toBeUndefined();
    expect(guard.env).toMatchObject({ BASE_URL: '${{ secrets.GAME_BENCH_BASE_URL }}', REFRESH_TOKEN: '${{ secrets.GAME_BENCH_REFRESH_TOKEN }}' });
    expect(guard.run).toMatch(/-n "\$BASE_URL" \] && \[ -n "\$REFRESH_TOKEN"/);
    expect(guard.run).toMatch(/ready=false/);
    expect(guard.run).toMatch(/::notice::/);
    expect(guard.run).not.toMatch(/exit 1/);
    for (const s of rest) expect(s.if, s.name).toMatch(/steps\.guard\.outputs\.ready == 'true'/);
  });

  it('always summarises and uploads what the run wrote, even when the bench stopped', () => {
    const summary = job.steps.find((s) => s.run?.includes('scripts/game-bench-summary.ts'))!;
    const upload = job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'))!;
    expect(summary.if).toMatch(/always\(\)/);
    expect(summary.run).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(upload.if).toMatch(/always\(\)/);
    expect(String(upload.with!.path)).toContain('game-bench');
  });
});

describe('the per-build token source', () => {
  it('mints a FRESH ID token on every call from the refresh token', async () => {
    const calls: string[] = [];
    let n = 0;
    const fetchImpl: TokenFetch = async (url, init) => { calls.push(`${url}|${init.body}`); n++; return { ok: true, status: 200, json: async () => ({ id_token: `id-${n}` }) }; };
    const next = benchmarkTokenSource({ refreshToken: 'rt-1', apiKey: 'key-1' }, fetchImpl);
    expect(await next()).toBe('id-1');
    expect(await next()).toBe('id-2');
    expect(calls[0]).toBe('https://securetoken.googleapis.com/v1/token?key=key-1|grant_type=refresh_token&refresh_token=rt-1');
  });

  it('a refused refresh throws without echoing the token or the response body', async () => {
    const fetchImpl: TokenFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'TOKEN_EXPIRED rt-secret' }) });
    const err = await benchmarkTokenSource({ refreshToken: 'rt-secret', apiKey: 'k' }, fetchImpl)().catch((e: Error) => e);
    expect(String(err)).toBe('Error: token-refresh-failed: HTTP 400');
  });

  it('a fixed BENCH_AUTH_TOKEN still works for a local run; nothing at all is refused', async () => {
    expect(await benchmarkTokenSource({ authToken: 'abc' })()).toBe('abc');
    expect(() => benchmarkTokenSource({})).toThrow(/BENCH_AUTH_TOKEN/);
    expect(() => benchmarkTokenSource({ refreshToken: 'rt' })).toThrow(/API key/);
  });
});

describe('the job summary', () => {
  const metrics = { filesCreated: 3, ok: true, readinessScore: 90, billedUsd: null, toolCalls: 1, toolErrors: 0, providerFallbacks: 0, geminiTrap: false, errored: false };
  const run = (id: string, extra: Partial<BenchRun>): BenchRun => ({ id, lang: 'en', complexity: 'simple', attempt: 1, seconds: 100, metrics, success: true, ...extra } as BenchRun);
  const base: BenchResultFile = { label: 'weekly-1', set: 'smoke', baseUrl: 'https://x', startedAt: '2026-11-29T20:37:00Z', flags: [], runs: [],
    execution: { status: 'complete', plannedRuns: 2, sourceCommit: 'abcdef0123', sourceDirty: false, fixtureSha256: 'x', promptIds: [], repetitions: 1, nodeVersion: 'v22', requestedTier: 'weak' } };

  it('reports classes (ask-not-met always shown), mean GQS, seconds and real cost', () => {
    const sig = { kitSeeded: true, playtest: 'passed' as const, gqs: 80, defects: [], scope: 'ok' as const, repair: null, gateBlocked: false, askNotMet: false };
    const md = gameBenchMarkdown({ ...base, runs: [
      run('a', { metrics: { ...metrics, evidence: { realCostUsd: 0.3 } } as never, game: { signals: sig, cls: 'ok' } }),
      run('b', { metrics: { ...metrics, evidence: { realCostUsd: 0.5 } } as never, game: { signals: { ...sig, gqs: 60 }, cls: 'ask-not-met' } }),
    ] });
    expect(md).toContain('Status: **complete** — 2/2 runs.');
    expect(md).toContain('| ask-not-met | 1 |');
    expect(md).toContain('| ok | 1 |');
    expect(md).toContain('Mean GQS: 70.0 (over 2 runs)');
    expect(md).toContain('Seconds: 200 total, 100 mean (over 2)');
    expect(md).toContain('Real cost: $0.80 (reported by 2 of 2 runs)');
  });

  it('a stopped run says so first, and an unreported value is "not reported", never zero', () => {
    const md = gameBenchMarkdown({ ...base, execution: { ...base.execution!, status: 'blocked' }, runs: [run('a', { failure: 'transport-or-timeout', success: false, seconds: null })] });
    expect(md).toContain('Status: **BLOCKED** — 1 of 2 runs recorded.');
    expect(md).toContain('Stopped at `a#1`: transport-or-timeout');
    expect(md).toContain('| ask-not-met | 0 |');
    expect(md).toContain('Mean GQS: not reported');
    expect(md).toContain('Real cost: not reported');
  });
});
