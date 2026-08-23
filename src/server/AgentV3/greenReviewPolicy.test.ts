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

  it('an app PROVEN not to render is still repaired — we are earning green', () => {
    // The original rule here was simply `!previewGreen ⇒ write`, and that is the assertion this
    // replaces. It conflated "we looked and it was broken" with "we could not look", and the second
    // case is a very likely-fine app being rewritten on no evidence (admin 2026-08-23). The intent it
    // was protecting — a genuinely broken build still gets the reviewer's repair — is kept exactly,
    // and now needs the evidence it always implied.
    expect(reviewerShouldWrite({ previewGreen: false, previewProvenBroken: true, buildOk: true })).toBe(true);
    expect(reviewerShouldWrite({ previewGreen: false, buildOk: false })).toBe(true);
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
    // Asserts the EVIDENCE reaches the rule, not just that the rule is called. A call site that
    // dropped `previewProvenBroken` would compile, pass a shape check, and silently restore the old
    // "not green ⇒ rewrite it" behaviour on every build whose preview could not be verified.
    expect(routes).toContain('reviewerShouldWrite({ previewGreen, previewProvenBroken, buildOk: result.ok })');
    expect(routes).toContain('const greenStopReview =');
    // And that the evidence is only ever set from a CONCLUSIVE verdict — never from an unpainted
    // snapshot (ignorance) or a dead dev server (a process problem no code edit can fix).
    expect(routes).toContain('!verdict.rendered && !verdict.inconclusive && !verdict.serverDown) previewProvenBroken = true');
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

describe('IGNORANCE IS NOT A LICENCE TO EDIT (admin 2026-08-23, "reviewer band kar dein?")', () => {
  /**
   * `previewGreen: false` always meant two different things at once — "we looked and it was broken"
   * and "we could not look at all" — and the original rule treated them the same. The second is the
   * state a build reaches when there is no sandbox, when the snapshot was taken before the app
   * painted, or when the dev server had stopped: the app in front of the user is very likely FINE,
   * and rewriting it on no evidence is the re-break class Green Stop exists to end, surviving in the
   * one state nobody had separated out.
   */
  it('does NOT write when the build succeeded but the preview could not be verified', () => {
    expect(reviewerShouldWrite({ previewGreen: false, previewProvenBroken: false, buildOk: true })).toBe(false);
  });

  it('treats a missing signal the same way — absent is not "broken"', () => {
    // A caller that has not been updated must fall on the SAFE side, not the editing side.
    expect(reviewerShouldWrite({ previewGreen: false, buildOk: true })).toBe(false);
  });

  it('DOES write when the app was opened and seen broken', () => {
    // Positive evidence of a defect is exactly what the reviewer's repair is for.
    expect(reviewerShouldWrite({ previewGreen: false, previewProvenBroken: true, buildOk: true })).toBe(true);
  });

  it('DOES write when the build itself reported failure — there is no working app to protect', () => {
    expect(reviewerShouldWrite({ previewGreen: false, previewProvenBroken: false, buildOk: false })).toBe(true);
  });

  it('still never writes to a GREEN app, whatever else is true', () => {
    for (const buildOk of [true, false]) {
      for (const previewProvenBroken of [true, false]) {
        expect(reviewerShouldWrite({ previewGreen: true, previewProvenBroken, buildOk })).toBe(false);
      }
    }
  });

  it('the kill switch still restores the old always-write behaviour', () => {
    const env = { AGENTV3_GREEN_STOP: 'off' } as never;
    expect(reviewerShouldWrite({ previewGreen: true, previewProvenBroken: false, buildOk: true, env })).toBe(true);
    expect(reviewerShouldWrite({ previewGreen: false, previewProvenBroken: false, buildOk: true, env })).toBe(true);
  });
});
