// 🔴 AN EDIT IS NOT SENT BACK TO WORK BY THE PROJECT'S OVERALL SCORE (failedbr #2342, 95884987, 2026-11-13).
//
// "Game open nhi ho raha hai apk me sahi karo". The model found the real cause (a missing script → `atob` crash) and
// fixed it at 19 min. The readiness gate's only blocker was the PROJECT's score — 0/100 from 18 medium innerHTML
// findings already in the user's 646 KB game — so the build was resumed into an unrequested security refactor, hit the
// 25-minute cap, and the whole turn (real fix included) went to a wip branch instead of main.
// Reversion: drop the `editingExistingApp` filter in decideUnfinishedResume and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideUnfinishedResume, isProjectScoreBlocker, unfinishedResumeStandDownNote } from '../src/server/AgentV3/unfinishedResume';

/** The report's own blocker, verbatim up to the first finding. */
const SCORE = 'readiness score 0/100 is below the 50/100 bar (too many unresolved quality issues — 18 medium-severity security issue(s): unsafe-html-sink @ js/08-game-main.js:4507 — Writing raw HTML (innerHTML/outerHTML/insertAdjacentHTML) enables XSS';
const DONE_TEXT = 'Ho gaya. APK me game na khulne ki asli wajah pakdi gayi aur fix kar di gayi';

describe('the project score does not resume an edit', () => {
  it('#2342: an edit whose only blocker is the project score stands down', () => {
    const d = decideUnfinishedResume({ text: DONE_TEXT, blockers: [SCORE], resumesUsed: 0, producedFiles: true, editingExistingApp: true });
    expect(d.resume).toBe(false);
    expect(d.standDown).toBe('edit-project-score');
    expect(unfinishedResumeStandDownNote(d.standDown, 1)).toMatch(/edits an existing app/);
  });
  it('a real blocker on an edit still resumes — and is the only one listed', () => {
    const d = decideUnfinishedResume({ text: DONE_TEXT, blockers: [SCORE, 'npm run build fails: src/App.tsx(12,3) TS2304'], resumesUsed: 0, producedFiles: true, editingExistingApp: true });
    expect(d.resume).toBe(true);
    expect(d.message).toMatch(/TS2304/);
    expect(d.message).not.toMatch(/readiness score 0\/100/);
  });
  it('a NEW build is still held to the score, exactly as before', () => {
    const d = decideUnfinishedResume({ text: 'Done!', blockers: [SCORE], resumesUsed: 0, producedFiles: true });
    expect(d.resume).toBe(true);
  });
  it('only the aggregate score line is a project-score blocker', () => {
    expect(isProjectScoreBlocker(SCORE)).toBe(true);
    expect(isProjectScoreBlocker('unsafe-html-sink @ js/x.js:1 — Writing raw HTML')).toBe(false);
    expect(isProjectScoreBlocker('This is still the starter template')).toBe(false);
  });
  it('the runner passes the edit fact', () => {
    const runner = readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toMatch(/decideUnfinishedResume\(\{[^}]*editingExistingApp: this\.opts\.editingExistingApp === true \}\)/);
  });
});
