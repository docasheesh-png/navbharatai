import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveLastReport, readLastReport } from './reportCache';

// A minimal localStorage stub (vitest runs in node — no DOM).
function stubStorage(opts: { failFirstSet?: boolean } = {}) {
  const store = new Map<string, string>();
  let failed = false;
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failFirstSet && !failed) { failed = true; throw new Error('QuotaExceededError'); }
      store.set(k, v);
    },
    removeItem: (k: string) => { store.delete(k); },
    _store: store,
  };
}

describe('reportCache — device-local last-resort build report (never "No build report" again)', () => {
  const orig = (globalThis as Record<string, unknown>).localStorage;
  afterEach(() => { (globalThis as Record<string, unknown>).localStorage = orig; });
  beforeEach(() => { (globalThis as Record<string, unknown>).localStorage = stubStorage(); });

  it('round-trips the last report', () => {
    const report = { schema: 'navbharatai.v3.build-diagnostics/1', ok: true, counts: { total: 3 } };
    saveLastReport(report);
    expect(readLastReport()).toEqual(report);
  });

  it('QUOTA-SAFE: when the full report is too big, a SLIM copy (heavy sections dropped) is stored', () => {
    (globalThis as Record<string, unknown>).localStorage = stubStorage({ failFirstSet: true });
    const report = { ok: true, commands: [{ stdout: 'x'.repeat(10) }], llmCalls: [{}], generatedFiles: [{}], issues: [] };
    saveLastReport(report);
    const cached = readLastReport() as Record<string, unknown>;
    expect(cached).not.toBeNull();
    expect(cached.commands).toBeUndefined(); // heavy sections dropped…
    expect(cached.issues).toEqual([]);       // …the report itself survives
    expect(String(cached._slimmed)).toMatch(/dropped/); // honestly marked
  });

  it('never throws without localStorage (SSR/node) and returns null', () => {
    (globalThis as Record<string, unknown>).localStorage = undefined;
    expect(() => saveLastReport({ ok: true })).not.toThrow();
    expect(readLastReport()).toBeNull();
  });

  it('ignores non-object payloads and corrupt stored JSON', () => {
    saveLastReport('not-an-object');
    expect(readLastReport()).toBeNull();
    ((globalThis as unknown) as { localStorage: ReturnType<typeof stubStorage> }).localStorage._store.set('nbv3:last-build-report', '{corrupt');
    expect(readLastReport()).toBeNull(); // corrupt JSON → null, never a throw
  });
});
