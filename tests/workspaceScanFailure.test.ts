import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ⚠️ A SCAN THAT FAILED IS NOT AN EMPTY SANDBOX — and one line used to say it was.
 *
 * The File Guardian compares the durable copy of a project against what is really in the sandbox. It
 * read the sandbox through:
 *
 *     collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {}, skipped: [] }))
 *
 * so an UNREACHABLE sandbox became "we looked and found nothing". The guardian then reads that as
 * total data loss: it records `sandbox recycled/empty` in the admin report and plans a FULL restore of
 * every stored file. Both wrong — and the restore is doomed anyway, because a sandbox we cannot list
 * is one we cannot write to either. Those writes throw, the outer handler swallows them, and the build
 * carries on against a broken machine with a false data-loss finding in its report.
 *
 * THE INFORMATION EXISTED. `E2BActuator.listFiles` deliberately distrusts an empty fast-path result —
 * its own comment says "a genuinely empty workspace and a silently-failed find look identical here" —
 * and falls through to a slow path that THROWS. The actuator got it right; this caller discarded it.
 *
 * Seventh instance of the pattern recorded in PROGRESS.md for 2026-08-24: a fallback value standing in
 * for a measurement that never happened.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const actuator = readFileSync(
  join(__dirname, '..', 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

describe('the File Guardian tells a failed look apart from an empty sandbox', () => {
  it('records the failure instead of silently substituting an empty result', () => {
    expect(route).toContain('scanFailed = true;');
    expect(route).toContain("code: 'WORKSPACE_SCAN_FAILED'");
  });

  it('says plainly that nothing was compared — not that files are missing', () => {
    // The wording is the fix. "We could not check" and "your files are gone" are different facts, and
    // only one of them should ever reach an admin report about a healthy project.
    expect(route).toContain('This is NOT a report that files are missing');
  });

  it('does not claim data loss or rewrite the project when the scan failed', () => {
    // With a failed scan EVERY stored file looks missing, so this branch would restore all of them
    // into a machine it could not even list.
    expect(route).toContain('if (plan.count > 0 && !scanFailed) {');
  });

  it('does not claim the opposite either — "nothing needed restoring" is also a comparison', () => {
    // The quiet branch asserts a clean result. Reaching it on a failed scan would be the same lie
    // wearing a reassuring face.
    expect(route).toContain('} else if (!scanFailed) {');
  });

  it('the premise still holds: listFiles really does refuse to trust an empty result', () => {
    // If this stops being true, a failed listing would return [] instead of throwing and `scanFailed`
    // would never be set — the guard would go quiet without failing. Whoever changes it should see this.
    const at = actuator.indexOf('async listFiles(');
    expect(at).toBeGreaterThan(-1);
    const body = actuator.slice(at, actuator.indexOf('\n  }', at));
    expect(body).toContain('An EMPTY result is not trusted');
    expect(body).toContain('if (paths.length > 0) return paths');
  });
});
