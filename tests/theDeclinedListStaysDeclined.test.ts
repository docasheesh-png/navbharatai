/**
 * Autopsy 958aa1ec — build report #1836 (3D endless car racing game, weak tier, ENGINE_R1, RED in 170 s).
 *
 * Three defects this file locks, each with the report's own words:
 *   1. "no login, multiplayer, purchases or backend" dropped only "login": the game contract told the builder
 *      MULTIPLAYER was a named feature and APP_SCOPE called the game LARGE ("needs multiplayer / online play").
 *   2. "All NavBharatAI Pro providers failed (ENGINE_R1)" was recorded verbatim, and the outcome still read
 *      "the engine did not record why" (OUTCOME_UNEXPLAINED).
 *   3. The game kit shipped off-grid spacing, so SPACING_SNAPPED rewrote our own files on every game build — and
 *      its snap moved the joystick knob 2px off centre (52px wide, margin -26px → -24px).
 */
import { describe, expect, it } from 'vitest';
import { withoutDeclinedSentences } from '../src/server/lib/RequirementGapAnalyzer';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { terminalOutcomeCode, ALL_PROVIDERS_FAILED_PREFIX, ALL_PROVIDERS_UNAVAILABLE_PREFIX } from '../src/server/AgentV3/buildOutcomeSummaries';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { snapSpacingInSource } from '../src/server/AgentV3/spacingSnap';
import { readFileSync } from 'node:fs';

/** The request of #1836, verbatim. */
const REQUEST = 'Build a simple mobile-friendly 3D endless car racing game using React, Vite and Three.js. Show a low-poly 3D car on a three-lane road with roadside scenery and approaching obstacles. Start button; left/right arrow keys and large on-screen touch buttons to change lanes; score increases with distance. Collision must stop the run and show Game Over with final score and a Restart button that resets score and obstacles. Include Pause/Resume and brief visible instructions. Responsive portrait and desktop layouts. Use procedural geometry only, no external image/model assets, no login, multiplayer, purchases or backend. Keep scope small and fully playable. Create preview only; do not publish or deploy publicly.';

describe('1 · a refusal covers its whole list', () => {
  it('🔴 the report case: multiplayer, purchases and backend leave with login; what was asked for stays', () => {
    const kept = withoutDeclinedSentences(REQUEST);
    for (const declined of ['multiplayer', 'purchases', 'backend', 'login', 'publish']) expect(kept, declined).not.toContain(declined);
    for (const asked of ['score', 'Restart', 'Pause', 'procedural geometry', 'Keep scope small']) expect(kept, asked).toContain(asked);
  });
  it('the game contract no longer tells the builder to build multiplayer', () => {
    const c = buildGameContract(REQUEST);
    expect(c.requiredFeatures).toEqual(['score', 'restart', 'pause']);
    expect(c.genre).toBe('racing');
  });
  it('the scope no longer reads the declined multiplayer as infrastructure the game needs', () => {
    expect(analyzeAppScope(REQUEST).signals.join(' ')).not.toMatch(/multiplayer/i);
  });
  it('the list ends where a clause asks for something again — precision before recall', () => {
    expect(withoutDeclinedSentences('A quiz app, no ads, add a leaderboard and a timer.')).toContain('add a leaderboard');
    expect(withoutDeclinedSentences('A shop, no login, with a cart and checkout.')).toContain('with a cart');
    expect(withoutDeclinedSentences('A game, no sound, score is shown at the top.')).toContain('score is shown');
    expect(withoutDeclinedSentences("A notes app; don't add sync, offline only.")).not.toContain('sync');
  });
});

describe('2 · a provider chain that ran out is a named outcome, from the text it throws', () => {
  it('🔴 the report case: "All NavBharatAI Pro providers failed (ENGINE_R1)" is ENGINE_UNAVAILABLE, not unexplained', () => {
    const message = 'All NavBharatAI Pro providers failed (ENGINE_R1). Last error: the output budget ran out before the answer began — this rung was authorised 9833 output tokens, cut down from 32000 but returned no text or tool call.';
    expect(terminalOutcomeCode({ messages: [message] })).toBe('OUTCOME_ENGINE_UNAVAILABLE');
    expect(terminalOutcomeCode({ error: new Error(`${ALL_PROVIDERS_UNAVAILABLE_PREFIX} (known-fatal from earlier in this build). Last error: x`) })).toBe('OUTCOME_ENGINE_UNAVAILABLE');
    expect(terminalOutcomeCode({ messages: ['something nobody named'] })).toBe('OUTCOME_UNEXPLAINED');
  });
  it('🔒 the chain builds its message from the same prefixes the classifier reads — they cannot drift', () => {
    const runner = readFileSync('src/server/AgentV3/providers/MultiProviderTurnRunner.ts', 'utf8');
    expect(runner).toContain('`${ALL_PROVIDERS_UNAVAILABLE_PREFIX} (known-fatal from earlier in this build)`');
    expect(runner).toContain('`${ALL_PROVIDERS_FAILED_PREFIX} (${compactFallbackPath(fellBackFrom)})`');
    expect(runner).not.toMatch(/'All NavBharatAI Pro providers/);
    expect(ALL_PROVIDERS_FAILED_PREFIX).toBe('All NavBharatAI Pro providers failed');
  });
});

describe('3 · 🔒 the game kit ships on the 4px grid, so the snap never has our own files to rewrite', () => {
  it('every file every game recipe writes has no off-grid spacing (a new one fails here)', () => {
    const offGrid: string[] = [];
    for (const [path, f] of recipeFilePool()) {
      const content = typeof f === 'string' ? f : (f as { content: string }).content;
      const r = snapSpacingInSource(String(content), 4, path);
      if (r && r.snapped) offGrid.push(`${path}: ${r.changes.join(', ')}`);
    }
    expect(offGrid).toEqual([]);
  });
  it('the joystick knob is still centred on its own size', () => {
    const shell = readFileSync('src/server/lib/GameShellGenerator.ts', 'utf8');
    const knob = /\.nbg-tc-knob\{[^}]*width:(\d+)px;height:(\d+)px;margin:-(\d+)px 0 0 -(\d+)px/.exec(shell);
    expect(knob).not.toBeNull();
    const [, w, h, mt, ml] = knob!.map(Number);
    expect([mt, ml]).toEqual([w / 2, h / 2]);
  });
});
