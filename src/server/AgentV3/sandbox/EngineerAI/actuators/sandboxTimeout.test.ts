import { describe, it, expect } from 'vitest';
import { withTimeout, isIgnoredListPath } from './E2BActuator';

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

describe('isIgnoredListPath — keep node_modules & build output out of the edit file tree', () => {
  it('excludes dependency / build / VCS paths (the 5115-files bloat)', () => {
    expect(isIgnoredListPath('node_modules/react/index.js')).toBe(true);
    expect(isIgnoredListPath('dist/assets/index.js')).toBe(true);
    expect(isIgnoredListPath('.git/HEAD')).toBe(true);
    expect(isIgnoredListPath('src/components/node_modules/x.js')).toBe(true); // nested too
    expect(isIgnoredListPath('coverage/lcov.info')).toBe(true);
  });
  it('keeps real source files', () => {
    expect(isIgnoredListPath('src/App.tsx')).toBe(false);
    expect(isIgnoredListPath('index.html')).toBe(false);
    expect(isIgnoredListPath('package.json')).toBe(false);
    // a file whose NAME merely contains a substring of an ignored dir is not excluded
    expect(isIgnoredListPath('src/build-utils.ts')).toBe(false);
  });
});
