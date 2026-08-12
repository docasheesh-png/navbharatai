import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  greenStopEnabled, reviewerShouldWrite, userRequestHealAllowedWhenGreen,
  toReviewSuggestions, reviewSuggestionSummary, reviewSuggestionCard,
} from './greenReviewPolicy';

/**
 * THE ADMIN'S OBSERVATION, VERIFIED (BENCHMARK 0, 2026-08-12): the game rendered at minute 6.6 and the
 * build ran to 14.3 — most of it spent editing a working app. In the 44-minute report before it, the
 * reviewer's silent auto-fix replaced the user's real .env secrets with placeholders and killed the
 * app's database and payments.
 *
 * The rule this file encodes: once the app WORKS, the engine's OWN OPINIONS become suggestions, while
 * the USER's OWN REQUESTS are still fulfilled. "user ne jo maanga wo karo; jo humein theek lagta hai wo
 * sirf batao." Every test below guards one half of that — either "stop imposing" or "keep delivering".
 */

describe('the reviewer writes only while the app is not yet working', () => {
  it('a VERIFIED-GREEN app is not silently rewritten by the reviewer', () => {
    // This is the whole fix. Green + the reviewer had opinions ⇒ suggest, do not write.
    expect(reviewerShouldWrite({ previewGreen: true })).toBe(false);
  });

  it('an app that has NOT rendered yet is still repaired — we are earning green', () => {
    expect(reviewerShouldWrite({ previewGreen: false })).toBe(true);
  });

  it('the kill switch restores the old always-write behaviour', () => {
    const off = { AGENTV3_GREEN_STOP: 'off' } as NodeJS.ProcessEnv;
    expect(reviewerShouldWrite({ previewGreen: true, env: off })).toBe(true);
    expect(reviewerShouldWrite({ previewGreen: false, env: off })).toBe(true);
  });

  it('defaults ON — this is the fix the admin asked for', () => {
    expect(greenStopEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(greenStopEnabled({ AGENTV3_GREEN_STOP: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('the USER\'S OWN requests still auto-fix on a green app — that is finishing the job', () => {
    // A missing requested feature and a real runtime error are not our opinion; they are the job.
    // This is the "Coming Soon text the user asked for" case — it must still get done.
    expect(userRequestHealAllowedWhenGreen()).toBe(true);
  });
});

describe('the findings become plain-language suggestions', () => {
  it('strips the reviewer\'s [CRITICAL]/[WARNING] tags — a user does not think in those', () => {
    const s = toReviewSuggestions([
      { text: '[CRITICAL] The sort ignores edits made after load' },
      { text: 'WARNING: buttons are missing an accessible label' },
    ]);
    expect(s[0].title).not.toMatch(/\[|critical|warning/i);
    expect(s.map((x) => x.title)).toContain('The sort ignores edits made after load');
  });

  it('lists FUNCTIONAL concerns first — those are what a user most wants to know', () => {
    const s = toReviewSuggestions([
      { text: 'a cosmetic spacing nit', functional: false },
      { text: 'the total is calculated wrong', functional: true },
    ]);
    expect(s[0].title).toContain('total is calculated wrong');
  });

  it('keeps the original detail for the follow-up build, not just the display title', () => {
    const s = toReviewSuggestions([{ text: '[CRITICAL] X is broken', critical: true }]);
    expect(s[0].detail).toContain('[CRITICAL]');
    expect(s[0].functional).toBe(true);
  });

  it('is capped so a working app is never buried under a wall of nits', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `nit ${i}` }));
    expect(toReviewSuggestions(many).length).toBeLessThanOrEqual(6);
  });

  it('survives junk', () => {
    expect(toReviewSuggestions([{ text: '' }, { text: '   ' }])).toEqual([]);
    expect(toReviewSuggestions(null as never)).toEqual([]);
  });
});

describe('the summary the user reads', () => {
  const suggestions = toReviewSuggestions([
    { text: 'The high-score does not persist on reload', functional: true },
    { text: 'innerHTML is used where textContent would be safer', functional: false },
  ]);

  it('says the app WORKS and was left untouched — it never claims a fix', () => {
    const msg = reviewSuggestionSummary(suggestions);
    expect(msg).toContain('built and working');
    expect(msg).toContain('left your working app exactly as it is');
    expect(msg.toLowerCase()).not.toContain('i fixed');
    expect(msg.toLowerCase()).not.toContain('auto-fixed');
  });

  it('invites a one-word follow-up in plain language', () => {
    expect(reviewSuggestionSummary(suggestions)).toContain('fix these');
  });

  it('carries no vendor or model name (white-label law)', () => {
    const msg = reviewSuggestionSummary(suggestions).toLowerCase();
    for (const vendor of ['glm', 'kimi', 'claude', 'sonnet', 'opus', 'gemini', 'grok', 'anthropic', 'moonshot']) {
      expect(msg, vendor).not.toContain(vendor);
    }
  });

  it('a clean build offers NOTHING — no nagging', () => {
    expect(reviewSuggestionSummary([])).toBe('');
    expect(reviewSuggestionCard([])).toBeNull();
  });

  it('the structured card mirrors the suggestions for a richer client', () => {
    const card = reviewSuggestionCard(suggestions);
    expect(card?.kind).toBe('review_suggestions');
    expect(card?.count).toBe(2);
    expect(card?.items[0].title).toContain('high-score');
  });
});

/**
 * THE WIRING — a policy nobody calls changes nothing, and this one has to change the reviewer.
 */
describe('it is actually wired into the build', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('the reviewer write pass is gated on the app not being green', () => {
    expect(routes).toContain('reviewerShouldWrite({ previewGreen })');
    expect(routes).toContain('const greenStopReview =');
  });

  it('when green-stopping, the findings are OFFERED and the write loop is skipped', () => {
    expect(routes).toContain('reviewSuggestionSummary(suggestions)');
    expect(routes).toContain('REVIEW_SUGGESTED_NOT_APPLIED');
    // The write loop is the else-branch — it cannot run when we green-stop.
    expect(routes).toContain('} else if (autoFixItems.length && reviewerAutoFixEnabled()');
  });

  it('a GREEN app is not marked not-ok by the reviewer\'s opinions', () => {
    // The false-success holder must not fire when we are green-stopping — a rendering app ships.
    expect(routes).toContain('!isImportTurn && !greenStopReview) reviewCriticalsUnresolved');
  });
});
