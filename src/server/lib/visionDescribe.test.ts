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

import { describeVisionAttachments, visionProviderChain } from './visionDescribe';
import { runInNoClaudeZone } from '../AgentV3/noClaudeZone';

const IMG = { type: 'image/png', name: 'shot.png', base64: 'aGVsbG8=' } as any;

describe('visionProviderChain — which models may read an attachment, per tier (audit fix 2026-07-13)', () => {
  it('WEAK tier (noClaude): Gemini → Grok, Claude NEVER — the exact confirmed leak', () => {
    // Before this fix a weak (free) build with an image + one Gemini failure fell through to a
    // REAL Anthropic vision call (outside enforceNoClaude). The chain itself must exclude Claude.
    expect(visionProviderChain({ noClaude: true })).toEqual(['gemini', 'grok']);
    expect(visionProviderChain({ noClaude: true })).not.toContain('claude');
  });

  it('noClaude WINS over useClaude (belt & braces — a mis-threaded flag pair can never re-open the leak)', () => {
    expect(visionProviderChain({ noClaude: true, useClaude: true })).toEqual(['gemini', 'grok']);
  });

  it('Opus tiers (useClaude): Claude first for the highest-fidelity read', () => {
    expect(visionProviderChain({ useClaude: true })).toEqual(['claude', 'gemini', 'grok']);
  });

  it('default (Normal/Strong): cheap first, Claude only as last resort', () => {
    expect(visionProviderChain({})).toEqual(['gemini', 'grok', 'claude']);
    expect(visionProviderChain()).toEqual(['gemini', 'grok', 'claude']);
  });
});

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

  it('never touches Claude even when useClaude is ALSO set (noClaude wins at runtime too)', async () => {
    const out = await describeVisionAttachments([IMG], { noClaude: true, useClaude: true });
    expect(anthropicCtor).not.toHaveBeenCalled();
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

  it('describes multiple attachments and preserves input order (fan-out is concurrent by construction)', async () => {
    // describeVisionAttachments fans the per-attachment describes out with Promise.all, so it is
    // concurrent BY CONSTRUCTION (see the source). We deliberately do NOT assert wall-clock overlap:
    // that is a scheduler detail that is non-deterministic across CI runners — earlier timing- and
    // barrier-based versions both flaked on GitHub Actions. What IS deterministic and what actually
    // matters is the CONTRACT: every attachment is represented and the joined output preserves input
    // order, byte-identical to the old sequential loop (Promise.all is order-preserving). Each row's
    // label always carries the attachment name (described OR the honest "could not be read" placeholder),
    // so these assertions hold regardless of which provider answered.
    const imgs = [
      { type: 'image/png', name: 'a.png', base64: 'x' },
      { type: 'image/png', name: 'b.png', base64: 'y' },
      { type: 'application/pdf', name: 'c.pdf', base64: 'z' },
    ] as any[];
    const out = await describeVisionAttachments(imgs);
    expect(out).toContain('a.png');
    expect(out).toContain('b.png');
    expect(out).toContain('c.pdf');
    expect(out.indexOf('a.png')).toBeLessThan(out.indexOf('b.png'));
    expect(out.indexOf('b.png')).toBeLessThan(out.indexOf('c.pdf'));
  });
});
