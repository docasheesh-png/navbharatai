import { describe, it, expect } from 'vitest';
import { shouldSeedSandbox, ensureWorkspaceFilesInSandbox, projectNeedsMarker, PROJECT_MARKER } from './sandboxSeed';

/**
 * Admin 2026-08-19: an app built at 10:20 and previewing correctly failed to publish at 16:11 with
 * `npm error enoent ... /home/user/workspace/package.json`. The app was fine; the SANDBOX was empty.
 * Publish assumed the sandbox still held the files, which is true for a few minutes after a build and
 * false for the rest of the day.
 */

function fakeActuator(sandboxFiles: string[] | Error) {
  const written: Record<string, string> = {};
  return {
    written,
    listFiles: async () => { if (sandboxFiles instanceof Error) throw sandboxFiles; return sandboxFiles; },
    writeFile: async (_w: string, p: string, c: string) => { written[p] = c; },
  };
}

describe('shouldSeedSandbox', () => {
  const saved = { 'package.json': '{}', 'src/App.tsx': 'x' };

  it('THE REPORTED CASE: an empty sandbox with saved files must be seeded', () => {
    expect(shouldSeedSandbox([], saved)).toEqual({ seed: true, reason: 'sandbox empty' });
  });

  it('a warm sandbox that already has the project is left alone', () => {
    expect(shouldSeedSandbox(['package.json', 'src/App.tsx'], saved).seed).toBe(false);
  });

  it('a sandbox with files but NO package.json is still seeded', () => {
    // The failure being fixed is `npm run build` opening package.json. A stray scaffold remnant or a
    // lone lockfile makes the sandbox non-empty while leaving the build exactly as broken, so
    // "has some files" is the wrong test and the file the build actually opens is the right one.
    expect(shouldSeedSandbox(['node_modules/.package-lock.json', 'README.md'], saved))
      .toEqual({ seed: true, reason: 'project marker missing' });
  });

  it('finds the marker in a nested workspace path too', () => {
    expect(shouldSeedSandbox(['/home/user/workspace/package.json'], saved).seed).toBe(false);
  });

  it('a FAILED listing seeds — "could not look" is not "empty"', () => {
    // Skipping the seed because the listing errored would reproduce the original bug through a
    // different door. Re-writing files that are already there is harmless; not writing them is not.
    expect(shouldSeedSandbox(null, saved)).toEqual({ seed: true, reason: 'sandbox listing failed' });
  });

  it('never seeds when there is nothing saved — there is nothing to restore', () => {
    expect(shouldSeedSandbox([], {})).toEqual({ seed: false, reason: 'no saved files' });
  });

  it('a static project with no package.json is judged on emptiness alone', () => {
    const staticApp = { 'index.html': '<h1>hi</h1>' };
    expect(projectNeedsMarker(staticApp)).toBe(false);
    expect(shouldSeedSandbox(['index.html'], staticApp).seed).toBe(false);
    expect(shouldSeedSandbox([], staticApp).seed).toBe(true);
  });
});

describe('ensureWorkspaceFilesInSandbox', () => {
  const saved = { 'package.json': '{"name":"piano"}', 'src/App.tsx': 'piano' };

  it('restores every saved file into an empty sandbox and reports ready', async () => {
    const a = fakeActuator([]);
    const r = await ensureWorkspaceFilesInSandbox(a, 'ws1', async () => saved);
    expect(r.ready).toBe(true);
    expect(r.seeded).toBe(2);
    expect(a.written['package.json']).toBe('{"name":"piano"}');
  });

  it('writes nothing when the sandbox is already good — publish stays fast in the common case', async () => {
    const a = fakeActuator(['package.json', 'src/App.tsx']);
    const r = await ensureWorkspaceFilesInSandbox(a, 'ws1', async () => saved);
    expect(r).toEqual({ ready: true, seeded: 0, reason: '' });
    expect(Object.keys(a.written)).toEqual([]);
  });

  it('says so HONESTLY when the workspace genuinely has nothing', async () => {
    // The one case where "nothing to publish" is true — and it must read as our sentence, not npm's.
    const a = fakeActuator([]);
    const r = await ensureWorkspaceFilesInSandbox(a, 'ws1', async () => ({}));
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('build an app first');
    expect(r.reason).not.toMatch(/ENOENT|npm/i);
  });

  it('one unwritable file does not abort the restore', async () => {
    // A partial project builds far more often than an empty one.
    const a = fakeActuator([]);
    const flaky = { ...a, writeFile: async (_w: string, p: string, c: string) => {
      if (p === 'src/App.tsx') throw new Error('disk hiccup');
      a.written[p] = c;
    } };
    const r = await ensureWorkspaceFilesInSandbox(flaky, 'ws1', async () => saved);
    expect(r.ready).toBe(true);
    expect(r.seeded).toBe(1);
  });

  it('never throws at a caller mid-publish, whatever the sandbox does', async () => {
    const a = fakeActuator(new Error('sandbox gone'));
    await expect(ensureWorkspaceFilesInSandbox(a, 'ws1', async () => saved)).resolves.toBeTruthy();
    await expect(ensureWorkspaceFilesInSandbox(a, 'ws1', async () => { throw new Error('firestore down'); }))
      .resolves.toMatchObject({ ready: false });
  });

  it('refuses without a workspace instead of guessing one', async () => {
    const r = await ensureWorkspaceFilesInSandbox(fakeActuator([]), '', async () => saved);
    expect(r.ready).toBe(false);
  });

  it('the marker is the file the build actually opens', () => {
    expect(PROJECT_MARKER).toBe('package.json');
  });
});
