import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldSeedSandbox, ensureWorkspaceFilesInSandbox, prepareSandboxForBuild, projectNeedsMarker, PROJECT_MARKER } from './sandboxSeed';

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

describe('prepareSandboxForBuild — files AND dependencies, because half a fix produced the second report', () => {
  const saved = { 'package.json': '{"scripts":{"build":"tsc && vite build"}}', 'src/App.tsx': 'x' };

  function actuator(sandboxFiles: string[], dep?: { ok: boolean; ran: boolean; log: string } | Error) {
    const written: Record<string, string> = {};
    const calls: string[] = [];
    return {
      written, calls,
      listFiles: async () => sandboxFiles,
      writeFile: async (_w: string, p: string, c: string) => { written[p] = c; },
      ensureDependencies: dep === undefined ? undefined : async (w: string) => {
        calls.push(w);
        if (dep instanceof Error) throw dep;
        return dep;
      },
    };
  }

  it('THE SECOND REPORT: a seeded sandbox also gets its dependencies installed', async () => {
    // Admin 2026-08-19, twenty minutes after the ENOENT fix shipped: `sh: 1: tsc: not found`.
    // Restoring source files without node_modules leaves the build with no tools to run with.
    const a = actuator([], { ok: true, ran: true, log: 'added 240 packages' });
    const r = await prepareSandboxForBuild(a, 'ws1', async () => saved);
    expect(r.ready).toBe(true);
    expect(r.seeded).toBe(2);
    expect(r.installed).toBe(true);
    expect(a.calls).toEqual(['ws1']);   // the install really was asked for
  });

  it('a FAILED install does not block the build — the contract says carry on', async () => {
    // ensureDependencies is documented optional + best-effort: "carry on and report honestly, never a
    // hard stop". Blocking here would turn a recoverable install hiccup into a dead Publish button.
    const a = actuator([], { ok: false, ran: true, log: 'ERR! network timeout' });
    const r = await prepareSandboxForBuild(a, 'ws1', async () => saved);
    expect(r.ready).toBe(true);
    expect(r.installFailed).toBe(true);
    expect(r.installLog).toContain('network timeout');
  });

  it('an install that THROWS is reported, never rethrown at a caller mid-publish', async () => {
    const a = actuator([], new Error('sandbox died'));
    const r = await prepareSandboxForBuild(a, 'ws1', async () => saved);
    expect(r.ready).toBe(true);
    expect(r.installFailed).toBe(true);
    expect(r.installLog).toContain('sandbox died');
  });

  it('an actuator with no install support is fine — it is optional by design', async () => {
    // Local/Docker actuators do not offer it. Absence must read as "nothing to do", not as failure.
    const a = actuator([], undefined);
    const r = await prepareSandboxForBuild(a, 'ws1', async () => saved);
    expect(r.ready).toBe(true);
    expect(r.installFailed).toBe(false);
    expect(r.installed).toBe(false);
  });

  it('does not reach the install when there is nothing to build', async () => {
    // No files means no publish; asking for an install first would spend sandbox time for nothing.
    const a = actuator([], { ok: true, ran: true, log: '' });
    const r = await prepareSandboxForBuild(a, 'ws1', async () => ({}));
    expect(r.ready).toBe(false);
    expect(a.calls).toEqual([]);
  });

  it('a warm, complete sandbox still confirms dependencies — node_modules can be pruned', async () => {
    // Files present does not prove tools present, which is exactly the gap the second report found.
    const a = actuator(['package.json', 'src/App.tsx'], { ok: true, ran: false, log: '' });
    const r = await prepareSandboxForBuild(a, 'ws1', async () => saved);
    expect(r.seeded).toBe(0);
    expect(a.calls).toEqual(['ws1']);
  });
});

describe('the restore must survive Green Freeze — the defect that broke a real publish', () => {
  /**
   * Admin 2026-08-20: *"Your files could not be restored to the build machine."* — which is MY message
   * from the fix shipped the day before, and it was firing on a workspace whose files were perfectly
   * safe.
   *
   * Every sandbox write passes through `assertWriteAllowed`, which refuses to touch a verified-working
   * app from a pass it does not recognise. The seed wrote through `actuator.writeFile` from no pass at
   * all, so on a GREEN app — the ones most worth publishing — every single write was refused, `seeded`
   * stayed 0, and the honest-sounding message blamed the restore instead of naming the refusal.
   */
  it('runs inside the allowlisted pass, so a green app can still be restored', async () => {
    const { ALLOWED_PASSES } = await import('./greenFreeze');
    expect(ALLOWED_PASSES.has('sandbox-file-restore')).toBe(true);
  });

  it('the seed declares that pass — the allowlist alone does nothing', () => {
    // A pass identifies itself by wrapping its work in runInPass; being on the list without wrapping
    // is the same as not being on the list.
    const src = readFileSync(join(__dirname, 'sandboxSeed.ts'), 'utf8');
    expect(src).toContain("runInPass('sandbox-file-restore'");
  });

  it('a failed restore now NAMES its cause instead of shrugging', async () => {
    // The swallowed exception is what hid the Green Freeze refusal for a day. The first real reason is
    // kept and reported, while later files still get their turn.
    const a = {
      listFiles: async () => [] as string[],
      writeFile: async () => { throw new Error('Green freeze: refused to overwrite "src/App.tsx"'); },
    };
    const r = await ensureWorkspaceFilesInSandbox(a, 'ws1', async () => ({ 'package.json': '{}', 'src/App.tsx': 'x' }));
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('could not be restored');
    expect(r.reason).toContain('Green freeze');   // the actual cause, not a shrug
  });

  it('one bad file still does not abort the rest', async () => {
    const written: string[] = [];
    const a = {
      listFiles: async () => [] as string[],
      writeFile: async (_w: string, p: string) => {
        if (p === 'bad.ts') throw new Error('nope');
        written.push(p);
      },
    };
    const r = await ensureWorkspaceFilesInSandbox(a, 'ws1', async () => ({ 'package.json': '{}', 'bad.ts': 'x', 'ok.ts': 'y' }));
    expect(r.ready).toBe(true);
    expect(written).toEqual(['package.json', 'ok.ts']);
  });
});
