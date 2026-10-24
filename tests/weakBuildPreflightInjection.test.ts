import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEAK_SCOPE_INSTRUCTIONS, WEAK_SCOPE_TIMEOUT_MS } from '../src/server/AgentV3/weakBuildAdmission';
import { weakBuildAdmissionAsk } from '../src/server/AgentV3/weakBuildAdmissionAsk';
import { weakAdmissionForTurn } from '../src/server/AgentV3/weakBuildPreflight';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';

vi.mock('../src/server/AgentV3/weakBuildAdmissionAsk', () => ({ weakBuildAdmissionAsk: vi.fn() }));

const input = { prompt: 'Build a custom inventory app', intent: 'new_build', importing: false, tier: 'weak' };

describe('Weak preflight classifier injection', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTV3_WEAK_SCOPE_POLICY', 'on');
    vi.stubEnv('AGENTV3_GOLDEN_SCAFFOLD', 'off');
    vi.mocked(weakBuildAdmissionAsk).mockReset();
    vi.mocked(weakBuildAdmissionAsk).mockResolvedValue({ text: 'simple' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('keeps the legacy classifier as the default when no runner is injected', async () => {
    expect(await weakAdmissionForTurn(input)).toMatchObject({ scope: 'simple', source: 'model' });
    expect(weakBuildAdmissionAsk).toHaveBeenCalledExactlyOnceWith(WEAK_SCOPE_INSTRUCTIONS, input.prompt, expect.any(AbortSignal));
  });

  it('uses exactly the supplied classifier and preserves its measured usage', async () => {
    const usage = { inputTokens: 40, outputTokens: 1 };
    const ask = vi.fn().mockResolvedValue({ text: 'complex', usage });
    expect(await weakAdmissionForTurn(input, ask)).toEqual({ scope: 'complex', source: 'model', usage });
    expect(ask).toHaveBeenCalledExactlyOnceWith(WEAK_SCOPE_INSTRUCTIONS, input.prompt, expect.any(AbortSignal));
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });

  it('retains the hard deadline and aborts a stalled injected runner without fallback', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const ask = vi.fn((_system: string, _user: string, nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<never>(() => {});
    });
    const pending = weakAdmissionForTurn(input, ask);
    await vi.advanceTimersByTimeAsync(WEAK_SCOPE_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ scope: null, source: 'unavailable' });
    expect(signal?.aborted).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });

  it('fails closed on an injected classifier error without retrying or using legacy', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('session unavailable'));
    expect(await weakAdmissionForTurn(input, ask)).toEqual({ scope: null, source: 'unavailable' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });

  it.each(['simple plus explanation', '{"scope":"simple"}', ''])('keeps strict parsing for injected output %j', async (text) => {
    const ask = vi.fn().mockResolvedValue({ text });
    expect(await weakAdmissionForTurn(input, ask)).toMatchObject({ scope: null, source: 'unavailable' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });

  it.each([{ tier: 'off' }, { tier: 'mini' }, { intent: 'chat' }, { importing: true }])('does not classify excluded turn %j', async (patch) => {
    const ask = vi.fn();
    expect(await weakAdmissionForTurn({ ...input, ...patch }, ask)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });

  it('leaves the disabled scope-policy path unchanged', async () => {
    vi.stubEnv('AGENTV3_WEAK_SCOPE_POLICY', 'off');
    const ask = vi.fn();
    expect(await weakAdmissionForTurn(input, ask)).toBeNull();
    expect(await weakAdmissionForTurn(input)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });

  it('does not buy an injected classifier call for an exact tested template', async () => {
    vi.stubEnv('AGENTV3_GOLDEN_SCAFFOLD', 'on');
    const prompt = STARTER_TEMPLATES.find(template => template.id === 'todo')!.prompt;
    const ask = vi.fn();
    expect(await weakAdmissionForTurn({ ...input, prompt }, ask)).toEqual({ scope: 'simple', source: 'template' });
    expect(ask).not.toHaveBeenCalled();
    expect(weakBuildAdmissionAsk).not.toHaveBeenCalled();
  });
});
