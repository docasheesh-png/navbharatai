import { describe, it, expect } from 'vitest';
import { shouldRunNextQueued, type RunNextInput } from './queueExecutor';

function inp(over: Partial<RunNextInput> = {}): RunNextInput {
  return { running: false, buildSettled: true, pendingGate: false, hasError: false, claimInFlight: false, ...over };
}

describe('shouldRunNextQueued', () => {
  it('runs the next item when idle after a settled build', () => {
    expect(shouldRunNextQueued(inp())).toBe(true);
  });

  it('never claims a second while a build is running (serial one-writer invariant)', () => {
    expect(shouldRunNextQueued(inp({ running: true }))).toBe(false);
  });

  it('does not advance before the previous build has settled', () => {
    expect(shouldRunNextQueued(inp({ buildSettled: false }))).toBe(false);
  });

  it('does not advance while a plan/permission gate is open', () => {
    expect(shouldRunNextQueued(inp({ pendingGate: true }))).toBe(false);
  });

  it('PAUSES the queue on an error (never auto-chains past a failure)', () => {
    expect(shouldRunNextQueued(inp({ hasError: true }))).toBe(false);
  });

  it('does not re-enter while a claim/submit is already in flight', () => {
    expect(shouldRunNextQueued(inp({ claimInFlight: true }))).toBe(false);
  });

  it('every guard independently blocks; the happy path is the only true', () => {
    expect(shouldRunNextQueued(inp())).toBe(true);
    for (const k of ['running', 'pendingGate', 'hasError', 'claimInFlight'] as const) {
      expect(shouldRunNextQueued(inp({ [k]: true }))).toBe(false);
    }
    expect(shouldRunNextQueued(inp({ buildSettled: false }))).toBe(false);
  });
});
