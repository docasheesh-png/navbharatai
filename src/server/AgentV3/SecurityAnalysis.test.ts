import { describe, it, expect } from 'vitest';
import { scanSecurity, securitySummary } from './SecurityAnalysis';

describe('scanSecurity', () => {
  it('flags a hardcoded credential but ignores env-based and placeholder values', () => {
    const real = scanSecurity('src/config.ts', 'const apiKey = "sk_live_abcdef123456";');
    expect(real.some((f) => f.rule === 'hardcoded-secret' && f.severity === 'high')).toBe(true);

    expect(scanSecurity('a.ts', 'const apiKey = process.env.API_KEY;')).toEqual([]);
    expect(scanSecurity('b.ts', 'const password = "your-password-here";')).toEqual([]);
  });

  it('flags credentials embedded in a DB/queue connection string', () => {
    for (const uri of [
      'const url = "mongodb://admin:s3cret99@cluster0.mongodb.net/db";',
      'const pg = "postgres://user:p4ssword@db.host:5432/app";',
      'const r = "redis://:hunter2pw@redis.host:6379";',
      'const a = "amqps://guest:secretpw@rabbit.host";',
      'const m = "mongodb+srv://admin:topSecret1@cluster0.abcd.mongodb.net";',
    ]) {
      const f = scanSecurity('src/db.ts', uri);
      expect(f.some((x) => x.rule === 'connection-string-credentials' && x.severity === 'high')).toBe(true);
    }
  });

  it('does NOT flag connection strings without credentials or with env/placeholder values', () => {
    expect(scanSecurity('a.ts', 'const url = "mongodb://localhost:27017/db";')).toEqual([]);
    expect(scanSecurity('a.ts', 'const url = "postgres://db.host:5432/app";')).toEqual([]);
    expect(scanSecurity('a.ts', 'const url = `mongodb://admin:${process.env.DB_PASS}@host`;')).toEqual([]);
    expect(scanSecurity('a.ts', 'const url = "mysql://user:<password>@host";')).toEqual([]);
    // a non-DB scheme with a colon/at is not a DB credential leak
    expect(scanSecurity('a.ts', 'const u = "https://api.example.com/v1";')).toEqual([]);
  });

  it('flags command injection from a dynamically-built shell command', () => {
    for (const code of [
      'execSync(`rm -rf ${dir}`);',
      'exec("git clone " + repoUrl);',
      'exec(`ls ${userPath}`);',
      'spawnSync(`sh -c ${cmd}`);',
      'execFile(`tool ${arg}`);',
    ]) {
      const f = scanSecurity('src/run.ts', code);
      expect(f.some((x) => x.rule === 'command-injection' && x.severity === 'high')).toBe(true);
    }
  });

  it('does NOT flag a constant exec command or RegExp.exec / member exec', () => {
    expect(scanSecurity('a.ts', 'execSync("ls -la");').some((f) => f.rule === 'command-injection')).toBe(false);
    expect(scanSecurity('a.ts', 'const m = /ab+c/.exec(`${input}`);').some((f) => f.rule === 'command-injection')).toBe(false);
    expect(scanSecurity('a.ts', 'const m = pattern.exec("foo" + bar);').some((f) => f.rule === 'command-injection')).toBe(false);
    expect(scanSecurity('a.ts', 'exec(commandVariable);').some((f) => f.rule === 'command-injection')).toBe(false);
  });

  it('flags AWS keys and private keys', () => {
    expect(scanSecurity('a.ts', 'const k = "AKIAIOSFODNN7EXAMPLE";').some((f) => f.rule === 'aws-access-key')).toBe(true);
    expect(scanSecurity('key.pem', '-----BEGIN RSA PRIVATE KEY-----').some((f) => f.rule === 'private-key')).toBe(true);
  });

  it('flags dangerous code patterns with line numbers', () => {
    const f = scanSecurity('src/App.tsx', [
      'const x = 1;',
      'el.innerHTML = dangerouslySetInnerHTML;',
    ].join('\n'));
    const danger = f.find((x) => x.rule === 'dangerous-html');
    expect(danger).toBeTruthy();
    expect(danger!.line).toBe(2);
  });

  it('flags insecure http but allows localhost and https', () => {
    expect(scanSecurity('a.ts', 'fetch("http://api.example.com/x")').some((f) => f.rule === 'insecure-http')).toBe(true);
    expect(scanSecurity('a.ts', 'fetch("http://localhost:3000/x")')).toEqual([]);
    expect(scanSecurity('a.ts', 'fetch("https://api.example.com/x")')).toEqual([]);
  });

  it('returns clean for safe code', () => {
    expect(scanSecurity('a.ts', 'export const add = (a, b) => a + b;')).toEqual([]);
  });
});

describe('securitySummary', () => {
  it('summarises by severity and reports clean when empty', () => {
    expect(securitySummary([])).toContain('no hardcoded secrets');
    const sum = securitySummary([
      { file: 'a.ts', line: 1, severity: 'high', rule: 'hardcoded-secret', message: 'x' },
      { file: 'b.ts', line: 2, severity: 'low', rule: 'insecure-http', message: 'y' },
    ]);
    expect(sum).toContain('1 high');
    expect(sum).toContain('1 low');
    expect(sum).toContain('a.ts:1');
  });
});
