import { describe, it, expect } from 'vitest';
import { analyzeSecretLeak, secretLeakSummary } from './SecretLeakAnalysis';

describe('analyzeSecretLeak', () => {
  it('is not assessable when there is no real .env file', () => {
    const r = analyzeSecretLeak(['.env.example', 'src/App.tsx'], null);
    expect(r.assessed).toBe(false);
    expect(r.findings).toHaveLength(0);
  });

  it('flags a real .env that is not gitignored (high)', () => {
    const r = analyzeSecretLeak(['.env', 'src/App.tsx'], 'node_modules/\ndist/');
    expect(r.assessed).toBe(true);
    expect(r.exposed).toContain('.env');
    expect(r.findings[0].level).toBe('high');
  });

  it('passes when .gitignore covers .env', () => {
    const r = analyzeSecretLeak(['.env', '.env.local'], 'node_modules/\n.env\n.env.local');
    expect(r.assessed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('treats a wildcard .env* rule as covering', () => {
    const r = analyzeSecretLeak(['.env.production'], '.env*');
    expect(r.findings).toHaveLength(0);
  });

  it('ignores templates/examples as non-secret', () => {
    const r = analyzeSecretLeak(['.env.example', '.env.sample', '.env.template'], null);
    expect(r.assessed).toBe(false);
  });

  it('flags when .gitignore exists but only has a commented .env line', () => {
    const r = analyzeSecretLeak(['.env'], '# .env\nnode_modules/');
    expect(r.findings).toHaveLength(1);
  });

  it('detects .env nested under a path', () => {
    const r = analyzeSecretLeak(['backend/.env'], 'node_modules/');
    expect(r.exposed).toContain('backend/.env');
  });
});

describe('secretLeakSummary', () => {
  it('renders not-assessable', () => {
    expect(secretLeakSummary(analyzeSecretLeak([], null))).toContain('no .env');
  });
  it('renders pass', () => {
    expect(secretLeakSummary(analyzeSecretLeak(['.env'], '.env'))).toContain('✓');
  });
  it('renders the critical warning', () => {
    expect(secretLeakSummary(analyzeSecretLeak(['.env'], null))).toContain('CRITICAL');
  });
});
