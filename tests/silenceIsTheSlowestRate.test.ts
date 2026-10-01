// AUTOPSY 1389f0d5 (2026-09-30): "Provider time wasted: 80.3s across 2 call(s) that returned nothing —
// 17% of the build's clock. By kind: 1 timeout (60s), 1 crawl (20.3s)."
//
// The throughput floor was judged only when a chunk ARRIVED. A rung that trickled was abandoned at ~20 s; a
// rung that sent nothing at all waited out the whole 60-second silence window — silence was treated more
// gently than slowness. While the ladder allows an abandon (a next rung exists, the crawl allowance is not
// spent), a stream that has produced nothing by the end of the grace period is now abandoned as a crawl,
// whether it never opened or opened and never spoke. Locked here:
//   1. a request that never opens is given up at the grace period, with the crawl message;
//   2. a stream that opens and never speaks is given up at the grace period, with the crawl message;
//   3. with no abandon allowed (the last rung), nothing changes — a slow answer beats none;
//   4. a stream that opens after we gave up is closed, so it does not generate for nobody.
import { describe, it, expect, afterEach } from 'vitest';
import { OpenAiToolRunner, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function env() {
  process.env.AGENTV3_STREAM_BUILD_CALLS = 'on';
  process.env.AGENTV3_STREAM_IDLE_MS = '12000';
  process.env.AGENTV3_STREAM_THROUGHPUT_GRACE_MS = '5000';
}

const params = (over: Record<string, unknown>) => ({ model: 'glm-4.7-flashx', system: 's', messages: [{ role: 'user' as const, content: 'build' }], tools: [], ...over });

function silentStream(onAbort: () => void) {
  return {
    controller: { abort: onAbort },
    [Symbol.asyncIterator]() { return { next: () => new Promise<never>(() => {}) }; },
  };
}

describe('1 · a request that never opens', () => {
  it('🔴 is abandoned as a crawl at the grace period when another rung can take it', async () => {
    env();
    const hung = { chat: { completions: { create: () => new Promise(() => {}) } } } as unknown as OpenAiChatClient;
    const t0 = Date.now();
    await expect(new OpenAiToolRunner(hung, { model: 'glm-4.7-flashx' })
      .runTurn(params({ canAbandonSlowStream: () => true, hasNextRung: true }) as never))
      .rejects.toThrow(/abandoned for crawling after 5000ms/);
    expect(Date.now() - t0).toBeLessThan(8_000);
  }, 20_000);
});

describe('2 · a stream that opens and never speaks', () => {
  it('🔴 is abandoned as a crawl at the grace period, not at the silence window', async () => {
    env();
    let aborted = false;
    const client = { chat: { completions: { create: async () => silentStream(() => { aborted = true; }) } } } as unknown as OpenAiChatClient;
    const t0 = Date.now();
    await expect(new OpenAiToolRunner(client, { model: 'glm-4.7-flashx' })
      .runTurn(params({ canAbandonSlowStream: () => true, hasNextRung: true }) as never))
      .rejects.toThrow(/abandoned for crawling/);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(aborted).toBe(true);
  }, 20_000);
});

describe('3 · the last rung is never given up for being slow', () => {
  it('🔒 without an allowed abandon the silence window still decides', async () => {
    env();
    const client = { chat: { completions: { create: async () => silentStream(() => {}) } } } as unknown as OpenAiChatClient;
    const t0 = Date.now();
    await expect(new OpenAiToolRunner(client, { model: 'glm-4.7-flashx' })
      .runTurn(params({ canAbandonSlowStream: () => false, hasNextRung: false }) as never))
      .rejects.toThrow(/timed out after 12000ms/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(11_500);
  }, 30_000);
});

describe('4 · a stream that opens after we gave up is closed', () => {
  it('does not generate for nobody', async () => {
    env();
    let aborted = false;
    let open: (v: unknown) => void = () => {};
    const client = { chat: { completions: { create: () => new Promise((r) => { open = r; }) } } } as unknown as OpenAiChatClient;
    await expect(new OpenAiToolRunner(client, { model: 'glm-4.7-flashx' })
      .runTurn(params({ canAbandonSlowStream: () => true, hasNextRung: true }) as never))
      .rejects.toThrow(/abandoned for crawling/);
    open(silentStream(() => { aborted = true; }));
    await new Promise((r) => setTimeout(r, 20));
    expect(aborted).toBe(true);
  }, 20_000);
});
