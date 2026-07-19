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

  it('describes multiple attachments CONCURRENTLY and preserves input order (perf audit 2026-07-18)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    // BARRIER (not a fixed sleep) so concurrency is observed DETERMINISTICALLY — the old 15ms window
    // was a race: on a loaded CI runner the first mock could resolve before the others were dispatched,
    // giving maxInFlight=1 and a flaky failure. Now each call blocks until at least 2 are simultaneously
    // in flight (proving real overlap) or a 2s cap elapses. If the fan-out is genuinely concurrent this
    // releases immediately; if it were sequential (a real regression) no 2nd call ever arrives, the cap
    // trips, and maxInFlight stays 1 → the test still fails, correctly.
    messagesCreate.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const start = Date.now();
      while (inFlight < 2 && Date.now() - start < 2000) {
        await new Promise((r) => setTimeout(r, 5));
      }
      inFlight--;
      return { content: [{ type: 'text', text: 'desc' }] };
    });
    try {
      const imgs = [
        { type: 'image/png', name: 'a.png', base64: 'x' },
        { type: 'image/png', name: 'b.png', base64: 'y' },
        { type: 'application/pdf', name: 'c.pdf', base64: 'z' },
      ] as any[];
      const out = await describeVisionAttachments(imgs); // default chain → Claude (no cheap keys set)
      // Order preserved (Promise.all keeps input order → byte-identical layout to the old loop).
      expect(out.indexOf('a.png')).toBeLessThan(out.indexOf('b.png'));
      expect(out.indexOf('b.png')).toBeLessThan(out.indexOf('c.pdf'));
      // All three overlapped → the fan-out really is concurrent, not N sequential round-trips.
      expect(maxInFlight).toBeGreaterThan(1);
    } finally {
      messagesCreate.mockImplementation(async () => ({ content: [{ type: 'text', text: 'a described image' }] }));
    }
  });
});
