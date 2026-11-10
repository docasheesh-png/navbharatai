// BR1961 (report cd970693, 2026-11-08) — conversation:
//   earlier: "Mujhe youtube ki tarah ek app Banakar do"  (= make me an app like YouTube)
//   this turn: "Ab main us app par khud kuch ficar cenj kar sakta hu aur Koi nahin"
//
// planning.sizing concatenates the follow-up first, then the earlier request. requestSubject
// (needsIntent's "name in the subject" shortcut) reads only the first line, so YouTube was no
// longer in the subject. "ki tarah" is Hindi for "like" / "jaisa" but was not in LIKENESS_AFTER,
// so APP_SCOPE said "ordinary one-shot, no mega-signal" while the file planner built a YouTube-like
// video app. The standalone earlier line already escalates (YouTube is in THAT line's subject);
// the concatenated sizing did not.
//
// Class: Hindi "X ki/ke/ka tarah" immediately after a famous name is a likeness word.
// t311u: this ESCALATES (the costly direction). The postposition must sit immediately after the
// name, tighter than jaisa's 40-char window, so a tool phrase plus "ki tarah" ("youtube seo
// generator ki tarah") does not inherit a clone reason.
import { describe, it, expect } from 'vitest';
import { analyzeAppScope, namesAsProduct, scopeVerdict, requestSubject } from '../src/server/lib/appScopeAnalyzer';

const BR1961_FOLLOW_UP = 'Ab main us app par khud kuch ficar cenj kar sakta hu aur Koi nahin';
const BR1961_EARLIER = 'Mujhe youtube ki tarah ek app Banakar do';
const BR1961_SIZING = `${BR1961_FOLLOW_UP}\n\n${BR1961_EARLIER}`;
const YOUTUBE = /\byou\s?tube\b/i;

describe('Hindi "X ki tarah" is a likeness, like "jaisa" / "like"', () => {
  it('the standalone earlier request already clones (YouTube is in that line\'s subject)', () => {
    const s = analyzeAppScope(BR1961_EARLIER);
    expect(s.famousApp).toBe('YouTube');
    expect(s.decision).toBe('analyze');
    expect(scopeVerdict(BR1961_EARLIER, { complex: false }).large).toBe(true);
  });

  it('the BR1961 concatenated sizing (follow-up first) still clones, via ki tarah', () => {
    expect(requestSubject(BR1961_SIZING)).toBe(BR1961_FOLLOW_UP);
    expect(namesAsProduct(BR1961_SIZING, YOUTUBE, { needsIntent: true, subject: requestSubject(BR1961_SIZING) })).toBe(true);
    const s = analyzeAppScope(BR1961_SIZING);
    expect(s.famousApp).toBe('YouTube');
    expect(s.decision).toBe('analyze');
    expect(s.signals.join(' ')).toMatch(/clone of YouTube|asks to clone YouTube/);
    expect(scopeVerdict(BR1961_SIZING, { complex: false }).large).toBe(true);
  });

  it.each([
    'youtube ki tarah ek app',
    'YouTube ke tarah ek app banao',
    'instagram ki tarah reels app',
    'WhatsApp ka tarah chat app',
  ])('"%s" names a product to clone', (p) => {
    const s = analyzeAppScope(p);
    expect(s.decision).toBe('analyze');
    expect(s.famousApp).toBeTruthy();
  });
});

describe('🔒 neighbours: existing likeness, tools, and a heading mention stay as they were', () => {
  it.each([
    ['Create a html code of youtube seo generator', null],
    ['youtube video downloader', null],
    ['youtube seo generator ki tarah ek tool banao', null],
    ['YouTube ka tournament', null],
    ['an app for YouTube players', null],
  ])('%s stays direct', (p, _n) => {
    const s = analyzeAppScope(p);
    expect(s.famousApp).toBeNull();
    expect(s.decision).toBe('direct');
  });

  it.each([
    ['YouTube jaisa SEO generator banao', 'YouTube'],
    ['Mujhe youtube jaisa app do', 'YouTube'],
    ['build a youtube clone', 'YouTube'],
    ['Build me an Instagram', 'Instagram'],
  ])('%s still clones as %s', (p, app) => {
    const s = analyzeAppScope(p);
    expect(s.famousApp).toBe(app);
    expect(s.decision).toBe('analyze');
  });

  it('a later heading that merely names a product is still not a clone (6452c0a9)', () => {
    const p = `${BR1961_FOLLOW_UP}\n\n7. WhatsApp and Contact System\nUse the official WhatsApp click-to-chat feature`;
    expect(analyzeAppScope(p).famousApp).toBeNull();
  });

  it('an earlier "Build me an Instagram" without a likeness word is still first-line-subject (6452c0a9 / needsIntent)', () => {
    // Residual: changing requestSubject to every paragraph would treat a blank-line heading as a
    // subject and reopen 6452c0a9. Documented, not widened.
    const p = `${BR1961_FOLLOW_UP}\n\nBuild me an Instagram`;
    expect(requestSubject(p)).toBe(BR1961_FOLLOW_UP);
    expect(analyzeAppScope(p).famousApp).toBeNull();
  });
});
