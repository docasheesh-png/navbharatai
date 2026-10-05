// Forensic audit 2026-10-04 (P2) — production refuses to start with a security control switched off, and
// says plainly (names, never values) which settings are missing.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkProductionConfig, assertProductionConfig } from '../src/server/lib/productionConfigContract';

const FULL = {
  NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: 'k'.repeat(48), CASHFREE_APP_ID: 'a', CASHFREE_SECRET_KEY: 's',
  CASHFREE_WEBHOOK_SECRET: 'w', ADMIN_PASSWORD: 'p',
} as NodeJS.ProcessEnv;

describe('the contract', () => {
  it('a complete production environment passes clean', () => {
    expect(checkProductionConfig(FULL)).toEqual({ fatal: [], warnings: [] });
  });

  it('VITEST in production is fatal, whatever its value', () => {
    for (const v of ['true', '1', 'false']) {
      expect(checkProductionConfig({ ...FULL, VITEST: v }).fatal).toHaveLength(1);
      expect(() => assertProductionConfig({ ...FULL, VITEST: v })).toThrow(/VITEST/);
    }
  });

  it('missing keys are named as warnings, never fatal, and never print a value', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: 'short-secret-value' } as NodeJS.ProcessEnv;
    expect(() => assertProductionConfig(env)).not.toThrow();
    const printed = spy.mock.calls.flat().join('\n');
    spy.mockRestore();
    expect(printed).toMatch(/SECRET_ENCRYPTION_KEY is shorter/);
    expect(printed).toMatch(/CASHFREE_WEBHOOK_SECRET/);
    expect(printed).not.toContain('short-secret-value');
  });

  it('outside production nothing is checked (dev and tests run as before)', () => {
    expect(checkProductionConfig({ VITEST: 'true' } as NodeJS.ProcessEnv)).toEqual({ fatal: [], warnings: [] });
  });

  it('the server runs it at boot, before any route', () => {
    const src = readFileSync('server.ts', 'utf8');
    const at = src.indexOf('assertProductionConfig();');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf('app.use('));
  });
});
