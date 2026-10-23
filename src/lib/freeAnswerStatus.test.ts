import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readFreeAnswerStatus, freeAnswerStatusLine, FreeAnswerStatusReader, newFreeAnswerRequestId } from './freeAnswerStatus';
import { gatewayChatFailure } from './chatResponseStream';
const status = { limit: 20, used: 1, reserved: 1 as const, remaining: 18, inProgress: true, resetsAt: 1792780200000, day: '2026-10-23' };
describe('authoritative shared Free answer display', () => {
  it('distinguishes pending credit from completed answers', () => {
    expect(readFreeAnswerStatus(status)).toEqual(status);
    expect(freeAnswerStatusLine(status)).toContain('18/20 remaining');
    expect(freeAnswerStatusLine(status)).toContain('1 in progress');
    expect(freeAnswerStatusLine(null)).toContain('unavailable');
  });
  it.each([{ ...status, remaining: 19 }, { ...status, used: -1 }, { ...status, reserved: 2 }, { ...status, inProgress: false }, { ...status, resetsAt: NaN }])('rejects incoherent server data', data => {
    expect(readFreeAnswerStatus(data)).toBeNull();
  });
  it('never applies an old account or out-of-order fetch result', async () => {
    let resolve!: (s: unknown) => void;
    const apply = vi.fn(); const reader = new FreeAnswerStatusReader(apply);
    const old = reader.refresh(() => new Promise(r => { resolve = r; }));
    reader.invalidate();
    await reader.refresh(async () => ({ ...status, used: 0, reserved: 0, remaining: 20, inProgress: false }));
    resolve(status); await old;
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ remaining: 20 }));
    expect(apply).not.toHaveBeenCalledWith(status);
  });
  it('represents a prior-day active answer without spending the new day twice', () => {
    expect(readFreeAnswerStatus({ ...status, used: 0, reserved: 0, remaining: 20 })).toMatchObject({ inProgress: true, remaining: 20 });
  });
  it('mints request identities rather than predictable retry counters', () => {
    const a = newFreeAnswerRequestId();
    expect(a).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(newFreeAnswerRequestId()).not.toBe(a);
  });
  it('refreshes the server on identity, visibility, cross-tab changes and midnight without a client quota', () => {
    const hook = readFileSync('src/hooks/useFreeAnswerStatus.ts', 'utf8');
    for (const required of ['onAuthStateChanged', 'visibilitychange', "'focus'", "'storage'", "cache: 'no-store'", 'value.resetsAt - Date.now()', 'reader.invalidate()', 'clearInterval(poll)']) expect(hook).toContain(required);
    expect(hook).toContain('if (!active)');
  });
  it('reuses one send identity across both Free chat paths and refreshes after every outcome', () => {
    const hook = readFileSync('src/hooks/useChatEngine.ts', 'utf8');
    expect(hook.match(/newFreeAnswerRequestId\(\)/g)).toHaveLength(1);
    expect(hook).toContain("headers['x-nb-answer-request'] = answerRequestId");
    expect(hook).toContain("{ 'x-nb-answer-request': answerRequestId }");
    expect(hook).toContain('currentAgent, currentMode, answerRequestId');
    expect(hook).toMatch(/finally \{\s*setIsLoadingForTab\(false\);\s*notifyFreeAnswerChanged\(\)/);
  });
  it('clears unavailable counts rather than inventing allowance', async () => {
    const apply = vi.fn(); const reader = new FreeAnswerStatusReader(apply);
    await reader.refresh(async () => { throw new Error('offline'); });
    expect(apply).toHaveBeenLastCalledWith(null);
  });
  it.each(['DAILY_LIMIT', 'BUSY', 'DUPLICATE', 'ATTEMPT_LIMIT', 'UNAVAILABLE'])('treats FREE_ANSWER_%s as terminal before fallback/retry', suffix => {
    expect(gatewayChatFailure({ code: `FREE_ANSWER_${suffix}`, error: 'Exact actionable notice' })).toMatchObject({ message: 'Exact actionable notice', code: `FREE_ANSWER_${suffix}` });
  });
});
