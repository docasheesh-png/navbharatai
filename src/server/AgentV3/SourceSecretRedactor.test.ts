import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { redactSecrets as plain } from './SecretRedactor';
import { containsSecret, redactDeep, redactEventForUser, redactSecrets } from './SourceSecretRedactor';

// Minimal synthetic declarations exposing the generic assignment-mask boundary.
// No private report bytes or inferred replacement source are copied into this fixture.
const MEMBER = 'export interface User { password: string; createdAt: number; }';
const SIGNATURE = 'export function useAuth(): { login: (email: string, password: string) => Promise<void>; } { throw new Error(); }';

describe('a primitive annotation is syntax, not a credential', () => {
  it.each([
    MEMBER,
    SIGNATURE,
    'type Credentials = { password: string; token?: number; secret: boolean[]; };',
    'class Login { private password!: string; token: (string | null)[]; }',
    'const login = (password: string): void => {};',
    'function login(password: string, token: number): void {}',
    'let password: string | undefined;',
    '<<<FILE src/types/index.ts>>>\n' + MEMBER + '\n<<<ENDFILE>>>',
    '<<<FILE src/hooks/useAuth.ts>>>\n' + SIGNATURE + '\nconst unfinished = (',
    '<<<FILE a.ts>>>\n' + MEMBER + '\n<<<ENDFILE>>>\n<<<FILE b.ts>>>\n' + SIGNATURE + '\n<<<ENDFILE>>>',
  ])('preserves declaration/signature delimiters in %s', (input) => {
    expect(redactSecrets(input)).toBe(input);
    expect(containsSecret(input)).toBe(false);
  });

  it('reproduces the old corruption without guessing the historical unredacted source', () => {
    expect(plain(MEMBER)).not.toContain('password: string;');
    expect(plain(SIGNATURE)).not.toContain('password: string)');
    expect(redactSecrets(MEMBER)).toContain('password: string;');
    expect(redactSecrets(SIGNATURE)).toContain('password: string)');
  });

  it('is idempotent over nested tool inputs and user events', () => {
    const input = { content: MEMBER, nested: [{ source: SIGNATURE }] };
    expect(redactDeep(input)).toEqual(input);
    expect(redactDeep(redactDeep(input))).toEqual(input);
    const event = { type: 'narration', text: MEMBER };
    expect(redactEventForUser(event)).toBe(event);
  });
});

describe('preservation never exempts credential-bearing source', () => {
  it.each([
    'function login(password: string = "privateDefaultValue") {}',
    'const password: string = "privateDefaultValue";',
    'class Login { password: string = "privateDefaultValue"; }',
    'const password = { nested: "privateDefaultValue" };',
    'const password: string = readSecret("privateDefaultValue");',
    'function login(password: string = `prefix-${"privateDefaultValue"}`) {}',
    'interface Login { password: "privateDefaultValue"; }',
    'interface Login { password: privateDefaultValue; }',
    'interface Login { password: string | "privateDefaultValue"; }',
    'interface Login { password: Array<"privateDefaultValue">; }',
    'interface Login { password: string /* password=privateDefaultValue */ []; }',
    'interface Login { password: string; token: "privateDefaultValue"; }',
    'const password = (token: string) => "privateDefaultValue";',
  ])('masks values/defaults/literals, not only their annotations: %s', (input) => {
    const out = redactSecrets(input);
    expect(out).not.toContain('privateDefaultValue');
    expect(out).toContain('[REDACTED:secret]');
    expect(redactSecrets(out)).toBe(out);
  });

  it.each([
    'password: string',
    'password: number',
    'password: boolean',
    'password=string',
    'password:\n  string',
    'password:\r\n  string',
    'credentials:\n  password: string',
    'const config = { password: string };',
    'const config = { password: number };',
    '<<<FILE config.yaml>>>\npassword: string',
    '<<<FILE config.yaml>>>\ninterface Login { password: string; }',
    'Explain this setting: password: string',
    '- **Password:** `string`',
    '"password: string"',
    "'password: string'",
    '`password: string`',
    '// password: string',
    '/* password: string */',
    'const example = "interface Login { password: string; }";',
    'const example = `interface Login { password: string; }`;',
    'const example = /interface Login { password: string; }/;',
    '/* interface Login { password: string; } */',
    '```json\n{ "password": "sk-proj-' + 'a'.repeat(30) + '" }\n```',
    '```yaml\npassword: string\n```',
    'not valid source !!!\ninterface Login { password: string; }',
  ])('keeps generic secret protection for non-annotations: %s', (input) => {
    const out = redactSecrets(input);
    expect(out).toContain('[REDACTED:');
    expect(out).not.toContain('password: string');
  });

  it('does not turn protocol markers inside a literal into source boundaries', () => {
    const input = '<<<FILE a.ts>>>\nconst text = `\n<<<ENDFILE>>>\n<<<FILE b.ts>>>\ninterface Login { password: string; }\n`;';
    expect(redactSecrets(input)).not.toContain('password: string');
    expect(redactSecrets(input)).toContain('[REDACTED:secret]');
  });

  it.each([
    '0;'.repeat(21_000) + MEMBER,
    '('.repeat(200) + '0' + ')'.repeat(200) + ';' + MEMBER,
    (`<<<FILE a.ts>>>\n${MEMBER}\n<<<ENDFILE>>>\n`).repeat(129),
  ])('falls back conservatively when a structural parsing budget is exhausted', (input) => {
    expect(redactSecrets(input)).toBe(plain(input));
  });

  it('falls back conservatively for an oversized payload', () => {
    const input = ' '.repeat(200_001) + MEMBER + '\npassword=privateDefaultValue';
    expect(redactSecrets(input)).toBe(plain(input));
    expect(redactSecrets(input)).not.toContain('privateDefaultValue');
  });
});

describe('all existing non-source secret shapes keep the generic protection', () => {
  const providerKeys = [
    'sk-ant-' + 'a'.repeat(24), 'xai-' + 'A'.repeat(24), 'AIza' + 'A'.repeat(35),
    'AKIA' + 'A'.repeat(16), 'ghp_' + 'a'.repeat(36), 'github_pat_' + 'a'.repeat(60),
    'xoxb-' + 'a'.repeat(24), 'sk_live_' + 'a'.repeat(24), 'GOCSPX-' + 'a'.repeat(24),
    'SG.' + 'a'.repeat(24) + '.' + 'a'.repeat(24),
  ];
  it.each([
    ...providerKeys,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    'postgres://dbuser:privateDefaultValue@db.example.com:5432/app',
    'DATABASE_PASSWORD=privateDefaultValue',
    'client_secret: "privateDefaultValue"',
    '- **Password:** `privateDefaultValue`',
    '**token:** `privateDefaultValue`',
    '*secret*: `privateDefaultValue`',
    '`api_key`: `privateDefaultValue`',
    'password:\n "privateDefaultValue"',
    'password:\r\n privateDefaultValue',
    'Do not expose private credentials.\n==================================================\n17. DEMO MODE',
    'The password field is required.',
  ])('retains the existing result for %s', (input) => {
    expect(redactSecrets(input)).toBe(plain(input));
  });

  it('does not preserve provider material even in a type', () => {
    for (const key of providerKeys) {
      expect(redactSecrets(`interface Login { password: "${key}"; }`)).not.toContain(key);
    }
  });

  it('retains private-key block redaction', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    expect(redactSecrets(pem)).toBe(plain(pem));
    expect(redactSecrets(pem)).toContain('[REDACTED:private-key]');
  });
});

/** Redacted evidence need not typecheck, but a mask must not introduce a parser error. */
function parseErrors(source: string): string[] {
  const sf = ts.createSourceFile('evidence.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [])
    .map((d) => `${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

describe('redaction preserves parser structure across repeated report boundaries', () => {
  it.each([
    'const config = { password: syntheticCredential };',
    'interface Config { password: syntheticCredential; }',
    'config.password = syntheticCredential;',
    'config["password"] = syntheticCredential;',
    'config["pass\\u0077ord"] ||= readValue("syntheticCredential");',
    '(config.password) ??= `syntheticCredential-${other}`;',
    'password = readValue("syntheticCredential");',
    'const config = { "password": ["syntheticCredential"] };',
    'const config = { ["password"]: readValue("syntheticCredential", other) };',
    'const config = { pass\\u0077ord: `syntheticCredential-${other}` };',
    'const config = { token: { nested: "syntheticCredential" } };',
    'const config = { password() { return "syntheticCredential"; } };',
    'const config = { async password() { return "syntheticCredential"; } };',
    'const config = { *password() { yield "syntheticCredential"; } };',
    'const config = { get password() { return "syntheticCredential"; } };',
    'const config = { set password(value: string) { use("syntheticCredential"); } };',
    'const { password = readValue("syntheticCredential") } = config;',
    'const { password: local = readValue("syntheticCredential") } = config;',
    'function login(password: string = readValue("syntheticCredential")) {}',
    'class Login { #password: string = readValue("syntheticCredential"); }',
    'interface Config { password: Array<"syntheticCredential">; }',
    'interface Config { password: { nested: "syntheticCredential" }; }',
    'interface Config { password: string | "syntheticCredential"; }',
    'interface Config { password: [name: "syntheticCredential"]; }',
    '/* password:syntheticCredential*/',
    'const pattern = /password:syntheticCredential/;',
    'const text = `password:${readValue("syntheticCredential")}`;',
    'const text = tag`password:${readValue("syntheticCredential")}`;',
    'const text = "password:syntheticCredential";',
    'const view = <p>password:syntheticCredential</p>;',
    'const view = <input password={readValue("syntheticCredential")} />;',
    'const view = <input password="syntheticCredential" />;',
    'const config = { /* password:syntheticCredential*/ visible: 1 };',
  ])('does not let an earlier mask erase later primitive evidence: %s', (prefix) => {
    const input = prefix + '\n' + MEMBER + '\n' + SIGNATURE;
    expect(parseErrors(input)).toEqual([]);
    const out = redactSecrets(input);
    expect(out).not.toContain('syntheticCredential');
    expect(out).toContain('[REDACTED:secret]');
    expect(out).toContain(MEMBER);
    expect(out).toContain(SIGNATURE);
    expect(parseErrors(out)).toEqual([]);
    expect(redactSecrets(out)).toBe(out);
    expect(redactSecrets(redactSecrets(out))).toBe(out);
  });
});

describe('source masks never trust marker-looking values', () => {
  it.each([
    '"[REDACTED:secret]" + "syntheticCredential"',
    '"[REDACTED:secret] syntheticCredential"',
    '`[REDACTED:secret] ${"syntheticCredential"}`',
    'read("[REDACTED:secret]", "syntheticCredential")',
    '["[REDACTED:secret]", "syntheticCredential"]',
    '{ marker: "[REDACTED:secret]", value: "syntheticCredential" }',
    '"[REDACTED:syntheticCredential]"',
  ])('masks the complete expression, including %s', (value) => {
    for (const prefix of [
      `const config = { password: ${value} };`,
      `config.password = ${value};`,
      `function login(password: string = ${value}) {}`,
    ]) {
      const out = redactSecrets(prefix + '\n' + MEMBER);
      expect(out).not.toContain('syntheticCredential');
      expect(out).toContain(MEMBER);
      expect(parseErrors(out)).toEqual([]);
      expect(redactSecrets(out)).toBe(out);
    }
  });

  it('masks an entire nonprimitive type even beside a forged marker literal', () => {
    const out = redactSecrets('interface Login { password: "[REDACTED:secret]" | "syntheticCredential"; }\n' + MEMBER);
    expect(out).toContain('password: "[REDACTED:secret]";');
    expect(out).not.toContain('syntheticCredential');
    expect(out).toContain(MEMBER);
    expect(parseErrors(out)).toEqual([]);
    expect(redactSecrets(out)).toBe(out);
  });

  it('expands a secret shorthand to a masked property without trusting its value', () => {
    const out = redactSecrets('const config = { password, visible: true };\n' + MEMBER);
    expect(out).toContain('password: "[REDACTED:secret]", visible: true');
    expect(out).toContain(MEMBER);
    expect(parseErrors(out)).toEqual([]);
    expect(redactSecrets(out)).toBe(out);
  });

  it('preserves only known numeric counters across value and assignment positions', () => {
    const input = 'const config = { input_tokens: 1234567 }; config.outputTokens = "1234567";\n' + MEMBER;
    expect(redactSecrets(input)).toBe(input);
    for (const key of ['token', 'password', 'input_tokens']) {
      expect(redactSecrets(`const config = { ${key}: "syntheticCredential" };`)).not.toContain('syntheticCredential');
    }
    expect(redactSecrets('const config = { token: 1234567, password: 1234567 };')).not.toContain('1234567');
  });
});


it('keeps syntax stable in file envelopes, capped previews, nested inputs and event text', () => {
  const source = 'const config = { "password": readValue("syntheticCredential") };\n' + MEMBER;
  const envelope = '<<<FILE config.ts>>>\n' + source + '\n<<<ENDFILE>>>\n<<<FILE auth.ts>>>\n' + SIGNATURE;
  for (const input of [source, envelope, envelope + '\nconst unfinished = (']) {
    const out = redactSecrets(input);
    expect(out).toContain(MEMBER);
    expect(out).not.toContain('syntheticCredential');
    expect(redactSecrets(out)).toBe(out);
    expect(redactDeep(redactDeep({ nested: [{ input }] }))).toEqual({ nested: [{ input: out }] });
    const event = redactEventForUser({ type: 'narration', text: input });
    expect(event.text).toBe(out);
    expect(redactEventForUser(event)).toEqual(event);
  }
});

describe('escaped secret names do not depend on unrelated raw-name triggers', () => {
  it.each([
    String.raw`const config = { pass\u0077ord: "syntheticValue" };`,
    String.raw`const config = { "pass\u0077ord": "syntheticValue" };`,
    String.raw`const config = { ["pass\u0077ord"]: "syntheticValue" };`,
    String.raw`config.pass\u0077ord = "syntheticValue";`,
    String.raw`config["pass\u0077ord"] = "syntheticValue";`,
    String.raw`const pass\u0077ord = "syntheticValue";`,
    String.raw`const config = { pass\u{77}ord: "syntheticValue" };`,
    String.raw`const config = { "pass\u{77}ord": "syntheticValue" };`,
    String.raw`const config = { ["pass\u{77}ord"]: "syntheticValue" };`,
    String.raw`config.pass\u{77}ord = "syntheticValue";`,
    String.raw`config["pass\u{77}ord"] = "syntheticValue";`,
    String.raw`const pass\u{0000000077}ord = "syntheticValue";`,
    String.raw`const config = { "pass\x77ord": "syntheticValue" };`,
    String.raw`const config = { ["pass\x77ord"]: "syntheticValue" };`,
    String.raw`config["pass\x77ord"] = "syntheticValue";`,
  ])('masks a standalone decoded credential name: %s', (input) => {
    expect(input).not.toMatch(/password|secret|token|credential/i);
    expect(parseErrors(input)).toEqual([]);
    const out = redactSecrets(input);
    expect(out).not.toContain('syntheticValue');
    expect(out).toContain('[REDACTED:secret]');
    expect(parseErrors(out)).toEqual([]);
    expect(redactSecrets(out)).toBe(out);
  });

  it('still preserves primitive annotations and unrelated escaped properties', () => {
    for (const input of [
      String.raw`interface Login { pass\u0077ord: string; }`,
      String.raw`interface Login { "pass\u{77}ord": string; }`,
      String.raw`const config = { na\u006de: "ordinary value" };`,
      String.raw`const config = { ["na\x6de"]: "ordinary value" };`,
    ]) expect(redactSecrets(input)).toBe(input);
  });

  it('keeps oversized escape candidates on the conservative generic fallback', () => {
    const input = ' '.repeat(200_001) + String.raw`const config = { pass\u0077ord: "syntheticValue" };`;
    expect(redactSecrets(input)).toBe(plain(input));
  });
});

describe('lexical spans never split an existing generic credential match', () => {
  it.each([
    'password:/*note*/syntheticValue;',
    'PASSWORD=/*note*/syntheticValue',
    'password:/**/syntheticValue',
    'password:/*token:syntheticA*/syntheticB',
    'password: /*token:syntheticA*/syntheticB',
    'password:\n/*token:syntheticA*/syntheticB',
    'PASSWORD=/*token:syntheticA*/syntheticB',
    'Settings password:/*token:syntheticA*/syntheticB',
    'const visible = /password:syntheticA/+syntheticB;',
    'const visible = /*password:syntheticA*/syntheticB;',
  ])('retains generic protection across %s', (input) => {
    for (const text of [input, input + '\n' + MEMBER]) {
      const baseline = plain(text);
      const out = redactSecrets(text);
      for (const sentinel of ['syntheticValue', 'syntheticA', 'syntheticB']) {
        if (!baseline.includes(sentinel)) expect(out).not.toContain(sentinel);
      }
    }
  });

  it.each([
    'const x = `password:${"syntheticValue"}`;',
    'const x = `password=${read("syntheticValue")}`;',
    'const x = `prefix ${safe} password: ${"syntheticValue"}`;',
    'const x = tag`password:${"syntheticValue"}`;',
    'const x = `pass\\u0077ord:${"syntheticValue"}`;',
  ])('masks a direct assignment-labeled interpolation without evaluating it: %s', (input) => {
    expect(parseErrors(input)).toEqual([]);
    const out = redactSecrets(input);
    expect(out).not.toContain('syntheticValue');
    expect(out).toContain('[REDACTED:secret]');
    expect(parseErrors(out)).toEqual([]);
    expect(redactSecrets(out)).toBe(out);
  });

  it('does not mistake a tag/name or ordinary template mention for an assignment label', () => {
    for (const input of [
      'const x = password`ordinary ${value}`;',
      'const x = `The password field ${value} is required.`;',
      'const x = `ordinary ${password}`;',
    ]) expect(redactSecrets(input)).toBe(input);
  });
});


it('never treats input text resembling an internal boundary as a masking exemption', () => {
  const input = 'const x = `password:${"syntheticValue"}`;\n/*\n\0source-boundary\0\n*/';
  const out = redactSecrets(input);
  expect(out).not.toContain('syntheticValue');
  expect(out).toContain('[REDACTED:secret]');
  expect(redactSecrets(out)).toBe(out);
});

describe('AST masks never restore a generic-masked suffix', () => {
  it.each([
    'PASSWORD=syntheticA;syntheticB',
    'PASSWORD=\nsyntheticA;syntheticB',
    'const config={\npassword:\nsyntheticA;syntheticB\n};',
    'PASSWORD=syntheticA;;syntheticB',
    'PASSWORD=syntheticA)syntheticB',
    'PASSWORD=syntheticA]syntheticB',
    'PASSWORD=syntheticA}syntheticB',
    'PASSWORD=syntheticA;[REDACTED:secret]syntheticB',
    'Settings PASSWORD=syntheticA;syntheticB',
    'password: PASSWORD=syntheticA;syntheticB',
    'const harmless = 1; PASSWORD=syntheticA;syntheticB',
    'const password=syntheticA;syntheticB',
    'config.password=syntheticA;syntheticB',
    'config["password"]=syntheticA;syntheticB',
    'const config={password:syntheticA;syntheticB};',
    'const config={password:syntheticA)syntheticB};',
    'const config={password:syntheticA}syntheticB;',
    'const value = { password: /password:syntheticA/;syntheticB',
    'const value = { password: <p>password:syntheticA</p>;syntheticB',
    'function login(password=syntheticA;syntheticB) {}',
    'class Login { password=syntheticA;syntheticB }',
    'interface Login { password:syntheticA;syntheticB }',
    'const { password=syntheticA;syntheticB } = config;',
    'const config={password(){return syntheticA;}syntheticB};',
    'const config={input_tokens:1234567;syntheticB};',
    'PASSWORD=https://alice:syntheticA@example.test',
    'const config={password:https://alice:syntheticA@example.test\n};',
    'PASSWORD=postgres://alice:syntheticA@example.test/db',
    'config.password=https://alice:syntheticA@example.test',
  ])('keeps conservative generic protection for %s', (input) => {
    for (const text of [input, input + '\n' + MEMBER, input + '\n' + SIGNATURE]) {
      const generic = plain(text);
      const out = redactSecrets(text);
      for (const sentinel of ['syntheticA', 'syntheticB']) {
        if (!generic.includes(sentinel)) expect(out).not.toContain(sentinel);
      }
    }
  });

  it.each([
    'PASSWORD=syntheticA; syntheticB',
    'PASSWORD=syntheticA;\nsyntheticB',
    'PASSWORD=syntheticA;\r\nsyntheticB',
    'PASSWORD="syntheticA";syntheticB',
    'config.password = "syntheticA"; syntheticB;',
  ])('does not discard unrelated suffixes outside the generic match: %s', (input) => {
    expect(plain(input)).toContain('syntheticB');
    const out = redactSecrets(input);
    expect(out).not.toContain('syntheticA');
    expect(out).toContain('syntheticB');
  });
});


it('discards every source span and uses generic original-input masking when the proof budget is exhausted', () => {
  const input = MEMBER + '\n' + 'PASSWORD=syntheticA;syntheticB '.repeat(1_000);
  expect(input.length).toBeLessThan(200_000);
  const out = redactSecrets(input);
  expect(out).toBe(plain(input));
  expect(out).toContain('createdAt: number;');
  expect(out).not.toContain(MEMBER);
  expect(out).not.toContain('syntheticA');
  expect(out).not.toContain('syntheticB');
});

it('proves line-local generic equivalence before checking many escaped-name values', () => {
  const input = MEMBER + '\n' + (String.raw`const config = { pass\u{77}ord: "tiny" };` + '\n').repeat(500);
  expect(input.length).toBeLessThan(200_000);
  const out = redactSecrets(input);
  expect(out).not.toContain('tiny');
  expect(out).toContain(MEMBER);
  expect(out).toContain('const config');
});


it('needs no differential checks when generic masking changes nothing', () => {
  const input = (String.raw`const config = { pass\u{77}ord: "tiny" };` + ' ').repeat(500);
  expect(plain(input)).toBe(input);
  const out = redactSecrets(input);
  expect(out).not.toContain('tiny');
  expect(out).toContain('const config');
});

it('retains ordinary near-limit multiline source rather than using full-string checks per field', () => {
  const filler = '// ' + 'ordinary evidence '.repeat(45) + '\n';
  const block = filler.repeat(10) + String.raw`const config = { password: "syntheticA", pass\u{77}ord: "tiny" };` + '\n';
  const input = MEMBER + '\n' + block.repeat(24);
  expect(input.length).toBeGreaterThan(190_000);
  expect(input.length).toBeLessThan(200_000);
  const out = redactSecrets(input);
  expect(out).not.toContain('tiny');
  expect(out).toContain(MEMBER);
  expect(out.split(filler).length - 1).toBe(240);
});


it('uses whole-input checks when quoted assignment or PEM masking crosses lines', () => {
  const quoted = '{"password"\n:\n"syntheticA"}';
  expect(redactSecrets(quoted)).not.toContain('syntheticA');
  const pem = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  const body = pem.trim().split('\n')[1];
  const input = 'const text = `' + pem + '`;\n' + MEMBER;
  const out = redactSecrets(input);
  expect(out).not.toContain(body);
  expect(out).toContain(MEMBER);
  expect(parseErrors(out)).toEqual([]);
});

it.each([10, 11, 20, 500])('preserves verified semicolon-segment evidence in a 196k minified line with %i fields', (fields) => {
  const prefix = 'const visible=42; const password="syntheticA"; ' +
    (String.raw`const config = { pass\u{77}ord: "tiny" };` + ' ').repeat(fields - 1) + '// ';
  const input = prefix + 'x'.repeat(196_000 - prefix.length);
  expect(input.length).toBe(196_000);
  const out = redactSecrets(input);
  expect(out).not.toContain('tiny');
  expect(out).not.toContain('syntheticA');
  expect(out).toContain('const visible=42;');
  expect(out).toContain('// ');
  expect(out).not.toBe(JSON.stringify('[REDACTED:secret]'));
});


describe('a semicolon partition needs exact generic equivalence, not source provenance', () => {
  it.each([
    'PASSWORD=syntheticA;syntheticB',
    'const password="syntheticA;syntheticB";',
    'const config={"password":"syntheticA;syntheticB"};',
    'const x=`password:syntheticA;syntheticB`;',
    'const x=`password:${read("syntheticA;syntheticB")}`;',
    'const x="https://alice:syntheticA;syntheticB@example.test";',
    'const password=syntheticA;syntheticB;',
  ])('does not expose either side of a cross-semicolon credential: %s', (input) => {
    for (const text of [input, input + '\n' + MEMBER]) {
      const out = redactSecrets(text);
      expect(out).not.toContain('syntheticA');
      expect(out).not.toContain('syntheticB');
    }
  });

  it('retains whole-input protection for PEM headers containing semicolons', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    const body = pem.trim().split('\n')[1];
    const withHeader = pem.replace('\n', '\nVersion: syntheticA;syntheticB\n');
    const input = 'const key = `' + withHeader + '`;\n' + MEMBER;
    expect(plain(input)).not.toContain(body);
    const out = redactSecrets(input);
    expect(out).not.toContain(body);
    expect(out).not.toContain('syntheticA');
    expect(out).not.toContain('syntheticB');
    expect(out).toContain(MEMBER);
    expect(parseErrors(out)).toEqual([]);
  });
});


it('keeps the original size cap when mask expansion makes a later pass oversized', () => {
  const prefix = MEMBER + '\nconst password="syntheticA"; ' +
    (String.raw`const config = { pass\u{77}ord: "tiny" };` + ' ').repeat(500) + '// ';
  const input = prefix + 'x'.repeat(196_000 - prefix.length);
  const out = redactSecrets(input);
  expect(out).toContain(MEMBER);
  expect(out.length).toBeGreaterThan(200_000);
  expect(out).not.toContain('tiny');
  const again = redactSecrets(out);
  expect(again).toBe(plain(out));
  expect(again).not.toContain('tiny');
  expect(again).not.toContain('syntheticA');
});


describe('proof exhaustion preserves the bundled generic floor, not unpublished AST-only recall', () => {
  const expensive = MEMBER + '\n' + 'PASSWORD=syntheticA;syntheticB '.repeat(1_000) + '\n';

  it('keeps PEM protection and ordinary evidence without retaining an earlier primitive exemption', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    const body = pem.trim().split('\n')[1];
    const filler = '// ' + 'ordinary evidence '.repeat(45) + '\n';
    const block = filler.repeat(10) + String.raw`const config = { password: "syntheticA", pass\u{77}ord: "tiny" };` + '\n';
    const input = MEMBER + '\nconst key = `' + pem + '`;\n' + block.repeat(24);
    expect(input.length).toBeLessThan(200_000);
    const out = redactSecrets(input);
    expect(out).toBe(plain(input));
    expect(out).not.toContain(body);
    expect(out).not.toContain('syntheticA');
    expect(out).not.toContain(MEMBER);
    expect(out.split(filler).length - 1).toBe(240);
    // The deployed generic redactor also lacks this AST-only escaped-name coverage.
    // Do not claim it as a guarantee on the explicit generic fallback path.
    expect(plain(input)).toContain('tiny');
    expect(out).toContain('tiny');
  });

  it.each([
    'const config = { password: "tiny" };',
    'const password: string = "tiny";',
    String.raw`const config = { pass\u{77}ord: "tiny" };`,
    'const x = `password:${"tiny"}`;',
    'const config = { password(){return "tiny";} };',
  ])('limits extra source detection to completed bounded analysis: %s', (source) => {
    expect(redactSecrets(source)).not.toContain('tiny');
    const input = expensive + source;
    expect(plain(input)).toContain('tiny');
    expect(redactSecrets(input)).toBe(plain(input));
  });

  it.each([
    'password=syntheticValue',
    'PASSWORD=https://alice:syntheticValue@example.test',
    'password:/*token:syntheticValue*/syntheticTail',
    '{"password":"syntheticValue"}',
    'const key="sk-proj-' + 'a'.repeat(30) + '";',
  ])('retains full original-input generic protection including trailing %s', (tail) => {
    const input = expensive + tail;
    const out = redactSecrets(input);
    expect(out).toBe(plain(input));
    expect(out).not.toContain('syntheticValue');
    expect(out).not.toContain('syntheticTail');
    expect(out).not.toContain('sk-proj-' + 'a'.repeat(30));
  });

  it('keeps the strengthened quoted-key generic protection rather than reverting to old main output', () => {
    const input = expensive + '{"password":"tiny"}';
    // ffbbb802 has no quoted-key rule; bundled generic deliberately adds it.
    expect(plain(input)).not.toContain('tiny');
    expect(redactSecrets(input)).toBe(plain(input));
  });

  it('uses the same atomic fallback in nested inputs and user-event text', () => {
    const out = plain(expensive);
    expect(redactDeep({ nested: [{ source: expensive }] })).toEqual({ nested: [{ source: out }] });
    expect(redactEventForUser({ type: 'narration', text: expensive }).text).toBe(out);
  });
});
