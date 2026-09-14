import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appRanDespiteFailedVerdict, fixRemainingIssuePrompt, appRunningNoticeText,
} from '../src/components/agentv3/failedButRunning';

const panel = readFileSync(resolve(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const reducer = readFileSync(resolve(__dirname, '../src/components/agentv3/agentV3Reducer.ts'), 'utf8');

/**
 * ADMIN, 2026-09-14, describing production rather than a report:
 *
 *   "kabhi kabhi app ban jata hai, par chatbox me ai bolta 'fix with ai' aur woh build fail me count
 *    ho jata hai (10-12% time). aur ham aise builds ko fix with ai press hote hi SACH ME TOD DETE HAI.
 *    3 nuksan: charge = 0, wapas se wahi sahi app banana padega, user ka trust bhi gaya."
 */
const RENDERED = {
  ok: false as const, appRendered: true, running: false, hasError: false,
  budgetReached: false, summary: 'Release gate: RED — 1 build-breaking blocker(s).',
};

describe('a build whose app the platform WATCHED render is not offered as broken', () => {
  it('THE CASE: verdict failed, app rendered', () => {
    expect(appRanDespiteFailedVerdict(RENDERED)).toBe(true);
  });

  it('🔴 an UNKNOWN never counts as rendered — the Android shell is bundled', () => {
    // A phone can run last month's client against today's server and vice versa, so the field can be
    // missing. An unknown must resolve to today's behaviour, never to "the app is fine".
    expect(appRanDespiteFailedVerdict({ ...RENDERED, appRendered: undefined })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, appRendered: false })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, appRendered: 1 as never })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, appRendered: 'yes' as never })).toBe(false);
  });

  it('a genuinely broken app keeps the failure card', () => {
    expect(appRanDespiteFailedVerdict({ ...RENDERED, appRendered: false })).toBe(false);
  });

  it('never steals another card: a crash, a budget pause, a running build, a successful build', () => {
    expect(appRanDespiteFailedVerdict({ ...RENDERED, hasError: true })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, budgetReached: true })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, running: true })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, ok: true as never })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, ok: undefined })).toBe(false);
  });

  it('needs a real summary — an empty card would say nothing at all', () => {
    expect(appRanDespiteFailedVerdict({ ...RENDERED, summary: '' })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, summary: '   ' })).toBe(false);
    expect(appRanDespiteFailedVerdict({ ...RENDERED, summary: undefined })).toBe(false);
  });

  it('null and undefined are safe', () => {
    expect(appRanDespiteFailedVerdict(null)).toBe(false);
    expect(appRanDespiteFailedVerdict(undefined)).toBe(false);
  });
});

describe('the prompt must not order a rebuild of a working app', () => {
  const p = fixRemainingIssuePrompt('Release gate: RED — 1 build-breaking blocker(s).');

  it('🔴 does NOT assert the app is broken — that false premise is what caused the damage', () => {
    // The old prompt was "…finish/fix the build so the app works end-to-end", which states as fact
    // that it does not. A model handed a false premise goes looking, finds nothing, and edits working
    // code until it has something to show for the turn.
    expect(p).not.toContain('works end-to-end');
    expect(p).not.toMatch(/finish\/fix the build/i);
  });

  it('states the evidence, so the model is not left inferring that everything is suspect', () => {
    expect(p).toMatch(/already built and RUNNING/);
    expect(p).toMatch(/rendered correctly/);
  });

  it('forbids the rebuild explicitly — the failure mode is a large confident unnecessary edit', () => {
    expect(p).toMatch(/Do NOT rebuild, redesign or restructure/);
    expect(p).toMatch(/do not touch anything that already works/);
  });

  it('🔒 gives an explicit licence to change NOTHING — without it a model invents work', () => {
    expect(p).toMatch(/change NOTHING/);
    expect(p).toMatch(/complete and correct answer/);
  });

  it('carries the real summary so the turn has something concrete to look at', () => {
    expect(p).toContain('Release gate: RED — 1 build-breaking blocker(s).');
  });

  it('survives a missing summary without crashing or inventing one', () => {
    expect(() => fixRemainingIssuePrompt('')).not.toThrow();
    expect(() => fixRemainingIssuePrompt(undefined as never)).not.toThrow();
  });
});

describe('the notice leads with what is true and checkable', () => {
  const t = appRunningNoticeText();
  it('says the app runs FIRST, then the caveat', () => {
    expect(t).toMatch(/^Your app is built and running/);
    expect(t.indexOf('running')).toBeLessThan(t.indexOf('did not pass'));
  });
  it('still states the honest caveat and the zero charge', () => {
    expect(t).toMatch(/One check did not pass/);
    expect(t).toMatch(/not been charged/);
  });
});

describe('the wiring — none of which fails anything if dropped', () => {
  it('the server sends the one fact the client was missing', () => {
    expect(route).toContain('appRendered: buildObs.previewRendered === true');
  });

  it('the reducer keeps it, strictly', () => {
    expect(reducer).toContain('appRendered: event.appRendered === true');
  });

  it('the panel chooses the card by that rule, not by tone', () => {
    expect(panel).toContain('appRanDespiteFailedVerdict({');
    expect(panel).toContain('fixRemainingIssuePrompt(state.summary');
    expect(panel).toContain('appRunningNoticeText()');
  });

  it('🔒 the ORIGINAL failure card and its prompt still exist for a genuinely broken app', () => {
    // This change must narrow what the old card claims, never delete the card. An app that really is
    // broken still needs the blunt version.
    expect(panel).toContain("fixWithAI('Continue from where you left off and finish/fix the build so the app works end-to-end.')");
  });
});
