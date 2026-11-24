/**
 * Admin 2026-11-24 (question 2, second half): a rule the user named ("kill an enemy → score goes up") is PROVEN by playing,
 * not by grepping. The kit's runtime exposes window.__nbRules (status, score, emit); at the end of the playtest, after the
 * Play again check, each probed rule's own kit event is sent and the state is read back. A game that does not use the kit
 * state is "not checkable", never "broken". The route wiring (contract rules → probes → report) lands with the contract's
 * rules (G1). Fixtures run the generated kit files with a window global.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { probedRules, ruleProbeMessage, gamePlaytestModule, gamePlaytestConfig, RULE_EVENTS, PROBED_RULES } from '../src/server/AgentV3/gamePlaytest';

const DIR = join(__dirname, `.tmp-rule-probe-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let ST: any; let EV: any;
beforeAll(async () => {
  (globalThis as any).window ??= {};
  const out: any = (generateGameRuntime as any)({});
  const files: Record<string, string> = out.files ?? out;
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  ST = await import(join(DIR, 'src/game/core/state.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('🔴 the kit answers the probe', () => {
  it('a game that wired the rule: sending ENEMY_DIED raises the score through window.__nbRules', () => {
    const h = (globalThis as any).window.__nbRules;
    expect(typeof h.emit).toBe('function');
    const off = EV.events.on(RULE_EVENTS.enemyDied, () => ST.addScore(10));
    ST.setStatus('playing');
    const before = h.score();
    h.emit(RULE_EVENTS.enemyDied, { position: { x: 0, y: 0, z: 0 }, overkill: 0 });
    expect(h.score()).toBe(before + 10);
    off?.();
  });
  it('a game that did NOT wire it: the score does not move (the probe reports "does NOT work")', () => {
    const h = (globalThis as any).window.__nbRules;
    const before = h.score();
    h.emit(RULE_EVENTS.enemyDied, {});
    expect(h.score()).toBe(before);
  });
});

describe('the probe list and its message', () => {
  it('only rules a probe exists for, the round-ending one last', () => {
    expect(probedRules(['no-health-game-over', 'pickup-score-up', 'enemy-dies-score-up'])).toEqual(['enemy-dies-score-up', 'no-health-game-over']);
    expect(probedRules(undefined)).toEqual([]);
  });
  it('says works / does NOT work / could not be checked, with the evidence', () => {
    const msg = ruleProbeMessage([
      { id: 'enemy-dies-score-up', verdict: 'held', why: 'score 0 to 10 after an enemy died' },
      { id: 'no-health-game-over', verdict: 'not-checkable', why: 'the game does not use the kit state' },
    ]);
    expect(msg).toMatch(/killing an enemy raises the score — works \(score 0 to 10/);
    expect(msg).toMatch(/could not be checked \(the game does not use the kit state\)/);
    expect(ruleProbeMessage([])).toBe('');
  });
});

describe('🔒 the script', () => {
  const src = gamePlaytestModule({ ...gamePlaytestConfig('http://x'), rules: [...PROBED_RULES], ruleEvents: RULE_EVENTS }, '');
  it('runs the probes after the Play again check, from window.__nbRules, with event names as data', () => {
    expect(src.indexOf('window.__nbRules')).toBeGreaterThan(src.indexOf('out.restartCheck = { ended, pressed, after }'));
    expect(src).toMatch(/h\.emit\(ev\.enemyDied/);
    expect(src).not.toMatch(/'ENEMY_DIED'/);
  });
  it('is valid JavaScript', () => {
    expect(() => new Function(`return (async () => { ${src.replace(/^import .*$/m, '')} })`)).not.toThrow();
  });
});
