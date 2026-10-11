// ONE PERSON'S APPS, ONE ACTION (admin 2026-10-11, Q-796: "a per-owner view in the admin's app moderation: every
// app of that person, their states, and one action across them").
//
// A ban was per app: a person with nine live apps took nine bans, and nothing re-checked a banned person's OTHER
// live apps. Now an owner's search carries one bar with Unpublish all / Ban all, the server acts app by app through
// the same function the single buttons use, and a single ban says how many other live apps the person still has.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ownerModerationTargets, ownerConfirmCopy, MAX_OWNER_MODERATION, canUnpublish, canBan } from '../src/lib/adminAppModeration';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const apps = [
  { workspaceId: 'a', status: 'active' },
  { workspaceId: 'b', status: 'unpublished' },
  { workspaceId: 'c', status: 'taken_down' },
  { workspaceId: 'd', status: 'held', heldFrom: 'active' },
  { workspaceId: 'e', status: 'held', heldFrom: 'unpublished' },
];

describe('🔒 the owner-wide action reaches exactly what the row buttons would', () => {
  it('Unpublish all takes the live ones — the same rule as each row', () => {
    const t = ownerModerationTargets(apps, 'unpublish');
    expect(t).toEqual(apps.filter((a) => canUnpublish(a.status as any, (a as any).heldFrom)).map((a) => a.workspaceId));
    expect(t).toContain('a');
    expect(t).not.toContain('b');
  });

  it('Ban all takes everything not already banned', () => {
    const t = ownerModerationTargets(apps, 'ban');
    expect(t).toEqual(apps.filter((a) => canBan(a.status as any)).map((a) => a.workspaceId));
    expect(t).not.toContain('c');
  });

  it('is bounded, and the bound is said', () => {
    const many = Array.from({ length: MAX_OWNER_MODERATION + 20 }, (_, i) => ({ workspaceId: `w${i}`, status: 'active' }));
    expect(ownerModerationTargets(many, 'ban')).toHaveLength(MAX_OWNER_MODERATION);
    expect(code('src/server/routes/admin.ts')).toContain('truncated: all.length > MAX_OWNER_MODERATION');
  });

  it('its confirmation has its own sentences, and says "at least" when more apps are not loaded', () => {
    expect(ownerConfirmCopy('ban', 3).title).toBe('Ban all 3 apps of this person?');
    expect(ownerConfirmCopy('ban', 3).body).toMatch(/can never be published again/);
    expect(ownerConfirmCopy('unpublish', 1).title).toBe('Unpublish all 1 app of this person?');
    expect(ownerConfirmCopy('unpublish', 12, true).title).toBe('Unpublish all at least 12 apps of this person?');
  });
});

describe('🔒 the owner route does, per app, exactly what a single Ban or Unpublish does', () => {
  const admin = code('src/server/routes/admin.ts');
  const at = admin.indexOf("app.post('/api/admin/owners/:uid/moderate'");
  const body = admin.slice(at, admin.indexOf('app.', at + 20));

  it('the same three steps, in the same order: offline (throws unless confirmed), audit line, 180-day record', () => {
    const off = body.indexOf('await takeAppOffline(workspaceId, kind, offlineDeps);');
    const aud = body.indexOf("audit(kind === 'taken_down' ? 'ADMIN_APP_TAKEDOWN' : 'ADMIN_APP_UNPUBLISH', { admin: adminUsername()");
    const rec = body.indexOf('await recordTakedown({');
    expect(off).toBeGreaterThan(-1);
    expect(aud).toBeGreaterThan(off);
    expect(rec).toBeGreaterThan(aud);
    // the unpublish stamp is the single route's own, so the two actions read the same in the record
    expect(body).toContain("`[unpublished — owner may republish] ${reason}`");
    expect(admin).toContain("reason: `[unpublished — owner may republish] ${reason}`,");
  });

  it('needs a valid owner, an action and the admin\'s reason, and reports per app', () => {
    expect(body).toContain('verifyAdminToken');
    expect(body).toContain('WORKSPACE_UID_RE.test(uid)');
    expect(body).toContain('readAdminReason(');
    expect(body).toContain("results.push({ workspaceId, ok: false, error: 'not confirmed offline — nothing was recorded for it' });");
    expect(body).toContain("audit('ADMIN_OWNER_MODERATE'");
  });

  it('the single routes are untouched', () => {
    expect(admin).toContain("takeAppOffline(workspaceId, 'taken_down', offlineDeps)");
    expect(admin).toContain("takeAppOffline(workspaceId, 'unpublished', offlineDeps)");
  });

  it('a single ban names the person\'s other live apps', () => {
    expect(admin).toContain('otherLiveApps: others.count, ownerUid: others.ownerUid');
  });
});

describe('🔒 the screens', () => {
  it('an owner search shows the bar, and the dashboard confirms through its one dialog', () => {
    const panel = code('src/components/admin/BuiltAppsPanel.tsx');
    expect(panel).toContain("mode === 'owner' && rows !== null && rows.length > 0 && !error && onModerateOwner");
    expect(panel).toContain("onModerateOwner(owner, 'ban', bannable, more)");
    const dash = code('src/components/AdminDashboard.tsx');
    expect(dash).toContain('`/api/admin/owners/${encodeURIComponent(ownerUid)}/moderate`');
    expect(dash).toContain('ownerConfirmCopy(moderating.action, moderating.count ?? 0, moderating.more === true)');
    expect(dash).toContain('setFocusOwner({ uid: d.ownerUid, tick: Date.now() })');
  });
});
