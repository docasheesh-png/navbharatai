/**
 * An action, shooter or open-world game is a town of enterable houses (owner 2026-11-23).
 * The prompt, the validator and CLAUDE.md keep the rule. A 2D game does not grow a town.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asksForEnterableHouses } from '../src/server/AgentV3/gameIntent';
import { ENTERABLE_HOUSE_RULE, missingEnterableHouses } from '../src/server/AgentV3/enterableHouseRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

describe('enterable houses are required for an action world', () => {
  it('hears PUBG, Free Fire, BGMI and GTA in any language, and ignores a flat game', () => {
    expect(asksForEnterableHouses('BGMI jaisa game banao')).toBe(true);
    expect(asksForEnterableHouses('free fire wali shooting')).toBe(true);
    expect(asksForEnterableHouses('gta style open world')).toBe(true);
    expect(asksForEnterableHouses('ओपन वर्ल्ड में घर')).toBe(true);
    expect(asksForEnterableHouses('a 2d puzzle game')).toBe(false);
    expect(asksForEnterableHouses('2d platformer with a house')).toBe(false);
  });

  it('the prompt, the validator and CLAUDE.md still state the rule', () => {
    expect(architectSystemPrompt()).toContain('createActionTown');
    expect(ENTERABLE_HOUSE_RULE).toContain('at least 100');
    expect(readFileSync('CLAUDE.md', 'utf8')).toContain('This rule must never be removed');
    expect(readFileSync('CLAUDE.md', 'utf8')).toContain('at least 100 houses');
    const solid = { 'src/game/Game.ts': 'createHouse({ storeys: 2 }); // BGMI open world' };
    expect(missingEnterableHouses('BGMI jaisa open world', solid)).toMatch(/ENTERABLE HOUSES MISSING/);
    expect(missingEnterableHouses('BGMI jaisa open world', { 'src/game/Game.ts': 'createActionTown(100, 1);' })).toBe('');
    expect(missingEnterableHouses('a 2d puzzle', solid)).toBe('');
  });
});
