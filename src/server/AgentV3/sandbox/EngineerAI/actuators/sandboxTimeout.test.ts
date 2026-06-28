import { describe, it, expect } from 'vitest';
import { withTimeout } from './E2BActuator';

describe('withTimeout — bounds a call that could hang forever (sandbox create/connect)', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('rejects with a labelled timeout error when the promise hangs', async () => {
    const neverResolves = new Promise<number>(() => { /* hangs forever */ });
    await expect(withTimeout(neverResolves, 20, 'Sandbox.create')).rejects.toThrow(/Sandbox\.create timed out after 20ms/);
  });

  it('propagates a rejection from the wrapped promise unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
});
