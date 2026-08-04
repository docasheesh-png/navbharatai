import { describe, it, expect } from 'vitest';
import { generatePasswordIntegration } from './PasswordGenerator';

describe('generatePasswordIntegration', () => {
  const c = generatePasswordIntegration();
  const server = c.files['server/lib/password.ts'];

  it('emits hashPassword + verifyPassword + needsRehash built on bcryptjs', () => {
    expect(server).toContain("import bcrypt from 'bcryptjs'");
    expect(server).toContain('export async function hashPassword(');
    expect(server).toContain('export async function verifyPassword(');
    expect(server).toContain('export function needsRehash(');
    expect(c.files['src/lib/password.ts']).toBeUndefined(); // server-side
  });

  it('uses a real bcrypt cost and salted hash, never a fast hash', () => {
    expect(server).toContain('const COST = 12');
    expect(server).toContain('bcrypt.hash(plain, COST)');
    expect(server).not.toContain('createHash'); // no MD5/SHA fast-hash
  });

  it('verify is constant-time and fails safe (never throws on a bad hash)', () => {
    expect(server).toContain('bcrypt.compare(plain, hash)');
    expect(server).toContain('return false');
    expect(server).toContain('catch');
  });

  it('bounds input length (bcrypt 72-byte truncation + DoS guard)', () => {
    expect(server).toContain('plain.length > 200');
  });

  it('declares bcryptjs, no env keys, no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'bcryptjs', version: '^2.4.3' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/password.ts']);
    expect(c.instructions.toLowerCase()).toContain('password');
  });
});
