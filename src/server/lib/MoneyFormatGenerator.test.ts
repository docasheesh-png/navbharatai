import { describe, it, expect } from 'vitest';
import { generateMoneyFormatIntegration } from './MoneyFormatGenerator';

describe('generateMoneyFormatIntegration', () => {
  const c = generateMoneyFormatIntegration();
  const server = c.files['server/lib/money.ts'];

  it('emits formatInr + formatIndianNumber + rupeesInWords, dependency-free and server-side', () => {
    expect(server).toContain('export function formatInr(');
    expect(server).toContain('export function formatIndianNumber(');
    expect(server).toContain('export function rupeesInWords(');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/money.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('uses the Indian locale for lakh/crore grouping (not Western thousands)', () => {
    expect(server).toContain("Intl.NumberFormat('en-IN'");
    expect(server).toContain("currency: 'INR'");
  });

  it('stores/formats money in paise (integer) and divides by 100 for display', () => {
    expect(server).toContain('paise / 100');
    expect(server).toContain('paise: number');
  });

  it('words helper uses the Indian Crore/Lakh system, handles paise, and recurses for >=100 crore', () => {
    expect(server).toContain("' Crore'");
    expect(server).toContain("' Lakh'");
    expect(server).toContain('10000000'); // crore divisor
    expect(server).toContain('100000'); // lakh divisor
    expect(server).toContain("' Paise'");
    expect(server).toContain("' Only'");
    expect(server).toContain('toWords(crore)'); // recursion, not twoDigits(crore) — fixes the >=100 crore bug
  });

  it('ships an emitted regression test and never writes .env.example', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files).sort()).toEqual(['server/lib/money.test.ts', 'server/lib/money.ts']);
    expect(c.instructions.toLowerCase()).toContain('paise');
  });
});
