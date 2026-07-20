import { describe, it, expect } from 'vitest';
import { analyzeCodeSmells, renderCodeSmells } from './CodeSmellAnalyzer';

describe('analyzeCodeSmells — magic numbers', () => {
  it('flags a magic number but allows indices, HTTP codes and common constants', () => {
    const files = [{ path: 'a.ts', content: [
      'setTimeout(fn, 5000);',        // 5000 → magic
      'res.status(404).json({});',    // 404 → allowed
      'const x = arr[0];',            // 0 → allowed
      'for (let i = 1; i < 2; i++) {}', // 1,2 → allowed
    ].join('\n') }];
    const r = analyzeCodeSmells(files);
    expect(r.magicNumbers.some((m) => m.detail.includes('5000'))).toBe(true);
    expect(r.magicNumbers.some((m) => m.detail.includes('404'))).toBe(false);
    expect(r.magicNumbers.some((m) => m.detail.includes(' 0 ') || m.detail.endsWith('0'))).toBe(false);
  });

  it('ignores numbers inside comments and identifiers/versions', () => {
    const files = [{ path: 'b.ts', content: [
      '// magic 9999 in a comment is ignored',
      'const v2 = loadV2();',   // v2 → part of identifier, not a number
      'const big = 987654;',    // magic
    ].join('\n') }];
    const r = analyzeCodeSmells(files);
    expect(r.magicNumbers.some((m) => m.detail.includes('9999'))).toBe(false);
    expect(r.magicNumbers.some((m) => m.detail.includes('987654'))).toBe(true);
    expect(r.magicNumbers.every((m) => !m.detail.includes(' 2 '))).toBe(true);
  });
});

describe('analyzeCodeSmells — duplicate blocks', () => {
  it('detects a run of identical non-trivial lines repeated across files', () => {
    const block = [
      'const total = items.reduce((a, b) => a + b.price, 0);',
      'const tax = total * taxRate;',
      'const shipping = computeShipping(items);',
      'const grand = total + tax + shipping;',
      'logger.info({ total, tax, shipping, grand });',
      'return { total, tax, shipping, grand };',
    ].join('\n');
    const files = [
      { path: 'cartA.ts', content: 'function a() {\n' + block + '\n}' },
      { path: 'cartB.ts', content: 'function b() {\n' + block + '\n}' },
    ];
    const r = analyzeCodeSmells(files);
    expect(r.duplicates.length).toBeGreaterThan(0);
    expect(r.duplicates[0].detail).toContain('cartA.ts');
  });

  it('does NOT flag short or trivial repetition', () => {
    const files = [
      { path: 'x.ts', content: 'const a = 3;\nconst b = 4;' },
      { path: 'y.ts', content: 'const a = 3;\nconst b = 4;' },
    ];
    expect(analyzeCodeSmells(files).duplicates).toEqual([]);
  });
});

describe('renderCodeSmells', () => {
  it('says so when clean, and lists findings otherwise', () => {
    expect(renderCodeSmells({ magicNumbers: [], duplicates: [] })).toContain('No magic numbers or duplicate');
    const out = renderCodeSmells({ magicNumbers: [{ file: 'a.ts', line: 3, detail: 'magic number 5000' }], duplicates: [] });
    expect(out).toContain('a.ts:3');
    expect(out).toContain('Advisory only');
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error — malformed input must not throw
    expect(() => analyzeCodeSmells(null)).not.toThrow();
    expect(() => analyzeCodeSmells([{ path: 'a', content: undefined as unknown as string }])).not.toThrow();
  });
});
