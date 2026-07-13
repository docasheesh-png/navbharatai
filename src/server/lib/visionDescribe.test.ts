import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Anthropic SDK so we can assert whether Claude vision was EVER attempted, without a network
// call. describeWithClaude does `await import('@anthropic-ai/sdk')` → this default export is what it gets.
const anthropicCtor = vi.fn();
const messagesCreate = vi.fn(async () => ({ content: [{ type: 'text', text: 'a described image' }] }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: messagesCreate };
    constructor(...args: unknown[]) { anthropicCtor(...args); }
  },
}));

import { describeVisionAttachments } from './visionDescribe';
import { runInNoClaudeZone } from '../AgentV3/noClaudeZone';

const IMG = { type: 'image/png', name: 'shot.png', base64: 'aGVsbG8=' } as any;

describe('describeVisionAttachments — weak-module no-Claude guard', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    anthropicCtor.mockClear();
    messagesCreate.mockClear();
    // No cheap vision providers → the only remaining rung would be Claude. ANTHROPIC key present so a
    // leak WOULD happen if the guard were absent.
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });
  afterEach(() => { process.env = { ...saved }; });

  it('never touches Claude when noClaude:true (returns the honest "could not be read" placeholder)', async () => {
    const out = await describeVisionAttachments([IMG], { noClaude: true });
    expect(anthropicCtor).not.toHaveBeenCalled();
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(out).toContain('could not be read');
  });

  it('never touches Claude inside an active no-Claude zone (in-zone caller)', async () => {
    const out = await runInNoClaudeZone({ active: true }, () => describeVisionAttachments([IMG]));
    expect(anthropicCtor).not.toHaveBeenCalled();
    expect(out).toContain('could not be read');
  });

  it('DOES fall back to Claude by default (paid/normal build, cheap providers unavailable)', async () => {
    const out = await describeVisionAttachments([IMG]);
    expect(anthropicCtor).toHaveBeenCalledTimes(1);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
    expect(out).toContain('a described image');
  });

  it('returns "" for no attachments (no provider touched)', async () => {
    const out = await describeVisionAttachments([], { noClaude: true });
    expect(out).toBe('');
    expect(anthropicCtor).not.toHaveBeenCalled();
  });
});
