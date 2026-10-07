// A PRIVATE KEY IS ITS MATERIAL, NOT ITS MARKER (autopsy d0b2fcd6, 2026-10-07, Q-737).
//
// NavBharatAI's own iOS workflow rebuilds a PEM from a repository secret with `sed`/`echo`, so its source
// contains the PEM markers and no key. Every detector matched the marker: the security scan raised
// "Private key committed in source" as a build-breaker, and the redactor showed the model
// `[REDACTED:private-key]` where the disk had plain text, so the model's edits never matched the file and it
// rewrote the workflow wholesale. These tests run every detector over THAT generated file and over real keys.

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import { containsPemPrivateKey, pemKeyAtLine, pemPrivateKeyBlocks } from '../src/server/lib/pemKeyMaterial';
import { redactSecrets } from '../src/server/AgentV3/SecretRedactor';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';
import { analyzeThreatModel } from '../src/server/AgentV3/threatModelAnalysis';
import { scanFileStatic } from '../src/server/lib/appStaticScan';
import { analyzeExposedSecrets } from '../src/server/lib/websiteCheckup';

const kit = generateShipKit({ appName: 'mitrify' });
const iosPath = Object.keys(kit.files).find((p) => /ios-ipa\.yml$/.test(p))!;
const IOS = kit.files[iosPath];
// The two lines from the report, verbatim in shape.
const SED_LINE = `BODY="$(printf '%s' "$RAW" | sed -e 's/-----BEGIN PRIVATE KEY-----//' -e 's/-----END PRIVATE KEY-----//' | tr -d '[:space:]')"`;
const ECHO_LINE = `{ echo "-----BEGIN PRIVATE KEY-----"; printf '%s' "$BODY" | fold -w 64; echo ""; echo "-----END PRIVATE KEY-----"; } > "$DEST"`;

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const rsa1 = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const encrypted = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' }) as string;
// A service-account JSON keeps the key on ONE line with `\n` escapes — the leak that matters most.
const serviceAccount = JSON.stringify({ type: 'service_account', private_key: rsa });
// RFC 1421 headers between the marker and the body.
const legacyEncrypted = `-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF\n\n${rsa1.split('\n').slice(1, -2).join('\n')}\n-----END RSA PRIVATE KEY-----\n`;
// Cut off mid-paste: no END marker, still a leaked key.
const truncated = rsa.split('\n').slice(0, 8).join('\n');
const REAL = { rsa, rsa1, ec, encrypted, serviceAccount, legacyEncrypted, truncated };

describe('the material test itself', () => {
  it('🔒 every real key shape is a key', () => {
    for (const [name, k] of Object.entries(REAL)) expect(containsPemPrivateKey(k), name).toBe(true);
  });

  it('🔒 code that MENTIONS the markers is not a key — including our own generated iOS workflow', () => {
    expect(IOS).toContain('-----BEGIN PRIVATE KEY-----');
    expect(containsPemPrivateKey(IOS)).toBe(false);
    expect(containsPemPrivateKey(SED_LINE)).toBe(false);
    expect(containsPemPrivateKey(ECHO_LINE)).toBe(false);
    expect(containsPemPrivateKey("grep -q 'BEGIN PRIVATE KEY'")).toBe(false);
    expect(containsPemPrivateKey('-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----')).toBe(false);
  });

  it('a line-based scanner confirms a marker by the lines that follow it', () => {
    const lines = rsa.split('\n');
    expect(pemKeyAtLine(lines, 0)).toBe(true);
    const ios = IOS.split('\n');
    expect(ios.some((_, i) => pemKeyAtLine(ios, i))).toBe(false);
  });
});

describe('every detector agrees', () => {
  it('🔒 the redactor leaves the workflow exactly as it is on disk — so an edit of it can match', () => {
    expect(redactSecrets(IOS)).toBe(IOS);
    expect(redactSecrets(`${SED_LINE}\n${ECHO_LINE}`)).toBe(`${SED_LINE}\n${ECHO_LINE}`);
  });

  it('🔒 the redactor still masks every real key, the JSON-escaped one included', () => {
    for (const [name, k] of Object.entries(REAL)) {
      const out = redactSecrets(`before\n${k}\nafter`);
      expect(out, name).toContain('[REDACTED:private-key]');
      expect(out, name).not.toMatch(/MII[A-Za-z0-9+/]{20}/);
    }
    expect(pemPrivateKeyBlocks().flags).toContain('g');
  });

  it('🔒 the security scan raises no private-key finding on the generated workflow, and does on a real key', () => {
    expect(scanSecurity(iosPath, IOS).filter((f) => f.rule === 'private-key')).toEqual([]);
    expect(scanSecurity('server/key.ts', `const k = \`${rsa}\`;`).some((f) => f.rule === 'private-key')).toBe(true);
    expect(scanSecurity('sa.json', serviceAccount).some((f) => f.rule === 'private-key')).toBe(true);
  });

  it('the threat model, the static scan and the website checkup follow the same rule', () => {
    const tmFake = analyzeThreatModel([{ path: 'src/lib/pem.ts', content: `export const h = "${'-----BEGIN PRIVATE KEY-----'}";` }]);
    expect(tmFake.filter((f) => /private key/.test(f.message))).toEqual([]);
    const tmReal = analyzeThreatModel([{ path: 'src/lib/key.ts', content: `export const k = \`${rsa}\`;` }]);
    expect(tmReal.some((f) => /private key/.test(f.message))).toBe(true);

    expect(scanFileStatic('assets/app.js', ECHO_LINE).some((f) => /private key/i.test(JSON.stringify(f)))).toBe(false);
    expect(scanFileStatic('assets/app.js', `var k=\`${rsa}\`;`).some((f) => /private key/i.test(JSON.stringify(f)))).toBe(true);

    const page = (body: string) => ({ body, url: 'https://x.test', status: 200, headers: {}, setCookies: [] }) as never;
    expect(analyzeExposedSecrets(page('<pre>-----BEGIN PRIVATE KEY-----</pre>'))).toEqual([]);
    expect(analyzeExposedSecrets(page(`<pre>${ec}</pre>`)).length).toBe(1);
  });
});

describe('census — one definition of a private key', () => {
  it('🔒 no detector outside pemKeyMaterial.ts writes its own PEM-marker regex', async () => {
    const { globSync } = await import('glob');
    const { readFileSync } = await import('node:fs');
    const files = globSync('src/**/*.{ts,tsx}', { ignore: ['**/*.test.*', 'src/server/lib/pemKeyMaterial.ts'] });
    // A JS regex literal or RegExp source — not shell text such as the generated workflow's `sed 's/-----BEGIN…'`.
    const regexLiteral = /(?:\bre:\s*|new RegExp\(\s*['"`]|[=(,]\s*)\/-----BEGIN[^/\n]*PRIVATE KEY/;
    const offenders = files.filter((f) => regexLiteral.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
