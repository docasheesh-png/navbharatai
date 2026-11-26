/**
 * Autopsy BR #2535, item 2: the game itself said "The rifle to hold is not one of this game's saved models, so nothing is in
 * the hand" — as a console WARNING and an on-screen hint. The playtest read only console ERRORS, so the build scored 94/100 and
 * was called done while the user's ask was not on screen.
 *
 * Class: the game reports that what the code asked for could not be shown, and nobody reads it. Now the playtest records those
 * sentences as GAME_DEFECT_NOT_SHOWN, and the completion gate refuses to call the build finished (release gate RED).
 * It is NOT a hard (unplayable) defect: the game still plays, and that set drives the "Go back" offer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KIT_NOT_SHOWN, playtestDefects, gamePlaytestScript } from '../src/server/AgentV3/gamePlaytest';
import { HARD_DEFECTS, gameRepairPrompt, gameIncompleteReason } from '../src/server/AgentV3/gameRepair';

/** The exact sentences the kit writes (GamePlayerBodyGenerator / GameRaceCustomGenerator). */
const SAID = {
  holdMissing: "[player] The rifle to hold is not one of this game's saved models, so nothing is in the hand.",
  holdFailed: '[player] The rifle to hold could not be loaded, so nothing is in the hand.',
  characterMissing: '[player] the character "sports coach" could not be used (it is not one of this game\'s saved models); the default person is shown.',
  raceCar: '[race car] Your car "monster truck" could not be used: not found. The standard car is shown instead.',
};

describe('the kit sentence for "not on screen" is recognised', () => {
  it('matches every sentence the kit writes for an ask it could not show', () => {
    for (const s of Object.values(SAID)) expect(KIT_NOT_SHOWN.test(s), s).toBe(true);
  });
  it('does not match an honest limitation that is not an unmet ask, or an unrelated log', () => {
    expect(KIT_NOT_SHOWN.test('[player] Your character has no animations of its own, so it moves without walking or posing.')).toBe(false);
    expect(KIT_NOT_SHOWN.test('[audio] could not load jump from /sounds/jump.ogg')).toBe(false);
  });
  it('the kit still writes those sentences (if the wording changes, this pattern must follow)', () => {
    const player = readFileSync('src/server/lib/GamePlayerBodyGenerator.ts', 'utf8');
    expect(player).toContain("to hold is not one of this game\\'s saved models, so nothing is in the hand.");
    expect(player).toContain("console.error('[player] the character \"' + name + '\" could not be used (");
    expect(readFileSync('src/server/lib/GameRaceCustomGenerator.ts', 'utf8')).toContain("console.error('[race car] ' + error);");
  });
});

describe('it blocks completion, and the repair hint names the fix', () => {
  it('BR #2535 run → GAME_DEFECT_NOT_SHOWN with the game\'s own words', () => {
    const defects = playtestDefects({ ok: true, notShown: [SAID.holdMissing] } as never, null);
    expect(defects).toContainEqual({ code: 'GAME_DEFECT_NOT_SHOWN', evidence: SAID.holdMissing });
    expect(HARD_DEFECTS.has('GAME_DEFECT_NOT_SHOWN')).toBe(false); // the game still plays — not "unplayable"
    expect(gameIncompleteReason(defects, [], { played: true })).toMatch(/something the game was asked to show is not on screen — the game said: \[player\] The rifle/);
    const prompt = gameRepairPrompt('hero kr hath me ek badi gun banao', defects, []);
    expect(prompt).toMatch(/GAME_DEFECT_NOT_SHOWN: .*add_library_models/);
    expect(prompt).toMatch(/never claim it is shown/);
  });
  it('a run with nothing unshown adds no such defect', () => {
    expect(playtestDefects({ ok: true } as never, null).map((d) => d.code)).not.toContain('GAME_DEFECT_NOT_SHOWN');
  });
});

describe('the playtest script reads warnings for it', () => {
  it('records a matching console warning (not as an error) and reports it', () => {
    const script = gamePlaytestScript('http://localhost:5173');
    expect(script).toMatch(/\(m\.type\(\) === 'warning' \|\| m\.type\(\) === 'error'\) && notShownRe\.test\(m\.text\(\)\)/);
    expect(script).toMatch(/if \(notShown\.length\) out\.notShown = notShown;/);
  });
});
