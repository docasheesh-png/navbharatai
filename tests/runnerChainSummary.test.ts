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

  // ⚠️ THIS ASSERTION CHANGED SHAPE ON 2026-09-17, AND THE CONTRACT IT PROTECTS DID NOT.
  //
  // It used to demand each pool key as its own rung: `GLM → GLM#2 → GLM#3`. The INTENT was that
  // "three keys were tried" must not be hidden — and that is still asserted below, by the count.
  // What changed is that listing them individually stopped working at the scale production actually
  // runs: with ~104 GLM keys configured, a real chain line ENDED inside the pool ("…and 80 more") and
  // KIMI and CLAUDE_HAIKU, which were in the chain, could not be seen at all. That is this module's
  // OWN question — "was the rung there, or never there?" — failing on its own line (autopsy 2b0a3ed5).
  //
  // So the count is the contract, not the spelling of it. A run collapses; the number survives.
  it('a key pool reports HOW MANY keys were tried, not one merged attempt', () => {
    const text = describeRunnerChain([
      { name: 'GLM', modelId: 'glm-5.2' },
      { name: 'GLM#2', modelId: 'glm-5.2', reportAs: 'GLM' },
      { name: 'GLM#3', modelId: 'glm-5.2', reportAs: 'GLM' },
    ]);
    expect(text).toBe('GLM(glm-5.2) ×3');
    expect(text).toContain('3'); // three keys tried is still legible as three
  });

  it('🔴 a big key pool no longer hides the rest of the ladder', () => {
    // The reported chain: 104 GLM keys, then KIMI, then Haiku. Before the collapse this line stopped
    // at GLM#24 and the admin could not tell whether KIMI was even in the chain.
    const pool = Array.from({ length: 104 }, (_, i) => ({
      name: i === 0 ? 'GLM' : `GLM#${i + 1}`, modelId: 'glm-4.7-flashx', reportAs: 'GLM',
    }));
    const text = describeRunnerChain([
      ...pool,
      { name: 'KIMI', modelId: 'kimi-k2.7-code' },
      { name: 'GLM#105', modelId: 'glm-5.3', reportAs: 'GLM' },
      { name: 'CLAUDE_HAIKU' },
    ]);
    expect(text).toBe('GLM(glm-4.7-flashx) ×104 → KIMI(kimi-k2.7-code) → GLM(glm-5.3) → CLAUDE_HAIKU');
    expect(text).not.toContain('and 80 more');
  });

  it('only CONSECUTIVE identical rungs collapse — a later return to the same engine still shows', () => {
    // The weak ladder really does visit GLM twice on different models. Collapsing by family alone
    // would erase the second visit and report a three-rung ladder as two.
    expect(describeRunnerChain([
      { name: 'GLM', modelId: 'glm-4.7-flashx' },
      { name: 'KIMI', modelId: 'kimi-k2.7-code' },
      { name: 'GLM', modelId: 'glm-5.3' },
    ])).toBe('GLM(glm-4.7-flashx) → KIMI(kimi-k2.7-code) → GLM(glm-5.3)');
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
