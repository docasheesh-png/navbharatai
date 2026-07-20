import { describe, it, expect } from 'vitest';
import { generateUpiIntegration } from './UpiGenerator';

describe('generateUpiIntegration', () => {
  const c = generateUpiIntegration();
  const lib = c.files['src/lib/upi.ts'];

  it('emits a dependency-free, keyless client lib (no gateway, no env)', () => {
    expect(lib).toContain('export function buildUpiLink(');
    expect(lib).toContain('export function isValidVpa(');
    expect(lib).not.toContain("from 'axios'");
    expect(lib).not.toContain('process.env');
    expect(c.files['.env.example']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('builds a spec-correct upi:// link — URL-encoded, 2-decimal amount, INR', () => {
    expect(lib).toContain("'upi://pay?'");
    expect(lib).toContain('encodeURIComponent(vpa)');
    expect(lib).toContain('params.amount.toFixed(2)');
    expect(lib).toContain("'cu=INR'");
  });

  it('refuses a broken link — throws on invalid VPA / non-positive amount', () => {
    expect(lib).toContain("throw new Error('Invalid UPI VPA");
    expect(lib).toContain('positive number');
    expect(lib).toContain('VPA_RE.test');
  });

  it('ships a runnable test alongside the lib and writes only src/lib files', () => {
    expect(c.files['src/lib/upi.test.ts']).toBeTruthy();
    expect(Object.keys(c.files).sort()).toEqual(['src/lib/upi.test.ts', 'src/lib/upi.ts']);
    expect(c.instructions.toLowerCase()).toContain('upi');
  });
});
