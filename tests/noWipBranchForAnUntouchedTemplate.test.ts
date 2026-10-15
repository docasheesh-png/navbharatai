import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { keepsNothingOfItsOwn } from '../src/server/AgentV3/gitPushTarget';

// Autopsy b001fd78 (Q5): a user-stopped build that wrote only the platform template pushed it to a wip/ branch.
describe('no wip/ branch for a build that kept nothing of its own', () => {
  it('failed + template only → nothing to keep', () => {
    expect(keepsNothingOfItsOwn({ buildOk: false, seed: 'platform-template' })).toBe(true);
  });
  it('a build that worked always pushes', () => {
    expect(keepsNothingOfItsOwn({ buildOk: true, seed: 'platform-template' })).toBe(false);
  });
  it('a failed build with the user\'s own seed or real edits still goes to wip/', () => {
    expect(keepsNothingOfItsOwn({ buildOk: false, seed: 'kept-seed' })).toBe(false);
    expect(keepsNothingOfItsOwn({ buildOk: false, seed: null })).toBe(false);
  });
  it('source guard: the end-of-turn push is gated on it', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/writtenFiles\.size > 0 && !keepsNothingOfItsOwn\(/);
  });
});

import { recordGitConnectTiming } from '../src/server/AgentV3/gitPushTarget';
// Autopsy b001fd78 (Q2): the GitHub connect step ran 7s with no timing line.
describe('the GitHub connect step is timed', () => {
  it('records a SETUP_TIMING-shaped row and never throws', () => {
    const rows: Array<{ startMs: number; message: string; detail: string }> = [];
    recordGitConnectTiming({ recordSetupTiming: (t) => rows.push(t) }, 1000, true, true, 8000);
    expect(rows[0].message).toBe('GitHub storage ready in 7s');
    expect(rows[0].detail).toContain('user account');
    expect(() => recordGitConnectTiming({ recordSetupTiming: () => { throw new Error('x'); } }, 0, false, false)).not.toThrow();
  });
  it('source guard: the route calls it', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('recordGitConnectTiming(buildDiag, gitConnectT0');
  });
});
