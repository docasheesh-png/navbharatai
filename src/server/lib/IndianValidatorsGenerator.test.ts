import { describe, it, expect } from 'vitest';
import { generateIndianValidatorsIntegration } from './IndianValidatorsGenerator';

describe('generateIndianValidatorsIntegration', () => {
  const c = generateIndianValidatorsIntegration();
  const server = c.files['server/lib/indianValidators.ts'];

  it('emits all seven validators + the mobile normalizer, dependency-free and server-side', () => {
    for (const fn of ['isValidPAN', 'isValidGSTIN', 'isValidAadhaar', 'isValidIFSC', 'isValidPincode', 'isValidUPI', 'isValidIndianMobile', 'normalizeIndianMobile']) {
      expect(server).toContain(`export function ${fn}(`);
    }
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/indianValidators.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('GSTIN verifies the real mod-36 checksum, not just a regex', () => {
    expect(server).toContain("'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'");
    expect(server).toContain('Math.floor(prod / 36) + (prod % 36)');
    expect(server).toContain('(36 - (sum % 36)) % 36');
  });

  it('Aadhaar verifies the real Verhoeff checksum (D5 tables), not just length', () => {
    expect(server).toContain('VERHOEFF_D');
    expect(server).toContain('VERHOEFF_P');
    expect(server).toContain('VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]]');
    expect(server).toContain('return c === 0');
  });

  it('the format checks match the real government/bank shapes', () => {
    expect(server).toContain('/^[A-Z]{5}[0-9]{4}[A-Z]$/');       // PAN
    expect(server).toContain('/^[A-Z]{4}0[A-Z0-9]{6}$/');        // IFSC (5th char reserved 0)
    expect(server).toContain('/^[1-9][0-9]{5}$/');               // PIN code
  });

  it('ships an emitted regression test and never writes .env.example', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files).sort()).toEqual(['server/lib/indianValidators.test.ts', 'server/lib/indianValidators.ts']);
    expect(c.instructions.toLowerCase()).toContain('checksum');
  });
});
