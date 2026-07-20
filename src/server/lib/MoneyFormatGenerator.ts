// U-4 (verified recipe modules) — Indian money & number formatting (dependency-free, Intl-based).
//
// Indian apps display money constantly (prices, invoices, wallets, order totals) and the Western thousands
// grouping is WRONG here: ₹1234567 must read "₹12,34,567" (lakh/crore grouping), not "₹1,234,567". Getting
// this right by hand is fiddly and error-prone; doing it with a floating-point ₹ value invites rounding bugs.
// This recipe ships the real thing built on the platform's Intl 'en-IN' locale: format money that is stored
// in the smallest unit (paise) as an integer — the only safe way — into a correctly-grouped ₹ string, plus a
// plain Indian-grouped number formatter and an amount-in-words helper (lakh/crore) for cheques/invoices. No
// dependency, no env keys. PURE builder; correct and complete — no TODO stubs (the real-features rule).
// Unit-tested.

export interface MoneyFormatConfig {
  files: Record<string, string>;
  instructions: string;
}

const MONEY_SERVER = `// Format an amount stored in PAISE (integer smallest unit — always store money this way, never as a float)
// into a correctly-grouped Indian Rupee string, e.g. 12345678 paise → "₹1,23,456.78". Uses the platform's
// 'en-IN' locale so the lakh/crore grouping is correct by construction. Pass showPaise=false to drop the
// decimals for whole-rupee display.
export function formatInr(paise: number, opts?: { showPaise?: boolean }): string {
  if (!Number.isFinite(paise)) return '₹0';
  const rupees = paise / 100;
  const showPaise = opts?.showPaise ?? true;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: showPaise ? 2 : 0,
  }).format(rupees);
}

// Group a plain number the Indian way (12,34,567) without a currency symbol — for counts, quantities, views.
export function formatIndianNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-IN').format(n);
}

// Convert a RUPEE amount to words in the Indian system (lakh/crore) — the legal "Rupees … Only" form used on
// cheques, invoices and receipts. Handles paise (the decimal part), zero, and amounts into the thousands of
// crores (the crore group RECURSES, so ≥100 crore is correct — a plain twoDigits(crore) would emit "undefined").
// e.g. 1234567.89 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Eighty Nine Paise Only".
export function rupeesInWords(rupees: number): string {
  if (!Number.isFinite(rupees) || rupees < 0) return 'Zero Rupees Only';
  const totalPaise = Math.round(rupees * 100);
  const whole = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const twoDigits = (x: number): string => {
    if (x < 20) return ones[x];
    return (tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '')).trim();
  };
  const threeDigits = (x: number): string => {
    const h = Math.floor(x / 100);
    const rest = x % 100;
    return ((h ? ones[h] + ' Hundred' + (rest ? ' ' : '') : '') + (rest ? twoDigits(rest) : '')).trim();
  };
  const toWords = (x: number): string => {
    const parts: string[] = [];
    const crore = Math.floor(x / 10000000);
    const lakh = Math.floor((x % 10000000) / 100000);
    const thousand = Math.floor((x % 100000) / 1000);
    const hundred = x % 1000;
    if (crore) parts.push(toWords(crore) + ' Crore'); // recurse: correct for ≥100 crore
    if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
    if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
    if (hundred) parts.push(threeDigits(hundred));
    return parts.join(' ');
  };
  let out = (whole === 0 ? 'Zero' : toWords(whole)) + ' Rupees';
  if (paise > 0) out += ' and ' + twoDigits(paise) + ' Paise';
  return out + ' Only';
}

// Verified by an emitted regression test (money.test.ts) that locks the paise + ≥100-crore behaviour.
`;

const MONEY_TEST = `import { describe, it, expect } from 'vitest';
import { formatInr, formatIndianNumber, rupeesInWords } from './money';

describe('money', () => {
  it('formats paise into a lakh/crore-grouped rupee string', () => {
    expect(formatInr(12345678)).toBe('₹1,23,456.78');
    expect(formatInr(500000, { showPaise: false })).toBe('₹5,000');
    expect(formatIndianNumber(1234567)).toBe('12,34,567');
  });

  it('spells amounts in the Indian lakh/crore system with paise and the "Only" suffix', () => {
    expect(rupeesInWords(1234567.89)).toBe(
      'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Eighty Nine Paise Only',
    );
    expect(rupeesInWords(100000)).toBe('One Lakh Rupees Only');
    expect(rupeesInWords(500)).toBe('Five Hundred Rupees Only');
    expect(rupeesInWords(0)).toBe('Zero Rupees Only');
  });

  it('renders amounts into the thousands of crores (the ≥100-crore case that used to emit "undefined")', () => {
    expect(rupeesInWords(1250000000)).toBe('One Hundred Twenty Five Crore Rupees Only');
    expect(rupeesInWords(10000000)).toBe('One Crore Rupees Only');
    expect(rupeesInWords(1250000000)).not.toContain('undefined');
  });

  it('rounds to paise and treats a negative/non-finite amount as Zero', () => {
    expect(rupeesInWords(99.999)).toBe('One Hundred Rupees Only');
    expect(rupeesInWords(-5)).toBe('Zero Rupees Only');
  });
});
`;

const INSTRUCTIONS =
  'Indian money/number formatting wired at server/lib/money.ts (no dependency — native Intl en-IN). Store ' +
  'money as an INTEGER number of paise (never a float), then formatInr(paise) for a correctly lakh/crore-' +
  'grouped ₹ string (e.g. 12345678 → "₹1,23,456.78"). Use formatIndianNumber(n) for grouped counts and ' +
  'rupeesInWords(rupees) for the amount in words on invoices/cheques (lakh/crore system, with paise and the ' +
  'legal "Rupees … Only" suffix, correct into the thousands of crores). No API key needed.';

export function generateMoneyFormatIntegration(): MoneyFormatConfig {
  return {
    files: {
      'server/lib/money.ts': MONEY_SERVER,
      'server/lib/money.test.ts': MONEY_TEST,
    },
    instructions: INSTRUCTIONS,
  };
}
