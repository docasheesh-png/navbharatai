import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  appStatusView, canUnpublish, canBan, matchesAppQuery, confirmCopy, type AppRow,
} from '../src/lib/adminAppModeration';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * WHY THIS FILE EXISTS (admin 2026-09-17): *"published app ko, admin jab chahe unpublish ya ban kar
 * sake!"* The server route for a ban had existed since 2026-08-21 with NO caller, so the capability
 * was unreachable. These pin the two things that decide whether the new screen is safe: that the
 * permanent action can never be mistaken for the reversible one, and that both are really wired.
 */
describe('appStatusView — what the admin reads on a row', () => {
  it('a live app says LIVE, and says the link works', () => {
    const v = appStatusView('active');
    expect(v.live).toBe(true);
    expect(v.label).toBe('Live');
  });

  it('a record with NO status counts as live — the store treats it that way', () => {
    // Records written before the status field existed have none. Saying "unknown" would be worse
    // than useless: it IS serving, and this is the screen for deciding whether it should be.
    expect(appStatusView(undefined)).toEqual(appStatusView('active'));
    expect(appStatusView(undefined).live).toBe(true);
  });

  it('OFFLINE and BANNED are never described the same way', () => {
    const off = appStatusView('unpublished');
    const banned = appStatusView('taken_down');
    expect(off.live).toBe(false);
    expect(banned.live).toBe(false);
    expect(off.label).not.toBe(banned.label);
    // The difference that matters to a real person: one can come back, the other cannot.
    expect(off.meaning.toLowerCase()).toContain('again');
    expect(banned.meaning.toLowerCase()).toContain('never');
  });

  it('an unrecognised state is NOT reported as live', () => {
    // A state we do not understand must fail toward "not serving" — claiming an app is live when we
    // cannot tell is the direction that misleads a moderator into inaction.
    const v = appStatusView('something_new_we_added_later');
    expect(v.live).toBe(false);
    expect(v.tone).toBe('unknown');
  });

  it('every status yields real words — a row can never render blank', () => {
    for (const s of ['active', 'held', 'taken_down', 'unpublished', 'plan_paused', '', undefined as never]) {
      const v = appStatusView(s);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe('which actions are offered', () => {
  it('UNPUBLISH is offered only while the app is actually serving', () => {
    expect(canUnpublish('active')).toBe(true);
    expect(canUnpublish(undefined)).toBe(true);
    // Already offline: the button would delete a channel that is gone and re-write a status it
    // already holds — it would "succeed" and change nothing, which teaches that the buttons are fake.
    expect(canUnpublish('unpublished')).toBe(false);
    expect(canUnpublish('taken_down')).toBe(false);
  });

  it('BAN stays available on an OFFLINE app — that is the point, not an oversight', () => {
    // An unpublished app can still be republished by its owner. A ban is exactly what stops that, so
    // hiding it here would leave a moderator who has just parked something unable to make it final.
    expect(canBan('unpublished')).toBe(true);
    expect(canBan('held')).toBe(true);
    expect(canBan('active')).toBe(true);
  });

  it('BAN is not offered twice — an already-banned app has nothing left to take', () => {
    expect(canBan('taken_down')).toBe(false);
  });
});

describe('matchesAppQuery — finding the app a report names', () => {
  const row: AppRow = { workspaceId: 'ws-ABC123', userId: 'uid-999', url: 'https://cool-app.mitrify.in' };

  it('matches the app id, the owner and the link, because a report carries any one of them', () => {
    expect(matchesAppQuery(row, 'abc123')).toBe(true);
    expect(matchesAppQuery(row, 'UID-999')).toBe(true);
    expect(matchesAppQuery(row, 'cool-app')).toBe(true);
  });

  it('an empty query shows the list rather than hiding it', () => {
    expect(matchesAppQuery(row, '')).toBe(true);
    expect(matchesAppQuery(row, '   ')).toBe(true);
  });

  it('does not match something absent, and survives a row with missing fields', () => {
    expect(matchesAppQuery(row, 'zzz')).toBe(false);
    expect(matchesAppQuery({ workspaceId: 'ws-1' }, 'ws-1')).toBe(true);
    expect(matchesAppQuery({ workspaceId: 'ws-1' }, 'uid')).toBe(false);
  });
});

describe('confirmCopy — the last thing read before a permanent act', () => {
  const ban = confirmCopy('ban');
  const un = confirmCopy('unpublish');

  it('the two confirmations share NO wording — not the title, not the body, not the button', () => {
    // The entire protection against a permanent mistake is that a ban reads differently from an
    // unpublish. One sentence with a word swapped is how a moderator confirms without reading.
    expect(ban.title).not.toBe(un.title);
    expect(ban.body).not.toBe(un.body);
    expect(ban.cta).not.toBe(un.cta);
  });

  it('the ban says it cannot be undone, and points at the reversible option instead', () => {
    expect(ban.body.toLowerCase()).toContain('cannot be undone');
    expect(ban.body.toLowerCase()).toContain('never publish again');
    expect(ban.body.toLowerCase()).toContain('unpublish');
  });

  it('the unpublish promises the owner keeps the app — so it is not feared like a ban', () => {
    expect(un.body.toLowerCase()).toContain('owner');
    expect(un.body.toLowerCase()).toContain('again');
    // Deliberately matching the PHRASES, not the word 'never' — "whenever they want" is in this copy
    // and is the opposite of a warning.
    expect(un.body.toLowerCase()).not.toContain('never publish again');
    expect(un.body.toLowerCase()).not.toContain('cannot be undone');
  });
});

describe('the wiring — the capability must actually be reachable', () => {
  const admin = read('src/components/AdminDashboard.tsx');
  const route = read('src/server/routes/admin.ts');

  // Re-anchored 2026-09-18: the LIST moved to admin/BuiltAppsPanel.tsx (every built app, twelve at a
  // time, from `/api/admin/apps`); the two ACTIONS still run from the dashboard's confirmation dialog.
  const panel = read('src/components/admin/BuiltAppsPanel.tsx');

  it('the client calls BOTH server routes — the bug was that nothing called either', () => {
    expect(admin).toContain("action === 'ban' ? 'takedown' : 'unpublish'");
    expect(admin).toContain('/api/admin/deployments/');
    expect(panel).toContain('/api/admin/apps?');
  });

  it('the reversible route exists on the server beside the permanent one', () => {
    expect(route).toContain("'/api/admin/deployments/:workspaceId/unpublish'");
    expect(route).toContain("'/api/admin/deployments/:workspaceId/takedown'");
  });

  it('BOTH routes delete the live channel BEFORE touching the registry', () => {
    // The registry must never say a site is offline while it is still serving. Order is the whole
    // guarantee, so a refactor that reverses it has to fail here.
    for (const marker of ["setStatus(workspaceId, 'taken_down')", "setStatus(workspaceId, 'unpublished')"]) {
      const at = route.indexOf(marker);
      expect(at).toBeGreaterThan(0);
      const before = route.slice(Math.max(0, at - 700), at);
      expect(before).toContain('deleteChannel(workspaceId)');
    }
  });

  it('BOTH routes write the 180-day removal record — a ban is not the only removal', () => {
    // IT Rules 2021 Rule 3(1)(g): the record exists because we removed somebody's live site.
    // Whether they may republish afterwards does not change that fact.
    const unpublishBlock = route.slice(route.indexOf("/unpublish'"), route.indexOf("/unpublish'") + 1600);
    expect(unpublishBlock).toContain('recordTakedown');
    expect(unpublishBlock).toContain("audit('ADMIN_APP_UNPUBLISH'");
  });

  it('a failed removal is reported as failed, never softened into success', () => {
    expect(route).toContain('the live site was NOT confirmed removed');
    expect(admin).toContain('the live site was NOT confirmed removed');
  });

  it('the panel renders the ban in red and asks for a reason before it can run', () => {
    expect(admin).toContain('confirmCopy(moderating.action)');
    expect(admin).toContain("const reasonMissing = isBan && !moderateReason.trim()");
    expect(admin).toContain('disabled={moderateBusy || reasonMissing}');
  });

  it('an unreadable list is NOT shown as an empty one', () => {
    // On a moderation screen, "no built apps" over a failed read is the worst possible lie.
    expect(panel).toContain('Could not read the built-app list.');
    expect(panel).toContain('if (!opts.append) setRows(null);');
  });
});
