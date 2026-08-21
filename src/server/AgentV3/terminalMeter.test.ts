import { describe, it, expect } from 'vitest';
import {
  createMeterRegistry, attachStream, accrueFor, detachStream, openStreamCount,
} from './terminalMeter';

/**
 * THE OVER-CHARGE (found 2026-08-21): each attached terminal stream ran its own meter against the
 * SAME per-user daily bucket, so three open terminals burned the 30-minute allowance three times as
 * fast — while all of them are PTYs inside ONE sandbox that costs NavBharatAI nothing extra.
 */
const S = 1000;

describe('terminal meter — wall-clock per user, never per terminal', () => {
  it('THE BUG: three terminals for one minute cost ONE minute, not three', () => {
    const reg = createMeterRegistry();
    const t0 = 1_000_000;
    attachStream(reg, 'u1', 'a', t0);
    attachStream(reg, 'u1', 'b', t0);
    attachStream(reg, 'u1', 'c', t0);

    // Every stream ticks, as each one's own interval really does.
    const charged = accrueFor(reg, 'u1', t0 + 60 * S)
      + accrueFor(reg, 'u1', t0 + 60 * S)
      + accrueFor(reg, 'u1', t0 + 60 * S);

    expect(charged).toBe(60); // not 180
  });

  it('a second terminal opened later joins the running stretch — it does not start a second bill', () => {
    const reg = createMeterRegistry();
    const t0 = 0;
    attachStream(reg, 'u1', 'a', t0);
    attachStream(reg, 'u1', 'b', t0 + 30 * S); // joins mid-stretch
    expect(accrueFor(reg, 'u1', t0 + 60 * S)).toBe(60);
    expect(accrueFor(reg, 'u1', t0 + 60 * S)).toBe(0); // already consumed
  });

  it('closing a tab never forgives the time since the last tick', () => {
    const reg = createMeterRegistry();
    attachStream(reg, 'u1', 'a', 0);
    expect(detachStream(reg, 'u1', 'a', 45 * S)).toBe(45);
  });

  it('closing ONE of two terminals charges once and leaves the other running on the same mark', () => {
    const reg = createMeterRegistry();
    attachStream(reg, 'u1', 'a', 0);
    attachStream(reg, 'u1', 'b', 0);
    expect(detachStream(reg, 'u1', 'a', 30 * S)).toBe(30);
    expect(openStreamCount(reg, 'u1')).toBe(1);
    expect(accrueFor(reg, 'u1', 30 * S)).toBe(0);      // that stretch is paid
    expect(accrueFor(reg, 'u1', 60 * S)).toBe(30);     // the next one is not
  });

  it('the gap while NOTHING was open is never billed', () => {
    const reg = createMeterRegistry();
    attachStream(reg, 'u1', 'a', 0);
    detachStream(reg, 'u1', 'a', 10 * S);
    // …laptop shut for an hour…
    attachStream(reg, 'u1', 'b', 3_600_000);
    expect(accrueFor(reg, 'u1', 3_600_000 + 5 * S)).toBe(5); // only the new 5s
  });

  it('nothing attached ⇒ nothing charged, and an unknown stream detach is a no-op', () => {
    const reg = createMeterRegistry();
    expect(accrueFor(reg, 'u1', 5 * S)).toBe(0);
    expect(detachStream(reg, 'u1', 'ghost', 5 * S)).toBe(0);
  });

  it('two DIFFERENT users are metered independently', () => {
    const reg = createMeterRegistry();
    attachStream(reg, 'u1', 'a', 0);
    attachStream(reg, 'u2', 'a', 0);
    expect(accrueFor(reg, 'u1', 30 * S)).toBe(30);
    expect(accrueFor(reg, 'u2', 30 * S)).toBe(30); // u1's tick did not consume u2's stretch
  });

  it('keeps the 120s cap on one tick (a slept process must not bill time nobody spent)', () => {
    const reg = createMeterRegistry();
    attachStream(reg, 'u1', 'a', 0);
    expect(accrueFor(reg, 'u1', 10 * 60 * S)).toBe(120);
  });

  it('sub-second slivers are carried, not repeatedly forgiven', () => {
    const reg = createMeterRegistry();
    attachStream(reg, 'u1', 'a', 0);
    expect(accrueFor(reg, 'u1', 500)).toBe(0);   // under a second — mark must NOT move
    expect(accrueFor(reg, 'u1', 1500)).toBe(1);  // …so this still sees a whole second
  });
});
