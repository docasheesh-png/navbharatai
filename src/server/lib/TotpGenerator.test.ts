import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateTotpIntegration, TOTP_LIB_SOURCE } from './TotpGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateTotpIntegration (wiring)', () => {
  it('emits server/lib/totp.ts, dependency-free', () => {
    const out = generateTotpIntegration();
    expect(Object.keys(out.files)).toContain('server/lib/totp.ts');
    expect(out.dependencies).toEqual([]);
    expect(out.instructions).toMatch(/RFC 6238/);
  });

  it('the emitted source exports the real API and uses node:crypto (no shaped stub)', () => {
    expect(TOTP_LIB_SOURCE).toContain("from 'node:crypto'");
    expect(TOTP_LIB_SOURCE).toContain('export function generateTotpSecret');
    expect(TOTP_LIB_SOURCE).toContain('export function verifyTotp');
    expect(TOTP_LIB_SOURCE).toContain('export function totpAuthUrl');
    expect(TOTP_LIB_SOURCE).toContain('otpauth://totp/');
    expect(TOTP_LIB_SOURCE).toContain('timingSafeEqual');
  });
});

// Materialize and EXECUTE the exact emitted code, so we verify real cryptographic correctness against the
// official RFC 6238 test vectors — not just that the string looks right.
describe('emitted TOTP code — correctness (RFC 6238 vectors)', () => {
  const artifact = join(here, `._totp_emitted_${process.pid}.ts`);
  writeFileSync(artifact, TOTP_LIB_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  // ASCII secret "12345678901234567890" (the RFC 6238 SHA-1 seed) in base32.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  interface EmittedTotp {
    base32Encode(buf: Buffer): string;
    base32Decode(input: string): Buffer;
    generateTotpSecret(bytes?: number): string;
    generateTotp(secret: string, opts?: { digits?: number; step?: number; now?: number }): string;
    verifyTotp(secret: string, token: string, opts?: { digits?: number; step?: number; now?: number; window?: number }): boolean;
    totpAuthUrl(secret: string, opts: { issuer: string; account: string; digits?: number; step?: number }): string;
  }

  async function load(): Promise<EmittedTotp> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as EmittedTotp;
  }

  it('base32 round-trips and decodes the RFC seed to ASCII digits', async () => {
    const m = await load();
    expect(m.base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
    expect(m.base32Encode(Buffer.from('12345678901234567890', 'ascii'))).toBe(RFC_SECRET);
  });

  it('produces the exact RFC 6238 6-digit codes at the published timestamps', async () => {
    const m = await load();
    // RFC 6238 Appendix B (SHA1): T=59 → 94287082, T=1111111109 → 07081804, T=1234567890 → 89005924.
    expect(m.generateTotp(RFC_SECRET, { now: 59_000 })).toBe('287082');
    expect(m.generateTotp(RFC_SECRET, { now: 1111111109_000 })).toBe('081804');
    expect(m.generateTotp(RFC_SECRET, { now: 1234567890_000 })).toBe('005924');
  });

  it('verifyTotp accepts the correct code and rejects a wrong one', async () => {
    const m = await load();
    expect(m.verifyTotp(RFC_SECRET, '287082', { now: 59_000 })).toBe(true);
    expect(m.verifyTotp(RFC_SECRET, '000000', { now: 59_000 })).toBe(false);
    expect(m.verifyTotp(RFC_SECRET, '28708', { now: 59_000 })).toBe(false); // wrong length
    expect(m.verifyTotp(RFC_SECRET, 'abcdef', { now: 59_000 })).toBe(false); // non-numeric
  });

  it('tolerates ±1 step of clock drift but not more', async () => {
    const m = await load();
    const t = 1500000000_000;
    const code = m.generateTotp(RFC_SECRET, { now: t });
    expect(m.verifyTotp(RFC_SECRET, code, { now: t + 30_000 })).toBe(true);  // 1 step late → ok
    expect(m.verifyTotp(RFC_SECRET, code, { now: t - 30_000 })).toBe(true);  // 1 step early → ok
    expect(m.verifyTotp(RFC_SECRET, code, { now: t + 90_000 })).toBe(false); // 3 steps late → rejected
  });

  it('generates a valid otpauth:// provisioning URI + a fresh random secret', async () => {
    const m = await load();
    const url = m.totpAuthUrl(RFC_SECRET, { issuer: 'NavBharat App', account: 'user@example.com' });
    expect(url).toMatch(/^otpauth:\/\/totp\/NavBharat%20App:user%40example\.com\?/);
    expect(url).toContain('secret=' + RFC_SECRET);
    expect(url).toContain('period=30');
    const fresh = m.generateTotpSecret();
    expect(fresh).toMatch(/^[A-Z2-7]+$/);
    expect(fresh.length).toBeGreaterThanOrEqual(32);
  });
});
