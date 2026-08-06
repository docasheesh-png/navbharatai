import { describe, it, expect } from 'vitest';
import { isSecretFile, maskSecretContent, maskNotice, SECRET_MASK } from './secretMask';

/**
 * THE INCIDENT (admin, 2026-08-06). The Files viewer rendered `.env` verbatim, so a screenshot taken to
 * show a BUILD problem carried a live Neon database password and a payment secret out of the app. The
 * credentials had to be rotated.
 *
 * What makes it a defect rather than bad luck: the rest of the product already treats these values as
 * too sensitive to display — Settings → Database deliberately never shows a saved credential back, and
 * the vault encrypts them at rest. Then the same secrets were readable in one tap, with a copy button.
 * A promise kept on one screen and broken on the next is not a promise.
 */
describe('isSecretFile — narrow on purpose', () => {
  it('catches every .env flavour', () => {
    for (const p of ['.env', '.env.local', '.env.production', 'apps/web/.env', 'server/.env.test']) {
      expect(isSecretFile(p), p).toBe(true);
    }
  });

  it('catches private keys and credential blobs', () => {
    for (const p of ['certs/server.pem', 'id_rsa', 'keys/app.p12', 'service-account.json', 'gcp-key.json', 'credentials.json']) {
      expect(isSecretFile(p), p).toBe(true);
    }
  });

  it('does NOT mask source — hiding code would defeat the viewer', () => {
    for (const p of ['src/App.tsx', 'package.json', 'README.md', '.env.d.ts', 'src/env.d.ts', 'vite.config.ts', 'tsconfig.json']) {
      expect(isSecretFile(p), p).toBe(false);
    }
  });
});

describe('maskSecretContent — the keys stay, the values go', () => {
  const env = [
    '# database',
    'DATABASE_URL=postgresql://neondb_owner:npg_2j7qKwxcOkMs@ep-x.neon.tech/neondb?sslmode=require',
    'RAZORPAY_KEY_SECRET=hunter2',
    'EMPTY_ONE=',
    '',
    'export VITE_PUBLIC_THING=abc',
  ].join('\n');

  it('removes every value and keeps every key', () => {
    const out = maskSecretContent('.env', env);
    // Which variables the app expects is the useful part; the value is what a stranger must not learn.
    expect(out).toContain('DATABASE_URL=');
    expect(out).toContain('RAZORPAY_KEY_SECRET=');
    expect(out).toContain('export VITE_PUBLIC_THING=');
    expect(out).not.toContain('npg_2j7qKwxcOkMs');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('neon.tech');
  });

  it('keeps comments and blank lines, so the file still reads like itself', () => {
    const out = maskSecretContent('.env', env);
    expect(out.split('\n')[0]).toBe('# database');
    expect(out.split('\n')).toContain('');
  });

  it('leaves an EMPTY value alone — masking nothing would imply a secret that is not there', () => {
    expect(maskSecretContent('.env', 'EMPTY_ONE=')).toBe('EMPTY_ONE=');
  });

  it('the mask is a FIXED width, so it cannot leak how long the secret is', () => {
    const short = maskSecretContent('.env', 'A=x');
    const long = maskSecretContent('.env', 'A=' + 'y'.repeat(200));
    expect(short).toBe(long);
    expect(short).toBe(`A=${SECRET_MASK}`);
  });

  it('a key file has NO safe half — the whole body is hidden', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----';
    const out = maskSecretContent('certs/server.pem', pem);
    expect(out).not.toContain('MIIEv');
    expect(out).toContain('holds credentials');
  });

  it('source files pass through untouched', () => {
    const code = 'const KEY = process.env.DATABASE_URL;';
    expect(maskSecretContent('src/db.ts', code)).toBe(code);
  });
});

describe('the notice tells the user where their value went', () => {
  it('says why, and how to see it', () => {
    // A user who cannot find their own value will assume the app lost it — a worse outcome than the
    // one this protects against.
    const n = maskNotice('.env');
    expect(n).toContain('screenshot');
    expect(n).toContain('Reveal');
  });
});
