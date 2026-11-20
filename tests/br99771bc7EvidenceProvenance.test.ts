import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildDiagnostics, type LlmCallRecord } from '../src/server/AgentV3/BuildDiagnostics';
import { recordedTextCall } from '../src/server/AgentV3/recordedTextCall';
import { checkEditBase } from '../src/server/AgentV3/editBase';
import { InMemoryRevisionStore } from '../src/server/AgentV3/projectRevisions';
import { createSurplusScopeAsk, SURPLUS_SCOPE_PURPOSE } from '../src/server/AI/SurplusRegistry/scopeAdmission';
import type { SurplusBuildSession } from '../src/server/AI/SurplusRegistry/buildSession';
import type { TurnResult } from '../src/server/AgentV3/ClaudeClient';

// Real report shape: a 30,002ms admission call replayed seven milliseconds into a new build timer.
// The historical timestamps were discarded; these tests use a controlled completion clock instead
// of pretending the original report establishes when the call really finished.
const start = 1795019325348;
const row = (extra: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  ts: start - 2000, model: 'unknown', provider: 'SURPLUS', promptChars: 1190, responseChars: 0,
  finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0,
  latencyMs: 30002, ok: false, error: 'Build scope classification failed', ...extra,
});
afterEach(() => vi.useRealTimers());

describe('buffered call evidence keeps the clock that observed it', () => {
  it.each([true, false])('records the physical completion before replay (success=%s)', async success => {
    vi.useFakeTimers();
    vi.setSystemTime(start - 32002);
    const rows: LlmCallRecord[] = [];
    const call = recordedTextCall({
      makeRunner: () => ({ runTurn: async () => {
        vi.setSystemTime(start - 2000);
        if (!success) throw new Error('Build scope classification failed');
        return { text: 'complex', model: 'fixture', toolUses: [], rawContent: [], stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 1 } };
      } }),
      identify: () => ({ provider: 'SURPLUS', model: 'fixture' }),
      recordLlmCall: r => rows.push(r),
    }, { model: 'fixture', system: 'scope', messages: [], tools: [], maxTokens: 1024 },
    { promptPreview: 'Build scope admission classification' });
    if (success) await call; else await expect(call).rejects.toThrow('Build scope classification failed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ts: start - 2000, latencyMs: 30002, ok: success });
    vi.setSystemTime(start);
    const d = new BuildDiagnostics();
    vi.setSystemTime(start + 7);
    d.recordLlmCall(rows[0]);
    const report = d.report();
    expect(report.llmCalls[0].ts).toBe(start - 2000);
    const timing = report.issues.find(i => i.code === 'TIME_TO_FIRST_CALL');
    expect(timing?.ts).toBe(start - 2000);
    // Q-2746: the pre-build call is now named in plain words (started before the build's timer, not counted).
    expect(timing?.message).toContain("started before this build's timer");
    expect(timing?.message).not.toContain('of preparation');
    if (!success) expect(report.issues.find(i => i.code === 'LLM_CALL_FAILED')?.ts).toBe(start - 2000);
  });

  it.each([true, false])('preserves completion through the real scope buffer and sanitized observer (success=%s)', async success => {
    vi.useFakeTimers();
    vi.setSystemTime(start - 32002);
    const records: Omit<LlmCallRecord, 'ts'>[] = [];
    const turns: TurnResult[] = [];
    const observed = vi.fn();
    const session = {
      model: 'synthetic-model',
      runner: ({ onTurnComplete }: { onTurnComplete?: (turn: TurnResult) => void }) => ({
        runTurn: async () => {
          vi.setSystemTime(start - 2000);
          if (!success) throw new Error('PRIVATE_SCOPE_FAILURE');
          const turn: TurnResult = { text: 'complex', model: 'synthetic-model', toolUses: [], rawContent: [],
            stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 1 } };
          onTurnComplete?.(turn);
          return turn;
        },
      }),
    } as unknown as SurplusBuildSession;
    const pending = createSurplusScopeAsk(session, turns, records, observed)!('PRIVATE_SYSTEM', 'PRIVATE_REQUEST');
    if (success) await expect(pending).resolves.toEqual({ text: 'complex' });
    else await expect(pending).rejects.toThrow('PRIVATE_SCOPE_FAILURE');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ts: start - 2000, latencyMs: 30002, ok: success,
      promptPreview: SURPLUS_SCOPE_PURPOSE, responsePreview: '' });
    expect(observed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ts: start - 2000 }));
    expect(JSON.stringify(records)).not.toContain('PRIVATE_');
    expect(turns).toHaveLength(success ? 1 : 0);
    vi.setSystemTime(start);
    const d = new BuildDiagnostics();
    vi.setSystemTime(start + 7);
    for (const record of records) d.recordLlmCall(record);
    expect(d.report().llmCalls[0]).toMatchObject({ ts: start - 2000, latencyMs: 30002, ok: success });
    expect(d.report().issues.find(issue => issue.code === 'TIME_TO_FIRST_CALL')?.ts).toBe(start - 2000);
    if (!success) expect(d.report().issues.find(issue => issue.code === 'LLM_CALL_FAILED')?.ts).toBe(start - 2000);
  });

  it('does not count buffer residence as setup when the call occurred inside the build', () => {
    let now = start;
    const d = new BuildDiagnostics({ now: () => now });
    now = start + 100000;
    d.recordLlmCall(row({ ts: start + 7000, latencyMs: 5000, ok: true, error: undefined }));
    expect(d.report().issues.find(i => i.code === 'TIME_TO_FIRST_CALL')?.message).toContain('2s of preparation');
  });

  it.each([NaN, Infinity, -1, start + 10000])('does not trust an invalid or future timestamp: %s', ts => {
    let now = start;
    const d = new BuildDiagnostics({ now: () => now });
    now += 7;
    d.recordLlmCall(row({ ts }));
    expect(d.report().llmCalls[0].ts).toBe(now);
  });

  it('older buffered evidence cannot replace fresh liveness, but also cannot revive a stale build', () => {
    let now = start;
    const d = new BuildDiagnostics({ now: () => now });
    d.record({ phase: 'build', severity: 'info', code: 'BUILD_STARTED', message: 'accepted' });
    d.recordLlmCall(row({ ts: start - 200000 }));
    expect(d.report().rootCause).not.toContain('ended without recording');
    now += 160000;
    expect(d.report().rootCause).toContain('ended without recording');
    d.heartbeat();
    d.recordLlmCall(row({ ts: start - 190000, error: 'another historical failure' }));
    expect(d.report().rootCause).not.toContain('ended without recording');
  });
});

describe('missing revision evidence does not establish project age', () => {
  it('describes a fresh starter and an older unverified project by the same observed fact', async () => {
    for (const workspaceId of ['fresh-starter', 'older-unverified']) {
      const result = await checkEditBase({ workspaceId,
        hydrated: { 'src/App.tsx': 'export default function App() { return <h1>Hello World</h1>; }' },
        store: new InMemoryRevisionStore(), loadVerifiedCopy: async () => ({}), withTimeout: p => p });
      expect(result.check.state).toBe('no-head');
      expect(result.verifiedBase).toBeNull();
      expect(result.finding?.code).toBe('EDIT_BASE_LEGACY');
      expect(result.finding?.message).toContain('no verified revision yet');
      expect(result.finding?.message).not.toContain('saved before revisions existed');
    }
  });
});
