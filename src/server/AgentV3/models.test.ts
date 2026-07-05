import { describe, it, expect, afterEach } from 'vitest';
import { resolveModel, sonnetModel, opusModel, haikuModel, fastBuildModel, opusNormalModel, ladderModel, modelSupportsAdaptiveThinking } from './models';
import { architectSystemPrompt } from './systemPrompt';

describe('model resolution (D5/D6)', () => {
  const prevS = process.env.AGENTV3_SONNET_MODEL;
  const prevO = process.env.AGENTV3_OPUS_MODEL;
  afterEach(() => {
    if (prevS === undefined) delete process.env.AGENTV3_SONNET_MODEL;
    else process.env.AGENTV3_SONNET_MODEL = prevS;
    if (prevO === undefined) delete process.env.AGENTV3_OPUS_MODEL;
    else process.env.AGENTV3_OPUS_MODEL = prevO;
  });

  it('standard mode resolves to Sonnet, only-opus resolves to Opus', () => {
    expect(resolveModel(false)).toBe(sonnetModel());
    expect(resolveModel(true)).toBe(opusModel());
    expect(resolveModel(false)).not.toBe(resolveModel(true));
  });

  it('honours env overrides', () => {
    process.env.AGENTV3_SONNET_MODEL = 'sonnet-x';
    process.env.AGENTV3_OPUS_MODEL = 'opus-y';
    expect(resolveModel(false)).toBe('sonnet-x');
    expect(resolveModel(true)).toBe('opus-y');
  });

  it('exposes the full ladder: haiku < sonnet < opus-4.7 (normal) and opus-4.8 (power)', () => {
    // Normal-mode escalation ceiling is Opus 4.7; power / only-opus is Opus 4.8.
    expect(opusNormalModel()).not.toBe(opusModel());
    expect(haikuModel()).toBeTruthy();
    expect(ladderModel('haiku')).toBe(haikuModel());
    expect(ladderModel('sonnet')).toBe(sonnetModel());
    expect(ladderModel('opus')).toBe(opusNormalModel());
  });

  it('the fast-lane build model defaults to Sonnet (consistency across per-file calls), env-overridable', () => {
    expect(fastBuildModel()).toBe(sonnetModel());
    const prevF = process.env.AGENTV3_FAST_BUILD_MODEL;
    process.env.AGENTV3_FAST_BUILD_MODEL = 'fast-x';
    expect(fastBuildModel()).toBe('fast-x');
    if (prevF === undefined) delete process.env.AGENTV3_FAST_BUILD_MODEL; else process.env.AGENTV3_FAST_BUILD_MODEL = prevF;
  });

  it('the ladder honours env overrides for haiku and normal-opus', () => {
    const prevH = process.env.AGENTV3_HAIKU_MODEL;
    const prevON = process.env.AGENTV3_OPUS_NORMAL_MODEL;
    process.env.AGENTV3_HAIKU_MODEL = 'haiku-x';
    process.env.AGENTV3_OPUS_NORMAL_MODEL = 'opus47-x';
    expect(ladderModel('haiku')).toBe('haiku-x');
    expect(ladderModel('opus')).toBe('opus47-x');
    if (prevH === undefined) delete process.env.AGENTV3_HAIKU_MODEL; else process.env.AGENTV3_HAIKU_MODEL = prevH;
    if (prevON === undefined) delete process.env.AGENTV3_OPUS_NORMAL_MODEL; else process.env.AGENTV3_OPUS_NORMAL_MODEL = prevON;
  });
});

describe('architect system prompt', () => {
  it('is conversational, forbids fake completion, and explains the tool workflow', () => {
    const p = architectSystemPrompt();
    const lower = p.toLowerCase();
    // Conversational (replies to greetings, talks before building).
    expect(lower).toContain('hello');
    expect(lower).toContain('reply');
    // Still builds for real with tools, no fake success.
    expect(lower).toContain('no fake success');
    expect(p).toContain('update_todo');
    expect(p).toContain('write_file');
  });
});

describe('modelSupportsAdaptiveThinking (build-report 400 guard)', () => {
  it('DENIES Haiku (the exact model that 400d on adaptive thinking)', () => {
    expect(modelSupportsAdaptiveThinking('claude-haiku-4-5-20251001')).toBe(false);
    expect(modelSupportsAdaptiveThinking('claude-haiku-4-5')).toBe(false);
  });
  it('ALLOWS Opus 4.x and Sonnet 4.6+', () => {
    expect(modelSupportsAdaptiveThinking('claude-opus-4-8')).toBe(true);
    expect(modelSupportsAdaptiveThinking('claude-opus-4-7')).toBe(true);
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true);
  });
  it('DENIES older Sonnet (< 4.6) and unknown / empty ids (default-deny → never a 400)', () => {
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-5')).toBe(false);
    expect(modelSupportsAdaptiveThinking('claude-3-5-sonnet')).toBe(false);
    expect(modelSupportsAdaptiveThinking('some-future-model')).toBe(false);
    expect(modelSupportsAdaptiveThinking(undefined)).toBe(false);
    expect(modelSupportsAdaptiveThinking('')).toBe(false);
  });
});
