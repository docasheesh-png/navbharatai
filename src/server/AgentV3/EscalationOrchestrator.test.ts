import { describe, it, expect, vi } from 'vitest';
import { runWithEscalation, type EscalationDeps } from './EscalationOrchestrator';
import type { StartTier } from './RequestAnalyser';

const PATH: StartTier[] = ['gemini', 'haiku', 'sonnet', 'opus'];

function deps<T>(over: Partial<EscalationDeps<T>>): EscalationDeps<T> {
  return {
    buildOnTier: vi.fn(),
    gate: vi.fn(),
    ...over,
  } as EscalationDeps<T>;
}

describe('runWithEscalation', () => {
  it('delivers the cheapest tier when its gate passes — no escalation', async () => {
    const buildOnTier = vi.fn().mockResolvedValue({ app: 'calculator' });
    const gate = vi.fn().mockResolvedValue({ pass: true, score: 95 });
    const res = await runWithEscalation(PATH, { buildOnTier, gate });
    expect(res.tier).toBe('gemini');
    expect(res.gatePassed).toBe(true);
    expect(res.escalations).toBe(0);
    expect(res.attemptedTiers).toEqual(['gemini']);
    expect(buildOnTier).toHaveBeenCalledTimes(1);
  });

  it('escalates when the cheap tier fails the gate, then delivers the first passing tier', async () => {
    const buildOnTier = vi.fn()
      .mockResolvedValueOnce({ v: 'gemini-broken' })
      .mockResolvedValueOnce({ v: 'haiku-ok' });
    const gate = vi.fn()
      .mockResolvedValueOnce({ pass: false, reason: 'build failed' })
      .mockResolvedValueOnce({ pass: true, score: 88 });
    const onEscalate = vi.fn();
    const res = await runWithEscalation(PATH, { buildOnTier, gate, onEscalate });
    expect(res.tier).toBe('haiku');
    expect(res.gatePassed).toBe(true);
    expect(res.escalations).toBe(1);
    expect(res.attemptedTiers).toEqual(['gemini', 'haiku']);
    expect(onEscalate).toHaveBeenCalledWith('gemini', 'haiku', 'build failed');
  });

  it('treats a thrown build error as a fail and escalates', async () => {
    const buildOnTier = vi.fn()
      .mockRejectedValueOnce(new Error('gemini 503'))
      .mockResolvedValueOnce({ v: 'haiku-ok' });
    const gate = vi.fn().mockResolvedValue({ pass: true });
    const onEscalate = vi.fn();
    const res = await runWithEscalation(PATH, { buildOnTier, gate, onEscalate });
    expect(res.tier).toBe('haiku');
    expect(onEscalate).toHaveBeenCalledWith('gemini', 'haiku', expect.stringContaining('gemini 503'));
  });

  it('delivers the LAST tier (Opus) as best-effort backstop when every gate fails — never breaks', async () => {
    const buildOnTier = vi.fn().mockImplementation((tier: StartTier) => Promise.resolve({ tier }));
    const gate = vi.fn().mockResolvedValue({ pass: false, reason: 'still not ready' });
    const res = await runWithEscalation(PATH, { buildOnTier, gate });
    expect(res.tier).toBe('opus');
    expect(res.gatePassed).toBe(false);
    expect(res.build).toEqual({ tier: 'opus' });
    expect(res.escalations).toBe(3);
    expect(res.attemptedTiers).toEqual(['gemini', 'haiku', 'sonnet', 'opus']);
  });

  it('respects maxTiers (escalation budget)', async () => {
    const buildOnTier = vi.fn().mockImplementation((tier: StartTier) => Promise.resolve({ tier }));
    const gate = vi.fn().mockResolvedValue({ pass: false });
    const res = await runWithEscalation(PATH, { buildOnTier, gate }, { maxTiers: 2 });
    // Only gemini + haiku tried; haiku is the (capped) last → best-effort backstop.
    expect(res.attemptedTiers).toEqual(['gemini', 'haiku']);
    expect(res.tier).toBe('haiku');
    expect(res.gatePassed).toBe(false);
  });

  it('does not block delivery if the gate itself throws (build already succeeded)', async () => {
    const buildOnTier = vi.fn().mockResolvedValue({ app: 'x' });
    const gate = vi.fn().mockRejectedValue(new Error('evaluate crashed'));
    const res = await runWithEscalation(PATH, { buildOnTier, gate });
    expect(res.tier).toBe('gemini');
    expect(res.gatePassed).toBe(true);
    expect(res.gate.reason).toContain('gate-error');
  });

  it('throws if the path is empty, and if the only/last tier build throws', async () => {
    await expect(runWithEscalation([], { buildOnTier: vi.fn(), gate: vi.fn() })).rejects.toThrow(/at least one tier/);
    const buildOnTier = vi.fn().mockRejectedValue(new Error('opus down'));
    await expect(runWithEscalation(['opus'], { buildOnTier, gate: vi.fn() })).rejects.toThrow(/opus down/);
  });
});
