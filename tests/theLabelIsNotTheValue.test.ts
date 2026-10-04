/**
 * Q-150 (autopsy 77bd487b): `console.error('Failed to reset password', err)` was a high-severity `pii-in-logs`
 * finding — the readiness gate's one HARD compliance block — because the detector matched the word anywhere
 * on the line. The "heal" then emptied the call to `console.error()`, deleting a real error log to fix a leak
 * that never existed. A sibling, the post-edit reviewer, called the same line a typo. The class: a label read
 * as a value. A credential is leaked when its VALUE reaches the console.
 *
 * The detector itself is the one #3532 merged (`lineLogsCredential`, with its own tests); this file locks what
 * that change did not reach — the post-edit reviewer's private copy, the heal, and a census against a third.
 * Its word list is deliberately narrow (`access_token`, not a bare `token`), so the cases here stay inside it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { lineLogsCredential, scanCompliance } from '../src/server/AgentV3/ComplianceAnalysis';
import { redactCredentialLogLine, redactCredentialLogs } from '../src/server/AgentV3/credentialLogRedaction';
import { reviewEdit } from '../src/server/AgentV3/PostEditReviewer';

const LABELS_ONLY = [
  "console.error('Failed to reset password', err);",
  "console.error('Password reset failed:', error);",
  "console.warn('token expired, refreshing');",
  "console.error('Could not save API key settings', e.message);",
  "console.error('password:', err.message);",
];
const VALUES = [
  'console.log(password);',
  "console.log('password', password);",
  "console.log('password:', pwd);",
  'console.log(`access_token=${t}`);',
  'console.log(`Your OTP is ${code}`);',
  "console.log('API key:', key);",
  'console.log({ email, password });',
  "const x = 1; console.debug('secret =', s)",
  'console.log(`login ${user.password}`);',
];

describe('a label is not a value', () => {
  it('the report\'s line and its siblings are not credential logs', () => {
    for (const l of LABELS_ONLY) expect(lineLogsCredential(l), l).toBe(false);
  });

  it('"API key" with a space is the same word as api_key — a label that introduces a key\'s value is a leak', () => {
    expect(lineLogsCredential("console.log('API key:', key);")).toBe(true);
    expect(lineLogsCredential("console.error('Could not save API key settings', e.message);")).toBe(false);
  });

  it('a credential\'s value still is — as a name, a property, an interpolation, or after a label that introduces it', () => {
    for (const l of VALUES) expect(lineLogsCredential(l), l).toBe(true);
  });

  it('the heal no longer empties a real error log', () => {
    expect(redactCredentialLogLine(LABELS_ONLY[0])).toBeNull();
    const app = { 'src/pages/Reset.tsx': `export async function reset() {\n  try { await send(); } catch (err) {\n    ${LABELS_ONLY[0]}\n  }\n}` };
    expect(redactCredentialLogs(app).redactions).toEqual([]);
    expect(redactCredentialLogLine('  console.log(password);')).toBe('  console.log();');
  });

  it('the readiness finding follows the same rule', () => {
    const finding = (line: string) => scanCompliance('src/a.ts', `export function f(err: unknown, password: string) {\n  ${line}\n}`)
      .some((f) => f.kind === 'pii-in-logs');
    expect(finding(LABELS_ONLY[0])).toBe(false);
    expect(finding('console.log(password);')).toBe(true);
  });

  it('the post-edit reviewer reads it the same way, and never calls it a typo', () => {
    const issues = (line: string) => reviewEdit('src/pages/Reset.tsx', `import React from 'react';\nexport function A() {\n  ${line}\n  return <div>reset</div>;\n}\n`).issues.join(' ');
    expect(issues(LABELS_ONLY[0])).not.toMatch(/credential|password printed|typo/i);
    expect(issues('console.log(password);')).toMatch(/Line 3 prints a credential's value to the console/);
  });
});

describe('census: one detector for a credential in a console line', () => {
  it('no other module keeps its own console-and-credential pattern', () => {
    const ROOT = join(__dirname, '../src/server');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { walk(f); continue; }
        if (!/\.ts$/.test(n) || /\.test\.ts$/.test(n) || n === 'ComplianceAnalysis.ts') continue;
        // Reads an ENV value (`process.env.*KEY`) handed to the console — a value by construction, not a label.
        if (n === 'SecurityConfigAnalysis.ts') continue;
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          // A regex literal that names a console call AND a credential word is a second detector.
          if (/(?:^|[=(,[:]\s*)\/(?![/*])[^\n]*console\\?\.[^\n]*(?:password|passwd|token|secret|otp)[^\n]*\/[gimsuy]*/i.test(line) && !/^\s*(?:\/\/|\*)/.test(line)) offenders.push(`${f.slice(ROOT.length + 1)}: ${line.trim().slice(0, 100)}`);
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });
});
