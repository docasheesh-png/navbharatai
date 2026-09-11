import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ALLOWED_PASSES } from '../src/server/AgentV3/greenFreeze';

/**
 * ⚠️ THE FIFTY-ATTEMPT BUG (admin 2026-09-11, verbatim).
 *
 * *"woh alredy mare huye hi hai, wapas on nahi hote hai. kitne bhi retry/diagnosis karo, woh wapas live
 * nahi ate hai, bas starting ke 24hr tak hi live rahte hai … aur isko aap bhi 50+ bar fix kiye ho.
 * nahi hua"* — then, flatly: *"resume nahi hota hai."*
 *
 * They were right, and every one of those fifty attempts was aimed at the wrong thing. A paused
 * sandbox genuinely can stop existing on the vendor's side, so a refused `Sandbox.connect` is a NORMAL
 * state. `getSandbox` already handled it by creating a fresh machine — and then the ONLY thing that
 * refilled that machine was the actuator's in-memory `_fileCache`, which the idle sweep deletes on
 * pause and which dies with its Cloud Run instance on every deploy. Days later, on another instance,
 * the restore source was empty. The machine stayed empty. Every retry repeated the same nothing.
 *
 * The app was never lost: `WorkspaceFileStore` is Firestore, has no TTL, and is written on every build
 * and edit. Publish and GitHub push already read it before touching a sandbox (sandboxSeed.ts) because
 * each was fixed on the day it broke. The PREVIEW — the surface the user looks at — was outside both.
 *
 * The fix belongs at `getSandbox` because that is the ONE door into a sandbox: the preview door's port
 * sweep, a publish, a push, a read and a build all pass through it, so one guarantee replaces five
 * call sites remembering to ask. These assertions pin that, because the failure mode is silent — a
 * machine nobody fills, reported as a clean setup.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const actuator = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
const route = read('src/server/routes/agentv3.ts');

const restoreBody = (() => {
  const at = actuator.indexOf('private async _restoreFreshSandbox(workspaceId: string): Promise<void> {');
  expect(at).toBeGreaterThan(-1);
  return actuator.slice(at, actuator.indexOf('\n  }', at));
})();

describe('a fresh machine gets the app put back into it', () => {
  it('the fresh-create branch restores instead of replaying a memory cache', () => {
    expect(actuator).toContain('if (freshCreate) await this._restoreFreshSandbox(workspaceId);');
  });

  it('reads the DURABLE store — the only source that still exists days later', () => {
    // This is the whole fix. A restore that consults only `_fileCache` is the original bug.
    expect(restoreBody).toContain('loadWorkspaceFiles(workspaceId)');
  });

  it('still prefers a warm write per path, so an unsaved edit is not undone', () => {
    expect(restoreBody).toContain('this._fileCache.get(workspaceId)');
    expect(restoreBody).toContain('mergeRestoreSources(durable, warm)');
  });

  it('lands the files through the ONE shared writer, not a fifth hand-rolled loop', () => {
    // `writeWorkspaceFiles` carries the archive fast path. The serial per-file loop it replaced is the
    // same bug class that once cost a 2,460-file project 648 seconds.
    expect(restoreBody).toContain('writeWorkspaceFiles(this, workspaceId, files)');
    expect(actuator).not.toContain("'files.write(replay)'");
  });

  it('restores the binary assets too — an app back without its logo is the same report again', () => {
    expect(restoreBody).toContain('restoreWorkspaceAssets(this, workspaceId)');
  });
});

describe('the restore can write to a green app, and cannot hang the caller', () => {
  it('runs inside the Green Freeze pass that is allowed to restore', () => {
    // Without the pass name the freeze refuses every write on a verified-working app — which is how an
    // identical restore once told a user "your files could not be restored" on a perfectly safe app.
    expect(restoreBody).toContain("runInPass('sandbox-file-restore'");
    expect(ALLOWED_PASSES.has('sandbox-file-restore')).toBe(true);
  });

  it('bounds every remote step, because getSandbox is on the hot path of every write', () => {
    expect(restoreBody).toContain("DURABLE_RESTORE_LOAD_MS, 'loadWorkspaceFiles(restore)'");
    expect(restoreBody).toContain("DURABLE_RESTORE_WRITE_MS, 'writeWorkspaceFiles(restore)'");
    expect(restoreBody).toContain("DURABLE_RESTORE_ASSET_MS, 'restoreWorkspaceAssets(restore)'");
  });

  it('never throws — a failed restore must still hand back the sandbox, and say it failed', () => {
    // Throwing here would turn "your preview is empty" into "your build crashed", on every path.
    expect(restoreBody).toContain('} catch {');
    expect(restoreBody).toContain('if (restoreFailed(outcome))');
    expect(restoreBody).toContain('summarizeRestore(outcome)');
  });
});

describe('concurrent callers share ONE machine', () => {
  it('holds an in-flight creation per workspace', () => {
    // Every file write, command and port sweep calls getSandbox, and a build fires several at once.
    // With no lock, two callers each created a machine and only the last was remembered — the other
    // billed by the minute until a sweep found it.
    expect(actuator).toContain('private _creating = new Map<string, Promise<Sandbox>>();');
    expect(actuator).toContain('const inFlight = this._creating.get(workspaceId);');
    expect(actuator).toContain('if (inFlight) return await inFlight;');
  });

  it('clears the entry whatever happened, so a failed create stays retryable', () => {
    expect(actuator).toContain('this._creating.delete(workspaceId);');
  });

  it('publishes the sandbox BEFORE restoring, so the restore cannot deadlock on its own lock', () => {
    // The restore writes through `this.writeFile`, which re-enters getSandbox. That re-entry must hit
    // the warm path — which it does only because `this.sandboxes` is set before the restore runs.
    const at = actuator.indexOf('this.sandboxes.set(workspaceId, sandbox);');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(actuator.indexOf('if (freshCreate) await this._restoreFreshSandbox(workspaceId);'));
  });
});

describe('the build report tells the truth about an empty machine', () => {
  it('reports what the restore achieved beside how the machine was obtained', () => {
    // The origin says the machine came up empty; only this says whether the app got put back. A report
    // with one and not the other is what left "created a fresh machine" next to a blank preview with
    // nothing to point at.
    expect(route).toContain("sandbox=${sandboxOriginOf(actuator, workspaceId) ?? 'unreported'}");
    expect(route).toContain("restore=${sandboxRestoreOf(actuator, workspaceId) ?? 'n/a (warm or resumed)'}");
  });

  it('an actuator that cannot answer says so instead of guessing', () => {
    const at = route.indexOf('function sandboxRestoreOf(');
    expect(at).toBeGreaterThan(-1);
    const body = route.slice(at, route.indexOf('\n}', at));
    expect(body).toContain("typeof fn !== 'function'");
    expect(body).toContain('return null;');
  });
});
