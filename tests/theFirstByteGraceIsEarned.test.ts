import { describe, it, expect } from 'vitest';
import { firstByteGraceFor, streamIsCrawling, STREAM_FIRST_BYTE_GRACE_MS, STREAM_THROUGHPUT_GRACE_MS } from '../src/server/AgentV3/providers/openAiStream';
import { createProviderSilenceMemory } from '../src/server/AgentV3/providerSilenceMemory';

// Owner 2026-10-18 (r6–r10 autopsy): the 30 s first-byte grace only for a rung that answered recently.
const NOW = 10_000_000;
describe('the first-byte grace is earned by answering recently', () => {
  it('answered 5 min ago → the full first-byte grace', () => {
    expect(firstByteGraceFor(NOW - 5 * 60_000, NOW, {})).toBe(STREAM_FIRST_BYTE_GRACE_MS);
  });
  it('never answered, or long ago → the old 15 s', () => {
    expect(firstByteGraceFor(0, NOW, {})).toBe(STREAM_THROUGHPUT_GRACE_MS);
    expect(firstByteGraceFor(NOW - 31 * 60_000, NOW, {})).toBe(STREAM_THROUGHPUT_GRACE_MS);
  });
  it('the recency window is env-configurable', () => {
    expect(firstByteGraceFor(NOW - 5 * 60_000, NOW, { AGENTV3_FIRST_BYTE_GRACE_RECENT_MS: '60000' })).toBe(STREAM_THROUGHPUT_GRACE_MS);
  });
  it('AGENTV3_FIRST_BYTE_GRACE_NEEDS_RECENT=off gives every rung the grace (#3810 as merged)', () => {
    expect(firstByteGraceFor(0, NOW, { AGENTV3_FIRST_BYTE_GRACE_NEEDS_RECENT: 'off' })).toBe(STREAM_FIRST_BYTE_GRACE_MS);
  });
  it('a zero-byte stream at 20 s is abandoned without the grace, kept with it', () => {
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: 20_000, firstByteGraceMs: 15_000 }, {})).toBe(true);
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: 20_000, firstByteGraceMs: 30_000 }, {})).toBe(false);
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: 20_000 }, {})).toBe(false); // absent ⇒ configured grace
  });
  it('the silence memory remembers when a rung answered', () => {
    const m = createProviderSilenceMemory({ now: () => NOW });
    expect(m.answeredAt!('glm')).toBe(0);
    m.clear('glm', NOW - 1000);
    expect(m.answeredAt!('glm')).toBe(NOW - 1000);
  });
});
