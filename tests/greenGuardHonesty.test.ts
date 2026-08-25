import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  greenGuardUndidWork, greenGuardSummaryCorrection, withGreenGuardCorrection, GREEN_GUARD_MARK,
} from '../src/server/AgentV3/greenGuardHonesty';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

/**
 * ⚠️ THE BUILD TOLD THE USER IT HAD SUCCEEDED WHILE ITS OWN GUARD THREW THE WORK AWAY.
 *
 * Admin build report 2026-08-25 — their words: "baar baar kehne par game me gaadi ki speed kyu nahi
 * badhayi ja rahi? pehle game theek chala, baad me speed phir se 0 ho gayi kyu?"
 *
 * The report's last four seconds answer both questions at once:
 *
 *     GREEN_GUARD_RESTORE   the app was verified working before this turn and is not working after it
 *                           — the last known good state was restored
 *     GREEN_GUARD_RESTORED  4 file(s) put back, 5 added by the failed attempt removed
 *     endedAt               ok: true, summary: "✅ Preview अब काम कर रहा है! … बाइक आगे बढ़ रही है"
 *
 * The guard is RIGHT to restore — shipping an app that no longer runs is worse than shipping one that
 * does. What was wrong is that it told nobody who mattered: a narration into a stream the user had
 * stopped watching, a finding into an admin-only report, and a SUMMARY that still described the change
 * as delivered.
 *
 * From the user's chair: ask for more speed, be told it is done, nothing changes. Ask again. Same.
 * No amount of re-asking could ever have worked — the change was made and deliberately undone each time.
 */
describe('when the guard undoes the work, the summary says so', () => {
  const facts = { restored: 4, removed: 5 };

  it('fires only when something was actually undone', () => {
    expect(greenGuardUndidWork(facts)).toBe(true);
    expect(greenGuardUndidWork({ restored: 0, removed: 3 })).toBe(true);
    expect(greenGuardUndidWork({ restored: 0, removed: 0 })).toBe(false);
    expect(greenGuardUndidWork(null)).toBe(false);
    expect(greenGuardUndidWork(undefined)).toBe(false);
  });

  it('answers the three things a person needs, in order', () => {
    const c = greenGuardSummaryCorrection(facts);
    expect(c).toContain('Your change was not kept');       // what happened to my request
    expect(c).toContain('nothing is broken, and nothing changed'); // is my app safe
    expect(c).toContain('smaller steps');                   // what do I do now
  });

  it('names the real numbers, and omits the removal clause when there was none', () => {
    expect(greenGuardSummaryCorrection(facts)).toContain('4 file(s) restored');
    expect(greenGuardSummaryCorrection(facts)).toContain('5 new one(s) removed');
    expect(greenGuardSummaryCorrection({ restored: 2, removed: 0 })).not.toContain('removed');
  });

  it('🔑 LEADS the summary rather than trailing it', () => {
    // A note under a green tick is read as a footnote to success. The user acts on the first line.
    const out = withGreenGuardCorrection('✅ Preview अब काम कर रहा है!', facts);
    expect(out.indexOf(GREEN_GUARD_MARK)).toBe(0);
    expect(out).toContain('✅ Preview अब काम कर रहा है!'); // the build's own words are kept, not deleted
  });

  it('is idempotent — two copies read like a malfunction', () => {
    // This path can be reached twice: the normal settle and the watchdog finalizer.
    const once = withGreenGuardCorrection('done', facts);
    expect(withGreenGuardCorrection(once, facts)).toBe(once);
  });

  it('never throws on a missing summary', () => {
    expect(() => withGreenGuardCorrection(undefined as unknown as string, facts)).not.toThrow();
  });
});

describe('and it is wired where the summary still reaches the user', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the guard records what it undid', () => {
    expect(route).toContain('greenGuardRestoreFacts = { restored: Object.keys(plan.write).length, removed: plan.remove.length };');
  });

  it('and the correction is applied at the late mutation point, before the charge line', () => {
    // That ordering is what makes the correction the first thing read, above even the price.
    const at = route.indexOf('greenGuardUndidWork(greenGuardRestoreFacts)');
    const charge = route.indexOf('const livePreviewLine = costBreakdown');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(charge);
  });
});

/**
 * "NEXT TIME JAB BHI KOI RACING GAME BANAYA JAYE, SPEED 0 SIRF AUR SIRF TAB HO, JAB USER BOLE."
 *
 * The prevention half. A vehicle that will not move is not a difficulty setting — it is an unplayable
 * game, and it is the single easiest way to ship one.
 */
describe('a vehicle starts moving unless the user asked otherwise', () => {
  const p = architectSystemPrompt('vite-react');

  it('the rule is stated, with the only exception named', () => {
    expect(p).toContain('A VEHICLE STARTS MOVING, ALWAYS');
    expect(p).toContain('Speed may be zero ONLY if the user explicitly asked for it');
  });

  it('closes the two excuses that produce a stuck car', () => {
    expect(p).toContain('never as "the player will press a key first"');
    expect(p).toContain('never as a placeholder you mean to fill in later');
  });

  it('says what to do, not only what to avoid', () => {
    expect(p).toContain('initialise speed to a real value');
    expect(p).toContain('apply acceleration in update() every frame');
  });
});
