import { describe, it, expect } from 'vitest';
import { generateAuthCode } from '../src/server/AppMakerLab/generator/AuthCodeGenerator';

/** P-CGE.8 — auth code generator (pure). */

describe('generateAuthCode — jwt (default, dependency-free)', () => {
  it('emits a crypto-based JWT module + Bearer middleware with no dependencies', () => {
    const { files, dependencies, summary } = generateAuthCode();
    expect(dependencies).toEqual([]); // dependency-free
    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/server/auth/jwt.ts');
    expect(paths).toContain('src/middleware/authMiddleware.ts');
    const jwt = files.find((f) => f.path === 'src/server/auth/jwt.ts')!.content;
    expect(jwt).toContain("import crypto from 'crypto';");
    expect(jwt).toContain('export function signToken');
    expect(jwt).toContain('export function verifyToken');
    expect(jwt).toContain('createHmac');
    expect(jwt).toContain('timingSafeEqual'); // constant-time signature check
    expect(jwt).toContain('JWT_SECRET');
    const mw = files.find((f) => f.path === 'src/middleware/authMiddleware.ts')!.content;
    expect(mw).toContain('Bearer ');
    expect(mw).toContain('verifyToken');
    expect(mw).toContain('401');
    expect(summary).toContain('JWT');
  });
});

describe('generateAuthCode — firebase', () => {
  it('emits client auth helpers and declares the firebase dependency', () => {
    const { files, dependencies } = generateAuthCode({ type: 'firebase' });
    expect(dependencies).toEqual(['firebase']);
    const mod = files.find((f) => f.path === 'src/lib/authClient.ts')!.content;
    expect(mod).toContain("from 'firebase/auth'");
    expect(mod).toContain('export function signIn');
    expect(mod).toContain('export function signOut');
    expect(mod).toContain('onAuthChange');
  });
});

describe('generateAuthCode — input coercion', () => {
  it('defaults an unknown type to jwt', () => {
    const { dependencies } = generateAuthCode({ type: 'nonsense' as unknown as 'jwt' });
    expect(dependencies).toEqual([]);
  });
});
