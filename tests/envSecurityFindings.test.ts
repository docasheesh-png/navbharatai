import { describe, expect, it } from 'vitest';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';

const token = `ghp_${'a1B2'.repeat(10)}`;

describe('credential value rules agree about the designated live environment file', () => {
  it.each(['.env', '.env.local', '.env.production'])('%s keeps server credentials advisory across provider-token and auth-header rules', (file) => {
    const findings = scanSecurity(file, `PROVIDER_TOKEN=${token}\nAuthorization="Bearer ${token}"`);
    expect(findings.filter((f) => ['hardcoded-provider-token', 'hardcoded-auth-header'].includes(f.rule)).map((f) => f.severity)).toEqual(['low', 'low', 'low']);
  });

  it.each(['src/client.ts', 'src/server.ts', '.env.example', '.env.sample', '.env.template'])('%s still reports hardcoded values as high', (file) => {
    const findings = scanSecurity(file, `const credential = '${token}';\nconst headers = { Authorization: 'Bearer ${token}' };`);
    expect(findings.find((f) => f.rule === 'hardcoded-provider-token')?.severity).toBe('high');
    expect(findings.find((f) => f.rule === 'hardcoded-auth-header')?.severity).toBe('high');
  });

  it.each(['VITE_', 'NEXT_PUBLIC_', 'REACT_APP_'])('%s actual credential values stay high even in a live env file', (prefix) => {
    const findings = scanSecurity('.env.local', `${prefix}API_TOKEN=${token}`);
    expect(findings.find((f) => f.rule === 'hardcoded-provider-token')?.severity).toBe('high');
  });
});

describe('type-only env names cannot leak a runtime value', () => {
  it.each(['src/vite-env.d.ts', 'src/env.d.mts', 'src/env.d.cts'])('%s declarations do not block readiness', (file) => {
    expect(scanSecurity(file, 'interface ImportMetaEnv { readonly VITE_API_SECRET: string; }').filter((f) => f.rule === 'client-exposed-secret')).toEqual([]);
  });

  it.each([
    'interface ImportMetaEnv { readonly VITE_API_SECRET: string; }',
    'export interface ImportMetaEnv extends Base { readonly NEXT_PUBLIC_SECRET: string; }',
    'type Env = { readonly REACT_APP_PASSWORD: string; nested: { value: string } };',
  ])('erases only a real interface/object-type declaration', (declaration) => {
    expect(scanSecurity('src/env.ts', declaration).filter((f) => f.rule === 'client-exposed-secret')).toEqual([]);
  });

  it.each([
    'const leak = import.meta.env.VITE_API_SECRET;',
    "const leak = import.meta.env['VITE_API_SECRET'];",
    'const env = import.meta.env; const leak = env.VITE_API_SECRET;',
    'interface ImportMetaEnv { readonly VITE_API_SECRET: string; } const leak = import.meta.env.VITE_API_SECRET;',
    'type Env = { VITE_API_SECRET: string }; const leak = process.env.NEXT_PUBLIC_SECRET;',
    'const documentation = `interface Fake { VITE_API_SECRET: string }`; const leak = import.meta.env.VITE_API_SECRET;',
  ])('keeps actual runtime references high, including those beside erased declarations', (source) => {
    expect(scanSecurity('src/env.ts', source).some((f) => f.rule === 'client-exposed-secret' && f.severity === 'high')).toBe(true);
  });
});
