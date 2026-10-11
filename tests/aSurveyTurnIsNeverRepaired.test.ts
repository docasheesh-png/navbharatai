// A SURVEY TURN IS LOOKED AT, NEVER REPAIRED (autopsy d0b2fcd6, 2026-10-07, Q-736).
//
// "Import this app … give me a short survey … Do not change any files yet." The survey answered, and then
// the live-preview repair loop — the one automatic writer not gated on `expectsArtifacts` — ran a repair
// agent that installed packages, edited SETUP_README.md and firebase.ts, and rewrote the iOS workflow.
// This class has been fixed one pass at a time before (the reviewer, the tsc gate, the dependency
// reconcile), each fix claiming the others were already covered. The census below makes it structural:
// every automatic-fix site in the build route must sit behind the turn's `expectsArtifacts`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const lines = route.split('\n');

describe('the turn that must not change files', () => {
  it('🔒 expectsArtifacts is false on every import/survey turn', () => {
    expect(route).toMatch(/const expectsArtifacts = \(intent === 'new_build' \|\| intent === 'edit_existing'\) && !isImportTurn;/);
  });

  it('🔒 the live-preview repair budget is 0 when the turn expects no artifacts — the look stays, the repair goes', () => {
    expect(route).toMatch(/const healMax = !expectsArtifacts \? 0 : autoFixEnabled\(\)/);
  });

  it('🔒 census: every automatic-fix site in the build route is gated on expectsArtifacts', () => {
    const sites = lines.map((l, i) => (/\bautoFixEnabled\(\)/.test(l) && !/^\s*(\/\/|\*)/.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(sites.length).toBeGreaterThanOrEqual(5);
    // Code only — a comment that NAMES the gate is not the gate.
    const code = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /\bexpectsArtifacts\b/.test(l.replace(/\/\/.*$/, ''));
    const ungated = sites.filter((i) => !lines.slice(Math.max(0, i - 60), i + 1).some(code));
    expect(ungated.map((i) => `agentv3.ts:${i + 1}`)).toEqual([]);
  });
});
