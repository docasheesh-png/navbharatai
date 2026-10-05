// EVERY ADMIN DECISION, IN EVERY ROUTE FILE, LEAVES AN AUDIT LINE (admin panel audit, PR 3, 2026-10-05).
//
// `adminActionsNeedAReason.test.ts` (PR 1) holds that rule for the `/api/admin` routes in admin.ts. The
// admin decisions that matter just as much live elsewhere and are guarded differently — by the store
// admin's Firebase identity (`isStoreAdmin`) rather than the admin panel token: approving an app into the
// community gallery, approving or removing an App Mart APK, listing or removing an App Mart web app,
// removing somebody's comment. Each of those made something public or deleted a person's work, and none
// of them wrote an audit line.
//
// THE CENSUS: across every route file, a mutating route whose body checks an admin identity
// (`verifyAdminToken`, `requireAdmin`, `isStoreAdmin`) must call `audit(` — or be listed below with the
// reason it changes nothing worth recording. A NEW admin route fails here until someone decides.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';

const root = join(__dirname, '..');

/** method + path → why it needs no audit line. Kept in step with adminActionsNeedAReason.test.ts. */
const NO_AUDIT_NEEDED: Record<string, string> = {
  'post /api/admin/insights/query': 'computes an answer from live metrics; changes nothing',
  'post /api/admin/deploy-risk': 'computes a risk score from the request; changes nothing',
  'post /api/admin/incident-analysis': 'computes an analysis from the request; changes nothing',
  'post /api/admin/all-builds/:workspaceId/mark': "a triage label on the admin's own inbox; reversible, no user affected",
  'post /api/admin/build-reports/:id/mark': "a triage label on the admin's own inbox; reversible, no user affected",
  'post /api/admin/apk-reports/:id/mark': "a triage label on the admin's own inbox; reversible, no user affected",
  'post /api/app-mart/social/comments': 'a person posting their own comment; isStoreAdmin only decides how it is displayed',
};

interface Route { file: string; key: string; body: string }

function adminGuardedWrites(): Route[] {
  const files = [...globSync('src/server/routes/*.ts', { cwd: root }), 'server.ts'].filter((f) => !/\.test\.ts$/.test(f));
  const out: Route[] = [];
  for (const file of files) {
    const s = readFileSync(join(root, file), 'utf8');
    const re = /app\.(post|put|patch|delete)\(\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const rest = s.slice(re.lastIndex);
      const next = rest.search(/\n  app\.(get|post|put|patch|delete|use)\(/);
      const body = s.slice(m.index, re.lastIndex + (next >= 0 ? next : 4000));
      if (!/\b(verifyAdminToken|requireAdmin|isStoreAdmin)\b/.test(body)) continue;
      out.push({ file, key: `${m[1]} ${m[2]}`, body });
    }
  }
  return out;
}

describe('every admin-guarded write is audited, whichever file it lives in', () => {
  const routes = adminGuardedWrites();

  it('sees the store-admin decisions, not only /api/admin (the census reads the right files)', () => {
    const keys = routes.map((r) => r.key);
    for (const k of ['post /api/gallery/admin/:id/review', 'post /api/nav-store/admin/review', 'post /api/nav-store/web/admin/review', 'post /api/app-mart/social/comments/:id/remove']) {
      expect(keys).toContain(k);
    }
  });

  it('has no admin decision without an audit line', () => {
    const missing = routes.filter((r) => !r.body.includes('audit(') && !(r.key in NO_AUDIT_NEEDED)).map((r) => `${r.file}: ${r.key}`);
    expect(missing).toEqual([]);
  });

  it('keeps no stale exemption', () => {
    const keys = new Set(routes.map((r) => r.key));
    expect(Object.keys(NO_AUDIT_NEEDED).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('the store decisions record WHO decided, not only what happened', () => {
    for (const k of ['post /api/gallery/admin/:id/review', 'post /api/nav-store/admin/review', 'post /api/nav-store/web/admin/review']) {
      const r = routes.find((x) => x.key === k)!;
      expect(r.body, k).toMatch(/audit\('[A-Z_]+', \{ reviewer: /);
    }
  });
});
