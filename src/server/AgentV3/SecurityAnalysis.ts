// AgentV3 — Security analysis (Phase 3/8, cat 16).
//
// Real static security scanning over the actual source the agent writes: hardcoded
// secrets/credentials and dangerous code patterns. Findings are computed at index
// time from real content (only the findings are kept, not the file body), so the
// `evaluate` tool can report concrete, real security defects for the team to fix —
// never a synthetic "looks secure".

export type Severity = 'high' | 'medium' | 'low';

export interface SecurityFinding {
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  message: string;
}

interface Rule {
  rule: string;
  severity: Severity;
  re: RegExp;
  message: string;
  /** Optional guard to suppress obvious false positives (e.g. placeholders). Receives the full match
   *  array so it can test the captured CREDENTIAL VALUE, not the whole line (see PLACEHOLDER note). */
  ignore?: (m: RegExpExecArray, fullLine: string) => boolean;
  /** A hardcoded-CREDENTIAL-VALUE rule (a secret string baked into data), as opposed to a code
   *  vulnerability. In an obvious mock/fixture/demo file these are almost always DEMO fixtures, not a
   *  real leak — so they are downgraded to 'low' there (still reported, never a build-failing 'high').
   *  Real code vulns (eval, jwt-none, aws-key, private-key) are NOT marked and stay high everywhere. */
  demoDowngrade?: boolean;
}

// Obvious mock / fixture / demo / seed / test data files. A hardcoded credential VALUE here (a demo
// password, a mock API key, a `postgres://user:pass@localhost` sample URL) is fixture data — NOT a
// production secret — so a demo app must never FAIL its readiness gate on its own mock login creds
// (deep-test SaaS dashboard, build 6f87751d: `hardcoded-secret @ src/data/mockData.ts:240` forced 0/100).
// PURE. Precise on purpose: a bare `src/data/config.ts` or `src/lib/api.ts` is NOT a fixture → stays high.
export function isFixtureFile(file: string): boolean {
  const f = (file || '').toLowerCase();
  if (/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(f)) return true;             // *.test.ts / *.stories.tsx
  if (/(?:^|\/)(?:__mocks__|__fixtures__|mocks|fixtures|seeds?|samples?|demos?|stubs?|examples?)\//.test(f)) return true; // a mock/fixture/… directory
  const base = f.split('/').pop() || f;
  if (/(?:^|[._-])(?:mock|fixture|seed|sample|demo|dummy|stub|fake)/.test(base)) return true; // mockData.ts, seed-users.ts, demo.data.ts
  return false;
}

// A dotenv secrets file (`.env`, `.env.local`, `.env.production`, …) is the DESIGNATED, gitignored place
// for real credentials — a `DATABASE_URL=postgres://user:pass@host/db`, an API key, a JWT secret all BELONG
// here. Flagging them as a build-BLOCKING 'high' is a false positive whose "fix" is circular ("move to an
// environment variable" — `.env` IS the environment file) and has no valid auto-fix, so the reviewer loops
// on it to the wall-clock timeout and marks a working app broken (autopsy build 6478f94d: a `continue` turn
// failed ok:false on `connection-string-credentials @ .env:2`, then timed out at the 1740s cap). So, exactly
// like a fixture file, credential-VALUE findings (demoDowngrade rules) in an env file are downgraded to
// 'low' — still REPORTED (honest, visible), never build-failing. `.env.example`/`.sample`/`.template` are
// EXCLUDED: those are committed templates that must carry only placeholders (a real secret there IS a leak).
// Real code vulns (private-key, aws-key, jwt-none, eval, …) are NOT demoDowngrade → they stay high here too.
// PURE.
export function isEnvSecretsFile(file: string): boolean {
  const base = (file || '').toLowerCase().split('/').pop() || '';
  if (!/^\.env(?:\.[a-z0-9_.-]+)?$/.test(base)) return false;          // .env, .env.local, .env.production, …
  return !/\.(?:example|sample|template|dist|tpl)$/.test(base);        // but NOT a committed .env.example template
}

// Placeholder / non-real-credential markers. MUST be tested against the captured credential VALUE
// (or the token itself), NOT the whole line: two tokens here (`<` and `test`) match far too much of
// an ordinary line — `<` hits EVERY JSX line (so secret detection was disabled on .tsx, the most
// common file type here) and `test` matches `latest`/`fastest`/a `// …test…` comment. Scoped to the
// value, `<` only fires on `<your-key>` and `test` only on a `test…` value — which is the intent.
const PLACEHOLDER = /(your[_-]?|example|placeholder|xxx+|<|\$\{|process\.env|import\.meta\.env|changeme|dummy|test)/i;

// TEMPLATE FIELD NAMES used AS the value — the other half of "this is not a real credential"
// (autopsy build 56ee622f, 2026-08-04).
//
// What went wrong: the reviewer told the agent to get live DB + payment credentials out of `.env`. The
// agent did exactly the right thing — replaced them with placeholders and wrote a canonical
// `.env.example` template:
//     DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
// The connection-string rule then captured `PASSWORD` as the password and asked PLACEHOLDER whether it
// looked fake. PLACEHOLDER has `your_`, `example`, `xxx`, `changeme`, `dummy`, `test` … but NOT the single
// most obvious template word of all: `PASSWORD`. So the finding fired at HIGH on `.env.example` — a file
// that by definition contains nothing but placeholders — and became a READINESS_BLOCKER. The build was
// marked NOT working and the user was told their app was broken.
//
// The engine punished itself for doing the right thing. Worse, it was inconsistent: the REAL `.env` was
// only 'low' (correctly downgraded by isEnvSecretsFile) while the dummy TEMPLATE was 'high'.
//
// So a value that is merely the FIELD'S OWN NAME is a placeholder. Kept deliberately narrow — an exact
// full-value match against a curated word list, never a substring — so a genuine secret that happens to
// contain "user" (`user_a8f3k2`) is still caught. `.env.example` keeps its "real secrets here ARE a leak"
// policy; it just can no longer mistake the template itself for the leak.
const TEMPLATE_FIELD_VALUE = new Set([
  'user', 'username', 'user_name', 'youruser', 'your_user', 'your_username',
  'password', 'passwd', 'pass', 'yourpassword', 'your_password', 'db_password', 'dbpassword',
  'host', 'hostname', 'your_host', 'yourhost', 'localhost',
  'db', 'dbname', 'db_name', 'database', 'database_name', 'mydb', 'yourdb',
  'port', 'secret', 'mysecret', 'key', 'apikey', 'api_key', 'token', 'credentials',
  'replace_me', 'replaceme', 'none', 'null', 'todo', 'redacted',
]);

/**
 * Is this captured credential VALUE a placeholder rather than a live secret? Combines the substring
 * markers (`your-key`, `xxx`, `${…}`) with an EXACT match against the template-field word list, so the
 * standard `scheme://USER:PASSWORD@HOST/DB` template is recognised for what it is. PURE.
 */
export function isPlaceholderValue(value: string | undefined | null): boolean {
  const v = (value ?? '').trim();
  if (!v) return true;
  if (PLACEHOLDER.test(v)) return true;
  return TEMPLATE_FIELD_VALUE.has(v.toLowerCase().replace(/[<>{}$]/g, ''));
}

// A security-sensitive context: the value being built is a secret/identity token, not a
// throwaway. Used to keep the "weak randomness / weak hash" rules high-precision — they
// fire ONLY when one of these words is on the same line, so an ordinary Math.random()
// (jitter, a sample, an animation) or an md5 cache-key/ETag is never flagged.
const SECURITY_CONTEXT = /\b(secret|token|password|passwd|otp|nonce|session|salt|api[_-]?key|apikey|credential|csrf|signature|hmac|private[_-]?key|access[_-]?token|reset[_-]?code|verification|auth)\b/i;

// Namespace / schema URIs (xmlns declarations, XML/SVG/RDF namespaces) just happen to use an
// http:// form but are IDENTIFIERS, never network endpoints — so http:// in them is not an
// "insecure endpoint". Excluded from the insecure-http rule to avoid a noisy false positive on
// every inline SVG (xmlns="http://www.w3.org/2000/svg") and XML namespace declaration.
const NAMESPACE_HTTP = /\bxmlns(?::\w+)?\s*=|http:\/\/(?:www\.)?(?:w3\.org|xmlns\.com|purl\.org|sodipodi\.sourceforge\.net|inkscape\.org|ns\.adobe\.com|schemas\.[\w.]+)/i;

const RULES: Rule[] = [
  {
    rule: 'hardcoded-secret',
    severity: 'high',
    // key/secret/password/token assigned a non-trivial string literal. The value is 8+
    // NON-whitespace chars: a real credential has no spaces, so this excludes the common
    // false positive of a validation/UI message (password = "Password must be 8 characters").
    re: /\b(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/i,
    message: 'Hardcoded credential — load it from an environment variable instead.',
    ignore: (m) => isPlaceholderValue(m[2] ?? m[0]),
    demoDowngrade: true,
  },
  {
    rule: 'connection-string-credentials',
    severity: 'high',
    // user:password baked into a DB/queue connection-string URI (scheme://user:pass@host).
    // The assignment-based hardcoded-secret rule misses this URI form entirely.
    re: /\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|rediss?|amqps?):\/\/[^\s:'"`@/]*:([^\s:'"`@/]{3,})@/i,
    message: 'Credentials embedded in a connection string — move the user/password to environment variables; never commit live DB/queue credentials.',
    ignore: (m) => isPlaceholderValue(m[2] ?? m[0]),
    demoDowngrade: true,
  },
  {
    rule: 'client-exposed-secret',
    severity: 'high',
    // Env vars with a CLIENT build prefix (VITE_ / NEXT_PUBLIC_ / REACT_APP_) are inlined
    // into the public browser bundle — visible to every visitor. A name that says SECRET/
    // PASSWORD/PRIVATE under such a prefix means a real secret is shipped to the client.
    // High-precision: the prefix guarantees exposure and the word indicates a true secret
    // (bare *_KEY/_TOKEN is intentionally NOT matched — publishable keys are meant to be public).
    re: /\b(?:VITE_|NEXT_PUBLIC_|REACT_APP_)[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|PRIVATE)(?:_|\b)/,
    message: 'A client-exposed env var (VITE_/NEXT_PUBLIC_/REACT_APP_) named like a secret is bundled into the public browser JS — visible to everyone. Keep secrets server-side (no client prefix); only publishable values belong under these prefixes.',
  },
  {
    rule: 'url-embedded-credentials',
    severity: 'high',
    // user:password@ embedded in an http(s) URL leaks the credential and is deprecated in
    // browsers. The connection-string-credentials rule only covers DB/queue schemes
    // (mongodb/postgres/…); this covers plain http(s) API URLs it misses.
    re: /\bhttps?:\/\/[^\s:'"`@/]+:([^\s:'"`@/]{3,})@/i,
    message: 'Credentials embedded in an http(s) URL (https://user:pass@host) — this leaks the credential and is deprecated in browsers; send them in an Authorization header from an environment variable instead.',
    ignore: (m) => PLACEHOLDER.test(m[1] ?? m[0]),
    demoDowngrade: true,
  },
  {
    rule: 'hardcoded-jwt-secret',
    severity: 'high',
    // jwt.sign(payload, '<literal>'[, opts]) — a hardcoded signing secret lets anyone
    // with the source forge tokens. The assignment-based hardcoded-secret rule misses
    // this function-argument form. `.*?,` skips the payload (object/variable) so the
    // secret arg is matched whether or not an options object follows.
    re: /\b(?:jwt|jsonwebtoken)\.sign\s*\(.*?,\s*(['"`])[^'"`]{4,}\1\s*[,)]/,
    message: 'Hardcoded JWT signing secret — anyone with the source can forge tokens; load it from an environment variable.',
    ignore: (m) => PLACEHOLDER.test(m[0]),
    demoDowngrade: true,
  },
  {
    rule: 'jwt-none-algorithm',
    severity: 'high',
    // A JWT configured with the "none" algorithm accepts UNSIGNED tokens — anyone can
    // forge any token (a classic auth bypass). Matches `algorithm: 'none'` (sign) or an
    // `algorithms` allow-list that includes 'none' (verify).
    re: /\balgorithms?\s*:\s*(\[[^\]]*)?['"`]none['"`]/i,
    message: 'JWT "none" algorithm accepts unsigned tokens — anyone can forge any token (auth bypass). Require a real algorithm (e.g. HS256/RS256) and never allow "none".',
  },
  {
    rule: 'aws-access-key',
    severity: 'high',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'Hardcoded AWS access key id — remove it and use a secret manager.',
  },
  {
    rule: 'private-key',
    severity: 'high',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    message: 'Private key committed in source — remove it immediately.',
  },
  {
    rule: 'eval-usage',
    severity: 'medium',
    // The global eval() runs a string as code (injection). The negative lookbehind excludes
    // member methods named eval (mathjs `math.eval(...)`, MongoDB `db.eval(...)`, etc.) which
    // are unrelated library calls — only the dangerous global eval is flagged.
    re: /(?<![.\w])eval\s*\(/,
    message: 'Use of eval() — avoid it; it enables code injection.',
    ignore: (_m, line) => /\/\/|\*/.test(line.slice(0, line.indexOf('eval'))),
  },
  {
    rule: 'dynamic-function',
    severity: 'medium',
    // `new Function('...')` builds code from a string at runtime — eval()'s twin. The
    // \b after Function avoids matching `new FunctionComponent(...)` and similar.
    re: /\bnew\s+Function\b\s*\(/,
    message: 'new Function() builds code from a string — like eval(), it enables code injection; avoid it.',
  },
  {
    rule: 'settimeout-string',
    severity: 'medium',
    // setTimeout/setInterval with a STRING first argument runs it as code (an eval) —
    // code injection + a CSP violation. Matches only a quoted first arg; a function
    // argument (setTimeout(() => …) / setTimeout(fn, …)) is not matched.
    re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
    message: 'setTimeout/setInterval with a string argument runs it as code (an eval — code injection, breaks CSP); pass a function instead.',
  },
  {
    rule: 'vm-code-execution',
    severity: 'high',
    // Node's vm module runs a STRING as code (runInNewContext/runInThisContext/
    // runInContext/compileFunction) — like eval(), it executes whatever it is given,
    // and it is NOT a security sandbox (the docs say so). Feeding it dynamic input is
    // remote code execution. The `vm.` prefix keeps this high-precision.
    re: /\bvm\.(?:runInNewContext|runInThisContext|runInContext|compileFunction)\s*\(/,
    message: "Node vm.runIn*/compileFunction runs a string as code (like eval) and is NOT a security sandbox — this enables code execution; never pass user input to it.",
  },
  {
    rule: 'electron-insecure-webprefs',
    severity: 'high',
    // Electron renderers are hardened by default. `nodeIntegration: true` gives the
    // page full Node.js access and `contextIsolation: false` removes the bridge
    // boundary — either one turns a single XSS in the renderer into full remote code
    // execution on the user's machine. Both forms are explicit and unambiguous.
    re: /\bnodeIntegration\s*:\s*true\b|\bcontextIsolation\s*:\s*false\b/,
    message: 'Insecure Electron webPreferences (nodeIntegration:true / contextIsolation:false) — this turns any renderer XSS into full code execution on the user machine; keep nodeIntegration off and contextIsolation on, and use a preload bridge.',
  },
  {
    rule: 'command-injection',
    severity: 'high',
    // A child_process shell sink (exec/execFile/spawn, sync or async) whose command is
    // built from a template interpolation (`...${x}`) or a string concatenation
    // ("..." + x) — the classic command-injection vector. The negative lookbehind
    // excludes method calls like `regex.exec(...)` / `cp.exec(...)` so RegExp.exec and
    // other libraries are not false-positives (a documented precision trade-off: the
    // `cp.exec(...)` member form is not matched — prefer the imported `exec(...)` form).
    re: /(?<![.\w])(?:exec|execFile|spawn)(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+\s*\S)/,
    message: 'Shell command built from dynamic input — this enables command injection; validate/escape the input or use execFile with an args array (no shell).',
  },
  {
    rule: 'weak-bcrypt-rounds',
    severity: 'medium',
    // A bcrypt cost factor below 10 (a single-digit rounds value) hashes too fast, so an
    // attacker can brute-force stolen password hashes cheaply. Modern guidance is ≥10–12.
    // Matches a literal single-digit rounds in bcrypt.hash(data, N) or genSalt(N); a
    // two-digit value (10+) or a variable is not flagged.
    re: /\bbcrypt(?:js)?\.(?:hash|hashSync)\s*\([^,)]+,\s*([0-9])\s*[,)]|\b(?:bcrypt(?:js)?\.)?genSalt(?:Sync)?\s*\(\s*([0-9])\s*[,)]/,
    message: 'bcrypt cost factor below 10 — the hash is too fast and cheap to brute-force; use at least 10 (12+ is common for new apps).',
  },
  {
    rule: 'express-trust-proxy-true',
    severity: 'medium',
    // `app.set('trust proxy', true)` trusts the X-Forwarded-For header from ANY client, so a
    // user can spoof their IP — defeating IP-based rate limiting, geo rules and audit logs.
    // Trust a specific hop count or the known proxy IPs instead of a blanket `true`.
    re: /\.set\s*\(\s*['"`]trust proxy['"`]\s*,\s*true\b/i,
    message: "trust proxy: true trusts X-Forwarded-For from any client (IP spoofing — defeats rate limiting and audit logs). Set it to the number of proxy hops or the specific proxy IP(s), not a blanket true.",
  },
  {
    rule: 'pseudo-random-bytes',
    severity: 'high',
    // crypto.pseudoRandomBytes() is explicitly NOT cryptographically secure (deprecated) —
    // using it for tokens/keys/IVs is predictable. Use crypto.randomBytes() instead.
    re: /\.pseudoRandomBytes\s*\(/,
    message: 'crypto.pseudoRandomBytes() is not cryptographically secure (deprecated) — use crypto.randomBytes() for tokens, keys and IVs.',
  },
  {
    rule: 'insecure-random-token',
    severity: 'high',
    // Math.random() is NOT cryptographically secure — its output is predictable, so using
    // it to build a token/secret/OTP/session id lets an attacker guess the value. The
    // SECURITY_CONTEXT guard (same-line keyword) keeps this precise: ordinary Math.random()
    // for jitter/sampling/animation is not flagged. Use crypto.randomBytes/randomUUID.
    re: /\bMath\.random\s*\(\s*\)/,
    message: 'Math.random() is not cryptographically secure (predictable) — do not build a token/OTP/secret/session id with it; use crypto.randomUUID() or crypto.randomBytes().',
    ignore: (_m, line) => !SECURITY_CONTEXT.test(line),
  },
  {
    rule: 'weak-hash-security',
    severity: 'medium',
    // MD5 and SHA-1 are cryptographically broken (collisions, fast to brute-force). Used
    // for a password/token/signature they are insecure; the SECURITY_CONTEXT guard keeps
    // this precise so an md5 ETag/cache-key/checksum (a legitimate non-security use) is not
    // flagged. Use SHA-256+ for integrity, and bcrypt/scrypt/argon2 for passwords.
    re: /\bcreateHash\s*\(\s*['"`](?:md5|sha1)['"`]\s*\)/i,
    message: 'MD5/SHA-1 is cryptographically broken — do not use it for a password/token/signature; use SHA-256+ for integrity and bcrypt/scrypt/argon2 for passwords.',
    ignore: (_m, line) => !SECURITY_CONTEXT.test(line),
  },
  {
    rule: 'weak-crypto-cipher',
    severity: 'high',
    // crypto.createCipher()/createDecipher() (no IV) are deprecated and insecure:
    // they derive the key/IV from a password with a single MD5 pass, producing the
    // SAME ciphertext for the same input every time (no randomness). The `\s*\(`
    // right after the name excludes the correct `createCipheriv(`/`createDecipheriv(`.
    re: /\.create(?:De)?[Cc]ipher\s*\(/,
    message: 'crypto.createCipher()/createDecipher() are insecure (no IV, MD5 key derivation) — use createCipheriv()/createDecipheriv() with a random IV instead.',
  },
  {
    rule: 'insecure-cipher-ecb',
    severity: 'high',
    // ECB block-cipher mode encrypts identical plaintext blocks to identical ciphertext, so
    // it leaks data patterns (the classic "ECB penguin") and provides no semantic security.
    // High-precision: a cipher algorithm string whose mode is -ecb. Use GCM (or CBC + a
    // random IV) instead.
    re: /['"`][a-z0-9]+(?:-[a-z0-9]+)*-ecb['"`]/i,
    message: 'ECB cipher mode leaks plaintext patterns (identical blocks → identical ciphertext) and is not semantically secure — use an authenticated mode like AES-GCM (or CBC with a random IV).',
  },
  {
    rule: 'weak-rsa-key-size',
    severity: 'medium',
    // An RSA/DSA key of 1024 bits (or less) is brute-forceable and deprecated — modern
    // guidance requires ≥2048. High-precision: modulusLength is the RSA/DSA key-size option.
    re: /\bmodulusLength\s*:\s*(?:512|768|1024)\b/,
    message: 'RSA/DSA key size ≤1024 bits is too weak (brute-forceable, deprecated) — use modulusLength: 2048 or higher (3072/4096 for long-term keys).',
  },
  {
    rule: 'path-traversal',
    severity: 'high',
    // A filesystem read / file response built from request input (req.query/params/body/
    // headers) lets an attacker request ../../etc/passwd — path traversal / local file
    // disclosure. High-precision: the file op's arguments must contain req.* directly.
    re: /\b(?:sendFile|readFile(?:Sync)?|createReadStream|readdir(?:Sync)?|unlink(?:Sync)?)\s*\([^)]*\breq\.(?:query|params|body|headers)\b/,
    message: 'File path built from request input — this enables path traversal (e.g. ../../etc/passwd). Validate against an allow-list and resolve+confine the path under a fixed base directory.',
  },
  {
    rule: 'cookie-httponly-false',
    severity: 'medium',
    // httpOnly:false makes a cookie readable by client JavaScript — an XSS can then steal a
    // session/auth cookie. The flag defaults to off, so writing it explicitly false is a
    // deliberate (and usually wrong) opt-out for a sensitive cookie.
    re: /\bhttpOnly\s*:\s*false\b/i,
    message: 'httpOnly:false makes the cookie readable by client JavaScript — an XSS can steal a session/auth cookie. Set httpOnly:true (and Secure + SameSite) for auth cookies.',
  },
  {
    rule: 'samesite-none-insecure',
    severity: 'medium',
    // A cookie with SameSite=None MUST also be Secure — modern browsers silently REJECT a
    // SameSite=None cookie that is not Secure (so the cookie is never set and auth breaks),
    // and None alone removes CSRF protection. Flag SameSite:'none' unless secure:true is on
    // the same line.
    re: /\bsameSite\s*:\s*['"`]none['"`]/i,
    message: "SameSite=None without Secure — browsers silently reject the cookie (it is never set, breaking auth) and it removes CSRF protection; set secure:true alongside sameSite:'none'.",
    ignore: (_m, line) => /\bsecure\s*:\s*true\b/i.test(line),
  },
  {
    rule: 'dangerous-html',
    severity: 'medium',
    re: /dangerouslySetInnerHTML/,
    message: 'dangerouslySetInnerHTML — sanitise the HTML or it enables XSS.',
  },
  {
    rule: 'angular-bypass-security',
    severity: 'medium',
    // Angular sanitises bindings by default; bypassSecurityTrustHtml/Url/ResourceUrl/
    // Script/Style explicitly DISABLES that protection, re-opening XSS if the value is
    // not already trusted. Matching the call is high-precision.
    re: /\bbypassSecurityTrust(?:Html|Url|ResourceUrl|Script|Style)\s*\(/,
    message: 'Angular bypassSecurityTrust* disables built-in sanitisation (XSS risk) — only use it on values you fully control, never on user input.',
  },
  {
    rule: 'vue-v-html',
    severity: 'medium',
    // Vue's v-html binding renders a raw HTML string into the DOM — the framework
    // equivalent of dangerouslySetInnerHTML and an XSS sink when the value is dynamic.
    re: /\bv-html\s*=/,
    message: 'Vue v-html renders raw HTML (XSS sink) — sanitise the HTML or render text with {{ }} / v-text instead.',
  },
  {
    rule: 'handlebars-triple-stache',
    severity: 'medium',
    // Handlebars/Mustache `{{{ value }}}` (triple stache) renders the value as RAW,
    // UNESCAPED HTML — the template-engine equivalent of innerHTML and an XSS sink
    // when the value is user-controlled. The normal `{{ value }}` (double) is escaped
    // and safe; the triple-brace form is distinctive, so matching it is high-precision.
    re: /\{\{\{[^}]+\}\}\}/,
    message: 'Handlebars {{{triple-stache}}} renders raw unescaped HTML (XSS sink) — use the escaped {{double}} form, or sanitise the value before trusting it as HTML.',
  },
  {
    rule: 'ejs-unescaped-output',
    severity: 'medium',
    // EJS `<%- value %>` outputs the value as RAW, UNESCAPED HTML (vs the escaped
    // `<%= value %>`) — an XSS sink for user-controlled data. The `include()` partial
    // helper is the standard, safe use of `<%-`, so it is excluded to keep precision.
    re: /<%-\s*\S/,
    message: 'EJS <%- %> outputs raw unescaped HTML (XSS sink) — use the escaped <%= %> for user data, or sanitise before output.',
    ignore: (_m, line) => /<%-\s*include\b/.test(line),
  },
  {
    rule: 'unsafe-html-sink',
    severity: 'medium',
    // Vanilla-DOM XSS sinks the React rule misses: assigning OR appending to
    // innerHTML/outerHTML (`=` and `+=`), or insertAdjacentHTML. `\+?=(?!=)` covers both
    // forms while excluding ==/=== comparisons; empty-string clears are ignored below.
    re: /\.(inner|outer)HTML\s*\+?=(?!=)|\.insertAdjacentHTML\s*\(/,
    message: 'Writing raw HTML (innerHTML/outerHTML/insertAdjacentHTML) enables XSS — sanitise the HTML or use textContent.',
    ignore: (_m, line) => /\.(?:inner|outer)HTML\s*=\s*(['"`])\s*\1/.test(line),
  },
  {
    rule: 'document-write',
    severity: 'medium',
    // document.write()/.writeln() injects raw HTML (an XSS sink when fed dynamic data),
    // blocks the parser, and silently wipes the whole page if called after load.
    re: /\bdocument\.write(?:ln)?\s*\(/,
    message: 'document.write() injects raw HTML (XSS sink) and blocks/overwrites the page — build DOM nodes, set textContent, or render via the framework instead.',
  },
  {
    rule: 'open-redirect',
    severity: 'medium',
    // res.redirect() to a value taken DIRECTLY from the request (req.query/params/body/
    // headers) is an open redirect — attackers craft a link to send users to a phishing
    // site. High-precision: the redirect target must START with req.* (optionally after a
    // status code), so `res.redirect(`/go?to=${req.query.x}`)` (fixed path) is not flagged.
    re: /\bres(?:ponse)?\.redirect\s*\(\s*(?:\d{3}\s*,\s*)?req\.(?:query|params|body|headers)\b/,
    message: 'Open redirect — res.redirect() to a value from the request lets attackers send users to a phishing site; validate against an allow-list of paths/hosts.',
  },
  {
    rule: 'sql-injection',
    severity: 'high',
    // A SQL statement built by interpolating/concatenating a value straight into the
    // query string — the classic SQL-injection vector.
    //
    // ROOT-CAUSE FIX (2026-07-04, from a real blocked build): the old rule matched ANY
    // template string that merely STARTED with an English word that is also a SQL verb —
    // so a Hospital-app build was blocked as "SQL injection" (readiness score 0/100) on
    //   aria-label={`Delete ${med.name}`}
    // — a GOOD accessibility label in a localStorage app with no SQL at all. UI English
    // ("Delete …?", "Update …", "Select … from the list") is full of SQL verbs.
    //
    // The rule now requires a REAL SQL skeleton, not just a verb:
    //   INSERT INTO <tbl> | DELETE FROM <tbl> … WHERE | UPDATE <tbl> SET …= |
    //   SELECT * FROM <tbl> | SELECT <cols> FROM <tbl> … WHERE
    // plus a `${…}` interpolation (template branch) or a non-literal concatenation
    // (string branch; `(?!['"])` after `+` excludes safe literal+literal joins).
    // Parameterised queries (`query('… WHERE id = ?', [id])`) are still not flagged.
    re: /`(?=[^`]*\$\{)[^`]*\b(?:insert\s+into\s+[\w."\[]|delete\s+from\s+[\w."\[][^`]*\bwhere\b|update\s+[\w."\[][\w."\]]*\s+set\s+[^`]*=|select\s+\*\s+from\s+[\w."\[]|select\s+[^`]{1,80}?\bfrom\s+[\w."\[][^`]*\bwhere\b)|['"][^'"]*\b(?:insert\s+into\s+[\w."\[]|delete\s+from\s+[\w."\[][^'"]*\bwhere\b|update\s+[\w."\[][\w."\]]*\s+set\b|select\s+\*\s+from\s+[\w."\[]|select\s+[^'"]{1,80}?\bfrom\s+[\w."\[][^'"]*\bwhere\b)[^'"]*['"]\s*\+\s*(?!['"])\S/i,
    message: 'SQL query built from interpolated/concatenated input — this enables SQL injection; use parameterised queries (placeholders + a values array) instead.',
  },
  {
    rule: 'nosql-injection',
    severity: 'high',
    // A raw request object passed straight into a Mongo/Mongoose query — a user can send
    // `{ "$gt": "" }` / `{ "$ne": null }` to match unintended documents (NoSQL injection,
    // a classic auth bypass on a login query). High-precision: the query arg IS req.*.
    re: /\.(?:find|findOne|findOneAnd\w+|update(?:One|Many)?|delete(?:One|Many)?|count(?:Documents)?|remove)\s*\(\s*req\.(?:body|query|params)\b/,
    message: 'Raw request object used as a database query — a user can inject query operators ($gt/$ne) to bypass it (NoSQL injection). Extract and validate the specific fields instead of passing req.body/req.query directly.',
  },
  {
    rule: 'ssrf',
    severity: 'high',
    // A server-side HTTP request whose URL is taken DIRECTLY from request input
    // (req.query/params/body/headers) is a Server-Side Request Forgery vector — an
    // attacker points it at internal services (e.g. http://169.254.169.254 cloud
    // metadata) or the private network. High-precision: the request fn's first arg
    // IS req.* (a fixed base with `${req...}` appended does not start with req., so
    // `fetch(`/api/${req.query.id}`)` is not flagged).
    re: /\b(?:fetch|axios(?:\.(?:get|post|put|patch|delete|head|request))?|got|https?\.(?:get|request))\s*\(\s*req\.(?:query|params|body|headers)\b/,
    message: 'Server-side request to a URL from request input — this enables SSRF (an attacker can reach internal services / cloud metadata). Validate the URL against an allow-list of hosts before fetching.',
  },
  {
    rule: 'regexp-from-request',
    severity: 'medium',
    // Building a RegExp from request input lets an attacker inject a catastrophically
    // backtracking pattern (ReDoS) that pins the CPU and hangs the server, or break the
    // intended match. High-precision: req.* appears inside the RegExp constructor's args.
    re: /\bnew\s+RegExp\s*\(\s*[^)]*\breq\.(?:query|params|body|headers)\b/,
    message: 'RegExp built from request input — a crafted pattern can cause catastrophic backtracking (ReDoS) that hangs the server. Validate/escape the input, or match with a fixed pattern instead of compiling user input.',
  },
  {
    rule: 'xxe-entity-expansion',
    severity: 'high',
    // An XML parser told to resolve/expand entities (noent/resolveEntities/expandEntities:
    // true) processes external entities — the classic XXE vector: read local files
    // (file:///etc/passwd), SSRF, or a billion-laughs DoS. Keep entity expansion OFF.
    re: /\b(?:noent|resolveEntities|expandEntities|externalEntities)\s*:\s*true\b/,
    message: 'XML entity expansion enabled (noent/resolveEntities/expandEntities: true) — this opens XXE (local file disclosure, SSRF, billion-laughs DoS). Disable entity/DTD processing for untrusted XML.',
  },
  {
    rule: 'disable-tls-verification',
    severity: 'high',
    // Turning off TLS certificate validation (rejectUnauthorized:false, or the
    // process-wide NODE_TLS_REJECT_UNAUTHORIZED=0) makes every HTTPS connection
    // accept ANY certificate — a trivial man-in-the-middle. Both forms are
    // unambiguous, so matching them is high-precision.
    re: /\brejectUnauthorized\s*:\s*false\b|\bNODE_TLS_REJECT_UNAUTHORIZED\b\s*[:=]\s*['"`]?0\b/,
    message: 'TLS certificate verification disabled (rejectUnauthorized:false / NODE_TLS_REJECT_UNAUTHORIZED=0) — every HTTPS connection now accepts any certificate (man-in-the-middle). Never disable it; trust the proper CA certificate instead.',
  },
  {
    rule: 'tls-weak-version',
    severity: 'medium',
    // Pinning a deprecated TLS/SSL protocol (TLS 1.0/1.1, SSLv3) via minVersion or the
    // legacy secureProtocol option exposes the connection to known attacks (BEAST/POODLE)
    // and is disallowed by modern servers. Match the explicit weak values only.
    re: /\bminVersion\s*:\s*['"`]TLSv1(?:\.1)?['"`]|\bsecureProtocol\s*:\s*['"`](?:TLSv1(?:_1)?|SSLv3)_method['"`]/,
    message: 'Deprecated TLS/SSL version pinned (TLS 1.0/1.1 or SSLv3) — these are vulnerable (BEAST/POODLE) and rejected by modern servers; require TLS 1.2+ (minVersion: "TLSv1.2").',
  },
  {
    rule: 'prototype-pollution',
    severity: 'high',
    // A deep-merge / deep-set of untrusted request input (lodash merge/mergeWith/
    // defaultsDeep/set, or jQuery.extend(true, …)) lets a `{ "__proto__": {…} }` payload
    // pollute Object.prototype — affecting every object in the app (auth bypass, RCE in
    // some sinks). High-precision: req.* is merged as a WHOLE object — the `(?!\.\w)`
    // excludes a specific validated leaf (req.body.name), a documented precision trade-off
    // (a nested object like req.body.settings is not matched).
    re: /\b(?:_|lodash)\.(?:merge|mergeWith|defaultsDeep|setWith|set)\s*\([^)]*\breq\.(?:body|query|params)\b(?!\s*\.\w)|\.extend\s*\(\s*true\s*,[^)]*\breq\.(?:body|query|params)\b(?!\s*\.\w)/,
    message: 'Deep-merging untrusted request input can pollute Object.prototype (a "__proto__" payload poisons every object) — validate/whitelist the fields first, or use a null-prototype target and a pollution-safe merge.',
  },
  {
    rule: 'open-redirect-header',
    severity: 'medium',
    // Setting the Location header directly from request input is an open redirect (the
    // header-based twin of res.redirect(req...)). High-precision: a setHeader/header/set
    // call whose header name is "location" and whose value comes from req.*.
    re: /\b(?:setHeader|header|set)\s*\(\s*['"`]location['"`]\s*,\s*[^)]*\breq\.(?:query|params|body|headers)\b/i,
    message: 'Location header set from request input — an open redirect that sends users to an attacker URL; validate the target against an allow-list of paths/hosts.',
  },
  {
    rule: 'hardcoded-auth-header',
    severity: 'high',
    // An Authorization header set to a literal `Bearer <token>` / `Basic <creds>` — a
    // hardcoded API/access credential the assignment-based hardcoded-secret rule misses
    // (its key-set has no "Authorization"). The PLACEHOLDER ignore excludes the correct
    // env form (`Bearer ${token}`) and obvious placeholders.
    re: /\bauthorization\b['"`]?\s*[:=]\s*(['"`])\s*(?:bearer|basic)\s+[^'"`]{8,}\1/i,
    message: 'Hardcoded Authorization credential (Bearer/Basic literal) — load the token from an environment variable instead of committing it.',
    ignore: (m) => PLACEHOLDER.test(m[0]),
  },
  {
    rule: 'hardcoded-provider-token',
    severity: 'high',
    // Distinctive provider credential formats (GitHub / Google / Slack / Stripe-live)
    // hardcoded in SOURCE. The assignment-based hardcoded-secret rule needs a known
    // key NAME, so a token stored under an arbitrary variable (`const k = "ghp_…"`) is
    // missed; these formats are unmistakable, so matching one is almost certainly a
    // real leaked credential. (EnvSecretValueAnalysis covers the same formats, but only
    // inside .env templates — this covers code.)
    re: /\bgh[posru]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAIza[0-9A-Za-z_-]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\b[rs]k_live_[A-Za-z0-9]{16,}|\bsk-ant-[A-Za-z0-9_-]{20,}/,
    message: 'Hardcoded API credential (GitHub/Google/Slack/Stripe/Anthropic token) in source — remove it, load it from an environment variable, and rotate the key since it was committed.',
    ignore: (m) => PLACEHOLDER.test(m[0]),
  },
  {
    rule: 'unsafe-target-blank',
    severity: 'medium',
    // A link opened with target="_blank" but no rel="noopener" lets the opened page
    // control this tab via window.opener (reverse tabnabbing — it can redirect the
    // original tab to a phishing page). The `noopener` guard below ignores the safe
    // form; same-line rel is the common case (a documented precision trade-off).
    re: /target\s*=\s*['"]_blank['"]/i,
    message: 'target="_blank" without rel="noopener" — the opened page can hijack this tab (reverse tabnabbing); add rel="noopener noreferrer".',
    ignore: (_m, line) => /noopener/i.test(line),
  },
  {
    rule: 'window-open-no-opener',
    severity: 'medium',
    // window.open(url) returns a handle and, unlike a modern target="_blank" link, does
    // NOT imply noopener — the opened page can drive this tab via window.opener (reverse
    // tabnabbing). High-precision: a non-empty first arg, and the safe form (a third
    // 'noopener' feature string, or a same-line opener cleanup) is ignored below.
    re: /\bwindow\.open\s*\(\s*[^)\s]/,
    message: "window.open() without 'noopener' lets the opened page control this tab via window.opener (reverse tabnabbing) — pass 'noopener' in the features argument (or set the returned handle's opener to null).",
    ignore: (_m, line) => /noopener/i.test(line) || /\.opener\s*=\s*null/.test(line),
  },
  {
    rule: 'document-domain-write',
    severity: 'medium',
    // Assigning document.domain relaxes the same-origin policy so ANY page on a sibling
    // subdomain can script into this one — a cross-site attack pivot. It is deprecated and
    // being removed from browsers. The `=(?!=)` matches assignment, not a comparison.
    re: /\bdocument\.domain\s*=(?!=)/,
    message: 'Assigning document.domain relaxes the same-origin policy (any sibling subdomain can script into this page) and is deprecated — remove it and use postMessage or CORS for cross-origin communication.',
  },
  {
    rule: 'iframe-sandbox-escape',
    severity: 'medium',
    // An <iframe sandbox> that allows BOTH allow-scripts AND allow-same-origin can reach
    // into its parent and remove its own sandbox attribute — defeating the sandbox entirely.
    // The two lookaheads require both tokens inside the same sandbox attribute value.
    re: /sandbox\s*=\s*['"](?=[^'"]*\ballow-scripts\b)(?=[^'"]*\ballow-same-origin\b)[^'"]*['"]/i,
    message: 'iframe sandbox allows both allow-scripts and allow-same-origin — the framed page can remove its own sandbox and escape it. Drop allow-same-origin (or serve the frame from a distinct origin).',
  },
  {
    rule: 'postmessage-wildcard-origin',
    severity: 'medium',
    // window.postMessage(data, '*') broadcasts the message to a frame at ANY origin —
    // a malicious/compromised iframe can read it. Always target a specific origin.
    re: /\.postMessage\s*\(\s*[^,]+,\s*['"]\*['"]\s*\)/,
    message: "postMessage(..., '*') sends data to any origin — pass the exact target origin instead of '*'.",
  },
  {
    rule: 'javascript-uri',
    severity: 'medium',
    // A `javascript:` URL in an href/src/action executes script when followed — an XSS
    // sink (especially when the URL is built from data) and a CSP violation. The common
    // no-op placeholders `javascript:void(0)` / `javascript:;` are ignored to keep
    // precision on the dangerous, script-bearing forms.
    re: /(?:href|src|to|action|formaction|xlink:href)\s*=\s*['"{]?\s*javascript:/i,
    message: 'javascript: URL in an href/src — following it executes script (XSS sink, breaks CSP); use an onClick handler or a real URL.',
    ignore: (_m, line) => /javascript:\s*(?:void\s*\(\s*0\s*\)|;)/i.test(line),
  },
  {
    rule: 'iframe-srcdoc-dynamic',
    severity: 'medium',
    // <iframe srcdoc={…}> renders the string as a FULL HTML document inside the frame — a
    // dynamic value is an XSS sink exactly like innerHTML. Matches a JSX expression or a
    // template literal with interpolation; a static double/single-quoted srcdoc is not flagged.
    re: /\bsrcdoc\s*=\s*(?:\{|`[^`]*\$\{)/,
    message: 'iframe srcdoc set from a dynamic value renders it as raw HTML in the frame (XSS sink) — sanitise the HTML, or build the frame content from trusted data only.',
  },
  {
    rule: 'data-html-uri',
    severity: 'medium',
    // A data:text/html URI in href/src is parsed as a full HTML document — following it runs
    // any inline script it contains (XSS / phishing) and bypasses many CSP setups.
    re: /(?:href|src|action|formaction|xlink:href)\s*=\s*['"{`]?\s*data:text\/html/i,
    message: 'data:text/html URI in href/src — it is parsed as an HTML document and runs inline script when opened (XSS/phishing); use a real URL or a sandboxed renderer.',
  },
  {
    rule: 'insecure-http',
    severity: 'low',
    re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1)[^'"`]+['"`]/,
    message: 'Insecure http:// URL — use https:// for remote endpoints.',
    // Skip XML/SVG namespace & schema URIs — they are identifiers, not endpoints.
    ignore: (_m, line) => NAMESPACE_HTTP.test(line),
  },
  {
    rule: 'insecure-websocket',
    severity: 'low',
    // A non-encrypted ws:// socket to a remote host travels in the clear, and an https
    // page cannot open it at all (mixed content). Local dev sockets are not flagged.
    re: /['"`]ws:\/\/(?!localhost|127\.0\.0\.1)[^'"`]+['"`]/,
    message: 'Insecure ws:// WebSocket to a remote host — use wss:// (an https page is blocked from opening a ws:// socket as mixed content).',
  },
];

/** Scan one file's content for security findings. Returns [] for non-issues. */
export function scanSecurity(file: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split('\n');
  // A hardcoded credential VALUE inside an obvious mock/fixture/demo file is demo data, not a real
  // leak — downgrade those (demoDowngrade rules) from 'high' to 'low' so a demo app never FAILS its
  // readiness gate on its own mock login creds, while a real secret in real source still blocks. Real
  // code vulns (aws-key, private-key, jwt-none, eval, …) are NOT demoDowngrade → they stay high here too.
  // Credentials are EXPECTED (not a leak) in a fixture/demo file OR a dotenv secrets file — a value rule
  // there is downgraded to 'low' so a correct app never FAILS its readiness gate on credentials that belong
  // exactly where they are. A real secret hardcoded in real source still blocks.
  const credsBelongHere = isFixtureFile(file) || isEnvSecretsFile(file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // skip minified/huge lines
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (m && !(r.ignore && r.ignore(m, line))) {
        const severity: Severity = credsBelongHere && r.demoDowngrade ? 'low' : r.severity;
        findings.push({ file, line: i + 1, severity, rule: r.rule, message: r.message });
      }
    }
  }
  return findings;
}

/** A concise, honest security report for the agent. */
export function securitySummary(findings: SecurityFinding[]): string {
  if (findings.length === 0) return 'Security scan: no hardcoded secrets or dangerous patterns found.';
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = findings.reduce(
    (acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc),
    {} as Record<Severity, number>,
  );
  const head = `Security scan: ${findings.length} issue(s) — ` +
    (['high', 'medium', 'low'] as Severity[]).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ') + '.';
  const body = sorted.slice(0, 20).map((f) => `  - [${f.severity}] ${f.file}:${f.line} ${f.rule} — ${f.message}`);
  return [head, ...body].join('\n');
}
