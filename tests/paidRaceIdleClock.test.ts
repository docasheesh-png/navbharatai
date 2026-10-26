/** Discarded provider activity must not hide silence in the answer actually shown to the user. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { AIRouter, getProviderStats, type StreamOutcome } from '../src/server/AI/Router/AIRouter';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); resetAllBreakers(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('AI_STREAM_RACE', ''); vi.stubEnv('CHAT_STREAM_WATCHDOG', 'on'); vi.stubEnv('CHAT_STREAM_IDLE_MS', '5000'); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
function fixture() {
  const router = new AIRouter('professional'); const parent = new AbortController();
  const emit: Array<(text: string) => void> = []; const finish: Array<() => void> = []; const signals: Array<AbortSignal | undefined> = [];
  const calls = [vi.fn(), vi.fn()]; const chunks: string[] = [];
  for (const [index, name] of ['GROK', 'GEMINI'].entries()) router.registerProvider({ name: name as 'GROK' | 'GEMINI', priority: index, healthCheck: async () => true, execute: vi.fn(),
    executeStream: async (_p, _s, chunk, _m, signal) => { calls[index](); signals[index] = signal; emit[index] = chunk; if (index === 0) chunk('Winner starts.'); await new Promise<void>(resolve => { finish[index] = resolve; }); return 'completed'; } });
  let outcome: StreamOutcome | undefined;
  const pending = router.routeStream('Synthetic question', undefined, text => chunks.push(text), parent.signal).then(value => { outcome = value; return value; });
  return { emit, finish, calls, chunks, signals, parent, pending, outcome: () => outcome };
}
describe('paid race visible-answer idle clock', () => {
  it('loser chunks cannot extend the stalled winner idle deadline or mix into its answer', async () => {
    const f = fixture(); await flush(); await vi.advanceTimersByTimeAsync(4000); f.emit[1]('Discarded loser activity.');
    await vi.advanceTimersByTimeAsync(1000);
    expect.soft(f.outcome()).toMatchObject({ ok: true, provider: 'GROK', raced: true, reason: 'stalled', latencyMs: 5000 });
    expect(f.chunks).toEqual(['Winner starts.']); f.calls.forEach(call => expect(call).toHaveBeenCalledOnce());
    // This changes observation only: both paid attempts and their existing occupancy remain owned.
    f.signals.forEach(signal => expect(signal).toBe(f.parent.signal)); expect(f.parent.signal.aborted).toBe(false);
    expect(getProviderStats().GROK.inFlightByUniverse.professional).toBe(1); expect(getProviderStats().GEMINI.inFlightByUniverse.professional).toBe(1);
    f.finish.forEach(finish => finish()); await f.pending; await flush();
    expect(getProviderStats().GROK.inFlightByUniverse.professional).toBe(0); expect(getProviderStats().GEMINI.inFlightByUniverse.professional).toBe(0);
  });
  it('real winner output still refreshes idle time; later loser output does not', async () => {
    const f = fixture(); await flush(); await vi.advanceTimersByTimeAsync(4000); f.emit[0]('Winner continues.');
    await vi.advanceTimersByTimeAsync(1000); expect(f.outcome()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3000); f.emit[1]('Discarded loser activity.');
    await vi.advanceTimersByTimeAsync(1000);
    expect.soft(f.outcome()).toMatchObject({ ok: true, provider: 'GROK', reason: 'stalled', latencyMs: 9000 });
    expect(f.chunks).toEqual(['Winner starts.', 'Winner continues.']);
    f.finish.forEach(finish => finish()); await f.pending; await flush(); expect(vi.getTimerCount()).toBe(0);
  });
});
