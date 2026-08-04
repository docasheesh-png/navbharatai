import { describe, it, expect } from 'vitest';
import { redactCredentialLogLine, redactCredentialLogs } from './credentialLogRedaction';
import { scanCompliance, lineLogsCredential } from './ComplianceAnalysis';

describe('redactCredentialLogLine — the exact SaaS-dashboard failure case', () => {
  it('redacts a login handler that logs the password (the real readiness blocker)', () => {
    const out = redactCredentialLogLine(`  console.log('login', email, password);`);
    expect(out).toBe('  console.log();');
    // and the rewrite clears the compliance finding
    expect(lineLogsCredential(out!)).toBe(false);
  });

  it('redacts every credential/token variant the detector flags', () => {
    for (const line of [
      `console.log('otp is', otp)`,
      `console.error("api_key", apiKey);`,
      `console.warn('access_token:', token, accessToken)`,
      `console.info('secret =', secret);`,
      `console.debug('cvv', cvv)`,
    ]) {
      const out = redactCredentialLogLine(line);
      expect(out, line).not.toBeNull();
      expect(lineLogsCredential(out!), out!).toBe(false);
    }
  });

  it('preserves indentation and a trailing semicolon / trailing statement', () => {
    expect(redactCredentialLogLine(`\t\tconsole.log('pw', password);`)).toBe('\t\tconsole.log();');
    expect(redactCredentialLogLine(`console.log('pw', password); doNext();`)).toBe('console.log(); doNext();');
  });

  it('is idempotent — an already-empty console call is left alone', () => {
    expect(redactCredentialLogLine('console.log();')).toBeNull();
    expect(redactCredentialLogLine(redactCredentialLogLine(`console.log('secret', s)`)!)).toBeNull();
  });
});

describe('redactCredentialLogLine — safety: never break the app (skips the ambiguous)', () => {
  it('leaves lines that do not log a credential untouched', () => {
    expect(redactCredentialLogLine(`console.log('rendered dashboard')`)).toBeNull();
    expect(redactCredentialLogLine(`const x = computeSecretSauce();`)).toBeNull();
  });

  it('skips a NON-standalone console (assignment / nested in another call)', () => {
    expect(redactCredentialLogLine(`const r = console.log('secret', s);`)).toBeNull();
    expect(redactCredentialLogLine(`if (dbg) console.log('password', p);`)).toBeNull();
  });

  it('skips a MULTI-LINE console call (parens do not balance on the flagged line)', () => {
    expect(redactCredentialLogLine(`console.log('password', password,`)).toBeNull();
  });

  it('skips a line containing a template literal (unsafe to bound single-line)', () => {
    expect(redactCredentialLogLine('console.log(`otp=${otp}`)')).toBeNull();
  });

  it('does not miscount parens/commas inside string arguments', () => {
    const out = redactCredentialLogLine(`console.log('password (hashed):', password)`);
    expect(out).toBe('console.log()');
    expect(lineLogsCredential(out!)).toBe(false);
  });
});

describe('redactCredentialLogs — whole-project, and it clears the readiness blocker', () => {
  it('redacts across files and reports each redaction', () => {
    const files = {
      'src/hooks/useAuth.ts': `export function useAuth() {\n  const login = (email, password) => {\n    console.log('auth', email, password);\n    return api.login(email, password);\n  };\n  return { login };\n}`,
      'src/pages/DashboardPage.tsx': `export const DashboardPage = () => <div>ok</div>;`,
    };
    const res = redactCredentialLogs(files);
    expect(res.redactions).toHaveLength(1);
    expect(res.redactions[0].file).toBe('src/hooks/useAuth.ts');
    expect(res.files['src/hooks/useAuth.ts']).toContain('console.log();');
    expect(res.files['src/hooks/useAuth.ts']).toContain('return api.login(email, password);'); // real logic untouched
    // untouched file shares the original reference (pure, minimal churn)
    expect(res.files['src/pages/DashboardPage.tsx']).toBe(files['src/pages/DashboardPage.tsx']);
  });

  it('the redacted project no longer trips the pii-in-logs readiness blocker', () => {
    const file = `const submit = () => {\n  console.log('user password', form.password);\n};`;
    const before = scanCompliance('src/Login.tsx', file).filter((i) => i.severity === 'high');
    expect(before).toHaveLength(1); // reproduces the blocker
    const healed = redactCredentialLogs({ 'src/Login.tsx': file });
    const after = scanCompliance('src/Login.tsx', healed.files['src/Login.tsx']).filter((i) => i.severity === 'high');
    expect(after).toHaveLength(0); // blocker gone
  });

  it('skips test/vendor files (never the product surface)', () => {
    const files = { 'src/auth.test.ts': `console.log('secret', s);` };
    expect(redactCredentialLogs(files).redactions).toHaveLength(0);
  });

  it('is a no-op on a clean project', () => {
    const files = { 'src/App.tsx': `export default () => <div/>;` };
    expect(redactCredentialLogs(files).redactions).toHaveLength(0);
  });
});
