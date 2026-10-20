// Q-886 — A CUSTOMER'S OWN DETAILS NEVER GO INTO A LOG LINE WHOLE.
//
// 🔴 THE DEFECT, on the NORMAL path and not an error branch:
//   · `routes/payment.ts` logged `Name: … Email: … Phone: …` on EVERY Cashfree order;
//   · the same file logged the WHOLE webhook body whenever an event carried no order id — firing
//     exactly when something was already wrong, so the worst payloads were the likeliest to print;
//   · `routes/auth.ts` logged a full phone number on every successful OTP gate check.
//
// 🔑 THE CLASS, AND WHY A SOURCE GUARD RATHER THAN THREE CAREFUL EDITS. `phoneForLog` already existed
// and was already used — at ONE of the two places in `auth.ts` that log a phone. The second was eleven
// lines below the first. A rule that must be remembered at every log statement is a rule that will
// eventually be forgotten, and the forgetting is SILENT: a log line that says too much looks exactly
// like one that says enough. So this file fails on a NEW raw-PII log line, in any server file, and the
// reviewer no longer has to notice.
//
// ⚠️ WHY THE CENSUS IS SHAPE-BASED, NOT WORD-BASED. An earlier instinct was to ban the words
// "email"/"phone" near `console.log`. That flags `[CIRCUIT] ${p.name}` (a provider's name) and misses
// `${cleanPhone}` entirely — wrong in both directions. What is actually forbidden is INTERPOLATING A
// VALUE whose identifier reads as a person's own detail, so the census matches the interpolation.
//
// 🔑 AND IT STOPS AT CONTACT DETAILS, DELIBERATELY. An account id — `customerIdClean`, `userId` — is
// our own handle for "who", it is what makes a log line diagnosable at all, and it is not a thing the
// person told us about themselves. A first draft of this census forbade `customer[A-Z]…` wholesale and
// flagged `${customerIdClean}` on the very line it was meant to bless, which would have pushed the fix
// toward a log nobody can trace. Name, email, phone, mobile: those are the person's. The id is ours.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { sourceCensusFiles } from './helpers/sourceCensus';
import { emailForLog, nameForLog, phoneForLog, webhookShapeForLog } from '../src/server/lib/piiForLog';

const root = join(__dirname, '..');

/**
 * 🔑 THE SHARED WALKER, NOT A PRIVATE ONE (2026-10-20).
 *
 * This file first hand-rolled its own `readdirSync` + `statSync` recursion. `tests/helpers/sourceCensus.ts`
 * does the same walk and skips `.tmp-*` generated fixtures, which can vanish mid-walk — a private copy
 * `statSync`s the disappearing path and fails CI for a reason that has nothing to do with what it checks.
 * `tests/sourceCensusIsolation.test.ts` pins that behaviour, including that a REAL broken source still
 * throws, so the skip cannot quietly swallow a genuine error.
 *
 * ⚠️ MEASURED WHILE MIGRATING, AND NOT SWEPT HERE ON PURPOSE: **109 other test files still hand-roll this
 * walk.** The helper arrived hours ago in #3858, from another session, which migrated three. A 109-file
 * mechanical sweep of another session's in-flight centralisation is exactly the race the concurrency rules
 * forbid, and every one of those files has its own filter and ignore list to get wrong. The count is
 * recorded as its own queue row instead; this change migrates only the census this session wrote.
 */
function serverFiles(dir: string): string[] {
  return sourceCensusFiles(dir, (p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p));
}

/** A log call's whole argument text, per source line. Comments stripped: this file's own quotes of the
 *  old lines, and the fixed sites' docblocks, would otherwise be read as code. */
function logLines(code: string): string[] {
  return stripCodeComments(code).split('\n').filter((l) => /console\.(log|warn|error|info|debug)\(/.test(l));
}

/**
 * An interpolation of a value that names a person's own detail — `${customerEmailClean}`,
 * `${cleanPhone}`, `${userName}` — but NOT one already routed through a masking helper, and not a
 * provider/model/file "name", which is what makes a word-based ban useless here.
 */
const RAW_PII = /\$\{\s*(?!(?:emailForLog|nameForLog|phoneForLog|maskPhone)\s*\()[A-Za-z0-9_.]*(?:[Ee]mail|[Pp]hone|[Mm]obile|customerName|userName|fullName|displayName|payerName)[A-Za-z0-9_.]*\s*\}/;

describe('no server log line carries a customer’s own details', () => {
  const files = serverFiles(join(root, 'src/server'));

  it('the census can see the server at all — it is not passing vacuously', () => {
    expect(files.length, 'no server files found; this guard went blind').toBeGreaterThan(100);
    const withLogs = files.filter((f) => logLines(readFileSync(f, 'utf8')).length > 0);
    expect(withLogs.length, 'no log lines found at all; the matcher is broken').toBeGreaterThan(30);
  });

  it('no log line interpolates a raw email, phone, mobile, customer field or user name', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of logLines(readFileSync(file, 'utf8'))) {
        if (RAW_PII.test(line)) offenders.push(`${file.replace(root + '/', '')}: ${line.trim().slice(0, 150)}`);
      }
    }
    expect(offenders, 'route these through emailForLog / nameForLog / phoneForLog (src/server/lib/piiForLog.ts)').toEqual([]);
  });

  it('no log line prints a whole request or webhook body', () => {
    // `console.warn('…', req.body)` leaks everything the payer sent and cannot be reviewed line by line.
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of logLines(readFileSync(file, 'utf8'))) {
        // The WRAPPED form is the fix, so it must not be flagged: only a bare `req.body` is a leak.
        const bare = line.replace(/webhookShapeForLog\(\s*req\.body\s*\)/g, 'webhookShapeForLog(…)');
        if (/console\.(log|warn|error|info|debug)\([^)]*\breq\.body\b/.test(bare)) {
          offenders.push(`${file.replace(root + '/', '')}: ${line.trim().slice(0, 150)}`);
        }
      }
    }
    expect(offenders, 'use webhookShapeForLog(req.body) — the keys and the event type, never the values').toEqual([]);
  });

  it('THE THREE SITES: each is fixed, and named here so a revert is visible', () => {
    const pay = stripCodeComments(readFileSync(join(root, 'src/server/routes/payment.ts'), 'utf8'));
    const auth = stripCodeComments(readFileSync(join(root, 'src/server/routes/auth.ts'), 'utf8'));
    expect(pay, 'the order line must not print the payer’s identity').not.toContain('Name: ${customerNameClean}');
    expect(pay).toContain('emailForLog(customerEmailClean)');
    expect(pay).toContain('webhookShapeForLog(req.body)');
    expect(auth).toContain('phoneForLog(cleanPhone)');
  });
});

describe('the helpers identify an account without being one', () => {
  it('an email keeps its first character and its domain, and nothing else', () => {
    expect(emailForLog('asheesh@gmail.com')).toBe('a…@gmail.com');
    expect(emailForLog('  Doc.Asheesh@ICLOUD.com  ')).toBe('D…@ICLOUD.com');
    // A plus-address must not leak the tag, and a sub-addressed domain is still the domain.
    expect(emailForLog('me+nav@sub.example.co.in')).toBe('m…@sub.example.co.in');
  });

  it('a value that is not an email is reduced, not passed through', () => {
    expect(emailForLog('not-an-email')).toBe('n…');
    expect(emailForLog('@nodomain')).toBe('@…');   // lastIndexOf('@') === 0, so not treated as an address
  });

  it('a name becomes its initial and its length', () => {
    expect(nameForLog('Asheesh Rathore')).toBe('A… (15)');
    expect(nameForLog('   ')).toBe('(none)');
  });

  it('every helper is TOTAL — junk gives a safe string, never a throw', () => {
    const junk: unknown[] = [undefined, null, '', '   ', 0, NaN, {}, [], true, Symbol('x'), 10n, () => 1];
    for (const v of junk) {
      expect(typeof emailForLog(v as string)).toBe('string');
      expect(typeof nameForLog(v as string)).toBe('string');
      expect(typeof phoneForLog(v as string)).toBe('string');
      expect(typeof webhookShapeForLog(v)).toBe('string');
    }
  });

  it('an empty value says so rather than printing nothing — a blank field is a real failure mode', () => {
    // A gateway rejecting a blank customer name is diagnosed from this difference.
    expect(emailForLog('')).toBe('(none)');
    expect(nameForLog(undefined)).toBe('(none)');
  });

  it('a webhook body gives its keys and event type, never a value', () => {
    const body = { type: 'PAYMENT_SUCCESS_WEBHOOK', data: { customer_details: { customer_phone: '9876543210' } }, order_id: 'ord_1' };
    const out = webhookShapeForLog(body);
    expect(out).toContain('keys=[data,order_id,type]');
    expect(out).toContain('type=PAYMENT_SUCCESS_WEBHOOK');
    expect(out, 'no value may survive').not.toContain('9876543210');
    expect(out).not.toContain('ord_1');
  });

  it('a hostile body cannot blow up the line it is in', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => webhookShapeForLog(circular)).not.toThrow();
    expect(webhookShapeForLog(circular)).toContain('keys=[a,self]');
    expect(webhookShapeForLog(null)).toBe('body=(none)');
    expect(webhookShapeForLog('a string')).toBe('body=(string)');
  });
});
