/**
 * Autopsy f04421ef, part 4 — "GLM: 0 turns" must be readable.
 *
 * The report showed `providerDelivery: { KIMI: 54 }`, no GLM row and no GLM failure. That is equally
 * consistent with GLM sitting in the chain and never being reached (fine) and with GLM not being in the
 * chain at all (a provider we believe leads our builds not running). The existing CHEAP_FLOOR_DECISION
 * line cannot separate them — with the floor set to `on` its key check is an OR, so it reports
 * "ACTIVE — ON leads" when only one of the two keys exists.
 */
import { describe, it, expect } from 'vitest';
import { describeRunnerChain, chainProviders, unreachedProvidersNote } from '../src/server/AgentV3/runnerChainSummary';
import { BuildDiagnostics, renderDiagnosticsText, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';

describe('describeRunnerChain', () => {
  it('names every rung in order, with the model each one calls', () => {
    expect(describeRunnerChain([
      { name: 'GLM', modelId: 'glm-5.2' },
      { name: 'KIMI', modelId: 'kimi-k3' },
      { name: 'CLAUDE' },
    ])).toBe('GLM(glm-5.2) → KIMI(kimi-k3) → CLAUDE');
  });

  it('keeps key-pool rungs distinct — three keys tried is not one attempt', () => {
    const text = describeRunnerChain([
      { name: 'GLM', modelId: 'glm-5.2' },
      { name: 'GLM#2', modelId: 'glm-5.2', reportAs: 'GLM' },
      { name: 'GLM#3', modelId: 'glm-5.2', reportAs: 'GLM' },
    ]);
    expect(text).toBe('GLM(glm-5.2) → GLM#2(glm-5.2) → GLM#3(glm-5.2)');
  });

  it('an EMPTY chain says so rather than rendering a blank', () => {
    expect(describeRunnerChain([])).toBe('no providers in the chain');
    expect(describeRunnerChain([{ name: '  ' }])).toBe('no providers in the chain');
  });

  it('a very long pool truncates instead of being dropped by the timeline cap', () => {
    const chain = Array.from({ length: 30 }, (_, i) => ({ name: `GLM#${i + 1}`, modelId: 'glm-5.2' }));
    const text = describeRunnerChain(chain, 5);
    expect(text).toMatch(/… and 25 more$/);
  });
});

describe('chainProviders — the families that line up against providerDelivery', () => {
  it('collapses pool rungs to the name the report records', () => {
    expect(chainProviders([
      { name: 'GLM', modelId: 'glm-5.2' },
      { name: 'GLM#2', modelId: 'glm-4.7', reportAs: 'GLM' },
      { name: 'KIMI', modelId: 'kimi-k3' },
      { name: 'CLAUDE_HAIKU' },
    ])).toEqual(['GLM', 'KIMI', 'CLAUDE_HAIKU']);
  });
});

describe('unreachedProvidersNote — the sentence that makes a zero readable', () => {
  it('THE CASE FROM THE REPORT: GLM in the chain, Kimi delivered everything', () => {
    const note = unreachedProvidersNote(['GLM', 'KIMI', 'CLAUDE_HAIKU'], { KIMI: 54 });
    expect(note).toMatch(/never reached this build: GLM, CLAUDE_HAIKU/);
    // And the distinction that was missing must be stated outright.
    expect(note).toMatch(/ABSENT from the chain/);
  });

  it('says nothing when every configured provider actually ran', () => {
    expect(unreachedProvidersNote(['GLM', 'KIMI'], { GLM: 10, KIMI: 44 })).toBeNull();
  });

  it('a provider recorded with zero turns counts as unreached, not as run', () => {
    expect(unreachedProvidersNote(['GLM', 'KIMI'], { GLM: 0, KIMI: 44 })).toMatch(/never reached this build: GLM/);
  });

  it('no chain recorded → no claim made', () => {
    expect(unreachedProvidersNote([], { KIMI: 54 })).toBeNull();
  });
});

describe('the report carries it', () => {
  it('prints the chain and the idle note under the provider table', () => {
    const d = new BuildDiagnostics();
    d.setProviderChain('GLM(glm-5.2) → KIMI(kimi-k3) → CLAUDE_HAIKU', ['GLM', 'KIMI', 'CLAUDE_HAIKU']);
    for (let i = 0; i < 54; i++) d.recordProviderTurn('KIMI');
    const text = renderDiagnosticsText(d.report());
    expect(text).toMatch(/Chain\s*: GLM\(glm-5\.2\) → KIMI\(kimi-k3\) → CLAUDE_HAIKU/);
    expect(text).toMatch(/never reached this build: GLM, CLAUDE_HAIKU/);
  });

  it('a blank chain records nothing rather than an empty line', () => {
    const d = new BuildDiagnostics();
    d.setProviderChain('   ');
    expect(d.report().providerChain).toBeUndefined();
  });

  it('White-Label Law: the chain never reaches a user-facing report', () => {
    const d = new BuildDiagnostics();
    d.setProviderChain('GLM(glm-5.2) → KIMI(kimi-k3)', ['GLM', 'KIMI']);
    const out = userFacingReport(d.report()) as Record<string, unknown>;
    expect(out.providerChain).toBeUndefined();
    expect(out.providerChainNames).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/GLM|KIMI|glm-5\.2/);
  });
});
