// Owner request 2026-10-18 + autopsy 2f46a4d8: glm-4.7-flashx (thinking disabled) was abandoned and benched
// after 15 s of producing NOTHING, in the planner and the builder. A zero-byte stream is queued, not crawling:
// it gets the longer first-byte grace; a started stream is still judged at the throughput grace.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  streamIsCrawling, streamFirstByteGraceMs, STREAM_FIRST_BYTE_GRACE_MS, STREAM_THROUGHPUT_GRACE_MS, STREAM_IDLE_MS_DEFAULT,
} from '../src/server/AgentV3/providers/openAiStream';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('a rung that has not sent its first byte gets time to start', () => {
  it('the reported 15 s silence is no longer an abandon; 30 s is', () => {
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: 15_000 })).toBe(false);
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: STREAM_FIRST_BYTE_GRACE_MS - 1 })).toBe(false);
    expect(streamIsCrawling({ producedBytes: 0, elapsedMs: STREAM_FIRST_BYTE_GRACE_MS })).toBe(true);
  });
  it('a stream that started and trickles is judged exactly as before', () => {
    expect(streamIsCrawling({ producedBytes: 10, elapsedMs: STREAM_THROUGHPUT_GRACE_MS })).toBe(true);
    expect(streamIsCrawling({ producedBytes: 20_000, elapsedMs: STREAM_THROUGHPUT_GRACE_MS })).toBe(false);
  });
  it('the grace sits between the throughput grace and the idle bound that ends a call', () => {
    expect(STREAM_FIRST_BYTE_GRACE_MS).toBeGreaterThan(STREAM_THROUGHPUT_GRACE_MS);
    expect(STREAM_FIRST_BYTE_GRACE_MS).toBeLessThan(STREAM_IDLE_MS_DEFAULT);
  });
  it('env-configurable, never below the throughput grace; junk falls back', () => {
    process.env.AGENTV3_STREAM_FIRST_BYTE_GRACE_MS = '45000';
    expect(streamFirstByteGraceMs()).toBe(45_000);
    process.env.AGENTV3_STREAM_FIRST_BYTE_GRACE_MS = '1000';
    expect(streamFirstByteGraceMs()).toBe(STREAM_THROUGHPUT_GRACE_MS);
    process.env.AGENTV3_STREAM_FIRST_BYTE_GRACE_MS = 'junk';
    expect(streamFirstByteGraceMs()).toBe(STREAM_FIRST_BYTE_GRACE_MS);
  });
  it('the never-opened bound (planner and builder) uses the same first-byte grace', () => {
    const src = readFileSync('src/server/AgentV3/providers/OpenAiToolRunner.ts', 'utf8');
    expect(src).toMatch(/Math\.min\(firstAnswerMs, streamFirstByteGraceMs\(\)\)/);
  });
});
