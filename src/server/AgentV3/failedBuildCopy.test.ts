/** Layer 1 of "a preview is never blank" (admin 2026-11-17): a failed build that rendered still leaves a copy. */
import { describe, expect, it, vi } from 'vitest';
import { failedBuildCopyWanted, keepFailedBuildCopy, type FailedBuildTurn } from './failedBuildCopy';

const now = 1_800_000_000_000;
// Build 3 of the reported battle royale: ENGINE_UNAVAILABLE, but the app rendered 686 s in.
const build3: FailedBuildTurn = { ok: false, rendered: true, copyTaken: null, expectsArtifacts: true, aborted: false, startedAt: now - 686_000, maxSeconds: 0 };
const VITE = JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '18', three: '0.170' } });

function rig(exitCode = 0, pkg = VITE) {
  const commands: string[] = [];
  const actuator = {
    readFile: vi.fn(async () => pkg),
    runCommand: vi.fn(async (_w: string, c: string) => { commands.push(c); return { exitCode, stdout: exitCode === 0 ? 'built in 6s' : 'error TS2304', stderr: '' }; }),
    downloadDistFiles: vi.fn(),
  };
  const takeCopy = vi.fn(async () => true);
  const record = vi.fn();
  return { actuator, takeCopy, record, commands, run: (turn: FailedBuildTurn = build3) => keepFailedBuildCopy({ actuator, workspaceId: 'w', writtenFiles: new Map([['src/game/battleroyale/game.ts', 'x']]), takeCopy, record, turn, now, loadFiles: async () => ({}), env: {} }) };
}

describe('when a failed build takes a copy', () => {
  it('the reported case: failed, rendered, no copy yet → wanted', () => {
    expect(failedBuildCopyWanted(build3, now)).toBe(true);
  });
  it('never for a successful turn (the gate already does it), an unrendered one, a stopped one, or one that already has a copy', () => {
    expect(failedBuildCopyWanted({ ...build3, ok: true }, now)).toBe(false);
    expect(failedBuildCopyWanted({ ...build3, rendered: false }, now)).toBe(false);
    expect(failedBuildCopyWanted({ ...build3, aborted: true }, now)).toBe(false);
    expect(failedBuildCopyWanted({ ...build3, copyTaken: { url: 'u' } }, now)).toBe(false);
    expect(failedBuildCopyWanted({ ...build3, expectsArtifacts: false }, now)).toBe(false);
  });
  it('never with less than 90 s left of a capped build', () => {
    expect(failedBuildCopyWanted({ ...build3, maxSeconds: 700 }, now)).toBe(false);
    expect(failedBuildCopyWanted({ ...build3, maxSeconds: 1500 }, now)).toBe(true);
  });
});

describe('keepFailedBuildCopy', () => {
  it('runs the production build and, when it passes, takes the copy and says so', async () => {
    const r = rig(0);
    await expect(r.run()).resolves.toBe(true);
    expect(r.commands.join('\n')).toContain('npm run build');
    expect(r.takeCopy).toHaveBeenCalledOnce();
    expect(r.record).toHaveBeenCalledWith(expect.objectContaining({ code: 'FAILED_BUILD_COPY_KEPT', severity: 'info' }));
  });
  it('a production build that does not pass takes no copy, and the report says the older copy will be shown', async () => {
    const r = rig(2);
    await expect(r.run()).resolves.toBe(false);
    expect(r.takeCopy).not.toHaveBeenCalled();
    expect(r.record).toHaveBeenCalledWith(expect.objectContaining({ code: 'FAILED_BUILD_COPY_NOT_KEPT', message: expect.stringContaining('labelled as older') }));
  });
  it('a successful turn does nothing here at all', async () => {
    const r = rig(0);
    await expect(r.run({ ...build3, ok: true })).resolves.toBe(false);
    expect(r.actuator.runCommand).not.toHaveBeenCalled();
  });
  it('a full-stack app (its server lived in the sandbox) is skipped, as in the gate', async () => {
    const r = rig(0, JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { express: '4' } }));
    await expect(r.run()).resolves.toBe(false);
    expect(r.actuator.runCommand).not.toHaveBeenCalled();
  });
});
