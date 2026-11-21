/**
 * failedbr #689 (queue Q-3213): "Fix this error and continue building the app" changed nothing and was told
 * "The build produced no files. Please try again" — a sentence about a NEW app, which reads as if the user's
 * existing app were gone. For an edit, the truth is that their app was left exactly as it was.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyBuildFailureSummary } from '../src/server/AgentV3/buildOutcomeSummaries';
import { classifyFailureReason } from '../src/lib/failureReason';

describe('an edit that changed nothing', () => {
  it('says the app is as it was, not that a build produced no files', () => {
    const s = emptyBuildFailureSummary(true, 0, false, false, false, false, true);
    expect(s).toMatch(/No change was made to your app this time — it is exactly as it was/);
    expect(s).not.toMatch(/produced no files/);
    expect(classifyFailureReason(s)).toMatchObject({ key: 'empty-build' });
  });
  it('🔒 a new build keeps its sentence; an answer, a refusal and a rendering app are still not failures', () => {
    expect(emptyBuildFailureSummary(true, 0, false, false)).toBe('The build produced no files. Please try again — you have not been charged.');
    expect(emptyBuildFailureSummary(true, 0, false, false, true, false, true)).toBeNull();
    expect(emptyBuildFailureSummary(true, 0, false, false, false, true, true)).toBeNull();
    expect(emptyBuildFailureSummary(true, 0, false, true, false, false, true)).toBeNull();
  });
  it('wired: the route passes whether the turn edits an existing app', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('isEditMode, // an edit that changed nothing left the app as it was (Q-3213)');
  });
});
