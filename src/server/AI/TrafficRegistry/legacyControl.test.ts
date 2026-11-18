/**
 * Traffic Manager V2, P3: provider drain/disable reaching the older paths — off until an admin turns a path on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_DISPLAY_NAMES } from '../../AgentV3/engineHealth';
import { PROVIDER_IDS } from '../FreeChain/config';
import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';
import { ENGINE_FAMILY, familyOfEngineName, familyOfFreeChainRung, LEGACY_PATHS, legacyPathAllows } from './legacyControl';
import { COVERED_PATHS, parseControlBody, type ControlDoc } from './controlTypes';

const doc = (over: Partial<ControlDoc>): ControlDoc => ({ global: { gateway: 'on' }, surfaces: {}, providers: {}, models: {}, revision: 1, updatedAtMs: 1, actor: 'a', reason: 'r', ...over });
const families = new Set(PROVIDER_FAMILIES.map(f => f.id));

describe('off until an admin turns a path on (no production change in P3)', () => {
  it('no document, or coverage off: every provider allowed, even a drained one', () => {
    expect(legacyPathAllows('builder', 'glm', null)).toBe(true);
    const drained = doc({ providers: { glm: { state: 'draining', trafficCapPct: 100 } } });
    for (const p of LEGACY_PATHS) expect(legacyPathAllows(p, 'glm', drained)).toBe(true);
  });
  it('coverage on: drained and disabled are skipped on that path only', () => {
    for (const state of ['draining', 'disabled'] as const) {
      const d = doc({ providers: { glm: { state, trafficCapPct: 100 } }, coverage: { builder: true } });
      expect(legacyPathAllows('builder', 'glm', d)).toBe(false);
      expect(legacyPathAllows('free-chain', 'glm', d)).toBe(true);
      expect(legacyPathAllows('chat-router', 'glm', d)).toBe(true);
      expect(legacyPathAllows('builder', 'kimi', d)).toBe(true);
    }
  });
  it('traffic caps are NOT applied on older paths (no stable request id there)', () => {
    expect(legacyPathAllows('builder', 'glm', doc({ providers: { glm: { state: 'enabled', trafficCapPct: 0 } }, coverage: { builder: true } }))).toBe(true);
  });
  it('an unknown engine label is never blocked', () => {
    expect(legacyPathAllows('builder', familyOfEngineName('BRAND_NEW'), doc({ coverage: { builder: true } }))).toBe(true);
  });
  it('coverage validates strictly and the path list is one list', () => {
    expect([...COVERED_PATHS]).toEqual([...LEGACY_PATHS]);
    expect(parseControlBody({ coverage: { builder: true, 'free-chain': false } })).toMatchObject({ coverage: { builder: true } });
    expect(() => parseControlBody({ coverage: { gateway: true } })).toThrow(/Unknown routing path/);
    expect(() => parseControlBody({ coverage: { builder: 'yes' } })).toThrow(/true or false/);
  });
});

describe('census: every label the older paths use maps to a kill-switch family', () => {
  it('every builder engine label (engineHealth display list) is mapped', () => {
    for (const label of Object.keys(ENGINE_DISPLAY_NAMES)) expect(familyOfEngineName(label), label).not.toBeNull();
  });
  it('every mapped family is a real kill-switch family', () => {
    for (const [label, family] of Object.entries(ENGINE_FAMILY)) expect(families.has(family), `${label} → ${family}`).toBe(true);
  });
  it('every Free Chat rung id, plus the two suppliers in front of it, maps', () => {
    for (const id of [...PROVIDER_IDS, 'mitrify', 'qubax']) {
      const f = familyOfFreeChainRung(id);
      expect(f, id).not.toBeNull();
      expect(families.has(f!), `${id} → ${f}`).toBe(true);
    }
  });
  it('pool suffixes are the same account', () => { expect(familyOfEngineName('GLM#2')).toBe('glm'); });
});

describe('each older path asks before a NEW attempt, and only there', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('chat router: inside acquire(), next to the health skip', () => {
    const s = src('src/server/AI/Router/AIRouter.ts');
    expect(s).toMatch(/private acquire\(name: string\): boolean \{[\s\S]{0,600}legacyPathAllows\('chat-router', familyOfEngineName\(name\)\)/);
  });
  it('builder: in the rung loop, a skip that moves to the next rung (continue), never a reorder', () => {
    const s = src('src/server/AgentV3/providers/MultiProviderTurnRunner.ts');
    expect(s).toMatch(/if \(!legacyPathAllows\('builder', familyOfEngineName\(name\)\)\) \{\s*fellBackFrom\.push\(name\);[\s\S]{0,200}continue;/);
  });
  it('Free Chat chain: first thing in the rung loop, before any reservation or dispatch', () => {
    const s = src('src/server/AI/FreeChain/runtime.ts');
    const loop = s.indexOf('for (const [position, id] of order.entries()) {');
    const check = s.indexOf("legacyPathAllows('free-chain'", loop);
    expect(loop).toBeGreaterThan(0);
    expect(check - loop).toBeLessThan(500);
    const firstReserveCall = s.slice(loop).search(/\.reserve\w*\(|reserveShared\(|reservePaid\w*\(/);
    expect(firstReserveCall === -1 || loop + firstReserveCall > check).toBe(true);
  });
});
