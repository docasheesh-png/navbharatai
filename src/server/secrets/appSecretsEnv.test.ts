import { describe, it, expect } from 'vitest';
import { mergeDotEnv, gitignoreWithEnv, isValidEnvName } from './appSecretsEnv';

describe('isValidEnvName', () => {
  it('accepts POSIX env names and rejects injection-y names', () => {
    expect(isValidEnvName('API_KEY')).toBe(true);
    expect(isValidEnvName('_x1')).toBe(true);
    expect(isValidEnvName('1KEY')).toBe(false);
    expect(isValidEnvName('A=B')).toBe(false);
    expect(isValidEnvName('A B')).toBe(false);
    expect(isValidEnvName('A\nB')).toBe(false);
  });
});

describe('mergeDotEnv', () => {
  it('appends vault keys to an empty file', () => {
    expect(mergeDotEnv('', { API_KEY: 'sk_live_123' })).toBe('API_KEY=sk_live_123\n');
  });

  it('OVERRIDES a generated placeholder in place (vault wins), keeping order + other lines', () => {
    const existing = '# app config\nPORT=3000\nAPI_KEY=your_key_here\nDEBUG=true';
    const out = mergeDotEnv(existing, { API_KEY: 'sk_real' });
    expect(out).toContain('API_KEY=sk_real');
    expect(out).not.toContain('your_key_here');
    // untouched lines survive, order preserved
    expect(out.indexOf('PORT=3000')).toBeLessThan(out.indexOf('API_KEY=sk_real'));
    expect(out).toContain('# app config');
    expect(out).toContain('DEBUG=true');
  });

  it('appends keys not already present and keeps existing ones', () => {
    const out = mergeDotEnv('PORT=3000\n', { API_KEY: 'k', DB_URL: 'postgres://x' });
    expect(out).toContain('PORT=3000');
    expect(out).toContain('API_KEY=k');
    expect(out).toContain('DB_URL=postgres://x');
  });

  it('handles `export KEY=` form and only overrides the matching key', () => {
    const out = mergeDotEnv('export API_KEY=old\nOTHER=1', { API_KEY: 'new' });
    expect(out).toContain('API_KEY=new');
    expect(out).toContain('OTHER=1');
  });

  it('strips newlines from a value so it can never inject a second variable', () => {
    const out = mergeDotEnv('', { API_KEY: 'line1\nEVIL=pwned' });
    expect(out).toBe('API_KEY=line1 EVIL=pwned\n'); // the \n became a space — one line, one var
    expect(out.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('drops invalid env names', () => {
    expect(mergeDotEnv('', { '1BAD': 'x', GOOD: 'y' })).toBe('GOOD=y\n');
  });

  it('is idempotent — re-merging the same vault yields the same file', () => {
    const once = mergeDotEnv('PORT=3000', { API_KEY: 'k' });
    expect(mergeDotEnv(once, { API_KEY: 'k' })).toBe(once);
  });

  it('returns the input unchanged when the vault is empty', () => {
    expect(mergeDotEnv('PORT=3000\n', {})).toBe('PORT=3000\n');
  });
});

describe('gitignoreWithEnv', () => {
  it('adds .env when not covered', () => {
    expect(gitignoreWithEnv('node_modules\n')).toBe('node_modules\n.env\n');
  });
  it('is a no-op when already covered (any common form)', () => {
    for (const g of ['.env\n', 'node_modules\n.env\n', 'x\n.env*\n', '*.env\n']) {
      expect(gitignoreWithEnv(g)).toBe(g);
    }
  });
  it('handles an empty/absent gitignore', () => {
    expect(gitignoreWithEnv('')).toBe('.env\n');
    expect(gitignoreWithEnv(null)).toBe('.env\n');
  });
});
