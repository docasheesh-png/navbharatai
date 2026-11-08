import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getChatOutcomeObservation, observeChatOutcome, resetChatOutcomeObservationForTests } from './chatOutcomeObservation';
beforeEach(() => { resetChatOutcomeObservationForTests(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
describe('chat terminal observation without quality claims', () => {
  it('keeps complete, empty, partial, refused and cancelled outcomes separate', async () => {
    await observeChatOutcome('free', undefined, async () => ({ ok: true, content: 'Public reply' }));
    await observeChatOutcome('free', undefined, async () => ({ ok: true, content: ' ' }));
    await observeChatOutcome('professional', undefined, async () => ({ ok: true, reason: 'stalled', content: 'Cut' }));
    const error = Object.assign(new Error('Private error text must not be recorded'), { code: 'SAFETY_REFUSAL' });
    await expect(observeChatOutcome('free', undefined, async () => { throw error; })).rejects.toBe(error);
    const controller = new AbortController(); controller.abort();
    await observeChatOutcome('free', controller.signal, async () => ({ ok: false }));
    expect(getChatOutcomeObservation().counts).toEqual({ complete: 1, partial: 1, refused: 1, cancelled: 1, failed: 1 });
    expect(JSON.stringify(getChatOutcomeObservation())).not.toContain(error.message);
    expect(getChatOutcomeObservation().bySurface.professional.partial).toBe(1);
  });
  it('does not mistake a notice for a streamed answer, or a committed error for completion', async () => {
    await observeChatOutcome('free', undefined, async () => ({ ok: true }), () => false);
    await expect(observeChatOutcome('free', undefined, async () => { throw new Error('Disconnected'); }, () => true)).rejects.toThrow('Disconnected');
    expect(getChatOutcomeObservation().counts).toMatchObject({ failed: 1, partial: 1, complete: 0 });
  });
  it.each([
    [{ code: 'AUTH' }, 'authentication'], [{ status: 429 }, 'rate-limit'],
    [{ code: 'QUOTA_EXHAUSTED' }, 'quota'], [{ status: 504 }, 'timeout'],
    [{ code: 'NETWORK' }, 'network'], [{ status: 503 }, 'upstream'],
    [{ code: 'unknown-private-label' }, 'unknown'],
  ])('records only an allowlisted failure category for %j', async (error, category) => {
    await expect(observeChatOutcome('free', undefined, async () => { throw error; })).rejects.toBe(error);
    expect(getChatOutcomeObservation().failureReasons).toEqual({ [category]: 1 });
    expect(JSON.stringify(getChatOutcomeObservation())).not.toContain('unknown-private-label');
  });
  it('explicit safety refusal takes precedence over a generic HTTP status', async () => {
    const error = { code: 'SAFETY_REFUSAL', status: 403 };
    await expect(observeChatOutcome('free', undefined, async () => { throw error; })).rejects.toBe(error);
    expect(getChatOutcomeObservation().counts.refused).toBe(1);
    expect(getChatOutcomeObservation().failureReasons).toEqual({ policy: 1 });
  });
  it('retains at most sixteen buckets even when the wall clock moves backwards', async () => {
    const start = Date.now();
    for (let minute = 0; minute < 100; minute++) {
      vi.setSystemTime(start - minute * 60_000);
      await observeChatOutcome('free', undefined, async () => ({ ok: true, content: 'Public' }));
    }
    expect(getChatOutcomeObservation().counts.complete).toBeLessThanOrEqual(16);
  });
  it('preserves the exact return object, isolates snapshots and expires old samples', async () => {
    const reply = { ok: true, content: 'Public' };
    expect(await observeChatOutcome('unknown-private-label', undefined, async () => reply)).toBe(reply);
    const snapshot = getChatOutcomeObservation(); snapshot.counts.complete = 99;
    expect(getChatOutcomeObservation().counts.complete).toBe(1);
    expect(getChatOutcomeObservation().bySurface).toHaveProperty('other');
    expect(JSON.stringify(snapshot)).not.toContain('unknown-private-label');
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(getChatOutcomeObservation().counts.complete).toBe(0);
  });
});
