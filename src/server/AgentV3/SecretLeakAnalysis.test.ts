import { describe, it, expect } from 'vitest';
import { analyzeSecretLeak, secretLeakSummary, gitignoreWithEnvCoverage } from './SecretLeakAnalysis';

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

  it('FLAGS a committed .env when the gitignore only covers .env.local (CRA default) — not bare .env', () => {
    // Regression: `\.env\b` matched inside `.env.local`, so a CRA gitignore (which lists
    // `.env.local`, `.env.*.local` but never bare `.env`) was wrongly read as covering `.env`.
    const cra = '/node_modules\n.env.local\n.env.development.local\n.env.test.local\n.env.production.local';
    const r = analyzeSecretLeak(['.env', 'src/App.tsx'], cra);
    expect(r.assessed).toBe(true);
    expect(r.exposed).toContain('.env');
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it('still covers bare .env via an any-dir (**/.env) or *.env rule, but NOT via .env.* or .env/ (dir)', () => {
    expect(analyzeSecretLeak(['.env'], '**/.env').findings).toHaveLength(0);       // any-dir → covered
    expect(analyzeSecretLeak(['.env'], '*.env').findings).toHaveLength(0);          // suffix glob → covered
    expect(analyzeSecretLeak(['.env'], '.env.*').findings.length).toBeGreaterThan(0); // only .env.<x> → NOT covered
    expect(analyzeSecretLeak(['.env'], '.env/').findings.length).toBeGreaterThan(0);  // directory rule → NOT covered
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

describe('gitignoreWithEnvCoverage (deterministic root-cause heal — App #7 + #8)', () => {
  it('appends .env coverage to an existing .gitignore that lacks it, then the leak clears', () => {
    // App #8's exact case: a 109-byte .gitignore existed but never listed .env.
    const before = 'node_modules/\ndist/\n*.log';
    const exposed = analyzeSecretLeak(['.env', 'src/App.tsx'], before).exposed;
    const healed = gitignoreWithEnvCoverage(before, exposed);
    expect(healed).not.toBeNull();
    expect(healed).toContain('.env');
    // the original rules are preserved …
    expect(healed).toContain('node_modules/');
    // … and re-assessing against the healed content clears the blocker (the whole point).
    expect(analyzeSecretLeak(['.env', 'src/App.tsx'], healed!).findings).toHaveLength(0);
  });

  it('creates a .gitignore from scratch when none exists', () => {
    const healed = gitignoreWithEnvCoverage(null, ['.env']);
    expect(healed).not.toBeNull();
    expect(analyzeSecretLeak(['.env'], healed!).findings).toHaveLength(0);
  });

  it('is idempotent — returns null when .env is already covered (no needless rewrite)', () => {
    expect(gitignoreWithEnvCoverage('node_modules/\n.env\n.env.local', ['.env'])).toBeNull();
    expect(gitignoreWithEnvCoverage('.env*', ['.env'])).toBeNull();
  });

  it('covers a specifically-exposed nested/other real env file by name', () => {
    const before = 'node_modules/';
    const exposed = analyzeSecretLeak(['backend/.env'], before).exposed;
    const healed = gitignoreWithEnvCoverage(before, exposed);
    expect(healed).not.toBeNull();
    // bare `.env` now covered (the detector keys on it) → nested backend/.env clears too.
    expect(analyzeSecretLeak(['backend/.env'], healed!).findings).toHaveLength(0);
  });

  it('never adds a template/example file as an ignore rule', () => {
    // Even if an example somehow lands in `exposed`, the heal must not gitignore a shareable template.
    const healed = gitignoreWithEnvCoverage('node_modules/', ['.env', '.env.example']);
    expect(healed).not.toBeNull();
    expect(healed).not.toContain('.env.example');
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
