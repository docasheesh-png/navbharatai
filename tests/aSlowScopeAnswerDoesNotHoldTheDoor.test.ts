// 🔴 ONE SLOW SCOPE ANSWER DOES NOT HOLD THE DOOR (failedbr #2470, 99771bc7, 2026-11-18).
//
// The Surplus scope ask owned the whole 30 s deadline: it ran 30 002 ms, failed, and the user watched an empty screen
// for half a minute before "Build accepted" — while the faster classifiers behind it never got a turn. The same engine
// then built the app without trouble. After its head start the fallback order is now asked in parallel, the first real
// answer wins, the loser is cancelled as "answered elsewhere" (an info line, never LLM_CALL_FAILED), and the cancel
// never drops Surplus from the build.
// Reversion: remove the head-start race from weakScopeAsk and the first test times out at the 30 s shape.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { weakScopeAsk } from '../src/server/AI/RouterOne/admission';
import { admitWeakBuild } from '../src/server/AgentV3/weakBuildAdmission';
import { createSurplusScopeAsk } from '../src/server/AI/SurplusRegistry/scopeAdmission';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { CanarySpendBlocked } from '../src/server/AgentV3/reliability/canarySpendGuard';
import type { SurplusBuildSession } from '../src/server/AI/SurplusRegistry/buildSession';
import type { LlmCallRecord } from '../src/server/AgentV3/BuildDiagnostics';

afterEach(() => { vi.useRealTimers(); });

/** A Surplus call that never answers until its signal is aborted — the #2470 shape. */
const hangs = (seen: { signal?: AbortSignal }) => vi.fn((_s: string, _u: string, signal: AbortSignal) => new Promise<{ text: string }>((_, reject) => {
  seen.signal = signal;
  signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
}));

describe('the race', () => {
  it('#2470: Surplus silent, GLM answers ⇒ classified a moment after the head start, not at 30 s', async () => {
    vi.useFakeTimers();
    const seen: { signal?: AbortSignal } = {};
    const glm = vi.fn(async () => ({ text: 'complex' }));
    const drop = vi.fn();
    const p = admitWeakBuild('I want to build a game board game name is business game', weakScopeAsk(hangs(seen), undefined, glm, drop, 8_000), { timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(8_001);
    const r = await p;
    expect(r).toMatchObject({ scope: 'complex', source: 'model' });
    expect(glm).toHaveBeenCalledOnce();
    expect(seen.signal?.aborted).toBe(true);            // the loser was cancelled
    expect(drop).not.toHaveBeenCalled();                 // …and Surplus stays the build's engine
  });

  it('a Surplus answer inside its head start wins alone — the fallback is never asked', async () => {
    const glm = vi.fn(async () => ({ text: 'simple' }));
    const surplus = vi.fn(async () => ({ text: 'complex' }));
    await expect(weakScopeAsk(surplus, undefined, glm, vi.fn(), 8_000)('s', 'u', new AbortController().signal)).resolves.toEqual({ text: 'complex' });
    expect(glm).not.toHaveBeenCalled();
  });

  it('a Surplus policy/spend refusal still stops classification, even mid-race', async () => {
    vi.useFakeTimers();
    let refuse!: (e: unknown) => void;
    const surplus = vi.fn(() => new Promise<{ text: string }>((_, reject) => { refuse = reject; }));
    const glm = vi.fn(() => new Promise<{ text: string }>(() => { /* still thinking */ }));
    const p = weakScopeAsk(surplus, undefined, glm, vi.fn(), 8_000)('s', 'u', new AbortController().signal);
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(8_001);
    refuse(new CanarySpendBlocked('test'));
    expect(await caught).toBeInstanceOf(CanarySpendBlocked);
  });
});

describe('the loser is reported as what it was', () => {
  it('the cancelled Surplus scope call is recorded as answered elsewhere, and onFailure is not told', async () => {
    vi.useFakeTimers();
    const session = { model: 'm', runner: () => ({ runTurn: (params: { signal?: AbortSignal }) => new Promise((_, reject) => {
      params.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) }) } as unknown as SurplusBuildSession;
    const records: Omit<LlmCallRecord, 'ts'>[] = [];
    const onFailure = vi.fn();
    const surplus = createSurplusScopeAsk(session, [], records, undefined, onFailure)!;
    const p = admitWeakBuild('a business board game', weakScopeAsk((s, u, sig) => surplus(s, u, sig), undefined, async () => ({ text: 'simple' }), vi.fn(), 8_000), { timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(8_001);
    expect((await p).scope).toBe('simple');
    await vi.advanceTimersByTimeAsync(1);
    expect(records).toHaveLength(1);
    expect(records[0].error).toMatch(/stage=hedge reason=answered_elsewhere/);
    expect(onFailure).not.toHaveBeenCalled();
    vi.useRealTimers();
    const diag = new BuildDiagnostics('b', 'p', 'm');
    diag.recordLlmCall(records[0]);
    const codes = diag.finalize?.({ ok: true, summary: '' })?.issues?.map((i: { code: string }) => i.code) ?? (diag as unknown as { issues: { code: string }[] }).issues.map((i) => i.code);
    expect(codes).toContain('LLM_CALL_ANSWERED_ELSEWHERE');
    expect(codes).not.toContain('LLM_CALL_FAILED');
  });
});
