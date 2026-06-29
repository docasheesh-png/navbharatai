import { describe, it, expect } from 'vitest';
import { stripUndefined, logStore } from './logStore';

describe('logStore.stripUndefined', () => {
  it('removes undefined-valued keys (the cause of firebase-admin sync throws)', () => {
    const out = stripUndefined({ id: 'x', ts: 1, traceId: undefined, message: undefined, event: 'E' });
    expect(out).toEqual({ id: 'x', ts: 1, event: 'E' });
    expect('traceId' in out).toBe(false);
    expect('message' in out).toBe(false);
  });

  it('keeps falsy-but-defined values (0, "", false, null)', () => {
    const out = stripUndefined({ a: 0, b: '', c: false, d: null, e: undefined });
    expect(out).toEqual({ a: 0, b: '', c: false, d: null });
  });

  it('is a shallow copy (does not mutate the input)', () => {
    const input = { a: 1, b: undefined };
    const out = stripUndefined(input);
    expect(input.b).toBeUndefined(); // original untouched
    expect(out).toEqual({ a: 1 });
    expect(out).not.toBe(input);
  });
});

describe('logStore.append — never throws (contract)', () => {
  it('does not throw even with undefined optional fields', () => {
    // Under VITEST getDb() returns null so this is a no-op, but the call must be safe.
    expect(() => logStore.append({ level: 'info', event: 'TEST', traceId: undefined })).not.toThrow();
  });
});
