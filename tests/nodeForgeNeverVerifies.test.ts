/**
 * NODE-FORGE IS ALLOWLISTED ONLY BECAUSE NOTHING VERIFIES A SIGNATURE WITH IT (2026-10-04).
 *
 * GHSA-86w9-cpqp-85rv: node-forge's RSA PKCS#1 v1.5 signature VERIFICATION accepts extra nested
 * DigestAlgorithm elements, i.e. a forged signature can pass. Every release is affected and no fix
 * exists, so `.audit-allowlist.json` accepts it. That decision rests on one fact: NavBharatAI uses
 * node-forge only to CREATE a certificate and a PKCS#12 keystore (src/server/lib/androidKeystore.ts)
 * and never to verify anything. This test holds that fact, so the allowlist entry cannot quietly
 * become wrong: a new importer, or a verify call, fails CI and forces a re-triage.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SCAN = ['src', 'scripts', 'server.ts'];

function sourceFiles(path: string, out: string[] = []): string[] {
  const st = statSync(path);
  if (st.isFile()) {
    if (/\.(m?[jt]sx?)$/.test(path) && !/\.test\.[jt]sx?$/.test(path)) out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist') continue;
    sourceFiles(join(path, name), out);
  }
  return out;
}

const IMPORTS_FORGE = /(?:from\s+['"]node-forge['"]|require\(\s*['"]node-forge['"]\s*\))/;

function forgeImporters(): string[] {
  return SCAN.flatMap((p) => sourceFiles(join(ROOT, p)))
    .filter((f) => IMPORTS_FORGE.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .sort();
}

describe('node-forge is never used to verify a signature', () => {
  it('only the keystore generator imports it', () => {
    expect(forgeImporters()).toEqual(['src/server/lib/androidKeystore.ts']);
  });

  it('the keystore generator never calls a verify function', () => {
    const src = readFileSync(join(ROOT, 'src/server/lib/androidKeystore.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.verify\s*\(/);
    expect(src).not.toMatch(/verifyCertificateChain|\.verifier\b/);
  });

  it('the allowlist still names the reason it depends on', () => {
    const allow = JSON.parse(readFileSync(join(ROOT, '.audit-allowlist.json'), 'utf8')) as { allow: { package: string; reason: string }[] };
    const entry = allow.allow.find((e) => e.package === 'node-forge');
    expect(entry?.reason).toMatch(/never calls a verify function/);
  });
});
