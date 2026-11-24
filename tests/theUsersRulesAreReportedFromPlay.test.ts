/**
 * G2b (admin 2026-11-24): the contract's rules reach the playtest, and what playing proved reaches the user — with a
 * one-tap fix when a rule did not happen. Pure reporter + route wiring pins.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportRuleProbes } from '../src/server/AgentV3/buildPhases/gameRuleProbes';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const ports = () => ({ record: vi.fn(), say: vi.fn() });

describe('reportRuleProbes', () => {
  it('🔴 a rule that did not happen is a warning the user can act on', () => {
    const p = ports();
    expect(reportRuleProbes([{ id: 'enemy-dies-score-up', verdict: 'not-held', why: 'score 0 to 0 after an enemy died' }], p)).toBe('GAME_RULE_BROKEN');
    expect(p.record.mock.calls[0][0]).toMatchObject({ severity: 'warning', autoResolved: false });
    expect(p.say).toHaveBeenCalledWith(expect.stringMatching(/killing an enemy raises the score — does NOT work/));
    const offer = buildFindingSuggestions([{ code: 'GAME_RULE_BROKEN', message: p.record.mock.calls[0][0].message, autoResolved: false }]);
    expect(offer[0]?.title).toBe('Make the game follow your rules');
    expect(offer[0]?.prompt).toMatch(/ENEMY_DIED/);
  });
  it('all working: an info line, and the user hears which rules were seen working', () => {
    const p = ports();
    expect(reportRuleProbes([{ id: 'enemy-dies-score-up', verdict: 'held', why: 'score 0 to 10 after an enemy died' }], p)).toBe('GAME_RULES_CHECKED');
    expect(p.record.mock.calls[0][0]).toMatchObject({ severity: 'info', autoResolved: true });
  });
  it('not checkable is neither working nor broken', () => {
    const p = ports();
    expect(reportRuleProbes([{ id: 'no-health-game-over', verdict: 'not-checkable', why: 'the game does not use the kit state' }], p)).toBe('GAME_RULES_CHECKED');
    expect(p.say).toHaveBeenCalledWith(expect.stringMatching(/could not be checked/));
  });
  it('no probes: nothing said; a throwing port never breaks the build', () => {
    const p = ports();
    expect(reportRuleProbes(undefined, p)).toBeNull();
    expect(p.say).not.toHaveBeenCalled();
    expect(reportRuleProbes([{ id: 'enemy-dies-score-up', verdict: 'held', why: 'x' }], { record: () => { throw new Error('x'); }, say: vi.fn() })).toBeNull();
  });
});

describe('🔒 wiring', () => {
  it('the contract rules go to the playtest, and its probes are reported right after it is read', () => {
    expect(ROUTE).toMatch(/gamePlaytestScript\(lastPreviewUrl, \{ storageState: signedInState\(\), startLabels, rules: \(gameContract\?\.rules \?\? \[\]\)\.map\(\(r\) => r\.id\) \}\)/);
    expect(ROUTE).toMatch(/const playRun = parsePlaytest\(out\.stdout\);\n\s+reportRuleProbes\(playRun\.rules, gameFixPorts\);/);
  });
});
