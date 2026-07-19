import { describe, it, expect, afterEach, vi } from 'vitest';

// SECURITY Phase 2.2 — the hardcoded fallback encryption key lives in source, so a secret written
// under it is decryptable by anyone with the repo. encrypt() must REFUSE the fallback in production
// (fail loud, never persist an attacker-decryptable secret), while decrypt() KEEPS the fallback so
// any data already written under it (dev, or a past misconfigured run) still reads — "decryption
// na toote". resolveKeys() reads process.env live per call, so we toggle env per test.

async function freshSecrets() {
  vi.resetModules();
  return import('../src/server/lib/secrets');
}

const saved = { ...process.env };
afterEach(() => {
  process.env.NODE_ENV = saved.NODE_ENV;
  if (saved.SECRET_ENCRYPTION_KEY === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = saved.SECRET_ENCRYPTION_KEY;
  if (saved.SECRET_KEY_V1 === undefined) delete process.env.SECRET_KEY_V1;
  else process.env.SECRET_KEY_V1 = saved.SECRET_KEY_V1;
  vi.unstubAllEnvs();
});

describe('encrypt() refuses the hardcoded fallback in production (Phase 2.2)', () => {
  it('THE VULN: production with NO configured key → encrypt throws (never writes under the source-code key)', async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.SECRET_KEY_V1;
    process.env.NODE_ENV = 'production';
    const { encrypt } = await freshSecrets();
    expect(() => encrypt('my-github-token')).toThrow(/SECRET_ENCRYPTION_KEY/);
  });

  it('production WITH a real key → encrypt works normally', async () => {
    process.env.SECRET_ENCRYPTION_KEY = '12345678901234567890123456789012';
    process.env.NODE_ENV = 'production';
    const { encrypt, decrypt } = await freshSecrets();
    const ct = encrypt('secret-value');
    expect(ct).toMatch(/^g\d+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // authenticated GCM
    expect(decrypt(ct)).toBe('secret-value');
  });

  it('dev/test with NO key → encrypt still works (fallback allowed off-production)', async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.SECRET_KEY_V1;
    process.env.NODE_ENV = 'test';
    const { encrypt, decrypt } = await freshSecrets();
    const ct = encrypt('dev-secret');
    expect(decrypt(ct)).toBe('dev-secret');
  });

  it('COMPAT: data written under the fallback still DECRYPTS in production (decryption never breaks)', async () => {
    // Write under the fallback off-production…
    delete process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.SECRET_KEY_V1;
    process.env.NODE_ENV = 'development';
    const dev = await freshSecrets();
    const ct = dev.encrypt('legacy-fallback-secret');
    // …then read it back with production set and still no key — decrypt keeps the fallback.
    process.env.NODE_ENV = 'production';
    expect(dev.decrypt(ct)).toBe('legacy-fallback-secret');
  });
});
