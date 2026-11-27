// 🧾 WHAT THIS REQUEST ASKED FOR IS PROVED BY PLAYING, NOT CLAIMED (Kadam 2; build report #2535, 2026-11-26).
//
// "hero kr hath me ek badi gun banao" was reported done from a menu screenshot, and nothing was in the hand. The class: "an
// edit turn's ask is never checked against the played game". Now an ask the page can check (enemies alive near the hero, an
// item really in a hand — the kit's live record window.__nbHeld) becomes GAME_DEFECT_ASK_NOT_MET when the played game does
// not show it, and the completion gate refuses to report the build done. A page that was never read says nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { asksForHeldItem } from '../src/server/AgentV3/gameIntent';
import { missingHeldFinding, pagePlaceholderFindings, PLACEHOLDER_PAGE_HOOK } from '../src/server/AgentV3/gamePlaceholderProbe';
import { gameIncompleteReason } from '../src/server/AgentV3/gameRepair';

describe('✋ asksForHeldItem — the real requests', () => {
  it.each([
    'hero kr hath me ek badi gun banao',            // BR2535, verbatim
    'hero ke hath me gun do',                        // BR2526, verbatim
    'batsman ke haath me bat hona chahiye',
    'give the player a sword in his hand',
    'हीरो के हाथ में बंदूक दो',
  ])('asks: %s', (t) => expect(asksForHeldItem(t)).toBe(true));
  it.each([
    'gun fire nahi ho rahi abhi bhi',                // BR2529: about firing, not about the hand
    'hero ka character badla nahi!! real human banao!!',
    'no gun in the hand please.',
    'cricket game me player ki position theek karo',
  ])('does not ask: %s', (t) => expect(asksForHeldItem(t)).toBe(false));
});

describe('✋ missingHeldFinding — read from the kit\'s live record of the hands', () => {
  it('nothing in either hand after a round → a finding', () => {
    expect(missingHeldFinding({ held: [] }, { held: [] })?.kind).toBe('MISSING_HELD');
  });
  it('the game has no kit player body (no record at all) → a finding that says nothing can show it', () => {
    expect(missingHeldFinding({ meshes: 10 }, { meshes: 10 })?.evidence).toMatch(/does not use the kit's player body/);
  });
  it('an item really in the hand → no finding', () => {
    expect(missingHeldFinding({ held: [] }, { held: [{ side: 'right', subject: 'rifle' }] })).toBe(null);
  });
  it('a page that was never read → no finding ("could not look" is not "missing")', () => {
    expect(missingHeldFinding(null, null)).toBe(null);
  });
  it('only looked for when the request asked', () => {
    expect(pagePlaceholderFindings({ held: [] }, { held: [], meshes: 50 }, null, {}).some((f) => f.kind === 'MISSING_HELD')).toBe(false);
    expect(pagePlaceholderFindings({ held: [] }, { held: [], meshes: 50 }, null, { held: true })[0].kind).toBe('MISSING_HELD');
  });
  it('the page hook reads window.__nbHeld, guarded', () => {
    expect(PLACEHOLDER_PAGE_HOOK).toMatch(/typeof window\.__nbHeld === 'function' \? window\.__nbHeld\(\)/);
  });
});

describe('🚦 the completion gate refuses "done" while the ask is not met', () => {
  it('ASK_NOT_MET is said in the user\'s terms', () => {
    const why = gameIncompleteReason([{ code: 'GAME_DEFECT_ASK_NOT_MET', evidence: 'an item in the hero\'s hand was asked for, but nothing was in either hand during the round' }], [], { played: true });
    expect(why).toMatch(/what you asked for is not in the game yet — an item in the hero's hand was asked for/);
  });
  it('census: every asked-for page finding becomes the defect the gate reads', () => {
    const phase = readFileSync('src/server/AgentV3/buildPhases/gamePlaytestPhase.ts', 'utf8');
    const probe = readFileSync('src/server/AgentV3/gamePlaceholderProbe.ts', 'utf8');
    const askedKinds = [...probe.matchAll(/'(MISSING_(?:ENEMIES|HELD|[A-Z]+_ASKED))'/g)].map((m) => m[1]);
    for (const k of new Set(askedKinds)) expect(phase, `${k} is never turned into GAME_DEFECT_ASK_NOT_MET`).toContain(`f.kind === '${k}'`);
    expect(phase).toMatch(/held: asksForHeldItem\(p\.request\)/);
  });
});
