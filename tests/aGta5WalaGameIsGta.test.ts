// BR1966 (report 949fe0c07e…, 2026-11-08) — "Pura gta5 wala game banaa do"
//
// APP_SCOPE treated this as an ordinary one-shot (no mega-signal) and the game kit
// prepared no 3D assets, because FAMOUS_APPS / DRAWN_IN_3D / realismIntent all used a
// bare `\bgta\b`. The digit/letter in "gta5" / "GTA5" / "gtav" is a word character, so
// the boundary after "gta" fails. The spaced twin "Pura gta 5 wala game banaa do" (and
// the BR1955 fixture "I want to make a game like gta 5") already cloned GTA, seeded the
// 3D kit, and chose the real objects tier.
//
// Class: glued GTA titles `gta5` / `gtav` / `gta-5` / `gta_5` are the same title as
// spaced "gta 5". A following digit other than 5 (gta50, gta6, gta4) or a longer token
// (gta5cheats, gtable) still does not match.
// t311u: this ESCALATES (the costly direction) and can select the heavier 3D/real tiers.
// An opposite-class corpus of 167 prompts was measured before the production edit:
// 0 field changes, 0 smaller→LARGE, 0 newly famousApp=GTA, 0 newly wants3D, 0 lite→real.

import { describe, it, expect } from 'vitest';
import { analyzeAppScope, scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { gameKitWants3D, gameKitPlan } from '../src/server/AgentV3/gameKitSeed';
import { realismIntent } from '../src/server/lib/realismIntent';
import { auditSummaryClaims, type MeasuredFacts } from '../src/server/AgentV3/claimAudit';
import { BR1955_PROMPT } from './fixtures/br1955';

export const BR1966_PROMPT = 'Pura gta5 wala game banaa do';
const SPACED = 'Pura gta 5 wala game banaa do';

function verdict(prompt: string) {
  const scope = analyzeAppScope(prompt);
  return {
    decision: scope.decision,
    size: scope.size,
    famousApp: scope.famousApp,
    wants3D: gameKitWants3D(prompt),
    plan: gameKitPlan(prompt),
    realismTier: realismIntent(prompt).tier,
    large: scopeVerdict(prompt, { complex: false }).large,
  };
}

describe('BR1966: a glued gta5 title is GTA, like spaced "gta 5"', () => {
  it("this report's prompt is a GTA clone and wants the 3D kit", () => {
    const v = verdict(BR1966_PROMPT);
    expect(v.famousApp).toBe('GTA');
    expect(v.decision).toBe('analyze');
    expect(v.size).toBe('large');
    expect(v.large).toBe(true);
    expect(v.wants3D).toBe(true);
    expect(v.plan).toEqual([
      'generate_game_runtime',
      'generate_game_3d',
      'generate_athree_map', // an open-world game gets the big map, laid down by the platform (failedbr #2478)
      'generate_game_vfx',
      'generate_melody',
      'generate_game_shell',
    ]);
    expect(v.realismTier).toBe('real');
  });

  it('matches the spaced twin that already worked on main', () => {
    expect(verdict(BR1966_PROMPT)).toEqual(verdict(SPACED));
  });

  it.each([
    'Pura GTA5 wala game banaa do',
    'I want to make a game like gta5',
    'gta5 jaisa game banao',
    'gtav wala game',
    'gta_5 wala game',
    'GTA-5 wala game',
  ])('"%s" is also GTA + 3D + real', (prompt) => {
    const v = verdict(prompt);
    expect(v.famousApp).toBe('GTA');
    expect(v.decision).toBe('analyze');
    expect(v.wants3D).toBe(true);
    expect(v.realismTier).toBe('real');
  });

  it('the spaced BR1955 fixture is unchanged', () => {
    const v = verdict(BR1955_PROMPT);
    expect(v.famousApp).toBe('GTA');
    expect(v.wants3D).toBe(true);
    expect(v.realismTier).toBe('real');
    expect(v.decision).toBe('analyze');
  });

  it('an India-map game stays a 2D ordinary one-shot', () => {
    const v = verdict('Build a game with indian map');
    expect(v.decision).toBe('direct');
    expect(v.size).toBe('small');
    expect(v.famousApp).toBeNull();
    expect(v.wants3D).toBe(false);
    expect(v.plan).toEqual([
      'generate_game_runtime',
      'generate_game_vfx',
      'generate_melody',
    ]);
    expect(v.large).toBe(false);
  });

  it.each([
    'gta50 wala game',
    'gta5cheats website',
    'gta6 wala game',
    'gta4 wala game',
    'gtable reservation app',
    'a data aggregator',
  ])('"%s" is not a GTA title', (prompt) => {
    const v = verdict(prompt);
    expect(v.famousApp, prompt).not.toBe('GTA');
    expect(v.wants3D, prompt).toBe(false);
    expect(v.realismTier, prompt).toBe('lite');
  });

  it('companion/tool phrases follow the existing "gta" reading (not a clone)', () => {
    for (const [glued, spaced] of [
      ['using GTA5', 'using GTA'],
      ['GTA5 wiki', 'GTA wiki'],
      ['GTA5 tips and tricks', 'GTA tips and tricks'],
    ] as const) {
      expect(verdict(glued).decision).toBe(verdict(spaced).decision);
      expect(verdict(glued).famousApp).toBe(verdict(spaced).famousApp);
      expect(verdict(glued).famousApp).toBeNull();
    }
  });

  it('a GTA5 quiz follows the existing "gta quiz" reading: famous, but not a 3D kit', () => {
    expect(verdict('gta5 quiz banao')).toEqual(verdict('gta quiz banao'));
    expect(verdict('gta5 quiz banao').famousApp).toBe('GTA');
    expect(verdict('gta5 quiz banao').wants3D).toBe(false);
  });
});

describe('BR1966: the "ready to play" summary was already contradicted', () => {
  const facts: MeasuredFacts = {
    consoleCaptured: true,
    screenshotTaken: true,
    previewVerified: true,
    gamePlayed: 'not-run',
  };
  const kind = (text: string) => auditSummaryClaims(text, facts).map((c) => c.kind);

  it("catches this report's playable claims when playtest did not run", () => {
    expect(kind('Your game is ready to play! Click the "Preview" tab at the top to start playing immediately.')).toContain('game-claimed-playable');
    expect(kind('Fully playable on both desktop and mobile devices')).toContain('game-claimed-playable');
  });

  it('leaves a qualified unverified description alone', () => {
    expect(kind('The game rendered in the preview; controls and camera remain unverified.')).not.toContain('game-claimed-playable');
  });
});
