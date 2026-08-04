import { describe, it, expect } from 'vitest';
import { scanSecurity, securitySummary, isPlaceholderValue } from './SecurityAnalysis';

describe('scanSecurity', () => {
  it('flags a hardcoded credential but ignores env-based and placeholder values', () => {
    const real = scanSecurity('src/config.ts', 'const apiKey = "sk_live_abcdef123456";');
    expect(real.some((f) => f.rule === 'hardcoded-secret' && f.severity === 'high')).toBe(true);

    expect(scanSecurity('a.ts', 'const apiKey = process.env.API_KEY;')).toEqual([]);
    expect(scanSecurity('b.ts', 'const password = "your-password-here";')).toEqual([]);
    // FP fix: a validation/UI message (has spaces) is not a hardcoded credential.
    expect(scanSecurity('v.ts', 'const password = "Password must be 8 characters";').some((f) => f.rule === 'hardcoded-secret')).toBe(false);
    expect(scanSecurity('v.ts', 'const secret = "the secret to success";').some((f) => f.rule === 'hardcoded-secret')).toBe(false);
    // a real space-free credential is still flagged.
    expect(scanSecurity('c.ts', 'const password = "Hunter2Pass99";').some((f) => f.rule === 'hardcoded-secret')).toBe(true);
  });

  it('does NOT go blind on a secret inside JSX or on a line with a test-suffixed word (the placeholder-guard scope bug)', () => {
    // The guard used to test the WHOLE line: a `<` (every JSX line) or a word like "latest"/"fastest"
    // (contains "test") suppressed the finding — so a real credential in a .tsx prop / on a commented
    // line reported clean. (Random non-format values are used so this test file carries no scannable
    // secret; NavBharatAI's hardcoded-secret rule flags any 8+ non-space value under a secret key.)
    const V = 'aB3xK9mP2qR7sT1uV4wZ'; // 20 non-space chars, no known-provider prefix, no placeholder token
    expect(scanSecurity('src/Pay.tsx', `<PayButton apiKey="${V}" />`)
      .some((f) => f.rule === 'hardcoded-secret' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('src/g.ts', `const password = "${V}"; // fastest path`)
      .some((f) => f.rule === 'hardcoded-secret')).toBe(true);
    expect(scanSecurity('src/a.ts', `const apiKey = "${V}"; // latest key`)
      .some((f) => f.rule === 'hardcoded-secret')).toBe(true);
    // …but a genuine placeholder VALUE (or an env form) is still suppressed.
    expect(scanSecurity('src/b.tsx', '<Cfg apiKey="your-api-key-here" />').some((f) => f.rule === 'hardcoded-secret')).toBe(false);
    expect(scanSecurity('src/c.tsx', '<Cfg apiKey="test-placeholder-123" />').some((f) => f.rule === 'hardcoded-secret')).toBe(false);
  });

  it('flags the global eval() but not member methods named eval (FP fix)', () => {
    expect(scanSecurity('a.ts', 'const r = eval(userCode);').some((f) => f.rule === 'eval-usage')).toBe(true);
    // mathjs / mongo / other library .eval() methods are not the dangerous global eval.
    expect(scanSecurity('a.ts', "const r = math.eval('2 + 2');").some((f) => f.rule === 'eval-usage')).toBe(false);
    expect(scanSecurity('a.ts', 'db.eval(jsFn);').some((f) => f.rule === 'eval-usage')).toBe(false);
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

  it('does NOT build-block on credentials in a .env file (they belong there) — downgraded to low, still reported', () => {
    // ROOT-CAUSE lock (autopsy build 6478f94d): `connection-string-credentials @ .env:2` was flagged HIGH,
    // blocked the readiness gate, and the un-fixable finding looped the reviewer to the 1740s wall-clock cap.
    for (const envName of ['.env', '.env.local', '.env.production', '.env.development.local']) {
      const f = scanSecurity(envName, 'DATABASE_URL=postgres://user:p4ssword@db.host:5432/app');
      const hit = f.find((x) => x.rule === 'connection-string-credentials');
      expect(hit).toBeDefined();                 // still REPORTED (honest, visible)
      expect(hit?.severity).toBe('low');          // but NEVER build-blocking high
    }
    // a redis/amqp connection string with a password in .env is likewise 'low', never a blocking high.
    expect(scanSecurity('.env', 'REDIS_URL=redis://:hunter2pw@redis.host:6379').find((x) => x.rule === 'connection-string-credentials')?.severity).toBe('low');
  });

  it('STILL blocks (high) on the same credential in real source, and in a committed .env.example template', () => {
    // real source — a DB URL hardcoded in a .ts must still fail the gate.
    expect(scanSecurity('src/db.ts', 'const url = "postgres://user:p4ssword@db.host:5432/app";').some((x) => x.rule === 'connection-string-credentials' && x.severity === 'high')).toBe(true);
    // .env.example is a COMMITTED template — a real secret there is a genuine leak, so it stays high (not downgraded).
    expect(scanSecurity('.env.example', 'DATABASE_URL=postgres://user:p4ssword@db.host:5432/app').some((x) => x.rule === 'connection-string-credentials' && x.severity === 'high')).toBe(true);
  });

  it('flags a client-exposed secret env var but not a publishable key', () => {
    expect(scanSecurity('a.ts', 'const k = import.meta.env.VITE_STRIPE_SECRET_KEY;').some((f) => f.rule === 'client-exposed-secret' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('.env', 'NEXT_PUBLIC_DB_PASSWORD=hunter2').some((f) => f.rule === 'client-exposed-secret')).toBe(true);
    expect(scanSecurity('a.ts', 'process.env.REACT_APP_PRIVATE_KEY').some((f) => f.rule === 'client-exposed-secret')).toBe(true);
    // a publishable key (no SECRET/PASSWORD/PRIVATE word) is meant to be public — not flagged.
    expect(scanSecurity('a.ts', 'const k = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;').some((f) => f.rule === 'client-exposed-secret')).toBe(false);
    expect(scanSecurity('a.ts', 'const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;').some((f) => f.rule === 'client-exposed-secret')).toBe(false);
  });

  it('flags credentials embedded in an http(s) URL but not a clean URL', () => {
    expect(scanSecurity('a.ts', "const u = 'https://admin:s3cretpw@api.acme.com/v1';").some((f) => f.rule === 'url-embedded-credentials' && f.severity === 'high')).toBe(true);
    // a clean URL or host:port (no user:pass@) is fine.
    expect(scanSecurity('a.ts', "const u = 'https://api.acme.com:8080/v1';").some((f) => f.rule === 'url-embedded-credentials')).toBe(false);
    // env/placeholder forms are ignored.
    expect(scanSecurity('a.ts', "const u = `https://${user}:${pass}@api.example.com`;").some((f) => f.rule === 'url-embedded-credentials')).toBe(false);
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
    expect(scanSecurity('a.ts', 'el.innerHTML += userInput;').some((f) => f.rule === 'unsafe-html-sink')).toBe(true);
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

  it('sql-injection does NOT fire on UI English that merely starts with a SQL verb (the Hospital-build false positive)', () => {
    // THE exact line that blocked a real build (readiness 0/100): an accessibility label.
    expect(scanSecurity('src/pages/Medicines.tsx', 'aria-label={`Delete ${med.name}`}').some((f) => f.rule === 'sql-injection')).toBe(false);
    expect(scanSecurity('a.tsx', 'const msg = `Update ${item.name} saved successfully`;').some((f) => f.rule === 'sql-injection')).toBe(false);
    expect(scanSecurity('a.tsx', 'const hint = `Select ${count} items from the dropdown`;').some((f) => f.rule === 'sql-injection')).toBe(false);
    expect(scanSecurity('a.tsx', 'toast(`Insert ${qty} units into inventory`);').some((f) => f.rule === 'sql-injection')).toBe(false);
    expect(scanSecurity('a.tsx', 'confirm("Delete " + med.name + "?");').some((f) => f.rule === 'sql-injection')).toBe(false);
  });

  it('sql-injection still fires on REAL SQL skeletons with interpolation/concatenation', () => {
    expect(scanSecurity('a.ts', 'db.run(`DELETE FROM sessions WHERE user_id = ${uid}`);').some((f) => f.rule === 'sql-injection')).toBe(true);
    expect(scanSecurity('a.ts', 'db.query(`SELECT ${cols} FROM orders WHERE status = ${s}`);').some((f) => f.rule === 'sql-injection')).toBe(true);
    expect(scanSecurity('a.ts', 'db.exec(`INSERT INTO logs (msg) VALUES (${m})`);').some((f) => f.rule === 'sql-injection')).toBe(true);
    expect(scanSecurity('a.ts', 'db.query("UPDATE users SET name=" + name + " WHERE id=1");').some((f) => f.rule === 'sql-injection')).toBe(true);
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
    expect(scanSecurity('a.ts', `const p = "${'github' + '_pat_' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(true);
    expect(scanSecurity('a.ts', `const a = "${'sk-' + 'ant-' + body}";`).some((f) => f.rule === 'hardcoded-provider-token')).toBe(true);
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

  it('flags document.domain assignment but not a comparison', () => {
    expect(scanSecurity('a.ts', "document.domain = 'example.com';").some((f) => f.rule === 'document-domain-write' && f.severity === 'medium')).toBe(true);
    // reading/comparing document.domain is fine.
    expect(scanSecurity('a.ts', "if (document.domain === 'app.acme.com') {}").some((f) => f.rule === 'document-domain-write')).toBe(false);
  });

  it('flags an iframe sandbox that allows both scripts and same-origin (escape) but not a safe one', () => {
    expect(scanSecurity('a.tsx', '<iframe src="/x" sandbox="allow-scripts allow-same-origin" />').some((f) => f.rule === 'iframe-sandbox-escape' && f.severity === 'medium')).toBe(true);
    // order-independent.
    expect(scanSecurity('a.tsx', '<iframe sandbox="allow-same-origin allow-forms allow-scripts" />').some((f) => f.rule === 'iframe-sandbox-escape')).toBe(true);
    // allow-scripts WITHOUT allow-same-origin is the safe form.
    expect(scanSecurity('a.tsx', '<iframe sandbox="allow-scripts allow-forms" />').some((f) => f.rule === 'iframe-sandbox-escape')).toBe(false);
  });

  it('flags a dynamic iframe srcdoc but not a static one', () => {
    expect(scanSecurity('a.tsx', '<iframe srcdoc={userHtml} />').some((f) => f.rule === 'iframe-srcdoc-dynamic' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.tsx', '<iframe srcdoc={`<p>${comment}</p>`} />').some((f) => f.rule === 'iframe-srcdoc-dynamic')).toBe(true);
    // a static srcdoc string is not flagged.
    expect(scanSecurity('a.tsx', '<iframe srcdoc="<p>Hello</p>" />').some((f) => f.rule === 'iframe-srcdoc-dynamic')).toBe(false);
  });

  it('flags a data:text/html URI in href/src but not a normal URL', () => {
    expect(scanSecurity('a.tsx', '<a href="data:text/html,<script>alert(1)</script>">x</a>').some((f) => f.rule === 'data-html-uri' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.tsx', '<iframe src="data:text/html;base64,PHNjcmlwdD4=" />').some((f) => f.rule === 'data-html-uri')).toBe(true);
    // a normal URL and a data image are fine.
    expect(scanSecurity('a.tsx', '<a href="https://x.com">x</a>').some((f) => f.rule === 'data-html-uri')).toBe(false);
    expect(scanSecurity('a.tsx', '<img src="data:image/png;base64,iVBOR" />').some((f) => f.rule === 'data-html-uri')).toBe(false);
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

  it('flags prototype pollution via deep-merge of request input but not a safe field merge', () => {
    expect(scanSecurity('a.ts', 'const cfg = _.merge({}, req.body);').some((f) => f.rule === 'prototype-pollution' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', 'lodash.defaultsDeep(target, req.query);').some((f) => f.rule === 'prototype-pollution')).toBe(true);
    expect(scanSecurity('a.ts', 'const o = $.extend(true, {}, req.body);').some((f) => f.rule === 'prototype-pollution')).toBe(true);
    // merging explicit, validated fields is safe.
    expect(scanSecurity('a.ts', 'const cfg = _.merge({}, { name: req.body.name });').some((f) => f.rule === 'prototype-pollution')).toBe(false);
  });

  it('flags an open redirect via a Location header from request input but not a fixed path', () => {
    expect(scanSecurity('a.ts', "res.setHeader('Location', req.query.next);").some((f) => f.rule === 'open-redirect-header' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', "res.set('location', req.body.url);").some((f) => f.rule === 'open-redirect-header')).toBe(true);
    // a fixed redirect target is fine.
    expect(scanSecurity('a.ts', "res.setHeader('Location', '/dashboard');").some((f) => f.rule === 'open-redirect-header')).toBe(false);
  });

  it('flags a raw request object used as a DB query (NoSQL injection) but not validated fields', () => {
    expect(scanSecurity('a.ts', 'const u = await User.findOne(req.body);').some((f) => f.rule === 'nosql-injection')).toBe(true);
    expect(scanSecurity('a.ts', 'db.collection("u").find(req.query);').some((f) => f.rule === 'nosql-injection')).toBe(true);
    // passing explicit, validated fields is the safe pattern.
    expect(scanSecurity('a.ts', 'const u = await User.findOne({ email: req.body.email });').some((f) => f.rule === 'nosql-injection')).toBe(false);
  });

  it('flags httpOnly:false on a cookie but not httpOnly:true', () => {
    expect(scanSecurity('a.ts', "res.cookie('sid', id, { httpOnly: false, secure: true });").some((f) => f.rule === 'cookie-httponly-false' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', "res.cookie('sid', id, { httpOnly: true });").some((f) => f.rule === 'cookie-httponly-false')).toBe(false);
  });

  it('flags SameSite=None without Secure but not when Secure is set', () => {
    expect(scanSecurity('a.ts', "res.cookie('sid', id, { sameSite: 'none' });").some((f) => f.rule === 'samesite-none-insecure' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', "res.cookie('sid', id, { sameSite: 'none', secure: false });").some((f) => f.rule === 'samesite-none-insecure')).toBe(true);
    // SameSite=None WITH Secure is the correct, accepted form.
    expect(scanSecurity('a.ts', "res.cookie('sid', id, { sameSite: 'none', secure: true });").some((f) => f.rule === 'samesite-none-insecure')).toBe(false);
    // SameSite=Lax/Strict is not affected.
    expect(scanSecurity('a.ts', "res.cookie('sid', id, { sameSite: 'lax' });").some((f) => f.rule === 'samesite-none-insecure')).toBe(false);
  });

  it('flags a weak bcrypt cost factor (<10) but not a strong one', () => {
    expect(scanSecurity('a.ts', 'const h = await bcrypt.hash(password, 8);').some((f) => f.rule === 'weak-bcrypt-rounds' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', 'const salt = bcrypt.genSaltSync(5);').some((f) => f.rule === 'weak-bcrypt-rounds')).toBe(true);
    // 10+ rounds (two digits) is fine.
    expect(scanSecurity('a.ts', 'const h = await bcrypt.hash(password, 12);').some((f) => f.rule === 'weak-bcrypt-rounds')).toBe(false);
    expect(scanSecurity('a.ts', 'const salt = bcrypt.genSaltSync(10);').some((f) => f.rule === 'weak-bcrypt-rounds')).toBe(false);
  });

  it("flags app.set('trust proxy', true) but not a specific hop count", () => {
    expect(scanSecurity('a.ts', "app.set('trust proxy', true);").some((f) => f.rule === 'express-trust-proxy-true' && f.severity === 'medium')).toBe(true);
    // a specific hop count / IP is the correct, non-blanket form.
    expect(scanSecurity('a.ts', "app.set('trust proxy', 1);").some((f) => f.rule === 'express-trust-proxy-true')).toBe(false);
  });

  it('flags ECB cipher mode but not an authenticated mode', () => {
    expect(scanSecurity('a.ts', "const c = crypto.createCipheriv('aes-256-ecb', key, null);").some((f) => f.rule === 'insecure-cipher-ecb' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', "const c = crypto.createCipheriv('des-ecb', key, null);").some((f) => f.rule === 'insecure-cipher-ecb')).toBe(true);
    // GCM/CBC are not flagged.
    expect(scanSecurity('a.ts', "const c = crypto.createCipheriv('aes-256-gcm', key, iv);").some((f) => f.rule === 'insecure-cipher-ecb')).toBe(false);
    expect(scanSecurity('a.ts', "const c = crypto.createCipheriv('aes-256-cbc', key, iv);").some((f) => f.rule === 'insecure-cipher-ecb')).toBe(false);
  });

  it('flags a weak RSA key size but not a strong one', () => {
    expect(scanSecurity('a.ts', 'generateKeyPairSync("rsa", { modulusLength: 1024 });').some((f) => f.rule === 'weak-rsa-key-size' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', 'crypto.generateKeyPair("rsa", { modulusLength: 512 });').some((f) => f.rule === 'weak-rsa-key-size')).toBe(true);
    // 2048+ is fine.
    expect(scanSecurity('a.ts', 'generateKeyPairSync("rsa", { modulusLength: 2048 });').some((f) => f.rule === 'weak-rsa-key-size')).toBe(false);
    expect(scanSecurity('a.ts', 'generateKeyPairSync("rsa", { modulusLength: 4096 });').some((f) => f.rule === 'weak-rsa-key-size')).toBe(false);
  });

  it('flags a file path built from request input (path traversal) but not a fixed path', () => {
    expect(scanSecurity('a.ts', 'res.sendFile(req.params.name);').some((f) => f.rule === 'path-traversal')).toBe(true);
    expect(scanSecurity('a.ts', 'fs.readFile(`./uploads/${req.query.file}`, cb);').some((f) => f.rule === 'path-traversal')).toBe(true);
    expect(scanSecurity('a.ts', 'createReadStream(req.body.path).pipe(res);').some((f) => f.rule === 'path-traversal')).toBe(true);
    // a fixed, non-request path is not flagged.
    expect(scanSecurity('a.ts', "res.sendFile(path.join(__dirname, 'index.html'));").some((f) => f.rule === 'path-traversal')).toBe(false);
  });

  it('flags a server-side request to a request-controlled URL (SSRF) but not a fixed base', () => {
    expect(scanSecurity('a.ts', 'const r = await fetch(req.query.url);').some((f) => f.rule === 'ssrf' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', 'const r = await axios.get(req.body.target);').some((f) => f.rule === 'ssrf')).toBe(true);
    expect(scanSecurity('a.ts', 'const r = await axios(req.body);').some((f) => f.rule === 'ssrf')).toBe(true);
    expect(scanSecurity('a.ts', 'http.get(req.params.host, cb);').some((f) => f.rule === 'ssrf')).toBe(true);
    expect(scanSecurity('a.ts', 'const r = await got(req.query.u);').some((f) => f.rule === 'ssrf')).toBe(true);
    // a fixed base with the input appended (not the whole URL) is not flagged here.
    expect(scanSecurity('a.ts', 'const r = await fetch(`/api/items/${req.query.id}`);').some((f) => f.rule === 'ssrf')).toBe(false);
    expect(scanSecurity('a.ts', 'const r = await fetch("https://api.example.com/v1");').some((f) => f.rule === 'ssrf')).toBe(false);
  });

  it('flags a RegExp built from request input (ReDoS) but not a fixed pattern', () => {
    expect(scanSecurity('a.ts', 'const re = new RegExp(req.query.search);').some((f) => f.rule === 'regexp-from-request' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', 'const re = new RegExp(`^${req.body.prefix}`);').some((f) => f.rule === 'regexp-from-request')).toBe(true);
    // a fixed/literal pattern is fine.
    expect(scanSecurity('a.ts', 'const re = new RegExp("^[a-z]+$");').some((f) => f.rule === 'regexp-from-request')).toBe(false);
  });

  it('flags XML entity expansion (XXE) but not a parser with it disabled', () => {
    expect(scanSecurity('a.ts', 'const doc = libxml.parseXml(xml, { noent: true });').some((f) => f.rule === 'xxe-entity-expansion' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', 'parser.parse(xml, { resolveEntities: true });').some((f) => f.rule === 'xxe-entity-expansion')).toBe(true);
    // entity expansion off (the safe default) is not flagged.
    expect(scanSecurity('a.ts', 'const doc = libxml.parseXml(xml, { noent: false });').some((f) => f.rule === 'xxe-entity-expansion')).toBe(false);
  });

  it('flags disabled TLS certificate verification (MITM) in both forms', () => {
    expect(scanSecurity('a.ts', 'const agent = new https.Agent({ rejectUnauthorized: false });').some((f) => f.rule === 'disable-tls-verification' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';").some((f) => f.rule === 'disable-tls-verification')).toBe(true);
    // the secure default (verification ON) is not flagged.
    expect(scanSecurity('a.ts', 'const agent = new https.Agent({ rejectUnauthorized: true });').some((f) => f.rule === 'disable-tls-verification')).toBe(false);
  });

  it("flags window.open() without 'noopener' (reverse tabnabbing) but not the safe forms", () => {
    expect(scanSecurity('a.ts', "window.open(externalUrl, '_blank');").some((f) => f.rule === 'window-open-no-opener' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', "window.open('https://x.com');").some((f) => f.rule === 'window-open-no-opener')).toBe(true);
    // passing 'noopener' in the features arg is safe.
    expect(scanSecurity('a.ts', "window.open(url, '_blank', 'noopener,noreferrer');").some((f) => f.rule === 'window-open-no-opener')).toBe(false);
    // an explicit opener cleanup is safe.
    expect(scanSecurity('a.ts', 'const w = window.open(url); w.opener = null;').some((f) => f.rule === 'window-open-no-opener')).toBe(false);
    // a no-arg window.open() is not flagged.
    expect(scanSecurity('a.ts', 'window.open();').some((f) => f.rule === 'window-open-no-opener')).toBe(false);
  });

  it('flags a deprecated TLS/SSL version but not TLS 1.2+', () => {
    expect(scanSecurity('a.ts', "const o = { minVersion: 'TLSv1' };").some((f) => f.rule === 'tls-weak-version' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', "const o = { minVersion: 'TLSv1.1' };").some((f) => f.rule === 'tls-weak-version')).toBe(true);
    expect(scanSecurity('a.ts', "const o = { secureProtocol: 'TLSv1_method' };").some((f) => f.rule === 'tls-weak-version')).toBe(true);
    // the modern minimum is not flagged.
    expect(scanSecurity('a.ts', "const o = { minVersion: 'TLSv1.2' };").some((f) => f.rule === 'tls-weak-version')).toBe(false);
  });

  it('flags Node vm.runIn*/compileFunction code execution but not unrelated calls', () => {
    expect(scanSecurity('a.ts', 'const r = vm.runInNewContext(userCode, ctx);').some((f) => f.rule === 'vm-code-execution' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', 'vm.runInThisContext(src);').some((f) => f.rule === 'vm-code-execution')).toBe(true);
    expect(scanSecurity('a.ts', 'const fn = vm.compileFunction(body, args);').some((f) => f.rule === 'vm-code-execution')).toBe(true);
    // a method named similarly on another object is not flagged.
    expect(scanSecurity('a.ts', 'svm.runModel(data);').some((f) => f.rule === 'vm-code-execution')).toBe(false);
  });

  it('flags Math.random() for a token/secret but not ordinary non-security use', () => {
    expect(scanSecurity('a.ts', 'const token = Math.random().toString(36).slice(2);').some((f) => f.rule === 'insecure-random-token' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('a.ts', 'const otp = Math.floor(Math.random() * 1000000);').some((f) => f.rule === 'insecure-random-token')).toBe(true);
    // ordinary non-security randomness is not flagged.
    expect(scanSecurity('a.ts', 'const jitter = Math.random() * 100;').some((f) => f.rule === 'insecure-random-token')).toBe(false);
    expect(scanSecurity('a.ts', 'const i = Math.floor(Math.random() * items.length);').some((f) => f.rule === 'insecure-random-token')).toBe(false);
  });

  it('flags MD5/SHA-1 used for a security value but not a non-security checksum', () => {
    expect(scanSecurity('a.ts', "const h = crypto.createHash('md5').update(password).digest('hex');").some((f) => f.rule === 'weak-hash-security' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('a.ts', "const sig = createHash('sha1').update(token).digest('hex');").some((f) => f.rule === 'weak-hash-security')).toBe(true);
    // an md5 ETag / cache key (no security keyword) is a legitimate non-security use.
    expect(scanSecurity('a.ts', "const etag = createHash('md5').update(fileBuffer).digest('hex');").some((f) => f.rule === 'weak-hash-security')).toBe(false);
    // SHA-256 is fine.
    expect(scanSecurity('a.ts', "const h = createHash('sha256').update(password).digest('hex');").some((f) => f.rule === 'weak-hash-security')).toBe(false);
  });

  it('flags insecure Electron webPreferences but not the secure defaults', () => {
    expect(scanSecurity('main.ts', 'webPreferences: { nodeIntegration: true }').some((f) => f.rule === 'electron-insecure-webprefs' && f.severity === 'high')).toBe(true);
    expect(scanSecurity('main.ts', 'webPreferences: { contextIsolation: false }').some((f) => f.rule === 'electron-insecure-webprefs')).toBe(true);
    // the hardened defaults are not flagged.
    expect(scanSecurity('main.ts', 'webPreferences: { nodeIntegration: false, contextIsolation: true }').some((f) => f.rule === 'electron-insecure-webprefs')).toBe(false);
  });

  it('flags Handlebars triple-stache raw HTML but not the escaped double form', () => {
    expect(scanSecurity('t.hbs', '<div>{{{ userBio }}}</div>').some((f) => f.rule === 'handlebars-triple-stache' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('t.hbs', '<div>{{ userName }}</div>').some((f) => f.rule === 'handlebars-triple-stache')).toBe(false);
  });

  it('flags EJS unescaped output but not the escaped form or include() partials', () => {
    expect(scanSecurity('t.ejs', '<p><%- comment.body %></p>').some((f) => f.rule === 'ejs-unescaped-output' && f.severity === 'medium')).toBe(true);
    expect(scanSecurity('t.ejs', '<p><%= comment.body %></p>').some((f) => f.rule === 'ejs-unescaped-output')).toBe(false);
    // the standard, safe partial-include idiom is not flagged.
    expect(scanSecurity('t.ejs', "<%- include('partials/header') %>").some((f) => f.rule === 'ejs-unescaped-output')).toBe(false);
  });

  it('flags Angular bypassSecurityTrust* (sanitisation disabled) but not normal sanitizer use', () => {
    expect(scanSecurity('app.ts', 'this.html = this.sanitizer.bypassSecurityTrustHtml(raw);').some((f) => f.rule === 'angular-bypass-security')).toBe(true);
    expect(scanSecurity('app.ts', 'const u = ds.bypassSecurityTrustResourceUrl(src);').some((f) => f.rule === 'angular-bypass-security')).toBe(true);
    expect(scanSecurity('app.ts', 'const clean = this.sanitizer.sanitize(ctx, raw);').some((f) => f.rule === 'angular-bypass-security')).toBe(false);
  });

  it('flags Vue v-html as an XSS sink but not a normal attribute', () => {
    expect(scanSecurity('App.vue', '<div v-html="userBio"></div>').some((f) => f.rule === 'vue-v-html')).toBe(true);
    expect(scanSecurity('App.vue', '<div v-text="userBio"></div>').some((f) => f.rule === 'vue-v-html')).toBe(false);
    expect(scanSecurity('App.vue', '<div>{{ userBio }}</div>').some((f) => f.rule === 'vue-v-html')).toBe(false);
  });

  it('flags crypto.pseudoRandomBytes but not the secure randomBytes', () => {
    expect(scanSecurity('a.ts', 'const t = crypto.pseudoRandomBytes(16);').some((f) => f.rule === 'pseudo-random-bytes')).toBe(true);
    expect(scanSecurity('a.ts', 'const t = crypto.randomBytes(16);').some((f) => f.rule === 'pseudo-random-bytes')).toBe(false);
  });

  it('flags the legacy createCipher/createDecipher but not the correct createCipheriv', () => {
    expect(scanSecurity('a.ts', "const c = crypto.createCipher('aes-256-cbc', pass);").some((f) => f.rule === 'weak-crypto-cipher')).toBe(true);
    expect(scanSecurity('a.ts', 'const d = crypto.createDecipher(algo, pass);').some((f) => f.rule === 'weak-crypto-cipher')).toBe(true);
    // The correct IV-based API is not flagged.
    expect(scanSecurity('a.ts', "const c = crypto.createCipheriv('aes-256-cbc', key, iv);").some((f) => f.rule === 'weak-crypto-cipher')).toBe(false);
    expect(scanSecurity('a.ts', 'const d = crypto.createDecipheriv(algo, key, iv);').some((f) => f.rule === 'weak-crypto-cipher')).toBe(false);
  });

  it('flags the JWT "none" algorithm (auth bypass) but not a real algorithm', () => {
    expect(scanSecurity('a.ts', `jwt.sign(payload, secret, { algorithm: 'none' });`).some((f) => f.rule === 'jwt-none-algorithm')).toBe(true);
    expect(scanSecurity('a.ts', `jwt.verify(token, secret, { algorithms: ['HS256', 'none'] });`).some((f) => f.rule === 'jwt-none-algorithm')).toBe(true);
    expect(scanSecurity('a.ts', `jwt.verify(token, secret, { algorithms: ['RS256'] });`).some((f) => f.rule === 'jwt-none-algorithm')).toBe(false);
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

  it('does NOT flag XML/SVG namespace & schema URIs as insecure-http (FP fix)', () => {
    // every inline SVG carries this xmlns — it is an identifier, not an endpoint.
    expect(scanSecurity('a.tsx', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">').some((f) => f.rule === 'insecure-http')).toBe(false);
    expect(scanSecurity('a.ts', 'const NS = "http://www.w3.org/1999/xhtml";').some((f) => f.rule === 'insecure-http')).toBe(false);
    expect(scanSecurity('a.xml', 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"').some((f) => f.rule === 'insecure-http')).toBe(false);
    // a real http endpoint on the same kind of line is still flagged.
    expect(scanSecurity('a.ts', 'const api = "http://api.acme.com/v1";').some((f) => f.rule === 'insecure-http')).toBe(true);
  });

  it('flags an insecure ws:// websocket to a remote host but allows wss and localhost', () => {
    expect(scanSecurity('a.ts', 'const s = new WebSocket("ws://api.example.com/live");').some((f) => f.rule === 'insecure-websocket')).toBe(true);
    expect(scanSecurity('a.ts', 'const s = new WebSocket("ws://localhost:3000/live");').some((f) => f.rule === 'insecure-websocket')).toBe(false);
    expect(scanSecurity('a.ts', 'const s = new WebSocket("wss://api.example.com/live");').some((f) => f.rule === 'insecure-websocket')).toBe(false);
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

describe('isPlaceholderValue — a template is not a leak (autopsy 56ee622f, 2026-08-04)', () => {
  it('recognises the canonical .env.example template words that BLOCKED a correct build', () => {
    // The exact value that became a READINESS_BLOCKER on `.env.example:2`:
    //   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
    for (const v of ['PASSWORD', 'USER', 'HOST', 'DB', 'USERNAME', 'DBNAME', 'YOUR_PASSWORD', 'REPLACE_ME']) {
      expect(isPlaceholderValue(v)).toBe(true);
    }
  });

  it('keeps the existing markers working', () => {
    for (const v of ['your-key', 'xxxx', '${DB_PASS}', 'changeme', 'dummy', 'placeholder', '<secret>']) {
      expect(isPlaceholderValue(v)).toBe(true);
    }
  });

  it('still catches a REAL credential — no weakening of detection', () => {
    // NOTE: AWS's documented sample key contains "EXAMPLE" and is intentionally treated as a
    // placeholder by the pre-existing marker list — that is correct and unchanged here.
    for (const v of ['s3cr3t!Abc', 'p4ssw0rd-live-9912', 'user_a8f3k2', 'Tr0ub4dor-3x', 'hunter2']) {
      expect(isPlaceholderValue(v)).toBe(false);
    }
  });

  it('matches the WHOLE value only — a secret merely containing a template word is still a secret', () => {
    expect(isPlaceholderValue('password')).toBe(true);
    expect(isPlaceholderValue('passwordX9!')).toBe(false);
    expect(isPlaceholderValue('mypassword123')).toBe(false);
  });

  it('empty / missing counts as a placeholder, never a leak', () => {
    expect(isPlaceholderValue('')).toBe(true);
    expect(isPlaceholderValue(null)).toBe(true);
    expect(isPlaceholderValue(undefined)).toBe(true);
  });
});

describe('the reported build must no longer be blocked by its own fix', () => {
  it('a canonical .env.example connection-string template produces NO high finding', () => {
    const findings = scanSecurity('.env.example', '# Database\nDATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require\n');
    expect(findings.filter((f) => f.severity === 'high')).toEqual([]);
  });

  it('a REAL credential committed to .env.example is still a high finding', () => {
    const findings = scanSecurity('.env.example', 'DATABASE_URL=postgresql://admin:Tr0ub4dor-3x@db.prod.internal/main\n');
    expect(findings.some((f) => f.severity === 'high' && f.rule === 'connection-string-credentials')).toBe(true);
  });
});
