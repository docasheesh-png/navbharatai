import { describe, it, expect } from 'vitest';
import { parseReviewOutput } from '../src/server/AgentV3/ReviewerAgent';
import { shortTitle, toReviewSuggestions, reviewSuggestionSummary } from '../src/server/AgentV3/greenReviewPolicy';

/**
 * A clean review must not read as a complaint.
 *
 * 🔴 WHAT A REAL USER SAW (autopsy 31dc61fd, 2026-09-20), verbatim:
 *
 *     I also noticed one thing I could improve if you want
 *     (I left your working app exactly as it is, rather than changing it without asking):
 *       1. No  or  issues were found. The app structure, imports, accessibility, security, and
 *          privacy checks all pass. The historical `write-typecheck` errors in the two
 *     Want me to? Just reply "fix these" …
 *
 * Three defects compounding in one sentence:
 *   1. the reviewer's CLEAN BILL OF HEALTH was classified as a finding, because
 *      `lower.includes('[critical]')` treats a MENTION of the tag as the tag;
 *   2. the tag-stripper then removed both brackets wherever they appeared, leaving two holes;
 *   3. `title.slice(0, 160)` cut the sentence dead mid-phrase with no ellipsis — exactly 160 chars.
 *
 * Under a heading that invites "reply fix these", that reads as the engine breaking.
 */

describe('a clean bill of health is not a finding', () => {
  it('🔴 the exact sentence from the report produces NO findings', () => {
    const issues = parseReviewOutput(
      'No [CRITICAL] or [WARNING] issues were found. The app structure, imports, accessibility, ' +
      'security, and privacy checks all pass.',
    );
    expect(issues).toEqual([]);
  });

  it.each([
    'No [CRITICAL] issues were found.',
    '[WARNING] No problems detected in the changed files.',
    '[SUGGESTION] None of the accessibility concerns were identified.',
    '[CRITICAL] Zero security violations found.',
  ])('a verdict of "nothing found" is dropped: %s', (line) => {
    expect(parseReviewOutput(line)).toEqual([]);
  });

  /**
   * ⚠️ THE PRECISION LOCK, and it is the half that matters most: swallowing a REAL finding would hide
   * a defect from the user for ever, which is strictly worse than the noise this rule removes.
   */
  it.each([
    ['[CRITICAL] No error handling on the save button — the app crashes on a failed write.', 'critical'],
    ['[WARNING] No label on the search input (WCAG 1.3.1).', 'warning'],
    ['[CRITICAL] There is no loading state, so the list flashes empty on every fetch.', 'critical'],
    ['[SUGGESTION] No tests cover the store — add a few.', 'suggestion'],
  ])('a REAL finding phrased with "no" survives: %s', (line, severity) => {
    const issues = parseReviewOutput(line as string);
    expect(issues.length, `dropped a real finding: ${line}`).toBe(1);
    expect(issues[0].severity).toBe(severity);
  });
});

describe('a tag removed mid-sentence leaves no hole', () => {
  it('🔴 "No  or  issues" — the double space is closed', () => {
    // Reached via a finding that is NOT a clean bill of health, so the rule above does not apply.
    const issues = parseReviewOutput('[CRITICAL] The [WARNING] banner never clears after a retry.');
    expect(issues.length).toBe(1);
    expect(issues[0].message).not.toMatch(/ {2,}/);
    expect(issues[0].message).toBe('The banner never clears after a retry.');
  });
});

describe('a shortened title says that it was shortened', () => {
  const long =
    'The sort control ignores edits made after the initial load, so a renamed row keeps its old ' +
    'position until the page is reloaded, which makes the list look like it silently dropped the change entirely.';

  it('🔴 never cuts a word in half, and always marks the cut', () => {
    const out = shortTitle(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    // The character before the ellipsis must end a word — the shipped bug ended on a space mid-phrase.
    expect(out.slice(0, -1)).not.toMatch(/\s$/);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('a title that fits is returned untouched, with no ellipsis', () => {
    expect(shortTitle('Add a label to the search input.')).toBe('Add a label to the search input.');
  });

  it('one enormous unbroken word is still cut, and still marked', () => {
    const url = `https://example.com/${'a'.repeat(300)}`;
    const out = shortTitle(url);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });

  it('trailing punctuation is not left dangling before the ellipsis', () => {
    expect(shortTitle(`${'word '.repeat(40)}, tail`)).not.toMatch(/[ ,;:-]…$/);
  });
});

describe('end to end — the offer the user reads', () => {
  it('🔴 a review that found nothing produces NO offer at all', () => {
    const issues = parseReviewOutput(
      'No [CRITICAL] or [WARNING] issues were found. The app structure, imports, accessibility, ' +
      'security, and privacy checks all pass.',
    );
    const suggestions = toReviewSuggestions(issues.map((i) => ({ text: i.message })));
    expect(suggestions).toEqual([]);
    // No suggestions ⇒ empty summary ⇒ the user is not invited to fix a thing that is fine.
    expect(reviewSuggestionSummary(suggestions)).toBe('');
  });

  it('a genuine finding still reaches the user, whole or honestly shortened', () => {
    const issues = parseReviewOutput('[WARNING] No label on the search input (WCAG 1.3.1).');
    const summary = reviewSuggestionSummary(toReviewSuggestions(issues.map((i) => ({ text: i.message }))));
    expect(summary).toContain('No label on the search input');
    expect(summary).toContain('Want me to?');
  });

  it('the summary never ships a bare mid-sentence stop', () => {
    const issues = parseReviewOutput(`[WARNING] ${'The sort control ignores edits made after load '.repeat(6)}`);
    const summary = reviewSuggestionSummary(toReviewSuggestions(issues.map((i) => ({ text: i.message }))));
    const bullet = summary.split('\n').find((l) => l.trim().startsWith('1.'))!;
    expect(bullet.trimEnd().endsWith('…')).toBe(true);
  });
});
