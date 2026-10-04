/**
 * Q-155: `withheldSecretNames` was written and tested for one job — telling the user which of their saved keys
 * a build did NOT receive, because each belongs to another app — and nothing ever called it. So a key the user
 * definitely saved was simply absent from their app, and the report said nothing. The class: an explanation
 * built and never shown. Now the build reads the vault once, injects this app's keys, and names the rest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { withheldSecretNames, secretsWithheldLine, MAX_WITHHELD_NAMED, type VaultSecretRow } from '../src/server/lib/secretScope';

const ROWS: VaultSecretRow[] = [
  { name: 'OPENAI_API_KEY', value: 'v1', workspaceId: null },
  { name: 'RAZORPAY_KEY_SECRET', value: 'v2', workspaceId: 'shop-app' },
  { name: 'MAPBOX_TOKEN', value: 'v3', workspaceId: 'travel-app' },
  { name: 'SMTP_PASS', value: 'v4', workspaceId: 'todo-app' },
];

describe('the keys a build did not get are named — never their values', () => {
  it('names the other apps\' keys, says where to change it, and prints no value', () => {
    const names = withheldSecretNames(ROWS, 'todo-app');
    expect(names).toEqual(['MAPBOX_TOKEN', 'RAZORPAY_KEY_SECRET']);
    const line = secretsWithheldLine(names);
    expect(line).toContain('2 saved key(s) were not given to this app because they belong to other apps: MAPBOX_TOKEN, RAZORPAY_KEY_SECRET.');
    expect(line).toContain('Settings → App Settings → Secrets & API Keys');
    for (const r of ROWS) expect(line).not.toContain(r.value);
  });

  it('a long list is counted, not dumped', () => {
    const many = Array.from({ length: MAX_WITHHELD_NAMED + 3 }, (_, i) => `KEY_${i}`);
    expect(secretsWithheldLine(many)).toContain('and 3 more.');
  });

  it('the build reads the vault ONCE for both answers, and reports the withheld names', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const vaultScope = await loadUserVaultScope(userId, workspaceId);');
    expect(route).toContain("code: 'SECRETS_WITHHELD', message: secretsWithheldLine(vaultScope.withheld)");
    const secrets = readFileSync('src/server/lib/secrets.ts', 'utf8');
    expect(secrets).toMatch(/const rows = await loadUserVaultRows\(userId\);\s*return \{ secrets: resolveScopedSecrets\(rows, workspaceId\), withheld: withheldSecretNames\(rows, workspaceId\) \};/);
  });
});

describe('census: nothing secretScope exports is written, tested and never used', () => {
  it('every export is read by live code, not only by its tests', () => {
    const src = readFileSync('src/server/lib/secretScope.ts', 'utf8');
    const exported = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(4);
    const live: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { if (n !== 'node_modules') walk(f); continue; }
        if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !f.endsWith('secretScope.ts')) live.push(readFileSync(f, 'utf8'));
      }
    };
    walk('src');
    const all = live.join('\n') + readFileSync('server.ts', 'utf8');
    // A constant used only inside its own module is fine; a function nobody calls is the defect.
    const own = src.replace(/^export (?:function|const) \w+/gm, '');
    for (const name of exported) {
      expect(new RegExp(`\\b${name}\\b`).test(all) || new RegExp(`\\b${name}\\b`).test(own), `${name} is exported and never used`).toBe(true);
    }
  });
});
