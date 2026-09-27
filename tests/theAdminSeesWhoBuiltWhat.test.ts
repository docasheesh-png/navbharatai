import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAppWorkspaceKey, isWorkspaceId } from '../src/server/lib/workspaceIdentity';
import { greenWorkspaceKey, attemptWorkspaceKey } from '../src/server/AgentV3/GreenGuard';
import { fingerprintWorkspaceKey } from '../src/server/AgentV3/RouteFingerprint';
import {
  snapshotCopyIsDead, channelInventory, forgetChannelInventory, healDeadSnapshotRecords,
  healDeadSnapshotRecordsThrottled, resetHealThrottleForTest, inventorySite, type ChannelInventory,
} from '../src/server/AgentV3/deadSnapshotCopies';
import { annotateBuiltAppRows, liveOrphans, builtAppRow, type BuiltAppRow } from '../src/server/AgentV3/adminBuiltApps';
import { previewPlan, matchesBuiltApp } from '../src/lib/adminAppModeration';

/**
 * ADMIN 2026-09-27, Security → Built apps: "kuch app ke preview chal hi nahi rahe! admin ko dikhna
 * chahiye kon kya bana raha hai!!" Four defects on one screen, each locked here:
 *   1. `…::greenmeta` (and `::attempt`) were listed as apps — the listings excluded `::green` only.
 *   2. A saved copy whose Firebase channel was RECLAIMED kept its URL, so Preview framed "Site Not Found".
 *   3. An orphan that is still LIVE had no files, so Preview was greyed out beside a working public link.
 *   4. The orphan strip said "Still live" on every row, including "Not published" and "Offline" ones.
 * And the row showed only a workspace id — never what the app was or who built it.
 */

const WS = 'agentv3-RyN1xjbfr6gmySF5E28apuC9ZJR2-abc123def';

describe('1 · a derived record is never an app', () => {
  it('every derived key the store holds is refused, by the separator, not by a list of suffixes', () => {
    for (const key of [greenWorkspaceKey(WS), attemptWorkspaceKey(WS), fingerprintWorkspaceKey(WS), `${WS}::anything-new`]) {
      expect(isWorkspaceId(key)).toBe(true); // shaped like a workspace — which is exactly why it leaked
      expect(isAppWorkspaceKey(key)).toBe(false);
    }
    expect(isAppWorkspaceKey(WS)).toBe(true);
    expect(isAppWorkspaceKey('not-a-workspace')).toBe(false);
  });

  it('🔒 both listings ask the class question (reversion guard)', () => {
    const src = readFileSync('src/server/AgentV3/WorkspaceFileStore.ts', 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/isGreenSnapshotKey\(/);
    expect((src.match(/!isAppWorkspaceKey\(d\.id\)/g) || []).length).toBe(2);
  });
});

describe('2 · a saved copy whose channel was reclaimed is not a saved copy', () => {
  const site = 'gen-lang-client-0866594388';
  const alive = `https://${site}--sn-agentv3-ryn1xjbf-aaaaaaaaaaaa-1a2b3c4d.web.app`;
  const dead = `https://${site}--sn-agentv3-zzzzzzzz-bbbbbbbbbbbb-9f8e7d6c.web.app`;
  const inv: ChannelInventory = {
    complete: true,
    channels: [
      { channelId: 'sn-agentv3-ryn1xjbf-aaaaaaaaaaaa', url: alive },
      { channelId: 'v3-live', url: `https://${site}--v3-live-11112222.web.app` },
    ],
  };

  it('the site is read off Firebase\'s own URLs', () => {
    expect(inventorySite(inv)).toBe(site);
    expect(inventorySite({ complete: true, channels: [] })).toBeNull();
  });

  it('a snapshot host the site no longer serves is dead; one it serves is not', () => {
    expect(snapshotCopyIsDead(dead, inv)).toBe(true);
    expect(snapshotCopyIsDead(alive, inv)).toBe(false);
  });

  it('🔒 nothing is judged dead on an inventory that was not read in full', () => {
    expect(snapshotCopyIsDead(dead, { ...inv, complete: false })).toBe(false);
    expect(snapshotCopyIsDead(dead, null)).toBe(false);
  });

  it('🔒 only a Firebase SNAPSHOT channel on THIS site can ever be judged dead', () => {
    expect(snapshotCopyIsDead('https://s-abc123.mitrify.in', inv)).toBe(false); // bucket copy
    expect(snapshotCopyIsDead(`https://${site}--v3-gone-12345678.web.app`, inv)).toBe(false); // a publish
    expect(snapshotCopyIsDead('https://other-site--sn-x-12345678.web.app', inv)).toBe(false); // another site
    expect(snapshotCopyIsDead('not a url', inv)).toBe(false);
  });

  it('the inventory is cached when complete, and a failed read is incomplete and not cached', async () => {
    forgetChannelInventory();
    let calls = 0;
    const failing = await channelInventory(async () => { calls += 1; throw new Error('403'); }, 1_000);
    expect(failing.complete).toBe(false);
    const ok = await channelInventory(async () => { calls += 1; return inv; }, 2_000);
    expect(ok.complete).toBe(true);
    await channelInventory(async () => { calls += 1; return inv; }, 3_000);
    expect(calls).toBe(2);
    forgetChannelInventory();
  });

  it('the heal clears exactly the dead records, and nothing at all on an incomplete inventory', async () => {
    const cleared: string[] = [];
    const deps = {
      inventory: async () => inv,
      listSnapshotRecords: async () => [
        { workspaceId: 'w-dead', snapshotUrl: dead },
        { workspaceId: 'w-alive', snapshotUrl: alive },
        { workspaceId: 'w-bucket', snapshotUrl: 'https://s-1.mitrify.in' },
      ],
      clearSnapshot: async (ws: string) => { cleared.push(ws); return true; },
    };
    expect(await healDeadSnapshotRecords(deps)).toEqual({ checked: 3, cleared: 1, skipped: null });
    expect(cleared).toEqual(['w-dead']);

    cleared.length = 0;
    const r = await healDeadSnapshotRecords({ ...deps, inventory: async () => ({ ...inv, complete: false }) });
    expect(r.skipped).toBe('incomplete-inventory');
    expect(cleared).toEqual([]);
  });

  it('a record a newer build already replaced is not counted as cleared', async () => {
    const r = await healDeadSnapshotRecords({
      inventory: async () => inv,
      listSnapshotRecords: async () => [{ workspaceId: 'w', snapshotUrl: dead }],
      clearSnapshot: async () => false,
    });
    expect(r.cleared).toBe(0);
  });

  it('the list route runs the heal at most once per ten minutes', () => {
    resetHealThrottleForTest();
    const deps = { inventory: async () => inv, listSnapshotRecords: async () => [], clearSnapshot: async () => false };
    expect(healDeadSnapshotRecordsThrottled(deps, 1_000_000)).toBe(true);
    expect(healDeadSnapshotRecordsThrottled(deps, 1_000_000 + 60_000)).toBe(false);
    expect(healDeadSnapshotRecordsThrottled(deps, 1_000_000 + 11 * 60_000)).toBe(true);
    resetHealThrottleForTest();
  });

  it('🔒 the reclaim route clears the records naming the channel it deleted (reversion guard)', () => {
    const src = readFileSync('src/server/routes/admin.ts', 'utf8');
    const at = src.indexOf("app.post('/api/admin/hosting/channels/:channelId/reclaim'");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, at + 5_000);
    const del = body.indexOf('deleteChannelById(channelId)');
    const clear = body.indexOf('sandboxStore.clearSnapshot(');
    expect(del).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(del);
    expect(body).toMatch(/findBySnapshotUrl\(target\.url\)/);
  });
});

describe('3 · every row says WHAT it is and WHO built it', () => {
  const meta = { workspaceId: WS, fileCount: 7, savedAt: 5 };
  const row = builtAppRow(meta, null, null);

  it('the chosen name wins, else the first prompt\'s title; none is "not recorded", never invented', () => {
    const owners = new Map([['RyN1xjbfr6gmySF5E28apuC9ZJR2', { email: 'rahul@example.com', name: 'Rahul', anonymous: false, label: 'Rahul · rahul@example.com' }]]);
    const [named] = annotateBuiltAppRows([row], owners, new Map([[WS, { appName: 'Hotel Booking', title: 'build me a hotel app' }]]));
    expect(named.appName).toBe('Hotel Booking');
    expect(named.owner).toEqual({ name: 'Rahul', email: 'rahul@example.com', label: 'Rahul · rahul@example.com', anonymous: false });
    const [titled] = annotateBuiltAppRows([row], owners, new Map([[WS, { appName: null, title: '  Kirana   store  ' }]]));
    expect(titled.appName).toBe('Kirana store');
    const [bare] = annotateBuiltAppRows([row], new Map(), new Map());
    expect(bare.appName).toBeNull();
    expect(bare.owner).toBeNull();
  });

  it('a row built alone carries empty name/owner — the route is what fills them', () => {
    expect(row.appName).toBeNull();
    expect(row.owner).toBeNull();
  });

  it('🔒 every list mode leaves the route through `finish` (reversion guard)', () => {
    const src = readFileSync('src/server/routes/admin.ts', 'utf8');
    const at = src.indexOf("app.get('/api/admin/apps'");
    const body = src.slice(at, src.indexOf("app.post('/api/admin/apps/:workspaceId/preview'"));
    expect((body.match(/\bfinish\(/g) || []).length).toBeGreaterThanOrEqual(6);
  });

  it('a name or an email fragment finds the row', () => {
    const r = { ...row, appName: 'Hotel Booking', owner: { name: 'Rahul', email: 'rahul@example.com', label: 'x', anonymous: false } };
    expect(matchesBuiltApp(r, 'hotel')).toBe(true);
    expect(matchesBuiltApp(r, 'rahul@')).toBe(true);
    expect(matchesBuiltApp(r, 'nothing-like-it')).toBe(false);
  });
});

describe('4 · orphans and their preview are honest', () => {
  const rec = (over: Record<string, unknown>) => ({ workspaceId: WS, userId: 'u', url: '', fileCount: 0, updatedAt: 1, orphaned: true, ...over }) as never;

  it('the "Live, owner deleted" strip holds only apps that are really live', () => {
    const live = rec({ url: 'https://a-1.mitrify.in', status: 'active' });
    const offline = rec({ url: 'https://a-2.mitrify.in', status: 'unpublished' });
    const ghost = rec({ url: '', status: 'active' });
    const banned = rec({ url: 'https://a-3.mitrify.in', status: 'taken_down' });
    expect(liveOrphans([live, offline, ghost, banned])).toEqual([live]);
  });

  it('a live orphan with no files previews its public link instead of a greyed-out button', () => {
    const orphan = builtAppRow(null, rec({ url: 'https://a-1.mitrify.in', status: 'active' }), undefined, WS);
    expect(orphan.fileCount).toBe(0);
    expect(previewPlan(orphan)).toMatchObject({ source: 'live', url: 'https://a-1.mitrify.in' });
  });

  it('the saved copy still wins; the live site beats the render; nothing live + no files is still "none"', () => {
    const base: BuiltAppRow = builtAppRow({ workspaceId: WS, fileCount: 4, savedAt: 1 }, null, null);
    expect(previewPlan({ ...base, publish: 'live', url: 'https://a.x', snapshotUrl: 'https://s-1.mitrify.in', snapshotAt: 1 }).source).toBe('copy');
    expect(previewPlan({ ...base, publish: 'live', url: 'https://a.x' }).source).toBe('live');
    expect(previewPlan({ ...base, publish: 'offline', url: 'https://a.x' }).source).toBe('render');
    expect(previewPlan({ ...base, fileCount: 0, publish: 'offline', url: 'https://a.x' }).source).toBe('none');
    expect(previewPlan({ ...base, publish: 'live', url: 'javascript:alert(1)' }).source).toBe('render');
  });

  it('🔒 "Still live" is said only of a row whose state IS live (reversion guard)', () => {
    const src = readFileSync('src/components/admin/BuiltAppsPanel.tsx', 'utf8');
    const i = src.indexOf("'Still live, but the owner deleted the workspace");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, i - 120), i)).toMatch(/d\.publish === 'live'\s*\?\s*$/);
    expect((src.match(/Still live, but the owner deleted/g) || []).length).toBe(1);
  });
});

beforeEach(() => { forgetChannelInventory(); });
