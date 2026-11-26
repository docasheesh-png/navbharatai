/**
 * Security audit 2026-11-21: two of the platform's own auth generators wrote
 *   process.env.JWT_SECRET ?? 'please-set-JWT_SECRET-env-var'    (BackendProvisioner)
 *   process.env.JWT_SECRET || 'dev-insecure-secret-change-me'     (AuthCodeGenerator)
 * into the apps users build. With JWT_SECRET unset, that fixed string IS the signing key, and it is public —
 * anyone could forge a sign-in. The built-app scanner did not catch this form either.
 *
 * The class: "a secret falls back to a fixed, readable string". Locked three ways: the generators' real output,
 * the scanner rule that now catches it in any app the model writes, and a census of the platform's own source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';
import { generateAuthCode } from '../src/server/AppMakerLab/generator/AuthCodeGenerator';
import { BackendProvisioner } from '../src/server/AgentV3/sandbox/EngineerAI/BackendProvisioner';

const rules = (file: string, code: string) => scanSecurity(file, code).map((f) => f.rule);

describe('the built-app scanner catches a literal secret fallback', () => {
  it('flags || and ?? fallbacks, placeholder-looking ones included', () => {
    expect(rules('server/auth.ts', "const s = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';")).toContain('secret-env-fallback-literal');
    expect(rules('server/auth.ts', 'const s = process.env.SESSION_SECRET ?? "please-set-me";')).toContain('secret-env-fallback-literal');
    expect(rules('server/k.ts', 'const k = process.env.STRIPE_SIGNING_KEY || `abc`;')).toContain('secret-env-fallback-literal');
  });
  it('does not flag an empty fallback, a random per-run value, or a non-secret variable', () => {
    expect(rules('server/a.ts', "const s = process.env.JWT_SECRET || '';")).not.toContain('secret-env-fallback-literal');
    expect(rules('server/a.ts', "const s = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');")).not.toContain('secret-env-fallback-literal');
    expect(rules('server/a.ts', "const p = process.env.PORT || '3000';")).not.toContain('secret-env-fallback-literal');
  });
});

describe("the platform's own auth generators write no fixed secret", () => {
  it('AuthCodeGenerator (JWT) uses a random per-run secret and passes the scanner', () => {
    for (const f of generateAuthCode({ type: 'jwt' }).files) {
      expect(f.content).not.toMatch(/dev-insecure-secret-change-me/);
      const found = rules(f.path, f.content);
      expect(found).not.toContain('secret-env-fallback-literal');
      expect(found).not.toContain('hardcoded-jwt-secret');
    }
    const jwtFile = generateAuthCode({ type: 'jwt' }).files.find((f) => /jwt/.test(f.path))!;
    expect(jwtFile.content).toMatch(/crypto\.randomBytes\(32\)/);
  });
  it('BackendProvisioner auth lib uses a random per-run secret and passes the scanner', () => {
    const auth = BackendProvisioner.getScaffoldFiles(['auth']).find((f) => f.path === 'src/lib/auth.ts')!;
    expect(auth.content).not.toMatch(/please-set-JWT_SECRET-env-var/);
    expect(auth.content).toMatch(/process\.env\.JWT_SECRET \|\| crypto\.randomBytes\(32\)\.toString\('hex'\)/);
    expect(rules(auth.path, auth.content)).not.toContain('secret-env-fallback-literal');
  });
});

describe('census: no platform source writes a literal secret fallback', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : []);
  });
  it('every process.env.*SECRET* fallback in src/server is empty or computed, never a fixed string', () => {
    const re = /process\.env\.[A-Z0-9_]*(?:SECRET|SIGNING_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*(?:\|\||\?\?)\s*(['"`])[^'"`]+\1/;
    const offenders = walk('src/server')
      .filter((p) => p !== join('src/server/AgentV3/SecurityAnalysis.ts'))
      .flatMap((p) => readFileSync(p, 'utf8').split('\n').map((l, i) => ({ p, i, l })).filter(({ l }) => re.test(l)))
      .map(({ p, i, l }) => `${p}:${i + 1}: ${l.trim()}`);
    expect(offenders, 'A secret must not fall back to a fixed string — use a random per-run value').toEqual([]);
  });
});

describe("the platform's own GitHub hand-off key (a sibling the census found)", () => {
  it('production without the key refuses to sign; a local run uses a random key', () => {
    const src = readFileSync('src/server/routes/githubAuth.ts', 'utf8');
    expect(src).not.toMatch(/navbharatai-dev-state-secret/);
    expect(src).toMatch(/if \(process\.env\.NODE_ENV === 'production'\) \{\s*throw new Error\('Refusing to sign a GitHub hand-off/);
    expect(src).toMatch(/devHandoffSecret = randomBytes\(32\)\.toString\('hex'\)/);
  });
});

