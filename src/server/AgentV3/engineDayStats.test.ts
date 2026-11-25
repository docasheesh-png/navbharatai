/**
 * Per-day engine stats (admin 2026-11-25: "per day fail response karo … kitne request gayi, kitne response aye, kitni
 * der me aye (avg) aur kitne fail huye … fallback system kam kyu nahi kiya woh bhi likh kar ana chahiye").
 * Runs the real BuildDiagnostics, with the inputs a real build feeds it (BR2527's own Surplus failure line).
 */
import { describe, expect, it, vi } from 'vitest';
const recorded: unknown[] = [];
vi.mock('./engineDayStats', async (orig) => {
  const real = await orig<typeof import('./engineDayStats')>();
  return { ...real, recordEngineDay: vi.fn(async (t: unknown) => { recorded.push(t); }) };
});
import { BuildDiagnostics } from './BuildDiagnostics';
import { engineCodeInMessage, engineDayRows, reasonKey } from './engineDayStats';
import { readFileSync } from 'node:fs';

const BR2527 = 'Surplus attempt 1 on glm-5.3-flash failed (response_validation: the engine refused the request, HTTP 404 (code minimum_discount_not_met)) — glm-5.3-flash is benched for this build; the next turn moves to glm-5.2, whose cache is cold';

function build() {
  let t = 1_000;
  const d = new BuildDiagnostics({ now: () => (t += 10) });
  d.recordProviderFailure('SURPLUS', new Error(BR2527));
  d.recordProviderFailure('SURPLUS', new Error(BR2527.replace('minimum_discount_not_met', 'no_sellers_for_model')));
  d.recordProviderFailure('GLM#2', new Error('429 Too Many Requests: rate limit reached for requests'));
  d.recordProviderTurn('ENGINE_R1', ['SURPLUS']);
  d.recordProviderTurn('ENGINE_R1', ['SURPLUS']);
  d.recordProviderTurn('SURPLUS', []);
  d.recordProviderTurn('GLM#7', ['GLM#2']);
  const call = (provider: string | undefined, answerMs: number, ok = true) => d.recordLlmCall({ provider, model: 'm', promptChars: 1, responseChars: 1, finishReason: 'stop', toolCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs: answerMs + 5000, answerMs, ok } as any);
  call('ENGINE_R1', 4000); call('ENGINE_R1', 2000); call('SURPLUS', 30000); call(undefined, 99999); call('ENGINE_R1', 1, false);
  return d;
}

describe('one build → its part of the day', () => {
  it('🔴 answered, failed, measured time, the engine\'s own refusal code, and who carried the turn', () => {
    const t = build().engineDayTally();
    expect(t.SURPLUS).toMatchObject({ answered: 1, failed: 2, timedAnswers: 1, answerMsTotal: 30000,
      reasons: { minimum_discount_not_met: 1, no_sellers_for_model: 1 }, carriedBy: { ENGINE_R1: 2 } });
    // The ANSWER's own time, not the caller's wait (which includes the rungs that failed before it).
    expect(t.ENGINE_R1).toMatchObject({ answered: 2, failed: 0, timedAnswers: 2, answerMsTotal: 6000 });
    // Key pool: GLM#2 and GLM#7 are one engine, and a key handing over to another key of it is not a fallback.
    expect(t.GLM).toMatchObject({ answered: 1, failed: 1, reasons: { 'rate-limit': 1 }, carriedBy: {} });
    // A call with no engine named is not guessed onto one.
    expect(Object.values(t).reduce((a, r) => a + r.timedAnswers, 0)).toBe(3); // and a failed call is no answer
  });
  it('finish() adds the build to its day exactly once, however often it is called', () => {
    recorded.length = 0;
    const d = build();
    d.finish(true); d.finish(false);
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as any).SURPLUS.failed).toBe(2);
  });
});

describe('the stored day', () => {
  it('reads back into rows: requests = answered + failed, the average from measured answers only, most-failed first', () => {
    const rows = engineDayRows({ engines: {
      ENGINE_R1: { builds: 3, answered: 106, failed: 0, timedAnswers: 100, answerMsTotal: 436_300 },
      SURPLUS: { builds: 3, answered: 30, failed: 18, timedAnswers: 0, answerMsTotal: 0, reasons: { no_sellers_for_model: 9, minimum_discount_not_met: 9 }, carriedBy: { ENGINE_R1: 14 } },
    } });
    expect(rows.map(r => r.engine)).toEqual(['SURPLUS', 'ENGINE_R1']);
    expect(rows[0]).toMatchObject({ requests: 48, avgAnswerMs: null, carriedBy: { ENGINE_R1: 14 } });
    expect(rows[1]).toMatchObject({ requests: 106, avgAnswerMs: 4363 });
  });
  it('anything malformed reads as zero, never invented', () => {
    expect(engineDayRows(null)).toEqual([]);
    expect(engineDayRows({ engines: { X: { answered: 'lots', failed: -3 } } })[0]).toMatchObject({ requests: 0, avgAnswerMs: null });
  });
  it('codes are Firestore-safe keys; the code is read only from "(code …)"', () => {
    expect(engineCodeInMessage(BR2527)).toBe('minimum_discount_not_met');
    expect(engineCodeInMessage('HTTP 404 with no code')).toBeNull();
    expect(reasonKey('a.b/c d')).toBe('a_b_c_d');
  });
});

describe('wired', () => {
  it('the chain names the engine that answered, and the turn record carries it', () => {
    expect(readFileSync('src/server/AgentV3/providers/MultiProviderTurnRunner.ts', 'utf8')).toContain('answeredBy: result.answeredBy ?? reportName');
    expect(readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8')).toContain('...(turn.answeredBy ? { provider: turn.answeredBy } : {})');
  });
  it('the route hands who-it-carried-for to the report, and the admin API serves the days', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('buildDiag.recordProviderTurn(used, fellBackFrom)');
    expect(route).not.toContain('onProviderUsed: (used) => { try { onUsed?.(used); }');
    expect(readFileSync('src/server/routes/admin.ts', 'utf8')).toContain('out.engineDays = { days: await readEngineDays(7), reasonText: ENGINE_REASON_TEXT }');
  });
});
