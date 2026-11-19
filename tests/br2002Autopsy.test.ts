/**
 * BR2002 autopsy: "Build a website for my business" (free Weak) SUCCEEDED with gate YELLOW, the user was shown
 * "Here's what I built", and the deep bug-hunt offer ran while the build's signal was still clear. Eight
 * seconds later the change record said "CHG-0001 new-app/standard · 14 file(s) · status stopped · gate YELLOW".
 *
 * Class: the change record took "the signal is aborted" as "the change was stopped". Several platform
 * mechanisms abort that one controller after a result exists (advisory cap, the zombie reaper, a lock reclaim,
 * a deploy drain). Only the user's own stop, or an abort that ended the build BEFORE a successful result,
 * is a stopped change. Fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changeWasStopped, ALL_ABORT_CAUSES } from '../src/server/AgentV3/buildAbortCause';

const ROOT = join(__dirname, '..');

describe('changeWasStopped', () => {
  it('🔴 the report shape: a successful build aborted afterwards by the platform is not a stopped change', () => {
    for (const cause of ['advisory-cap', 'reaper', 'lock-reclaimed', 'deploy-drain', 'unknown'] as const) {
      expect(changeWasStopped({ aborted: true, cause, userStopRecorded: false, resultOk: true }), cause).toBe(false);
    }
  });
  it('the user\'s own stop is always a stop, before or after the result', () => {
    expect(changeWasStopped({ aborted: true, cause: 'user-stop', userStopRecorded: false, resultOk: true })).toBe(true);
    expect(changeWasStopped({ aborted: false, cause: 'unknown', userStopRecorded: true, resultOk: true })).toBe(true);
    expect(changeWasStopped({ aborted: true, cause: 'user-stop', userStopRecorded: true, resultOk: false })).toBe(true);
  });
  it('an abort that ended the build before a successful result is a stop (BR2001: the watchdog)', () => {
    for (const cause of ALL_ABORT_CAUSES) {
      expect(changeWasStopped({ aborted: true, cause, userStopRecorded: false, resultOk: false }), cause).toBe(true);
    }
  });
  it('no abort and no user stop is never a stop', () => {
    expect(changeWasStopped({ aborted: false, cause: 'unknown', userStopRecorded: false, resultOk: false })).toBe(false);
    expect(changeWasStopped({ aborted: false, cause: 'unknown', userStopRecorded: false, resultOk: true })).toBe(false);
  });
});

describe('🔒 the settle site asks it', () => {
  it('the change record\'s stopped is changeWasStopped, not a bare abort.signal.aborted', () => {
    const src = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    const at = src.indexOf('settleChange(changeSession, {');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at - 600, at + 1500);
    expect(block).toMatch(/stopped: changeStopped,/);
    expect(block).toMatch(/const changeStopped = changeWasStopped\(\{ aborted: abort\.signal\.aborted, cause: abortCauseOf\(abort\.signal\), userStopRecorded: buildWasStopped\(settleIssues\), resultOk: result\.ok === true \}\)/);
    expect(block).not.toMatch(/stopped: abort\.signal\.aborted \|\|/);
  });
});
