import { describe, it, expect } from 'vitest';
import {
  manualEditContext,
  manualEditNarration,
  recordManualEdits,
  peekManualEdits,
  consumeManualEdits,
} from '../src/server/AgentV3/ManualEditTracker';

/** Phase S2 — manual IDE edit tracker: pure note builders + best-effort behaviour under VITEST. */

describe('manualEditContext (pure)', () => {
  it('returns empty string when no paths', () => {
    expect(manualEditContext([])).toBe('');
    expect(manualEditContext(null as unknown as string[])).toBe('');
  });
  it('names the files and uses singular/plural correctly', () => {
    const one = manualEditContext(['src/App.tsx']);
    expect(one).toContain('1 file in Code Studio');
    expect(one).toContain('• src/App.tsx');
    const two = manualEditContext(['a.ts', 'b.ts']);
    expect(two).toContain('2 files in Code Studio');
  });
  it('summarises the remainder past the named cap', () => {
    const many = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
    const note = manualEditContext(many);
    expect(note).toContain('25 files');
    expect(note).toContain('…and 5 more'); // 25 - 20 named
  });
  it('instructs the agent not to revert the edits', () => {
    expect(manualEditContext(['x.ts'])).toMatch(/do NOT overwrite or revert/i);
  });
});

describe('manualEditNarration (pure)', () => {
  it('pluralises and reads as a user acknowledgement', () => {
    expect(manualEditNarration(1)).toContain('1 file');
    expect(manualEditNarration(3)).toContain('3 files');
    expect(manualEditNarration(2)).toMatch(/noticed you manually edited/i);
  });
});

describe('tracker (in-memory under VITEST — no Firestore)', () => {
  it('records, peeks, then consume clears', async () => {
    const ws = 'ws-s2-a';
    await recordManualEdits(ws, ['src/a.ts', 'src/b.ts'], 1000);
    const peek = await peekManualEdits(ws);
    expect(peek.count).toBe(2);
    expect(peek.paths.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const consumed = await consumeManualEdits(ws);
    expect(consumed.count).toBe(2);
    const after = await peekManualEdits(ws);
    expect(after.count).toBe(0);
  });
  it('unions repeated records without duplicates', async () => {
    const ws = 'ws-s2-b';
    await recordManualEdits(ws, ['x.ts'], 1);
    await recordManualEdits(ws, ['x.ts', 'y.ts'], 2);
    const peek = await peekManualEdits(ws);
    expect(peek.count).toBe(2);
  });
  it('never throws on empty / missing input', async () => {
    await expect(recordManualEdits('', ['a.ts'], 1)).resolves.toBeUndefined();
    await expect(recordManualEdits('ws', [], 1)).resolves.toBeUndefined();
    await expect(peekManualEdits('nope')).resolves.toEqual({ paths: [], count: 0, at: 0 });
    await expect(consumeManualEdits('nope')).resolves.toEqual({ paths: [], count: 0, at: 0 });
  });
});
