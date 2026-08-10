/**
 * Audit finding #3 — one admin gate, and no credential in a URL.
 *
 * The defect was not "two copies of a function". It was that the copy was WEAKER than the original in
 * four separate ways, and it guarded observability telemetry plus a Firestore-export trigger. These
 * tests lock the gate's behaviour and the invariant that no route may re-invent it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import type { Request } from 'express';
import {
  adminRequestOk,
  mintAdminToken,
  verifyAdminTokenValue,
  adminTokenTtlMs,
  adminCredential,
  safeStrEqual,
} from '../src/server/lib/adminAuth';

const PASS = 'super-secret-admin-pass';
const USER = 'aashishcpmt09';

const reqWith = (headers: Record<string, unknown>, query: Record<string, unknown> = {}): Request =>
  ({ headers, query } as unknown as Request);

const prev = { pass: process.env.ADMIN_PASSWORD, user: process.env.ADMIN_USERNAME, ttl: process.env.ADMIN_TOKEN_TTL_HOURS };
afterEach(() => {
  process.env.ADMIN_PASSWORD = prev.pass;
  process.env.ADMIN_USERNAME = prev.user;
  process.env.ADMIN_TOKEN_TTL_HOURS = prev.ttl;
  if (prev.pass === undefined) delete process.env.ADMIN_PASSWORD;
  if (prev.user === undefined) delete process.env.ADMIN_USERNAME;
  if (prev.ttl === undefined) delete process.env.ADMIN_TOKEN_TTL_HOURS;
});

describe('adminRequestOk', () => {
  it('accepts a freshly minted token in the x-admin-token header', () => {
    process.env.ADMIN_PASSWORD = PASS;
    process.env.ADMIN_USERNAME = USER;
    const token = mintAdminToken(PASS, USER, Date.now());
    expect(adminRequestOk(reqWith({ 'x-admin-token': token }))).toBe(true);
  });

  it('🔒 NEVER accepts the password from the query string — the whole point of this fix', () => {
    // The old copy did exactly this, writing the admin password into every access log.
    process.env.ADMIN_PASSWORD = PASS;
    process.env.ADMIN_USERNAME = USER;
    expect(adminRequestOk(reqWith({}, { admin: PASS }))).toBe(false);
    expect(adminRequestOk(reqWith({}, { 'x-admin-token': mintAdminToken(PASS, USER, Date.now()) }))).toBe(false);
  });

  it('never accepts the raw password as the token either', () => {
    process.env.ADMIN_PASSWORD = PASS;
    process.env.ADMIN_USERNAME = USER;
    expect(adminRequestOk(reqWith({ 'x-admin-token': PASS }))).toBe(false);
  });

  it('refuses when no admin password is configured — an empty secret must not open the door', () => {
    delete process.env.ADMIN_PASSWORD;
    expect(adminRequestOk(reqWith({ 'x-admin-token': mintAdminToken('', USER, Date.now()) }))).toBe(false);
  });

  it('refuses a missing, empty, or non-string header', () => {
    process.env.ADMIN_PASSWORD = PASS;
    expect(adminRequestOk(reqWith({}))).toBe(false);
    expect(adminRequestOk(reqWith({ 'x-admin-token': '' }))).toBe(false);
    expect(adminRequestOk(reqWith({ 'x-admin-token': ['a', 'b'] }))).toBe(false);
  });

  it('refuses a token signed with a DIFFERENT password', () => {
    process.env.ADMIN_PASSWORD = PASS;
    process.env.ADMIN_USERNAME = USER;
    expect(adminRequestOk(reqWith({ 'x-admin-token': mintAdminToken('wrong-pass', USER, Date.now()) }))).toBe(false);
  });

  it('expires — a leaked token does not grant permanent access', () => {
    process.env.ADMIN_PASSWORD = PASS;
    process.env.ADMIN_USERNAME = USER;
    process.env.ADMIN_TOKEN_TTL_HOURS = '1';
    const old = mintAdminToken(PASS, USER, Date.now() - 2 * 60 * 60 * 1000);
    expect(adminRequestOk(reqWith({ 'x-admin-token': old }))).toBe(false);
  });

  it('tolerates a Cloud Run value with a trailing newline or wrapping quotes', () => {
    // Without adminCredential() normalisation the panel works while these routes 403 forever.
    process.env.ADMIN_PASSWORD = `"${PASS}"\n`;
    process.env.ADMIN_USERNAME = ` ${USER} `;
    expect(adminRequestOk(reqWith({ 'x-admin-token': mintAdminToken(PASS, USER, Date.now()) }))).toBe(true);
  });
});

describe('the primitives still behave', () => {
  it('verifyAdminTokenValue rejects legacy dotless, future-dated and malformed tokens', () => {
    const now = Date.now();
    const ttl = adminTokenTtlMs('720');
    expect(verifyAdminTokenValue(mintAdminToken(PASS, USER, now), PASS, USER, now, ttl)).toBe(true);
    expect(verifyAdminTokenValue('legacystatictoken', PASS, USER, now, ttl)).toBe(false);
    expect(verifyAdminTokenValue(mintAdminToken(PASS, USER, now + 10 * 60_000), PASS, USER, now, ttl)).toBe(false);
    expect(verifyAdminTokenValue('', PASS, USER, now, ttl)).toBe(false);
  });

  it('adminTokenTtlMs clamps junk to the 30-day default and stays inside [1h, 365d]', () => {
    expect(adminTokenTtlMs(undefined)).toBe(720 * 3600_000);
    expect(adminTokenTtlMs('not-a-number')).toBe(720 * 3600_000);
    expect(adminTokenTtlMs('0.001')).toBe(3600_000);
    expect(adminTokenTtlMs('999999')).toBe(365 * 24 * 3600_000);
  });

  it('adminCredential strips whitespace and one layer of quotes', () => {
    expect(adminCredential(' "abc" \n')).toBe('abc');
    expect(adminCredential(undefined, 'fallback')).toBe('fallback');
    expect(adminCredential('')).toBe('');
  });

  it('safeStrEqual is length-safe and correct', () => {
    expect(safeStrEqual('abc', 'abc')).toBe(true);
    expect(safeStrEqual('abc', 'abd')).toBe(false);
    expect(safeStrEqual('abc', 'abcd')).toBe(false); // must not throw on unequal lengths
    expect(safeStrEqual('', '')).toBe(true);
  });
});

describe('no route may re-invent the admin gate', () => {
  const files = execSync(
    "find src/server -name '*.ts' | grep -v '\\.test\\.' | grep -v goldenScaffolds | grep -v 'generator/templates'",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);

  const scan = (re: RegExp): string[] => {
    const out: string[] = [];
    for (const f of files) {
      if (f.endsWith('src/server/lib/adminAuth.ts')) continue; // the definition documents the old bug
      if (/\/\._/.test(f)) continue;
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      src.split('\n').forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        if (re.test(l)) out.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    return out;
  };

  it('🔒 no route reads an admin credential out of the query string or the body', () => {
    // If this fails, the fix is `adminRequestOk(req)` — not an allowlist entry.
    expect(scan(/req\.(query|body)\.admin\b/)).toEqual([]);
    expect(scan(/req\.(query|body)\[['"]admin['"]\]/)).toEqual([]);
  });

  it('no route compares ADMIN_PASSWORD directly', () => {
    expect(scan(/ADMIN_PASSWORD\s*(===|==|!==)/)).toEqual([]);
    expect(scan(/(===|==)\s*process\.env\.ADMIN_PASSWORD/)).toEqual([]);
  });

  it('the two routes that carried the weak copy now use the shared gate', () => {
    for (const f of ['src/server/routes/health.ts', 'src/server/routes/observability.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain("from '../lib/adminAuth'");
      expect(src, f).toContain('adminRequestOk(req)');
    }
  });

  it('admin.ts still exports its primitives, so existing importers are untouched', () => {
    const src = readFileSync('src/server/routes/admin.ts', 'utf8');
    for (const name of ['adminTokenTtlMs', 'mintAdminToken', 'verifyAdminTokenValue', 'adminCredential']) {
      expect(src, name).toContain(name);
    }
    expect(src).toContain("from '../lib/adminAuth'");
  });
});
