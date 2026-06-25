import { describe, it, expect } from 'vitest';
import { scanSecurityConfig, securityConfigSummary } from './SecurityConfigAnalysis';

// Note: TLS-verification-disabled and insecure Math.random() randomness are intentionally NOT
// tested here — those rules live in SecurityAnalysis (disable-tls-verification /
// insecure-random-token) and were removed from this module to avoid double-reporting the same
// line in `evaluate`. This module now owns CORS misconfiguration + secret-logging.

describe('scanSecurityConfig', () => {
  it('flags wildcard CORS origin (medium)', () => {
    const issues = scanSecurityConfig('src/server.ts', "app.use(cors({ origin: '*' }));");
    expect(issues.some((i) => i.rule === 'wildcard-cors' && i.severity === 'medium')).toBe(true);
  });

  it('flags a manual wildcard Access-Control-Allow-Origin header', () => {
    const issues = scanSecurityConfig('src/server.ts', "res.setHeader('Access-Control-Allow-Origin', '*');");
    expect(issues.some((i) => i.rule === 'wildcard-cors')).toBe(true);
  });

  it('flags CORS reflecting any origin with credentials (high) but not a pinned origin with credentials', () => {
    expect(scanSecurityConfig('src/server.ts', 'app.use(cors({ origin: true, credentials: true }));').some((i) => i.rule === 'cors-credentials-reflect-origin' && i.severity === 'high')).toBe(true);
    expect(scanSecurityConfig('src/server.ts', 'app.use(cors({ credentials: true, origin: true }));').some((i) => i.rule === 'cors-credentials-reflect-origin')).toBe(true);
    // a pinned origin with credentials is the correct, safe pattern.
    expect(scanSecurityConfig('src/server.ts', "app.use(cors({ origin: 'https://app.example.com', credentials: true }));").some((i) => i.rule === 'cors-credentials-reflect-origin')).toBe(false);
  });

  it('flags a secret env var logged to the console (medium)', () => {
    const issues = scanSecurityConfig('src/a.ts', 'console.log(process.env.STRIPE_SECRET_KEY);');
    expect(issues.some((i) => i.rule === 'logged-secret' && i.severity === 'medium')).toBe(true);
  });

  it('does not flag logging a non-secret env var', () => {
    const issues = scanSecurityConfig('src/a.ts', 'console.log(process.env.NODE_ENV);');
    expect(issues.some((i) => i.rule === 'logged-secret')).toBe(false);
  });

  it('does not flag a restricted CORS origin', () => {
    const issues = scanSecurityConfig('src/server.ts', "app.use(cors({ origin: 'https://example.com' }));");
    expect(issues).toHaveLength(0);
  });

  it('ignores commented-out lines', () => {
    const issues = scanSecurityConfig('src/a.ts', "// origin: '*' allow everything");
    expect(issues).toHaveLength(0);
  });

  it('ignores non-code files', () => {
    expect(scanSecurityConfig('notes.md', "origin: '*'")).toHaveLength(0);
  });

  it('records the line number', () => {
    const issues = scanSecurityConfig('src/a.ts', "const x = 1;\napp.use(cors({ origin: '*' }));");
    expect(issues[0].line).toBe(2);
  });
});

describe('securityConfigSummary', () => {
  it('renders a pass line when clean', () => {
    expect(securityConfigSummary([])).toContain('✓');
  });
  it('lists issues high-severity first', () => {
    // cors-credentials-reflect-origin is high, wildcard-cors is medium.
    const out = securityConfigSummary(
      scanSecurityConfig('a.ts', "app.use(cors({ origin: true, credentials: true }));\norigin: '*'"),
    );
    expect(out).toContain('Security config');
    expect(out.indexOf('[high]')).toBeLessThan(out.indexOf('[medium]'));
  });
});
