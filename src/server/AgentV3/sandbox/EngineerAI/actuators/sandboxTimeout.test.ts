import { describe, it, expect } from 'vitest';
import { withTimeout, isIgnoredListPath, resolveE2bTemplate, withDaemonRetry } from './E2BActuator';

describe('withDaemonRetry — browser_action survives a dead CDP daemon (BENCHMARK #2 autopsy)', () => {
  it('a first-try success runs the action once and never relaunches the daemon', async () => {
    let attempts = 0; let relaunches = 0;
    const r = await withDaemonRetry(async () => { attempts++; return 'ok'; }, () => { relaunches++; });
    expect(r).toBe('ok');
    expect(attempts).toBe(1);
    expect(relaunches).toBe(0);
  });

  it('a first-try failure RELAUNCHES the daemon and retries once, then succeeds', async () => {
    // The exact benchmark shape: the daemon was not reachable on the first attempt (exit 1), so the
    // cached-dead daemon is dropped and a fresh one is launched before the retry.
    let attempts = 0; const order: string[] = [];
    const r = await withDaemonRetry(
      async () => { attempts++; order.push(`attempt:${attempts}`); if (attempts === 1) throw new Error('exit status 1'); return 'clicked'; },
      () => { order.push('relaunch'); },
    );
    expect(r).toBe('clicked');
    expect(attempts).toBe(2);
    expect(order).toEqual(['attempt:1', 'relaunch', 'attempt:2']); // relaunch happens BETWEEN the two tries
  });

  it('two failures throw honestly — the tool is reported unavailable, never a false success', async () => {
    let relaunches = 0;
    await expect(withDaemonRetry(
      async () => { throw new Error('the browser was not reachable'); },
      () => { relaunches++; },
    )).rejects.toThrow(/not reachable/);
    expect(relaunches).toBe(1); // relaunched once, retried once, then gave up honestly
  });
});

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

describe('resolveE2bTemplate — A3 custom E2B image wiring (env-gated, safe no-op by default)', () => {
  it('returns undefined when E2B_TEMPLATE_ID is unset → default base image (unchanged behavior)', () => {
    expect(resolveE2bTemplate({} as any)).toBeUndefined();
  });
  it('returns undefined for a blank/whitespace value', () => {
    expect(resolveE2bTemplate({ E2B_TEMPLATE_ID: '   ' } as any)).toBeUndefined();
  });
  it('returns the trimmed template id when set → Sandbox.create launches the pinned image', () => {
    expect(resolveE2bTemplate({ E2B_TEMPLATE_ID: 'navbharat-builder' } as any)).toBe('navbharat-builder');
    expect(resolveE2bTemplate({ E2B_TEMPLATE_ID: '  navbharat-builder  ' } as any)).toBe('navbharat-builder');
  });
});
