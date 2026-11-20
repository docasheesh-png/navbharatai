/**
 * failedbr #1994 (2026-11-08): `npm install` exited 1 (a peer conflict), the same `npm install` later ran clean, and the
 * release gate still listed "$ npm install → exit 1" as a build-breaking blocker on a build that had timed out.
 */
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('a failure the same command later undid is not a blocker, whatever the build\'s outcome', () => {
  it('npm install failed, then ran clean: no blocker left', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm install', exitCode: 1, stderr: 'npm error ERESOLVE could not resolve', durationMs: 4000 });
    expect(d.shippingIssueCount('error')).toBe(1);
    d.recordCommand({ command: 'npm install', exitCode: 0, stdout: 'added 12 packages', durationMs: 9000 });
    expect(d.shippingIssueCount('error')).toBe(0);
  });
  it('a different command running clean does not undo it', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stderr: 'error TS2304', durationMs: 4000 });
    d.recordCommand({ command: 'npm install', exitCode: 0, durationMs: 9000 });
    expect(d.shippingIssueCount('error')).toBe(1);
  });
  it('a pipe\'s clean exit proves nothing (the exit is the last program\'s)', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run build 2>&1 | tail -20', exitCode: 1, stderr: 'boom', durationMs: 4000 });
    d.recordCommand({ command: 'npm run build 2>&1 | tail -20', exitCode: 0, durationMs: 4000 });
    expect(d.shippingIssueCount('error')).toBe(1);
  });
});
