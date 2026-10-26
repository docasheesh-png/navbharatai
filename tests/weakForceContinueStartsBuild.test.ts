import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { weakAdmissionBlocked } from '../src/server/AgentV3/weakBuildPreflight';

const panel = readFileSync(resolve('src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
const route = readFileSync(resolve('src/server/routes/agentv3.ts'), 'utf8');
const hook = readFileSync(resolve('src/hooks/useAgentV3Build.ts'), 'utf8');

describe('Continue with Weak actually starts a Weak build', () => {
  it('client sends weakForceContinue and locks powerLevel to weak', () => {
    expect(panel).toContain('weakForceContinueRef');
    expect(panel).toContain('Continue with Weak');
    expect(panel).toContain("powerLevel: forceWeak ? 'weak' : powerLevel");
    expect(panel).toContain('weakForceContinue: forceWeak || undefined');
    expect(hook).toContain('weakForceContinue: opts?.weakForceContinue === true ? true : undefined');
  });

  it('server skips scope diversion and uses complex Weak ladder when force-continuing', () => {
    expect(route).toContain('weakForceContinueDecision');
    expect(route).toContain('weakAdmissionForBuild');
    expect(route).toContain('resolveWeakComplexity(weakAdmissionForBuild');
    const preflight = readFileSync(resolve('src/server/AgentV3/weakBuildPreflight.ts'), 'utf8');
    expect(preflight).toContain("scope: 'complex'");
    expect(weakAdmissionBlocked({ scope: 'strong', source: 'model' })).toBe(true);
    expect(weakAdmissionBlocked({ scope: null, source: 'unavailable' })).toBe(true);
    expect(weakAdmissionBlocked({ scope: 'complex', source: 'model' })).toBe(false);
  });

  it('card keeps Switch module and drops Normal/Strong quick picks', () => {
    const start = panel.indexOf('isWeakScopeGuidanceCode(state.resultCode)');
    const end = panel.indexOf(') : (', start);
    const branch = panel.slice(start, end);
    expect(branch).toContain('Switch module');
    expect(branch).toContain('Continue with Weak');
    expect(branch).toContain('guide.risk');
    expect(branch).not.toContain("label: 'Normal'");
    expect(branch).not.toContain("label: 'Strong'");
  });
});
