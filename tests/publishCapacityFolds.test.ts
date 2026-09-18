/**
 * PUBLISH CAPACITY FOLDS (admin 2026-09-17: "Publish Capacity ko fold(hide) unfold ka option do").
 *
 * The card grows one row per wasted channel. On the capture that prompted this it carried THIRTY-FOUR
 * of them, each with its own Reclaim button — roughly a hundred lines of one card, pushing the panels
 * below it off the screen.
 *
 * 🔒 THE RULE THIS PINS: folding may hide the LIST, never the ALARM. A control that can silently
 * conceal a ceiling warning is worse than a long card, so the collapsed header keeps the level badge
 * and gains the numbers. Default OPEN, so nothing moves for an admin who never presses it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../src/components/AdminDashboard.tsx'), 'utf8');
/** Comments stripped: a promise in a comment is not a promise in the UI. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

describe('the fold control exists and is reachable', () => {
  it('a button toggles the card, and says which state it is in', () => {
    expect(CODE).toContain('onClick={togglePublishCard}');
    expect(CODE).toContain('aria-expanded={publishCardOpen}');
  });

  it('the body is what folds — the header is not inside it', () => {
    const bodyAt = CODE.indexOf('id="publish-capacity-body"');
    const toggleAt = CODE.indexOf('onClick={togglePublishCard}');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(toggleAt).toBeGreaterThan(-1);
    // The toggle must sit ABOVE the body, or folding would hide the control that unfolds it.
    expect(toggleAt).toBeLessThan(bodyAt);
    expect(CODE).toContain('{!publishCardOpen ? null :');
  });
});

describe('🔒 folding hides the list, never the warning', () => {
  const header = CODE.slice(
    CODE.indexOf('onClick={togglePublishCard}'),
    CODE.indexOf('id="publish-capacity-body"'),
  );

  it('the level badge is OUTSIDE the folded body — a critical ceiling still shows', () => {
    expect(header).toContain("channels?.verdict.level === 'critical'");
    expect(header).toContain('{channelsError ? \'unknown\' : channels?.verdict.level}');
  });

  it('a folded card still prints the numbers and the reclaimable backlog', () => {
    expect(header).toContain('{channels.verdict.used} / {channels.verdict.cap} channels');
    expect(header).toContain('channels.verdict.reclaimable > 0');
  });

  it('a card that could not be read says so when folded — never a silent blank', () => {
    expect(header).toContain('could not be read');
  });
});

describe('🔒 the remembered choice cannot break the panel', () => {
  it('defaults to OPEN, so an admin who never presses it sees today\'s card', () => {
    const init = CODE.slice(CODE.indexOf('const [publishCardOpen'), CODE.indexOf('const togglePublishCard'));
    expect(init).toContain("!== '1'");            // folded only on an explicit stored '1'
    expect(init).toContain('catch { return true; }'); // a throwing read opens, never folds
  });

  it('the write goes through the quota-safe helper, not a bare setItem', () => {
    const toggle = CODE.slice(CODE.indexOf('const togglePublishCard'), CODE.indexOf('const [expandedWorkspace'));
    expect(toggle).toContain('safeLS(');
    expect(toggle).not.toContain('localStorage.setItem');
  });

  it('⚠️ the state is per browser, not per server — it changes no data and no request', () => {
    // Recorded because the next reader may wonder whether this needs persisting server-side. It does
    // not: it is a view preference, and a fold that survived a sign-out would be a surprise, not a
    // feature. Nothing here touches the channel list, the verdict, or the reclaim route.
    const toggle = CODE.slice(CODE.indexOf('const togglePublishCard'), CODE.indexOf('const [expandedWorkspace'));
    expect(toggle).not.toContain('fetch(');
  });
});
