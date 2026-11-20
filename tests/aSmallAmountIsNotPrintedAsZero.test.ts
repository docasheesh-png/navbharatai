/**
 * Q-2747 (autopsy 05eb30ba): MARKUP_WAIVED printed "$0.0000 instead of $0.0000" — two different, non-zero
 * amounts, both under $0.00005, rounded to the same zero by `toFixed(4)`. The class is every report line that
 * printed a USD amount with a fixed four decimals; they now all use `usdAmount`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { usdAmount } from '../src/server/lib/usdAmount';
import { decideMarkupOnProof } from '../src/server/AgentV3/previewEarnsMarkup';

describe('a small amount is never printed as zero', () => {
  it('the reported case: two sub-cent amounts read as two different numbers', () => {
    const d = decideMarkupOnProof({ decidedBilledUsd: 0.000041, realCostUsd: 0.000016, sandboxUsd: 0, previewProven: false, expectsArtifacts: true });
    expect(d.markupApplied).toBe(false);
    expect(d.reason).toContain('($0.000016 instead of $0.000041)');
    expect(d.reason).not.toContain('$0.0000 ');
  });

  it('ordinary amounts keep exactly four decimals, as before', () => {
    expect(usdAmount(0.4188)).toBe('0.4188');
    expect(usdAmount(0.1047)).toBe('0.1047');
    expect(usdAmount(12.5)).toBe('12.5000');
    expect(usdAmount(0.0001)).toBe('0.0001');
  });

  it('boundaries: zero, tiny, negative, not-a-number; never exponent notation', () => {
    expect(usdAmount(0)).toBe('0.0000');
    expect(usdAmount(0.000099)).toBe('0.000099');
    expect(usdAmount(0.00005)).toBe('0.00005');
    expect(usdAmount(3.7e-7)).toBe('0.00000037');
    expect(usdAmount(-0.00002)).toBe('-0.00002');
    expect(usdAmount(Number.NaN)).toBe('0.0000');
    for (const v of [1e-9, 2.5e-11, 9.99e-5]) expect(usdAmount(v)).not.toMatch(/e/i);
    for (const v of [1e-9, 2.5e-11, 9.99e-5, 0.00003]) expect(Number(usdAmount(v))).toBeGreaterThan(0);
  });

  it('census: no server report line prints a dollar amount with a fixed toFixed(4) again', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
        const src = readFileSync(p, 'latin1');
        if (/\$\$\{[^{}`]*\.toFixed\(4\)\}/.test(src)) offenders.push(p);
      }
    };
    walk('src/server');
    expect(offenders).toEqual([]);
  });
});
