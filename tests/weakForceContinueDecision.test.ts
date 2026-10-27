import { describe, it, expect } from 'vitest';
import { weakForceContinueDecision, weakAdmissionBlocked } from '../src/server/AgentV3/weakBuildPreflight';

describe('weakForceContinueDecision', () => {
  it('blocks strong/unavailable unless the user force-continues on Weak', () => {
    const strong = { scope: 'strong' as const, source: 'model' as const };
    expect(weakForceContinueDecision(false, 'weak', strong).blocked).toBe(true);
    expect(weakForceContinueDecision(true, 'weak', strong).blocked).toBe(false);
    expect(weakForceContinueDecision(true, 'off', strong).blocked).toBe(true);
  });

  it('uses the complex Weak ladder when force-continuing a blocked admission', () => {
    const unavailable = { scope: null, source: 'unavailable' as const };
    const out = weakForceContinueDecision(true, 'weak', unavailable);
    expect(out.blocked).toBe(false);
    expect(out.admissionForBuild?.scope).toBe('complex');
    expect(weakAdmissionBlocked(out.admissionForBuild)).toBe(false);
  });

  it('leaves an already-admitted simple/complex result alone', () => {
    const simple = { scope: 'simple' as const, source: 'model' as const };
    const out = weakForceContinueDecision(true, 'weak', simple);
    expect(out.blocked).toBe(false);
    expect(out.admissionForBuild).toEqual(simple);
  });
});
