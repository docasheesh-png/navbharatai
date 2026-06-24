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

  it('flags a hardcoded JWT signing secret (with or without options)', () => {
    for (const code of [
      "const t = jwt.sign(payload, 'my-super-secret');",
      "const t = jwt.sign({ id: 1, role: 'admin' }, 'my-super-secret', { expiresIn: '1h' });",
      "const t = jsonwebtoken.sign(user, `staticsecret123`);",
    ]) {
      const f = scanSecurity('src/auth.ts', code);
      expect(f.some((x) => x.rule === 'hardcoded-jwt-secret' && x.severity === 'high')).toBe(true);
    }
  });

  it('does NOT flag jwt.sign when the secret comes from a variable/env, nor the options string', () => {
    expect(scanSecurity('a.ts', "jwt.sign(payload, process.env.JWT_SECRET);").some((f) => f.rule === 'hardcoded-jwt-secret')).toBe(false);
    expect(scanSecurity('a.ts', "jwt.sign(payload, secretKey, { algorithm: 'HS256' });").some((f) => f.rule === 'hardcoded-jwt-secret')).toBe(false);
    expect(scanSecurity('a.ts', "jwt.sign(payload, 'your-secret-here');").some((f) => f.rule === 'hardcoded-jwt-secret')).toBe(false);
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

  it('flags new Function() as dynamic code (eval twin), not React FunctionComponent', () => {
    expect(scanSecurity('a.ts', 'const f = new Function("a", "return a+1");').some((x) => x.rule === 'dynamic-function')).toBe(true);
    expect(scanSecurity('a.ts', 'const f = new Function ( "x" );').some((x) => x.rule === 'dynamic-function')).toBe(true);
    // word boundary: must not flag a class whose name merely starts with "Function".
    expect(scanSecurity('a.tsx', 'const c = new FunctionComponent(props);').some((x) => x.rule === 'dynamic-function')).toBe(false);
  });

  it('flags vanilla-DOM XSS sinks (innerHTML/outerHTML/insertAdjacentHTML) but not safe uses', () => {
    expect(scanSecurity('a.ts', 'el.innerHTML = userInput;').some((f) => f.rule === 'unsafe-html-sink')).toBe(true);
    expect(scanSecurity('a.ts', 'node.outerHTML = `<b>${x}</b>`;').some((f) => f.rule === 'unsafe-html-sink')).toBe(true);
    expect(scanSecurity('a.ts', 'box.insertAdjacentHTML("beforeend", html);').some((f) => f.rule === 'unsafe-html-sink')).toBe(true);
    // Safe: clearing via empty string, reading innerHTML, and == comparisons are not flagged.
    expect(scanSecurity('a.ts', 'el.innerHTML = "";').some((f) => f.rule === 'unsafe-html-sink')).toBe(false);
    expect(scanSecurity('a.ts', "el.innerHTML = '';").some((f) => f.rule === 'unsafe-html-sink')).toBe(false);
    expect(scanSecurity('a.ts', 'const h = el.innerHTML;').some((f) => f.rule === 'unsafe-html-sink')).toBe(false);
    expect(scanSecurity('a.ts', 'if (el.innerHTML === "x") {}').some((f) => f.rule === 'unsafe-html-sink')).toBe(false);
  });

  it('flags SQL built from interpolation/concatenation but not parameterised queries', () => {
    expect(scanSecurity('a.ts', 'db.query(`SELECT * FROM users WHERE id = ${id}`);').some((f) => f.rule === 'sql-injection')).toBe(true);
    expect(scanSecurity('a.ts', 'await db.query("SELECT * FROM users WHERE name = " + name);').some((f) => f.rule === 'sql-injection')).toBe(true);
    expect(scanSecurity('a.ts', 'conn.execute(`UPDATE accounts SET bal=${b} WHERE id=${id}`);').some((f) => f.rule === 'sql-injection')).toBe(true);
    // Safe: a parameterised query, a static query, and a literal+literal join are not flagged.
    expect(scanSecurity('a.ts', 'db.query("SELECT * FROM users WHERE id = ?", [id]);').some((f) => f.rule === 'sql-injection')).toBe(false);
    expect(scanSecurity('a.ts', 'db.query(`SELECT * FROM users`);').some((f) => f.rule === 'sql-injection')).toBe(false);
    expect(scanSecurity('a.ts', 'db.query("SELECT id FROM " + "users");').some((f) => f.rule === 'sql-injection')).toBe(false);
  });

  it('flags a hardcoded Authorization Bearer/Basic header but not the env form', () => {
    expect(scanSecurity('a.ts', "fetch(u, { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9' } });").some((f) => f.rule === 'hardcoded-auth-header')).toBe(true);
    expect(scanSecurity('a.ts', 'const h = { "Authorization": "Basic dXNlcjpwYXNzd29yZA==" };').some((f) => f.rule === 'hardcoded-auth-header')).toBe(true);
    // Safe: env-injected token and placeholders are not flagged.
    expect(scanSecurity('a.ts', 'const h = { Authorization: `Bearer ${token}` };').some((f) => f.rule === 'hardcoded-auth-header')).toBe(false);
    expect(scanSecurity('a.ts', "const h = { Authorization: 'Bearer YOUR_TOKEN_HERE' };").some((f) => f.rule === 'hardcoded-auth-header')).toBe(false);
  });

  it('flags distinctive provider tokens hardcoded in source (GitHub/Google/Slack/Stripe)', () => {
    // Tokens are assembled at runtime so no contiguous secret-format literal lives in
    // this file (which would trip secret-scanning push protection) — the scanner only
    // ever sees the joined string.
    const body = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'; // 36 alphanumerics, not a token by itself
    expect(scanSecurity('a.ts', `const t = "${'gh' + 'p_' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(true);
    expect(scanSecurity('a.ts', `const g = "${'AI' + 'za' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(true);
    expect(scanSecurity('a.ts', `const s = "${'xo' + 'xb-' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(true);
    expect(scanSecurity('a.ts', `const k = "${'sk' + '_live_' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(true);
    // Safe: env-injected, a placeholder/example, and an ordinary URL are not flagged.
    expect(scanSecurity('a.ts', 'const t = process.env.GITHUB_TOKEN;').some((f) => f.rule === 'hardcoded-provider-token')).toBe(false);
    expect(scanSecurity('a.ts', `const ex = "${'gh' + 'p_' + 'EXAMPLE' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(false);
    expect(scanSecurity('a.ts', 'const u = "https://github.com/user/repo";').some((f) => f.rule === 'hardcoded-provider-token')).toBe(false);
  });

  it('flags target="_blank" without rel="noopener" (reverse tabnabbing) but not the safe form', () => {
    expect(scanSecurity('a.tsx', '<a href="https://x.com" target="_blank">go</a>').some((f) => f.rule === 'unsafe-target-blank')).toBe(true);
    // Safe: rel="noopener" present, and a non-_blank target.
    expect(scanSecurity('a.tsx', '<a href="https://x.com" target="_blank" rel="noopener noreferrer">go</a>').some((f) => f.rule === 'unsafe-target-blank')).toBe(false);
    expect(scanSecurity('a.tsx', '<a href="/x" target="_self">go</a>').some((f) => f.rule === 'unsafe-target-blank')).toBe(false);
  });

  it('flags a javascript: URL in href/src (XSS) but not the void(0) no-op placeholder', () => {
    expect(scanSecurity('a.tsx', '<a href="javascript:stealCookies()">x</a>').some((f) => f.rule === 'javascript-uri')).toBe(true);
    expect(scanSecurity('a.tsx', '<iframe src="javascript:alert(1)" />').some((f) => f.rule === 'javascript-uri')).toBe(true);
    // Safe: the common no-op placeholder and a real URL are not flagged.
    expect(scanSecurity('a.tsx', '<a href="javascript:void(0)" onClick={go}>x</a>').some((f) => f.rule === 'javascript-uri')).toBe(false);
    expect(scanSecurity('a.tsx', '<a href="https://x.com">x</a>').some((f) => f.rule === 'javascript-uri')).toBe(false);
  });

  it('flags postMessage with a wildcard target origin but not a specific one', () => {
    expect(scanSecurity('a.ts', "iframe.contentWindow.postMessage(data, '*');").some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(true);
    expect(scanSecurity('a.ts', "win.postMessage(payload, 'https://app.example.com');").some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(false);
  });

  it('flags document.write/document.writeln but not an unrelated .write', () => {
    expect(scanSecurity('a.ts', 'document.write("<h1>" + userInput + "</h1>");').some((f) => f.rule === 'document-write')).toBe(true);
    expect(scanSecurity('a.ts', 'document.writeln(html);').some((f) => f.rule === 'document-write')).toBe(true);
    expect(scanSecurity('a.ts', 'stream.write(buf);').some((f) => f.rule === 'document-write')).toBe(false);
  });

  it('flags setTimeout/setInterval with a string (eval) but not a function argument', () => {
    expect(scanSecurity('a.ts', 'setTimeout("doStuff()", 100);').some((f) => f.rule === 'settimeout-string')).toBe(true);
    expect(scanSecurity('a.ts', "setInterval('tick()', 1000);").some((f) => f.rule === 'settimeout-string')).toBe(true);
    expect(scanSecurity('a.ts', 'setTimeout(() => doStuff(), 100);').some((f) => f.rule === 'settimeout-string')).toBe(false);
    expect(scanSecurity('a.ts', 'setTimeout(doStuff, 100);').some((f) => f.rule === 'settimeout-string')).toBe(false);
  });

  it('flags an open redirect to request input, but not a static or fixed-path redirect', () => {
    expect(scanSecurity('a.ts', 'res.redirect(req.query.url);').some((f) => f.rule === 'open-redirect')).toBe(true);
    expect(scanSecurity('a.ts', 'res.redirect(302, req.query.next);').some((f) => f.rule === 'open-redirect')).toBe(true);
    expect(scanSecurity('a.ts', "res.redirect('/login');").some((f) => f.rule === 'open-redirect')).toBe(false);
    expect(scanSecurity('a.ts', 'res.redirect(`/go?to=${req.query.next}`);').some((f) => f.rule === 'open-redirect')).toBe(false);
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
