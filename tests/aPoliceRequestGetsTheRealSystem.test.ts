/**
 * 🚓 A REQUEST FOR POLICE GETS THE REAL SYSTEM, AND ONLY THE REAL SYSTEM COUNTS (master audit 2026-11-25, Parts I + J).
 *
 * The reported prompt: "when any crime happens, police should arrive". It becomes the required feature 'police'; that seeds
 * the systems kit (which carries systems/dispatch.ts); the builder is told to use it; and the scope check counts police as
 * PRESENT only when the game calls the dispatch system — a game that only shows "Police aa gayi" is reported MISSING it.
 */
import { describe, expect, it } from 'vitest';
import { buildGameContract, scopeMatch } from '../src/server/AgentV3/gameIntent';
import { wantsCombatKit } from '../src/server/AgentV3/gameRules';

const ASK = 'Make a GTA style open world game. When any crime happens, police should arrive.';

describe('the police request, end to end through the contract', () => {
  it('names the feature, in English, Hinglish and Hindi', () => {
    expect(buildGameContract(ASK).requiredFeatures).toContain('police');
    expect(buildGameContract('3d game banao, chori karne par pulis aa jaye').requiredFeatures).toContain('police');
    expect(buildGameContract('एक 3D गेम बनाओ जिसमें अपराध होने पर पुलिस आए').requiredFeatures).toContain('police');
    expect(buildGameContract('a game with an ambulance that comes when someone is hurt').requiredFeatures).toContain('police');
  });
  it('seeds the systems kit (where dispatch.ts lives) even with no enemies named', () => {
    const c = buildGameContract(ASK);
    expect(wantsCombatKit(ASK, c.genre, c.requiredFeatures)).toBe(true);
  });
  it('🔴 a game that only SAYS police came is reported missing police (the reported bug)', () => {
    const c = buildGameContract(ASK);
    const fake = { 'src/game/Game.tsx': "events.on('ENTITY_DIED', () => events.emit('HINT', { text: 'Police aa gayi' })); const police = 'police';" };
    expect(scopeMatch(c, fake).missing).toContain('police');
  });
  it('a game that calls the dispatch system has police', () => {
    const c = buildGameContract(ASK);
    // A real project (Q-3360): the systems kit on disk and an entry that loads the game.
    const real = { 'src/game/systems/dispatch.ts': 'export class Dispatch {}', 'src/main.tsx': "import './game/Game';", 'src/game/Game.tsx': 'const npcs = new Entities(ctx); const wanted = new Wanted(ctx, npcs, new Dispatch(ctx, npcs));' };
    expect(scopeMatch(c, real).present).toContain('police');
    expect(scopeMatch(c, { 'src/game/Game.tsx': real['src/game/Game.tsx'] }).notVerified).toContain('police'); // no kit, no entry: a call to nothing
  });
  it('"police" mentioned only in a comment does not count', () => {
    const c = buildGameContract(ASK);
    expect(scopeMatch(c, { 'src/game/Game.tsx': '// TODO: new Wanted(ctx, npcs, new Dispatch(ctx, npcs))' }).missing).toContain('police');
  });
  it('a game that never mentions police does not get the feature', () => {
    expect(buildGameContract('a racing game with 3 laps and a timer').requiredFeatures).not.toContain('police');
  });
});
