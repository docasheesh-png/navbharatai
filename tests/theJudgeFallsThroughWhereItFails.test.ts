// THE JUDGE'S FALL-THROUGH, WHERE THE FAILURES ACTUALLY ARE (2026-09-20).
//
// Admin: *"nvidia nahi chal rah hai … dekho kya problem hai. kaha?"* — and the platform could not say
// where, because every provider failure on the judge path was caught and discarded. These cases lock
// both halves of the repair: the fall-through happens at CALL time, and the reason survives.
//
// Reversion-proven: each block names the exact old behaviour it forbids.

import { describe, it, expect, vi } from 'vitest';
import {
  composeJudgeChain,
  describeJudgeAttempts,
  isEmptyJudgeReply,
  judgeFailureReason,
  EMPTY_REPLY_REASON,
  type JudgeCandidate,
  type JudgeKind,
} from '../src/server/AgentV3/judgeChain';
import { readFileSync } from 'fs';
import { join } from 'path';

const ARGS = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], tools: [] as [], maxTokens: 1500, model: 'CALLER-MODEL' };

const candidate = (kind: JudgeKind, modelId: string, impl: JudgeCandidate['runTurn']): JudgeCandidate => ({ kind, modelId, runTurn: impl });
const label = (k: JudgeKind): string => k.toUpperCase();

describe('an unusable reply is recognised as one', () => {
  it('treats empty and whitespace-only as no answer', () => {
    expect(isEmptyJudgeReply('')).toBe(true);
    expect(isEmptyJudgeReply('   \n\t ')).toBe(true);
    expect(isEmptyJudgeReply(null)).toBe(true);
    expect(isEmptyJudgeReply(undefined)).toBe(true);
    expect(isEmptyJudgeReply('{"verdict":"pass"}')).toBe(false);
  });
});

describe('the failure reason survives — the status code IS the diagnosis', () => {
  it('keeps an HTTP status, which is what separates a bad key from a bad model id', () => {
    // 401/403 → the key. 404 → the model id or the host. These were indistinguishable before.
    expect(judgeFailureReason({ status: 401, message: 'Invalid API key' })).toContain('HTTP 401');
    expect(judgeFailureReason({ status: 404, message: 'model not found' })).toContain('HTTP 404');
    expect(judgeFailureReason({ status: 404, message: 'model not found' })).toContain('model not found');
  });

  it('never throws a second time, whatever it is handed', () => {
    expect(judgeFailureReason(null)).toBe('no reason given');
    expect(judgeFailureReason(undefined)).toBe('no reason given');
    expect(judgeFailureReason('plain string failure')).toContain('plain string failure');
    expect(judgeFailureReason(new Error('boom'))).toContain('boom');
    expect(judgeFailureReason({})).toBe('unknown error');
    expect(judgeFailureReason({ code: 'ETIMEDOUT', message: 'timeout' })).toContain('ETIMEDOUT');
  });

  it('stays one bounded line, so an HTML error page cannot swamp the report', () => {
    const r = judgeFailureReason({ message: `${'x'.repeat(500)}\nsecond line` });
    expect(r.length).toBeLessThanOrEqual(200);
    expect(r).not.toContain('\n');
  });
});

describe('the chain falls through at CALL time — the bug this replaces', () => {
  it('a THROWN provider error reaches the next engine instead of killing the review', async () => {
    // 🔴 THE OLD BEHAVIOUR: the try/catch wrapped `new OpenAI(...)`, which does not throw for a wrong
    // key or model, so this error landed in judgeBuild's catch → NOT REVIEWED, no fallback at all.
    const first = vi.fn().mockRejectedValue({ status: 404, message: 'unknown model' });
    const second = vi.fn().mockResolvedValue({ text: 'VERDICT' });
    const chain = composeJudgeChain([candidate('nemotron', 'nvidia/x', first), candidate('glm', 'glm-5.3', second)]);

    await expect(chain.runTurn(ARGS)).resolves.toEqual({ text: 'VERDICT' });
    expect(chain.servedBy()).toBe('glm');
    const attempts = chain.attempts();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ kind: 'nemotron', ok: false });
    expect(attempts[0].reason).toContain('HTTP 404');
    expect(attempts[1]).toMatchObject({ kind: 'glm', ok: true });
  });

  it('an EMPTY answer is that rung failing, not a verdict — the reasoning-model trap', async () => {
    // Nemotron 3 reasons; glm-5.3 and kimi-k2.7-code already proved in this repo that a reasoning
    // model can spend its whole output allowance and return nothing. The old path handed that empty
    // string to parseJudgeVerdict, which recorded "the reviewer's answer could not be read" — a
    // sentence about our parser, for a rung that never wrote a character.
    const first = vi.fn().mockResolvedValue({ text: '   \n ' });
    const second = vi.fn().mockResolvedValue({ text: 'VERDICT' });
    const chain = composeJudgeChain([candidate('nemotron', 'nvidia/x', first), candidate('grok', 'grok-3', second)]);

    await expect(chain.runTurn(ARGS)).resolves.toEqual({ text: 'VERDICT' });
    expect(chain.attempts()[0].reason).toBe(EMPTY_REPLY_REASON);
    expect(chain.servedBy()).toBe('grok');
  });

  it('each engine is asked for ITS OWN model id, never the caller\'s', async () => {
    // judgeBuild passes one model id. Without this, the second candidate would be asked for the
    // FIRST one's model at a host that has never heard of it — a fallback that cannot succeed.
    const first = vi.fn().mockRejectedValue(new Error('down'));
    const second = vi.fn().mockResolvedValue({ text: 'ok' });
    const chain = composeJudgeChain([candidate('nemotron', 'nvidia/ultra', first), candidate('glm', 'glm-5.3', second)]);

    await chain.runTurn(ARGS);
    expect(first.mock.calls[0][0].model).toBe('nvidia/ultra');
    expect(second.mock.calls[0][0].model).toBe('glm-5.3');
    // ...and the rest of the request is passed through untouched.
    expect(second.mock.calls[0][0].maxTokens).toBe(1500);
    expect(second.mock.calls[0][0].system).toBe('sys');
  });

  it('a working first engine costs exactly one call — the fallback is never speculative', async () => {
    const first = vi.fn().mockResolvedValue({ text: 'ok' });
    const second = vi.fn().mockResolvedValue({ text: 'ok' });
    const chain = composeJudgeChain([candidate('glm', 'glm-5.3', first), candidate('sonnet', 'sonnet', second)]);

    await chain.runTurn(ARGS);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(describeJudgeAttempts(chain.attempts(), label)).toBe('');
  });

  it('when every engine fails it THROWS, so judgeBuild records NOT REVIEWED and never blocks', async () => {
    const chain = composeJudgeChain([
      candidate('nemotron', 'n', vi.fn().mockRejectedValue({ status: 401, message: 'bad key' })),
      candidate('sonnet', 's', vi.fn().mockRejectedValue(new Error('anthropic down'))),
    ]);
    await expect(chain.runTurn(ARGS)).rejects.toBeTruthy();
    expect(chain.servedBy()).toBeNull();
    expect(chain.attempts().every((a) => !a.ok)).toBe(true);
  });

  it('attempts are per CALL, so a re-review does not report the first review\'s failures', async () => {
    const first = vi.fn()
      .mockRejectedValueOnce({ status: 500, message: 'blip' })
      .mockResolvedValue({ text: 'ok' });
    const second = vi.fn().mockResolvedValue({ text: 'ok' });
    const chain = composeJudgeChain([candidate('nemotron', 'n', first), candidate('glm', 'g', second)]);

    await chain.runTurn(ARGS);
    expect(chain.attempts()).toHaveLength(2);
    await chain.runTurn(ARGS);
    expect(chain.attempts()).toHaveLength(1);
    expect(chain.attempts()[0]).toMatchObject({ kind: 'nemotron', ok: true });
  });

  it('an empty candidate list cannot crash a build', async () => {
    const chain = composeJudgeChain([]);
    expect(chain.plannedKind()).toBeNull();
    await expect(chain.runTurn(ARGS)).rejects.toBeTruthy();
  });
});

describe('the report line says who failed, why, and who answered instead', () => {
  it('names the failure and the engine that served', () => {
    const note = describeJudgeAttempts(
      [{ kind: 'nemotron', modelId: 'nvidia/x', ok: false, reason: 'HTTP 404 · unknown model' }, { kind: 'glm', modelId: 'glm-5.3', ok: true }],
      label,
    );
    expect(note).toContain('NEMOTRON');
    expect(note).toContain('HTTP 404');
    expect(note).toContain('GLM answered instead');
  });

  it('says plainly when nobody answered', () => {
    const note = describeJudgeAttempts([{ kind: 'nemotron', modelId: 'n', ok: false, reason: 'HTTP 401' }], label);
    expect(note).toContain('no engine answered');
  });

  it('is SILENT on the ordinary path — a clean build gains no noise', () => {
    expect(describeJudgeAttempts([{ kind: 'glm', modelId: 'g', ok: true }], label)).toBe('');
    expect(describeJudgeAttempts([], label)).toBe('');
  });
});

describe('reversion guard — the construction-only fall-through must not come back', () => {
  // `tsc` and `vitest` cannot see that a try/catch guards the wrong statement: the old code compiled,
  // passed every test, and silently removed the quality gate from a whole tier. So the lock is at the
  // source level, the same discipline theLoopBreakerAndItsMeasurement.test.ts uses.
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const judge = route.slice(route.indexOf('function selectReviewJudge('), route.indexOf('function selectReviewJudge(') + 4000);

  it('selectReviewJudge composes a chain rather than returning inside a try', () => {
    expect(judge).toContain('composeJudgeChain(candidates)');
    // The old shape: a `return { runTurn, modelId, kind: '…' }` inside a try whose catch was a
    // comment about falling through. If this reappears the fall-through is decorative again.
    expect(judge).not.toContain("catch { /* client not constructable → fall through");
  });

  it('the judge report carries the attempts note', () => {
    expect(route).toContain('describeJudgeAttempts(judge.chain.attempts(), judgeEngineLabel)');
    // ...and the engine is named AFTER the call, never from the planned kind alone.
    expect(route).toContain('judge.chain.servedBy() ?? judge.kind');
  });
});
