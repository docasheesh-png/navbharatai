import { describe, it, expect } from 'vitest';
import { scanHardcodedUrls, hardcodedUrlSummary } from './HardcodedUrlAnalysis';

describe('scanHardcodedUrls', () => {
  it('flags a hardcoded localhost API URL', () => {
    const issues = scanHardcodedUrls('src/api.ts', "const API = 'http://localhost:3000/api';");
    expect(issues).toHaveLength(1);
    expect(issues[0].url).toBe('http://localhost:3000');
    expect(issues[0].line).toBe(1);
  });

  it('flags 127.0.0.1 too', () => {
    expect(scanHardcodedUrls('src/a.ts', "fetch('http://127.0.0.1:8080/x')")).toHaveLength(1);
  });

  it('flags hardcoded private-network IP URLs (192.168 / 10 / 172.16-31)', () => {
    const a = scanHardcodedUrls('src/a.ts', "const API = 'http://192.168.1.50:3000/api';");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'private-ip', url: 'http://192.168.1.50:3000' });
    expect(scanHardcodedUrls('src/a.ts', "fetch('http://10.0.0.5/x')")[0]?.kind).toBe('private-ip');
    expect(scanHardcodedUrls('src/a.ts', "fetch('https://172.16.3.4:8443/x')")[0]?.kind).toBe('private-ip');
    // a public IP / domain is not a private address.
    expect(scanHardcodedUrls('src/a.ts', "fetch('http://172.15.0.1/x')")).toHaveLength(0);
    expect(scanHardcodedUrls('src/a.ts', "fetch('https://8.8.8.8/x')")).toHaveLength(0);
  });

  it('does NOT flag a private IP that is an env-var fallback', () => {
    expect(scanHardcodedUrls('src/a.ts', "const u = process.env.API || 'http://192.168.1.10:3000';")).toHaveLength(0);
  });

  it('does NOT flag an env-var fallback default', () => {
    const issues = scanHardcodedUrls('src/api.ts', "const API = process.env.API_URL || 'http://localhost:3000';");
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag import.meta.env fallbacks', () => {
    const issues = scanHardcodedUrls('src/a.ts', "const u = import.meta.env.VITE_API ?? 'http://localhost:5173';");
    expect(issues).toHaveLength(0);
  });

  it('ignores comments and non-code files', () => {
    expect(scanHardcodedUrls('src/a.ts', "// http://localhost:3000")).toHaveLength(0);
    expect(scanHardcodedUrls('README.md', "http://localhost:3000")).toHaveLength(0);
  });

  it('does not flag a real production URL', () => {
    expect(scanHardcodedUrls('src/a.ts', "const API = 'https://api.example.com';")).toHaveLength(0);
  });

  it('does NOT scan test or build-config files (localhost is legitimate there)', () => {
    const url = "const API = 'http://localhost:3000/api';";
    // test files hit a local test server; config files set a dev proxy → these never ship.
    expect(scanHardcodedUrls('src/api.test.ts', url)).toHaveLength(0);
    expect(scanHardcodedUrls('src/api.spec.ts', url)).toHaveLength(0);
    expect(scanHardcodedUrls('__tests__/api.ts', url)).toHaveLength(0);
    expect(scanHardcodedUrls('vite.config.ts', "server: { proxy: { '/api': 'http://localhost:3000' } }")).toHaveLength(0);
    expect(scanHardcodedUrls('vitest.config.ts', url)).toHaveLength(0);
    // a normal source file is still scanned.
    expect(scanHardcodedUrls('src/api.ts', url)).toHaveLength(1);
  });
});

describe('hardcodedUrlSummary', () => {
  it('renders a pass line when clean', () => {
    expect(hardcodedUrlSummary([])).toContain('✓');
  });
  it('lists the offending URLs', () => {
    const out = hardcodedUrlSummary(scanHardcodedUrls('src/a.ts', "const u = 'http://localhost:3000';"));
    expect(out).toContain('break in production');
    expect(out).toContain('localhost');
  });
});
