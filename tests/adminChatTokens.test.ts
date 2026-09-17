/** `summariseChatTokens` — measured tokens summed, unmeasured turns COUNTED, never zeroed (2026-09-17). */
import { describe, it, expect } from 'vitest';
import { summariseChatTokens } from '../src/server/lib/adminUserActivity';

describe('summariseChatTokens', () => {
  it('sums only rows that carried real counts and counts the rest as unmeasured', () => {
    const s = summariseChatTokens([
      { usageMeasured: true, inputTokens: 1200, outputTokens: 300, createdAt: '2026-09-17T10:00:00.000Z', ok: true },
      { usageMeasured: true, inputTokens: 800, outputTokens: 100, createdAt: '2026-09-16T10:00:00.000Z', ok: true },
      { usageMeasured: false, createdAt: '2026-09-17T11:00:00.000Z', ok: true },
      { createdAt: '2026-09-01T10:00:00.000Z' },
      null,
    ]);
    expect(s.requests).toBe(4);
    expect(s.measuredRequests).toBe(2);
    expect(s.unmeasuredRequests).toBe(2);
    expect(s.inputTokens).toBe(2000);
    expect(s.outputTokens).toBe(400);
    expect(s.lastAtMs).toBe(Date.parse('2026-09-17T11:00:00.000Z'));
    expect(s.failedRequests).toBe(0);
  });
  it('a row marked measured but carrying no numbers is unmeasured, and a failed turn is counted', () => {
    const s = summariseChatTokens([
      { usageMeasured: true, inputTokens: 'n/a', outputTokens: 5, ok: false },
    ]);
    expect(s.measuredRequests).toBe(0);
    expect(s.unmeasuredRequests).toBe(1);
    expect(s.failedRequests).toBe(1);
    expect(s.inputTokens).toBe(0);
  });
  it('an empty history is all zeros with no last time', () => {
    expect(summariseChatTokens([])).toEqual({ requests: 0, measuredRequests: 0, unmeasuredRequests: 0, inputTokens: 0, outputTokens: 0, failedRequests: 0, lastAtMs: null });
  });
});
