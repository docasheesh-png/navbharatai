// failedbr #1270 (2026-11-20): the whole message was "Nhi banao" (don't make it) and it confirmed a build at high
// confidence; "na banao" was even read as a YES to our offer, because "na" is a filler word.
import { describe, expect, it } from 'vitest';
import { buildConfirmation, declinesTheBuild, isOfferAcceptance } from '../src/server/AgentV3/buildConfirmation';

describe('a refusal is never a build or a yes (failedbr #1270)', () => {
  it.each(['Nhi banao', 'nahi banao', 'mat banao', 'rehne do, mat banao', 'na banao', 'abhi mat banao', 'मत बनाओ', "don't build it", 'no, do not make an app'])(
    'declines: %s', (m) => {
      expect(declinesTheBuild(m)).toBe(true);
      expect(buildConfirmation(m)).toEqual({ confirmed: false, reason: 'declines-the-build' });
      expect(isOfferAcceptance(m)).toBe(false);
    });

  it.each(['bana do na', 'haan bana do na', 'ek todo app banao', 'ads mat banao, game banao', 'game banao jisme kuch bhi mat chhodo', 'yes build it'])(
    'still builds: %s', (m) => {
      expect(declinesTheBuild(m)).toBe(false);
      expect(buildConfirmation(m).confirmed).toBe(true);
    });

  it('the polite tag after the verb is still an acceptance', () => {
    expect(isOfferAcceptance('bana do na')).toBe(true);
    expect(isOfferAcceptance('haan')).toBe(true);
  });
});

describe('a thumbs-up is a yes to the offer (failedbr #1171)', () => {
  it.each(['👍', '👍🏽', '✅', '👌'])('accepts: %s', (m) => expect(isOfferAcceptance(m)).toBe(true));
  it.each(['👎', '😂', '🙏', '👍 but make it red'])('not an acceptance: %s', (m) => expect(isOfferAcceptance(m)).toBe(false));
});
