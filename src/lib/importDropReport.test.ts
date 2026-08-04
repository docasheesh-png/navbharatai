import { describe, it, expect } from 'vitest';
import {
  totalDropped, harmlessDropped, meaningfulDropped, dropReasonPhrases, importDropSummary,
} from './importDropReport';

describe('totalDropped', () => {
  it('sums every refusal category', () => {
    expect(totalDropped({ dir: 100, binary: 20, tooLarge: 3, secret: 1 })).toBe(124);
  });

  it('is safe on absent, partial and nonsense data', () => {
    expect(totalDropped(null)).toBe(0);
    expect(totalDropped(undefined)).toBe(0);
    expect(totalDropped({})).toBe(0);
    expect(totalDropped({ dir: Number.NaN, binary: -5 })).toBe(0);
  });
});

describe('harmless vs meaningful drops', () => {
  it('treats dependency/build folders and OS junk as harmless — npm install rebuilds them', () => {
    expect(harmlessDropped({ dir: 120_000, junk: 4 })).toBe(120_004);
    expect(meaningfulDropped({ dir: 120_000, junk: 4 })).toBe(0);
  });

  it('treats the user\'s own media and oversized files as REAL losses', () => {
    expect(meaningfulDropped({ dir: 120_000, binary: 3_600, tooLarge: 12 })).toBe(3_612);
  });
});

describe('importDropSummary', () => {
  it('says nothing when nothing was refused — a clean import stays clean', () => {
    expect(importDropSummary({ kept: 42, totalEntries: 42, dropped: {} })).toBe('');
    expect(importDropSummary({ kept: 42 })).toBe('');
  });

  it('reports the admin\'s 1 GB / 4000-file case with real numbers instead of a green tick', () => {
    // The exact failure being fixed: 400 files landed, 3,600 were discarded, and the UI said
    // "✅ Imported 400 files" with no hint that anything was missing.
    const s = importDropSummary({ kept: 400, totalEntries: 4_000, dropped: { binary: 3_500, tooLarge: 100 } });
    expect(s).toContain('400');
    expect(s).toContain('4,000');
    expect(s).toContain('3,600');
    expect(s).toMatch(/image\/media/i);
    expect(s).toMatch(/too large/i);
  });

  it('does NOT claim nothing is missing when the user\'s own files were dropped', () => {
    const s = importDropSummary({ kept: 400, totalEntries: 4_000, dropped: { binary: 3_600 } });
    expect(s).not.toMatch(/nothing you need is missing/i);
  });

  it('DOES reassure when only rebuildable folders were skipped — no false alarm', () => {
    const s = importDropSummary({ kept: 380, totalEntries: 120_380, dropped: { dir: 120_000 } });
    expect(s).toMatch(/nothing you need is missing/i);
    expect(s).toMatch(/rebuilt automatically/i);
  });

  it('leads with real losses, not with a reassuring 120,000 node_modules count', () => {
    const phrases = dropReasonPhrases({ dir: 120_000, binary: 12 });
    expect(phrases[0]).toMatch(/image\/media/i);
  });

  it('explains that credential files were excluded on purpose, not lost', () => {
    expect(dropReasonPhrases({ secret: 2 }).join(' ')).toMatch(/never uploaded, by design/i);
  });

  it('falls back to kept + dropped when the archive total is unknown (the SSE path)', () => {
    // The streaming path counts events and has no central-directory total; the summary must still add up.
    expect(importDropSummary({ kept: 10, dropped: { binary: 5 } })).toContain('10 of 15');
  });

  it('uses singular wording for exactly one file', () => {
    expect(dropReasonPhrases({ tooLarge: 1 })[0]).toBe('1 file too large to import');
    expect(dropReasonPhrases({ tooLarge: 2 })[0]).toBe('2 files too large to import');
  });

  it('never contradicts itself — the stated kept + dropped equals the stated total', () => {
    const s = importDropSummary({ kept: 400, totalEntries: 4_000, dropped: { binary: 3_600 } });
    expect(s).toContain('Imported 400 of 4,000 files — 3,600 were not imported');
  });
});
