// ADMIN PANEL AUDIT, PR 1 (2026-10-04): A HIGH-IMPACT ADMIN ACTION IS CONFIRMED, CARRIES THE ADMIN'S OWN
// REASON, AND LEAVES AN AUDIT LINE — AND THE PANEL'S FAKE CONTROLS ARE GONE.
//
// What the audit found, each now locked here:
//   • Ban sent the hard-coded reason "Admin action"; token adjustment accepted an empty reason and the
//     server wrote "Admin adjustment"; "message all users" was one press with no preview.
//   • Seven privileged routes (release gate, update broadcast, report deletion, …) wrote no audit line.
//   • Maintenance Mode, Feature Flags and Pricing Configuration saved values that nothing enforced.
//   • App.tsx fetched /api/admin/analytics without the admin token and read nothing it got back.
//
// `tsc` sees none of this. The census at the bottom is the CLASS lock: a NEW mutating admin route with
// no audit line fails CI until it gets one, or is listed with the reason it needs none.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  readAdminReason, readTokenDelta, broadcastScopeConfirmed, ALL_USERS_SCOPE,
  banCopy, tokenAdjustCopy, broadcastCopy, ADMIN_REASON_MAX,
} from '../src/lib/adminActionReason';
import { ConfirmActionDialog } from '../src/components/admin/ConfirmActionDialog';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const ADMIN = read('src/server/routes/admin.ts');
const DASH = read('src/components/AdminDashboard.tsx');
const APP = read('src/App.tsx');

/** The handler body of one route, up to the next route registration. */
function routeBody(src: string, signature: string): string {
  const at = src.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  const next = src.slice(at + signature.length).search(/\n  app\.(get|post|put|patch|delete)\(/);
  return src.slice(at, next === -1 ? undefined : at + signature.length + next);
}

describe('the reason rule (one function, read by the screen and the server)', () => {
  it('refuses an empty or blank reason', () => {
    expect(readAdminReason('').ok).toBe(false);
    expect(readAdminReason('   ').ok).toBe(false);
    expect(readAdminReason(undefined).ok).toBe(false);
    expect(readAdminReason(42).ok).toBe(false);
  });

  it('refuses the placeholders old screens sent on the admin\'s behalf', () => {
    expect(readAdminReason('Admin action').ok).toBe(false);
    expect(readAdminReason('  admin ADJUSTMENT ').ok).toBe(false);
  });

  it('refuses a reason too short or too long, and keeps a real one tidied', () => {
    expect(readAdminReason('ok').ok).toBe(false);
    expect(readAdminReason('x'.repeat(ADMIN_REASON_MAX + 1)).ok).toBe(false);
    expect(readAdminReason('  spam   uploads  ')).toEqual({ ok: true, reason: 'spam uploads' });
  });

  it('a token change must be a non-zero whole number', () => {
    expect(readTokenDelta(0).ok).toBe(false);
    expect(readTokenDelta('').ok).toBe(false);
    expect(readTokenDelta('abc').ok).toBe(false);
    expect(readTokenDelta(1.5).ok).toBe(false);
    expect(readTokenDelta('500')).toEqual({ ok: true, delta: 500 });
    expect(readTokenDelta(-200)).toEqual({ ok: true, delta: -200 });
  });

  it('a message to every user needs the explicit scope; a one-user message does not', () => {
    expect(broadcastScopeConfirmed('all', undefined)).toBe(false);
    expect(broadcastScopeConfirmed('all', true)).toBe(false);
    expect(broadcastScopeConfirmed('all', ALL_USERS_SCOPE)).toBe(true);
    expect(broadcastScopeConfirmed('user', undefined)).toBe(true);
  });
});

describe('what each confirmation says', () => {
  it('a ban requires a reason and names the consequence; lifting one does not require it', () => {
    expect(banCopy('a@b.c', true)).toMatchObject({ reasonRequired: true, danger: true, confirmLabel: 'Confirm ban' });
    expect(banCopy('a@b.c', true).consequence).toMatch(/suspended/);
    expect(banCopy('a@b.c', false).reasonRequired).toBe(false);
  });

  it('a token change shows the balance before and after', () => {
    const c = tokenAdjustCopy('a@b.c', 500, 1000);
    expect(c.reasonRequired).toBe(true);
    expect(c.consequence).toContain('1,000 → 1,500');
    expect(tokenAdjustCopy('a@b.c', -200, null).danger).toBe(true);
  });

  it('a message to all users says so in capitals', () => {
    expect(broadcastCopy('all', '').title).toContain('ALL users');
    expect(broadcastCopy('user', 'a@b.c').title).toContain('a@b.c');
  });
});

describe('the dialog', () => {
  it('starts with Confirm disabled when a reason is required', () => {
    const html = renderToStaticMarkup(React.createElement(ConfirmActionDialog, {
      copy: banCopy('a@b.c', true), onCancel: () => {}, onConfirm: () => {},
    }));
    expect(html).toContain('Reason (required)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm ban<\/button>/);
  });

  it('leaves Confirm enabled when the reason is optional', () => {
    const html = renderToStaticMarkup(React.createElement(ConfirmActionDialog, {
      copy: banCopy('a@b.c', false), onCancel: () => {}, onConfirm: () => {},
    }));
    expect(html).toContain('Reason (optional)');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Lift the ban<\/button>/);
  });
});

describe('🔒 the server refuses on its own — the screen is not the boundary', () => {
  it('ban: a ban without a real reason is refused; the reason and admin are audited', () => {
    const b = routeBody(ADMIN, "app.post('/api/admin/users/:userId/ban'");
    expect(b).toContain('readAdminReason(');
    expect(b).toMatch(/if \(banned && !reasonRead\.ok\) return res\.status\(400\)/);
    expect(b).toContain('admin: adminUsername()');
    expect(b).not.toContain("'Admin action'");
  });

  it('tokens: refused without a reason BEFORE the wallet is touched; before/after balances audited', () => {
    const b = routeBody(ADMIN, "app.post('/api/admin/users/:userId/tokens'");
    expect(b.indexOf('readAdminReason(')).toBeGreaterThan(-1);
    expect(b.indexOf('readAdminReason(')).toBeLessThan(b.indexOf('runTransaction('));
    for (const f of ['previousBalance', 'newBalance', 'admin: adminUsername()', "result: 'ok'"]) expect(b).toContain(f);
    expect(b).not.toContain("'Admin adjustment'");
  });

  it('announcement: a message to all users needs the confirmed scope', () => {
    const b = routeBody(ADMIN, "app.post('/api/admin/announcement'");
    expect(b).toContain('broadcastScopeConfirmed(');
    expect(b.indexOf('broadcastScopeConfirmed(')).toBeLessThan(b.indexOf('saveNotification('));
  });
});

describe('the screen asks before it acts', () => {
  it('ban, tokens and messages are sent ONLY from the confirmed action', () => {
    const run = DASH.slice(DASH.indexOf('const runPendingAction = async'));
    const runEnd = run.indexOf('\n  };\n');
    const runBody = run.slice(0, runEnd);
    for (const path of ['/ban`', '/tokens`', "'/api/admin/announcement'"]) {
      expect(runBody, path).toContain(path);
      // nowhere else in the dashboard
      expect(DASH.split(path).length - 1, path).toBe(1);
    }
    expect(DASH).not.toContain("reason: 'Admin action'");
  });

  it('every ban button opens the confirmation, including the account sheet and the complaint', () => {
    expect(DASH).not.toMatch(/void handleBan\(/);
    expect((DASH.match(/handleBan\(/g) ?? []).length).toBeGreaterThanOrEqual(3); // users list, account sheet, complaint
    expect(DASH).toContain('<ConfirmActionDialog');
  });

  it('a complaint is marked "actioned" only after the ban really went through', () => {
    expect(DASH).toContain("() => { void markUserReport(openReport.report.id, 'actioned'); })}");
    expect(DASH).not.toContain("void handleBan(openReport.report.target.ownerUid, true); void markUserReport");
    expect(DASH).toContain('a.after?.()');
  });

  it('the message preview shows the recipients and the exact text', () => {
    expect(DASH).toContain("{pendingAction.target === 'all' ? 'ALL USERS' : pendingAction.email}");
    expect(DASH).toContain('Message, exactly as it will be delivered:');
  });
});

describe('D1 — the fake controls are gone, with their state and handlers', () => {
  it('no Maintenance Mode, Feature Flags or Pricing Configuration on the Settings tab', () => {
    // Read the code without comments: the removal note names the controls on purpose.
    const code = DASH.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const gone of ['Site Maintenance', 'Coins per Rs.1', 'Referral Bonus %', 'Save Pricing', 'Pricing Configuration</', 'Feature Flags</h3>', 'Maintenance ON']) {
      expect(code, gone).not.toContain(gone);
    }
  });

  it('no dead state or handler left behind', () => {
    for (const gone of ['setMaintenanceModeState', 'setFeatureFlagsState', 'setPricingConfigState', 'setProviderEnabledState', 'handleSettingsSave', 'tokenReason']) {
      expect(DASH, gone).not.toContain(gone);
    }
  });

  it('the tokenless /api/admin/analytics call in App.tsx is gone', () => {
    expect(APP).not.toContain('/api/admin/analytics');
    expect(APP).not.toContain('fetchAdminAnalytics');
  });
});

// ── THE CLASS LOCK ───────────────────────────────────────────────────────────────────────────────────
//
// Every route that CHANGES something under /api/admin must write an audit line. The exemptions are the
// routes that change nothing durable — each with its reason, so adding to this list is a decision.
const NO_AUDIT_NEEDED: Record<string, string> = {
  'post /api/admin/insights/query': 'computes an answer from live metrics; changes nothing',
  'post /api/admin/deploy-risk': 'computes a risk score from the request; changes nothing',
  'post /api/admin/incident-analysis': 'computes an analysis from the request; changes nothing',
  'post /api/admin/all-builds/:workspaceId/mark': "a triage label on the admin's own inbox; reversible, no user affected",
  'post /api/admin/build-reports/:id/mark': "a triage label on the admin's own inbox; reversible, no user affected",
  'post /api/admin/apk-reports/:id/mark': "a triage label on the admin's own inbox; reversible, no user affected",
};

function mutatingAdminRoutes(): { key: string; body: string; file: string }[] {
  const dir = join(root, 'src/server/routes');
  const out: { key: string; body: string; file: string }[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const re = /app\.(post|put|patch|delete)\('(\/api\/admin[^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length);
      const next = rest.search(/\n  app\.(get|post|put|patch|delete)\(/);
      out.push({ key: `${m[1]} ${m[2]}`, body: src.slice(m.index, next === -1 ? undefined : m.index + m[0].length + next), file: f });
    }
  }
  return out;
}

describe('🔒 every mutating admin route writes an audit line (census)', () => {
  const routes = mutatingAdminRoutes();

  it('finds the routes (canary — a scanner that finds nothing would pass forever)', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it.each(routes.map((r) => [r.key, r] as const))('%s', (key, r) => {
    if (NO_AUDIT_NEEDED[key]) return;
    expect(r.body, `${key} in ${r.file} writes no audit line`).toContain('audit(');
  });

  it('every exemption still names a real route', () => {
    const keys = new Set(routes.map((r) => r.key));
    for (const k of Object.keys(NO_AUDIT_NEEDED)) expect(keys.has(k), k).toBe(true);
  });

  it('the events the audit asked for by name exist', () => {
    for (const ev of ['ADMIN_UPDATE_BROADCAST', 'ADMIN_BUILD_REPORTS_CLEARED', 'ADMIN_APK_REPORTS_CLEARED', 'ADMIN_RELEASE_GATE_CHANGED']) {
      expect(ADMIN).toContain(`'${ev}'`);
    }
  });
});
