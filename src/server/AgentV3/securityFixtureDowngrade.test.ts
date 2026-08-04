import { describe, it, expect } from 'vitest';
import { scanSecurity, isFixtureFile } from './SecurityAnalysis';

const sev = (file: string, code: string, rule: string) =>
  scanSecurity(file, code).find((f) => f.rule === rule)?.severity;

describe('isFixtureFile — obvious mock/fixture/demo/test data files', () => {
  it('is TRUE for the exact failing file + common fixture shapes', () => {
    expect(isFixtureFile('src/data/mockData.ts')).toBe(true);        // the build 6f87751d rootCause file
    expect(isFixtureFile('src/mocks/handlers.ts')).toBe(true);
    expect(isFixtureFile('src/__mocks__/user.ts')).toBe(true);
    expect(isFixtureFile('src/data/seedUsers.ts')).toBe(true);
    expect(isFixtureFile('src/fixtures/orders.ts')).toBe(true);
    expect(isFixtureFile('src/demo-data.ts')).toBe(true);
    expect(isFixtureFile('src/components/Button.test.tsx')).toBe(true);
  });

  it('is FALSE for real source (must NOT be treated as fixture → real secrets still block)', () => {
    expect(isFixtureFile('src/data/config.ts')).toBe(false);
    expect(isFixtureFile('src/lib/api.ts')).toBe(false);
    expect(isFixtureFile('src/server/db.ts')).toBe(false);
    expect(isFixtureFile('src/App.tsx')).toBe(false);
  });
});

describe('hardcoded credential in a MOCK/FIXTURE file → downgraded to low (never a build-failing high)', () => {
  it('the exact failure: a demo password in mockData.ts is LOW, not high', () => {
    // build 6f87751d: `hardcoded-secret @ src/data/mockData.ts:240` forced readiness 0/100.
    const code = `export const mockUser = { email: 'admin@acme.com', password: 'password123' };`;
    expect(sev('src/data/mockData.ts', code, 'hardcoded-secret')).toBe('low');
  });

  it('a mock API key + sample DB URL in fixtures are LOW too', () => {
    expect(sev('src/mocks/keys.ts', `const apiKey = 'sk_abcd1234efgh5678';`, 'hardcoded-secret')).toBe('low');
    expect(sev('src/data/seed.ts', `const DB = 'postgres://user:supersecret@localhost:5432/app';`, 'connection-string-credentials')).toBe('low');
  });
});

describe('the SAME credential in REAL source still BLOCKS (high) — no security regression', () => {
  it('a hardcoded credential in real source is still high', () => {
    const code = `const apiKey = 'sk_live_abcd1234efgh';`;
    expect(sev('src/lib/api.ts', code, 'hardcoded-secret')).toBe('high');
    expect(sev('src/config.ts', `const password = 'prodPass123';`, 'hardcoded-secret')).toBe('high');
  });

  it('a REAL AWS key / private key stays HIGH even in a fixture file (never demo-safe)', () => {
    // These are never legit demo data — a real-format AWS key or private key is a genuine red flag.
    expect(sev('src/data/mockData.ts', `const k = 'AKIA1234567890ABCDEF';`, 'aws-access-key')).toBe('high');
    expect(sev('src/mocks/keys.ts', `const p = '-----BEGIN RSA PRIVATE KEY-----';`, 'private-key')).toBe('high');
  });

  it('a code vulnerability (jwt none-algorithm) stays HIGH even in a fixture', () => {
    expect(sev('src/mocks/auth.ts', `jwt.verify(t, k, { algorithms: ['none'] });`, 'jwt-none-algorithm')).toBe('high');
  });
});
