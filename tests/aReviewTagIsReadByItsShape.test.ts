/**
 * BUILD 46e2d74b (admin 2026-10-11) — "Create an racing game for Nokia c 2-01". The admin's report: the
 * player's car shows its headlights and LEFT turns it RIGHT ("racing game me car ulti chal rahi hai").
 *
 * The platform's own reviewer had found a real defect in that game and written it down:
 *
 *     - **[BROKEN / CORRECTNESS] `updateGameState` never accelerates the car.**
 *
 * `parseReviewOutput` read ZERO issues from it, because a severity came only from three exact tokens, the
 * `[BROKEN]` marker only from one, and the untagged-finding reader (d798ddd3) only from four nouns. So the
 * verified green repair had nothing to select, nothing was offered to the user, and the report said
 * REVIEW_FINDINGS_UNREAD. This is the class — closed exact-token lists over free model prose — fixed by
 * reading the tag by its SHAPE (`readLeadingTags`).
 */
import { describe, it, expect } from 'vitest';
import {
  parseReviewOutput, readLeadingTags, selectGreenRepairable, reviewHasUnreadFindings,
} from '../src/server/AgentV3/ReviewerAgent';
import { salvageReview } from '../src/server/AgentV3/partialReview';

/** The finding exactly as build 46e2d74b's reviewer wrote it. */
const LITERAL_46E2D74B = '- **[BROKEN / CORRECTNESS] `updateGameState` never accelerates the car.**';
const REVIEW_46E2D74B = `**Review findings**\n\n${LITERAL_46E2D74B}`;

describe('the finding that shipped unread in 46e2d74b is read', () => {
  it('the literal line parses to one broken warning, and the green repair selects it', () => {
    const issues = parseReviewOutput(REVIEW_46E2D74B);
    expect(issues).toEqual([{ severity: 'warning', message: '`updateGameState` never accelerates the car.', broken: true }]);
    expect(selectGreenRepairable(issues)).toHaveLength(1);
    // And the honesty net no longer has to say "read nothing".
    expect(reviewHasUnreadFindings({ issues, summary: REVIEW_46E2D74B })).toBe(false);
  });

  it('the review salvaged after a timeout reads it too (same parser, same lane)', () => {
    expect(salvageReview(REVIEW_46E2D74B)?.issues.map((i) => i.message)).toEqual(['`updateGameState` never accelerates the car.']);
  });
});

describe('THE CLASS — every tag SHAPE a reviewer writes is read, with one vocabulary', () => {
  // The ten shapes the report map swept against the old parser: nine were LOST.
  const census: Array<[string, 'critical' | 'warning' | 'suggestion', boolean]> = [
    ['- **[BROKEN / CORRECTNESS] `updateGameState` never accelerates the car.**', 'warning', true],
    ['- **[CRITICAL / SECURITY] the api key is in the client bundle.**', 'critical', false],
    ['- **[WARNING / UX] the steering is inverted left-right.**', 'warning', false],
    ['- **[BROKEN] the steering is inverted left-right.**', 'warning', true],
    ['- [BROKEN][WARNING] the steering is inverted left-right.', 'warning', true],
    ['- **CRITICAL:** the steering is inverted left-right.', 'critical', false],
    ['- **Critical —** the steering is inverted left-right.', 'critical', false],
    ['1. **[Correctness] the steering is inverted left-right.**', 'warning', false],
    ['- **[HIGH] the steering is inverted left-right.**', 'warning', false],
    ['- (WARNING) the steering is inverted left-right.', 'warning', false],
    // Shapes nobody listed: a category the model invents, a negated verdict, a polish category.
    ['- **[GAMEPLAY] the car never leaves the start line.**', 'warning', false],
    ['- **[NOT WORKING] the Start Race button does nothing.**', 'warning', true],
    ['- **[STYLE / NAMING] consider renaming the helper.**', 'suggestion', false],
  ];
  for (const [line, severity, broken] of census) {
    it(`reads ${JSON.stringify(line.slice(0, 48))} as ${severity}${broken ? ' + broken' : ''}`, () => {
      const issues = parseReviewOutput(line);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe(severity);
      expect(issues[0].broken === true).toBe(broken);
      // The tag never reaches a user's screen.
      expect(issues[0].message).not.toMatch(/\[|\]|^\(|CRITICAL|WARNING|BROKEN|CORRECTNESS/);
    });
  }

  it('a composite tag beside an exact one is stripped whole, and its BROKEN word is kept', () => {
    expect(parseReviewOutput('[WARNING] [BROKEN / CORRECTNESS] the sort ignores edits')).toEqual([
      { severity: 'warning', message: 'the sort ignores edits', broken: true },
    ]);
  });

  it('only OUR severity words can fail a build; a model\'s own scale is a warning', () => {
    for (const tag of ['[HIGH]', '[MAJOR]', '[ERROR]', '[SEVERE / HIGH]'.replace('SEVERE / ', '')]) {
      expect(parseReviewOutput(`- **${tag} the checkout never saves the order.**`)[0]?.severity).toBe('warning');
    }
    expect(parseReviewOutput('- **[BLOCKER] the checkout never saves the order.**')[0]?.severity).toBe('critical');
    // The confidence gate still downgrades a shape-read critical the reviewer was unsure of.
    expect(parseReviewOutput('- **[CRITICAL / DATA]** (confidence: low) the checkout may not save.')[0]?.severity).toBe('warning');
  });
});

describe('precision — what is NOT a finding stays not a finding', () => {
  const notFindings = [
    '[PASS] App looks complete. Score: 90',
    '- [x] Login works fine here',
    '- [ ] Add tests later',
    '- [Home](/) is the landing page',
    '[docs]: https://example.com/docs',
    '**Critical:** None',
    '**Warning:** none found.',
    'High: 2, Medium: 1, Low: 0',
    '**Summary:** the app works as asked',
    '- **[Score] 80/100**',
    '- **[OK]** everything renders',
    '- **[FIXED]** the save bug from earlier',
    '### [CRITICAL] Issues',
    '(see below) the details',
    'Risk: the data is lost',
    '[1] footnote text here',
    '- **[src/App.tsx]** the entry',
    // A NEGATED clean bill (verification of this fix): these once parsed to BROKEN warnings that a working
    // app's verified repair would act on.
    '[NO ISSUES] The app works as requested.',
    '- **[No bugs found]** All features work as requested.',
    '[NO ERRORS] Build compiles cleanly and renders.',
    '- **[Not Applicable]** The app has no backend.',
    '- **[No Regression]** The earlier save fix still holds.',
  ];
  for (const line of notFindings) {
    it(`${JSON.stringify(line)} reads as nothing`, () => {
      expect(parseReviewOutput(line)).toEqual([]);
    });
  }

  it('a negation reads the word after it: a negated "works" is a break, a negated "issues" is nothing, anything else is not a break', () => {
    expect(parseReviewOutput('- **[NOT IMPLEMENTED]** the leaderboard never saves a score.')).toEqual([
      { severity: 'warning', message: 'the leaderboard never saves a score.', broken: true },
    ]);
    expect(parseReviewOutput('[NON FUNCTIONAL] the pause button does nothing.')[0]?.broken).toBe(true);
    expect(readLeadingTags('[NO ISSUES] The app works.')).toBeNull();
    expect(readLeadingTags('[NOT TESTED] the share sheet on iOS')?.broken).toBe(false);
    expect(selectGreenRepairable(parseReviewOutput('[NO ISSUES] The app works as requested.\n[No Problems] Everything renders correctly.'))).toEqual([]);
  });

  it('the reader itself: no tag at the start is null, a verdict is null', () => {
    expect(readLeadingTags('The car never accelerates [BROKEN]')).toBeNull();
    expect(readLeadingTags('[PASS] all good')).toBeNull();
    expect(readLeadingTags('- **[BROKEN / CORRECTNESS] `x` never runs.**')).toEqual({ severity: 'warning', broken: true, rest: '`x` never runs.**' });
  });

  it('every earlier shape still parses exactly as before (untagged "Bug:", exact tags, mid-line tags)', () => {
    expect(parseReviewOutput('**1. Bug: entering `.` after an operator produces `NaN`**')).toEqual([
      { severity: 'warning', message: 'entering `.` after an operator produces `NaN`', broken: true },
    ]);
    expect(parseReviewOutput('[WARNING] [BROKEN] the sort ignores edits\n[SUGGESTION] consider adding a footer')).toEqual([
      { severity: 'warning', message: 'the sort ignores edits', broken: true },
      { severity: 'suggestion', message: 'consider adding a footer' },
    ]);
    expect(parseReviewOutput('1. The login form [CRITICAL] crashes on submit')[0]?.severity).toBe('critical');
    expect(parseReviewOutput('No [CRITICAL] or [WARNING] issues were found.')).toEqual([]);
  });
});

describe('A CATEGORY IS NOT A VERDICT — a topic tag is judged by its sentence (verification of 46e2d74b, 2026-10-11)', () => {
  it('praise under a topic tag is no finding at all', () => {
    for (const line of [
      '- **[SECURITY]** Inputs are validated properly before use.',
      '- [PERFORMANCE] The render loop is well structured and uses one renderer.',
      '- **[GAMEPLAY]** Collision handling works as expected.',
      '- [CORRECTNESS] The score is saved correctly to localStorage.',
    ]) expect(parseReviewOutput(line), line).toEqual([]);
  });
  it('a topic tag over a defect is a warning; over a neutral note it is a suggestion — never a repair', () => {
    expect(parseReviewOutput('- **[GAMEPLAY]** the car never leaves the start line.')[0].severity).toBe('warning');
    expect(parseReviewOutput('- [CONTROLS] left and right steering are mirrored.')[0].severity).toBe('warning');
    const neutral = parseReviewOutput('- [PERFORMANCE] The scene re-creates its geometry every frame.');
    expect(neutral).toHaveLength(1);
    expect(neutral[0].severity).toBe('suggestion');
    expect(neutral[0].broken === true).toBe(false);
  });
});
