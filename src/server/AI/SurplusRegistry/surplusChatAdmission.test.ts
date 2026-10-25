import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  safe: vi.fn((r: string) => r),
}));
vi.mock('./admitOrFallback', () => ({
  resolveProBuildSurplusAdmission: mocks.resolve,
  safeSurplusAdmissionReason: mocks.safe,
}));

import { runWeakSurplusAdmissionForChat, recordSurplusAdmissionDiag } from './surplusChatAdmission';

describe('runWeakSurplusAdmissionForChat (Weak-only, chat-handler budget)', () => {
  it('skips Normal/Strong and plain chat without calling admission', async () => {
    const audit = vi.fn();
    for (const powerLevel of ['off', 'mini'] as const) {
      mocks.resolve.mockClear();
      const gate = await runWeakSurplusAdmissionForChat({
        powerLevel, intent: 'build', hasImportIntent: false, prompt: 'hi', buildId: 'b',
        tierEngineAvailable: () => true, audit,
      });
      expect(gate).toEqual({ ok: true, session: undefined, diag: undefined });
      expect(mocks.resolve).not.toHaveBeenCalled();
    }
    mocks.resolve.mockClear();
    const plain = await runWeakSurplusAdmissionForChat({
      powerLevel: 'weak', intent: 'chat', hasImportIntent: false, prompt: 'hi', buildId: 'b',
      tierEngineAvailable: () => true, audit,
    });
    expect(plain).toEqual({ ok: true, session: undefined, diag: undefined });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('admits on Weak build and surfaces SURPLUS_ADMITTED diag', async () => {
    const session = { model: 'model-a' } as never;
    mocks.resolve.mockImplementation(async (opts: { onAdmitted?: (s: unknown) => void }) => {
      opts.onAdmitted?.(session);
      return { ok: true, session };
    });
    const audit = vi.fn();
    const gate = await runWeakSurplusAdmissionForChat({
      powerLevel: 'weak', intent: 'build', hasImportIntent: false, prompt: 'Build X', buildId: 'b1',
      tierEngineAvailable: () => true, audit,
    });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.session).toBe(session);
    expect(gate.diag).toEqual({ code: 'SURPLUS_ADMITTED', model: 'model-a' });
    expect(audit).toHaveBeenCalledWith('AGENTV3_SURPLUS_ADMITTED', { model: 'model-a' }, 'info');
  });

  it('fail-opens with SURPLUS_FALLBACK diag when admission falls back', async () => {
    mocks.resolve.mockImplementation(async (opts: { onFallback?: (r: string) => void }) => {
      opts.onFallback?.('stale_or_missing_snapshot');
      return { ok: true, session: undefined };
    });
    mocks.safe.mockReturnValue('stale_or_missing_snapshot');
    const audit = vi.fn();
    const gate = await runWeakSurplusAdmissionForChat({
      powerLevel: 'weak', intent: 'build', hasImportIntent: false, prompt: 'Build X', buildId: 'b2',
      tierEngineAvailable: () => true, audit,
    });
    expect(gate).toMatchObject({ ok: true, session: undefined, diag: { code: 'SURPLUS_FALLBACK', reason: 'stale_or_missing_snapshot' } });
  });
});

describe('recordSurplusAdmissionDiag', () => {
  it('no-ops when diag is absent', () => {
    const record = vi.fn();
    recordSurplusAdmissionDiag({ record }, undefined);
    expect(record).not.toHaveBeenCalled();
  });

  it('records admitted and fallback codes', () => {
    const record = vi.fn();
    recordSurplusAdmissionDiag({ record }, { code: 'SURPLUS_ADMITTED', model: 'm1' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ code: 'SURPLUS_ADMITTED', severity: 'info' }));
    record.mockClear();
    recordSurplusAdmissionDiag({ record }, { code: 'SURPLUS_FALLBACK', reason: 'flag_off' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ code: 'SURPLUS_FALLBACK', severity: 'warning', detail: 'flag_off' }));
  });
});
