// PR 3 of the admin panel audit (2026-10-05): the App Check card and the Audit Log screen — two server
// capabilities that existed with no screen. These tests hold that each is wired end to end, that each tells
// the truth about what it can and cannot see, and that every admin decision reaches the audit log.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { readAppCheckStats, clientReadiness, enforceVerdict, type AppCheckStats } from '../src/lib/appCheckReadiness';
import { isAdminAuditEvent, adminAuditRow, adminEventLabel, NOT_ADMIN_ACTIONS } from '../src/lib/adminAuditEvents';
import { readAuditPage, auditRowMatches } from '../src/components/admin/AdminAuditLogPanel';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const zero = { valid: 0, missing: 0, invalid: 0, unverifiable: 0 };
const stats = (over: Partial<AppCheckStats> = {}): AppCheckStats => ({
  mode: 'monitor', siteKeyConfigured: true, since: '2026-10-05T00:00:00Z', scope: 'this server instance since it started',
  web: { ...zero }, native: { ...zero }, refused: 0, ...over,
});

describe('App Check — the reading taken before switching to enforce', () => {
  it('counts what enforce would refuse: no token or a bad one, never our own verifier being down', () => {
    expect(clientReadiness({ valid: 8, missing: 1, invalid: 1, unverifiable: 5 })).toEqual({ seen: 15, wouldRefuse: 2, validPct: 53 });
    expect(clientReadiness(zero).validPct).toBeNull();
  });

  it('says plainly when enforcing would lock people out', () => {
    const v = enforceVerdict(stats({ web: { valid: 90, missing: 10, invalid: 0, unverifiable: 0 }, native: { valid: 5, missing: 0, invalid: 0, unverifiable: 0 } }));
    expect(v.tone).toBe('danger');
    expect(v.sentence).toContain('10 of the 105');
  });

  it('green only when every request seen carried a valid token', () => {
    expect(enforceVerdict(stats({ web: { ...zero, valid: 4 }, native: { ...zero, valid: 2, unverifiable: 1 } })).tone).toBe('ok');
  });

  it('nothing seen is "nothing to judge", never a green light', () => {
    expect(enforceVerdict(stats()).tone).toBe('unknown');
  });

  it('a website with no site key would be refused entirely, whatever the counts', () => {
    const v = enforceVerdict(stats({ siteKeyConfigured: false, web: { ...zero, valid: 3 } }));
    expect(v.tone).toBe('warn');
    expect(v.sentence).toContain('every website request');
  });

  it('a body that is not the stats shape is not shown as stats', () => {
    expect(readAppCheckStats({ error: 'admin only' })).toBeNull();
    expect(readAppCheckStats({ mode: 'monitor', web: { valid: 1 }, native: zero })).toBeNull();
    expect(readAppCheckStats(stats())).not.toBeNull();
  });

  it('the card reads the real route, checks the answer, and says the counts are per instance', () => {
    const card = read('src/components/admin/AppCheckCard.tsx');
    expect(card).toContain("fetch('/api/admin/app-check'");
    expect(card).toContain('r.ok ? readAppCheckStats(body) : null');
    expect(card).toContain('Another instance keeps its own count');
    expect(read('src/server/routes/health.ts')).toContain("app.get('/api/admin/app-check'");
  });
});

describe('the audit log — every admin action, and only admin actions', () => {
  it('classifies admin and store-admin decisions in, refused tokens and platform failures out', () => {
    for (const e of ['ADMIN_APP_TAKEDOWN', 'ADMIN_TOKEN_ADJUST', 'ADMIN_LOGIN_FAILED', 'GALLERY_REVIEW_DECISION', 'STORE_APK_REVIEW_DECISION', 'STORE_WEB_REVIEW_DECISION', 'STORE_COMMENT_REMOVED_BY_ADMIN']) {
      expect(isAdminAuditEvent(e), e).toBe(true);
    }
    for (const e of ['ADMIN_ACCESS_DENIED', 'ADMIN_BUILD_REPORT_SAVE_FAILED', 'APP_PUBLISH_FLAGGED', 'SHARE_REVOKED', '', null]) {
      expect(isAdminAuditEvent(e), String(e)).toBe(false);
    }
  });

  it('every exclusion names a real event and says why', () => {
    const emitted = new Set<string>();
    for (const f of [...globSync('src/server/**/*.ts', { cwd: root }), 'server.ts']) {
      if (/\.test\.ts$/.test(f)) continue;
      for (const m of read(f).matchAll(/audit\('([A-Z0-9_]+)'/g)) emitted.add(m[1]);
    }
    for (const [event, why] of Object.entries(NOT_ADMIN_ACTIONS)) {
      expect(emitted.has(event), `${event} is excluded but nothing emits it`).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it('every event an admin-guarded write emits reaches the audit log (the class: a decision recorded where no one looks)', () => {
    const missed: string[] = [];
    for (const f of [...globSync('src/server/routes/*.ts', { cwd: root }), 'server.ts']) {
      if (/\.test\.ts$/.test(f)) continue;
      const s = read(f);
      const re = /app\.(post|put|patch|delete)\(\s*'([^']+)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const rest = s.slice(re.lastIndex);
        const next = rest.search(/\n  app\.(get|post|put|patch|delete|use)\(/);
        const body = s.slice(m.index, re.lastIndex + (next >= 0 ? next : 4000));
        if (!/\b(verifyAdminToken|requireAdmin|isStoreAdmin)\b/.test(body)) continue;
        for (const a of body.matchAll(/audit\('([A-Z0-9_]+)'/g)) {
          if (!isAdminAuditEvent(a[1]) && !(a[1] in NOT_ADMIN_ACTIONS)) missed.push(`${f} ${m[2]}: ${a[1]}`);
        }
      }
    }
    expect(missed).toEqual([]);
  });

  it('audit() copies admin actions into their own collection, so the screen can page exactly', () => {
    const audit = read('src/server/lib/audit.ts');
    expect(audit).toContain('if (isAdminAuditEvent(event)) appendAdminAudit(event, meta, Date.parse(ts));');
    const store = read('src/server/lib/adminAuditLog.ts');
    expect(store).toContain(".orderBy('ts', 'desc')");
    expect(store).toContain("ADMIN_AUDIT_COLLECTION = 'admin_audit_log'");
  });

  it('projects a row: who, on what, why, result', () => {
    expect(adminAuditRow({ ts: 5, event: 'ADMIN_APP_RESTORED', admin: 'root', workspaceId: 'ws1', reason: 'mistaken ban', result: 'ok' }))
      .toEqual({ ts: 5, event: 'ADMIN_APP_RESTORED', actor: 'root', target: 'ws1', reason: 'mistaken ban', result: 'ok' });
    expect(adminAuditRow({ ts: 6, event: 'GALLERY_REVIEW_DECISION', reviewer: 'a@b.c', id: 'g1', note: 'looks fine' }).actor).toBe('a@b.c');
    expect(adminEventLabel('ADMIN_APP_TAKEDOWN')).toBe('App takedown');
  });

  it('the screen never shows an unreadable answer as an empty log, and filters what it loaded', () => {
    expect(readAuditPage({ error: 'nope' })).toBeNull();
    expect(readAuditPage({ rows: [], nextBefore: null, available: false })).toEqual({ rows: [], nextBefore: null, available: false });
    const row = adminAuditRow({ ts: 1, event: 'ADMIN_TOKEN_ADJUST', admin: 'root', userId: 'u9', reason: 'refund for failed build' });
    expect(auditRowMatches(row, 'refund')).toBe(true);
    expect(auditRowMatches(row, 'token adjust')).toBe(true);
    expect(auditRowMatches(row, 'takedown')).toBe(false);
    const panel = read('src/components/admin/AdminAuditLogPanel.tsx');
    expect(panel).toContain('r.ok ? readAuditPage(body) : null');
    expect(panel).toContain('cannot be read here');
  });

  it('the route is admin-only and the two cards sit on the Safety page', () => {
    expect(read('src/server/routes/admin.ts')).toContain("app.get('/api/admin/audit-log', verifyAdminToken,");
    const dash = read('src/components/AdminDashboard.tsx');
    expect(dash).toContain('<AppCheckCard adminToken={adminToken} />');
    expect(dash).toContain('<AdminAuditLogPanel adminToken={adminToken} />');
    expect(dash).not.toContain('arrive in the next update');
  });
});

describe('every authenticated admin action says WHO did it', () => {
  // The login route's events happen BEFORE anyone is authenticated — the actor is whoever typed the
  // password, which is exactly what is not known — so they are the one exemption.
  const PRE_AUTH = new Set(['ADMIN_LOGIN_LOCKED', 'ADMIN_LOGIN_BLOCKED', 'ADMIN_LOGIN_MFA_REQUIRED', 'ADMIN_LOGIN_MFA_FAILED', 'ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGIN_FAILED', 'ADMIN_ACCESS_DENIED']);

  it('an audit line inside a token-guarded admin route carries admin: — the screen otherwise reads "not recorded"', () => {
    const missing: string[] = [];
    for (const f of [...globSync('src/server/routes/*.ts', { cwd: root }), 'server.ts']) {
      if (/\.test\.ts$/.test(f)) continue;
      const s = read(f);
      const re = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const rest = s.slice(re.lastIndex);
        const next = rest.search(/\n  app\.(get|post|put|patch|delete|use)\(/);
        const body = s.slice(m.index, re.lastIndex + (next >= 0 ? next : 4000));
        if (!/\b(verifyAdminToken|requireAdmin|adminOk)\b/.test(body)) continue;
        for (const a of body.matchAll(/audit\('([A-Z0-9_]+)',\s*\{([^}]*)/g)) {
          if (!isAdminAuditEvent(a[1]) || PRE_AUTH.has(a[1])) continue;
          if (!/\badmin:/.test(a[2])) missing.push(`${f} ${m[2]}: ${a[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
