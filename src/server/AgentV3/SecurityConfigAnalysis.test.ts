import { describe, it, expect } from 'vitest';
import { scanSecurityConfig, securityConfigSummary } from './SecurityConfigAnalysis';

describe('scanSecurityConfig', () => {
  it('flags disabled TLS verification (high)', () => {
    const issues = scanSecurityConfig('src/api.ts', 'const agent = new https.Agent({ rejectUnauthorized: false });');
    expect(issues.some((i) => i.rule === 'tls-verification-disabled' && i.severity === 'high')).toBe(true);
  });

  it('flags NODE_TLS_REJECT_UNAUTHORIZED=0', () => {
    const issues = scanSecurityConfig('src/setup.js', "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';");
    expect(issues.some((i) => i.rule === 'tls-verification-disabled')).toBe(true);
  });

  it('flags wildcard CORS origin (medium)', () => {
    const issues = scanSecurityConfig('src/server.ts', "app.use(cors({ origin: '*' }));");
    expect(issues.some((i) => i.rule === 'wildcard-cors' && i.severity === 'medium')).toBe(true);
  });

  it('flags a manual wildcard Access-Control-Allow-Origin header', () => {
    const issues = scanSecurityConfig('src/server.ts', "res.setHeader('Access-Control-Allow-Origin', '*');");
    expect(issues.some((i) => i.rule === 'wildcard-cors')).toBe(true);
  });

  it('does not flag a restricted CORS origin', () => {
    const issues = scanSecurityConfig('src/server.ts', "app.use(cors({ origin: 'https://example.com' }));");
    expect(issues).toHaveLength(0);
  });

  it('ignores commented-out lines', () => {
    const issues = scanSecurityConfig('src/a.ts', "// rejectUnauthorized: false");
    expect(issues).toHaveLength(0);
  });

  it('ignores non-code files', () => {
    expect(scanSecurityConfig('notes.md', "origin: '*'")).toHaveLength(0);
  });

  it('records the line number', () => {
    const issues = scanSecurityConfig('src/a.ts', "const x = 1;\nconst opts = { rejectUnauthorized: false };");
    expect(issues[0].line).toBe(2);
  });
});

describe('securityConfigSummary', () => {
  it('renders a pass line when clean', () => {
    expect(securityConfigSummary([])).toContain('✓');
  });
  it('lists issues high-severity first', () => {
    const out = securityConfigSummary(scanSecurityConfig('a.ts', "origin: '*'\nrejectUnauthorized: false"));
    expect(out).toContain('Security config');
    expect(out.indexOf('[high]')).toBeLessThan(out.indexOf('[medium]'));
  });
});
