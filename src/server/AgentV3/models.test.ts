import { describe, it, expect, afterEach } from 'vitest';
import { resolveModel, sonnetModel, opusModel } from './models';
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
