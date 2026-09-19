import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILT_APPS_PAGE_SIZE, BUILT_APPS_MAX_PAGE, clampPageSize, parseAppsQuery, publishStateOf, builtAppRow,
  joinBuiltAppRows, encodeCursor, decodeCursor, sliceOwnerPage,
} from '../src/server/AgentV3/adminBuiltApps';
import { publishStateView, matchesBuiltApp, previewPlan, replaceRow, type BuiltAppRow } from '../src/lib/adminAppModeration';

/**
 * 🧭 EVERY BUILT APP, TWELVE AT A TIME, EACH WITH A PREVIEW (admin 2026-09-18).
 *
 *   1. "sabhi users ki build app dikhni chahiye"           — the list is keyed on the durable FILE store.
 *   2. "ek dam se sara data load na ho, 12-12 ke set me"    — one page per request, an opaque cursor.
 *   3. "sabhi ka preview chalna chahiye, live ya offline"   — a preview source for every row, never a sandbox.
 *
 * Plus the defect the admin's own screenshot showed: rows with a badge and NOTHING after it. Those were
 * status-only registry docs minted by `set(…, { merge: true })` on a workspace whose record did not exist.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const rec = (o: Partial<{ workspaceId: string; userId: string; url: string; status: string; updatedAt: number; orphaned: boolean }>) =>
  ({ workspaceId: 'agentv3-u1-s1', userId: 'u1', url: 'https://a.example', fileCount: 3, updatedAt: 5, ...o }) as any;

describe('the page size is the admin\'s number, and cannot be talked up to "everything"', () => {
  it('twelve by default, and unreadable input means twelve', () => {
    expect(BUILT_APPS_PAGE_SIZE).toBe(12);
    expect(clampPageSize(undefined)).toBe(12);
    expect(clampPageSize('lots')).toBe(12);
    expect(clampPageSize(0)).toBe(12);
    expect(clampPageSize(-4)).toBe(12);
  });
  it('a hand-edited query string is clamped, never honoured to 500', () => {
    expect(clampPageSize('500')).toBe(BUILT_APPS_MAX_PAGE);
    expect(clampPageSize('7.9')).toBe(7);
    expect(BUILT_APPS_MAX_PAGE).toBeLessThan(100);
  });
});

describe('what the admin typed — a report names an app by whichever identifier it had', () => {
  it('nothing → the newest-first list', () => {
    expect(parseAppsQuery('')).toEqual({ mode: 'all' });
    expect(parseAppsQuery('   ')).toEqual({ mode: 'all' });
    expect(parseAppsQuery(undefined)).toEqual({ mode: 'all' });
  });
  it('a workspace id is an EXACT lookup', () => {
    expect(parseAppsQuery(' agentv3-RyN1xjbfr6gmySF5E28apuC9ZJR2-ec7ae4c4 ')).toEqual({ mode: 'exact', workspaceId: 'agentv3-RyN1xjbfr6gmySF5E28apuC9ZJR2-ec7ae4c4' });
  });
  it('a link is a URL lookup, trailing slash dropped', () => {
    expect(parseAppsQuery('https://a-abc.mitrify.in/')).toEqual({ mode: 'url', url: 'https://a-abc.mitrify.in' });
  });
  it('a uid is an OWNER lookup — but a short word never is', () => {
    expect(parseAppsQuery('RyN1xjbfr6gmySF5E28apuC9ZJR2')).toEqual({ mode: 'owner', uid: 'RyN1xjbfr6gmySF5E28apuC9ZJR2' });
    expect(parseAppsQuery('todo')).toEqual({ mode: 'text', text: 'todo' });
    expect(parseAppsQuery('ec7ae4c4-80c4')).toEqual({ mode: 'text', text: 'ec7ae4c4-80c4' });
  });
  it('an email is a fragment, not an owner (the store is keyed by uid)', () => {
    expect(parseAppsQuery('someone@example.com').mode).toBe('text');
  });
});

describe('publishStateOf — the two states the old panel could not name', () => {
  it('live needs a URL, not merely status active (the one definition of live)', () => {
    expect(publishStateOf(rec({}))).toBe('live');
    expect(publishStateOf(rec({ status: 'active' }))).toBe('live');
    expect(publishStateOf(rec({ url: '' }))).toBe('never');
  });
  it('🔴 THE GHOST: a status-only record is NOT a publish — never "Live", never "Offline"', () => {
    // Exactly the rows in the admin's screenshot: a badge and nothing after it.
    expect(publishStateOf({ status: 'active' } as any)).toBe('never');
  });
  it('no record at all means never published', () => {
    expect(publishStateOf(null)).toBe('never');
    expect(publishStateOf(undefined)).toBe('never');
  });
  it('the registry states keep their names', () => {
    expect(publishStateOf(rec({ status: 'unpublished' }))).toBe('offline');
    expect(publishStateOf(rec({ status: 'taken_down' }))).toBe('banned');
    expect(publishStateOf(rec({ status: 'held' }))).toBe('held');
    expect(publishStateOf(rec({ status: 'plan_paused' }))).toBe('paused');
    expect(publishStateOf(rec({ status: 'something-new' }))).toBe('unknown');
  });
});

describe('the row — three sources joined, any of which may be missing', () => {
  const meta = { workspaceId: 'agentv3-u1-s1', fileCount: 9, savedAt: 100 };
  it('a built, never-published app: files and owner from the id, no link, no registry status', () => {
    const row = builtAppRow(meta, null, null);
    expect(row).toMatchObject({ workspaceId: 'agentv3-u1-s1', ownerUid: 'u1', userId: 'u1', fileCount: 9, savedAt: 100, publish: 'never', status: null, url: null, snapshotUrl: null, orphaned: false });
  });
  it('a live app with a saved copy carries both the link and the copy', () => {
    const row = builtAppRow(meta, rec({ updatedAt: 7 }), { snapshotUrl: 'https://s-x.mitrify.in', snapshotAt: 50 });
    expect(row.publish).toBe('live');
    expect(row.url).toBe('https://a.example');
    expect(row.publishedAt).toBe(7);
    expect(row.snapshotUrl).toBe('https://s-x.mitrify.in');
    expect(row.snapshotAt).toBe(50);
  });
  it('an orphaned publish (files purged) is still a row, named by its registry id', () => {
    const row = builtAppRow(null, rec({ orphaned: true }), undefined, 'agentv3-u1-s1');
    expect(row.workspaceId).toBe('agentv3-u1-s1');
    expect(row.fileCount).toBe(0);
    expect(row.orphaned).toBe(true);
    expect(row.publish).toBe('live');
  });
  it('a copy is only a copy with a real URL, and its date is dropped with it', () => {
    const row = builtAppRow(meta, null, { snapshotUrl: 'not-a-url', snapshotAt: 50 });
    expect(row.snapshotUrl).toBeNull();
    expect(row.snapshotAt).toBe(0);
  });
  it('an anon workspace has no owner and a registry userId of "anon" is not one either', () => {
    const row = builtAppRow({ workspaceId: 'agentv3-anon-s9', fileCount: 1, savedAt: 1 }, rec({ workspaceId: 'agentv3-anon-s9', userId: 'anon' }), null);
    expect(row.ownerUid).toBeNull();
    expect(row.userId).toBeNull();
  });
  it('joinBuiltAppRows keeps the store\'s order — the join never re-sorts', () => {
    const metas = [{ workspaceId: 'agentv3-u1-b', fileCount: 1, savedAt: 1 }, { workspaceId: 'agentv3-u1-a', fileCount: 1, savedAt: 2 }];
    const rows = joinBuiltAppRows(metas, new Map([['agentv3-u1-a', rec({ workspaceId: 'agentv3-u1-a' })]]), new Map());
    expect(rows.map((r) => r.workspaceId)).toEqual(['agentv3-u1-b', 'agentv3-u1-a']);
    expect(rows[0].publish).toBe('never');
    expect(rows[1].publish).toBe('live');
  });
});

describe('the cursor is opaque, and only ever a workspace id', () => {
  it('round-trips', () => {
    const c = encodeCursor('agentv3-u1-s1');
    expect(c).not.toContain('agentv3'); // opaque to the client
    expect(decodeCursor(c)).toBe('agentv3-u1-s1');
  });
  it('nothing → nothing; garbage → nothing; a non-workspace id → nothing', () => {
    expect(encodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('!!!')).toBeNull();
    expect(decodeCursor(Buffer.from('users/admin', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('agentv3-u1/x', 'utf8').toString('base64url'))).toBeNull();
  });
  it('an owner\'s apps page by offset, and the last page says so', () => {
    const all = [1, 2, 3, 4, 5];
    expect(sliceOwnerPage(all, undefined, 2)).toEqual({ page: [1, 2], nextOffset: '2' });
    expect(sliceOwnerPage(all, '2', 2)).toEqual({ page: [3, 4], nextOffset: '4' });
    expect(sliceOwnerPage(all, '4', 2)).toEqual({ page: [5], nextOffset: null });
    expect(sliceOwnerPage(all, 'x', 2).page).toEqual([1, 2]);
  });
});

describe('what the screen shows (src/lib/adminAppModeration.ts)', () => {
  const base: BuiltAppRow = {
    workspaceId: 'agentv3-u1-s1', ownerUid: 'u1', userId: 'u1', fileCount: 4, savedAt: 10, publish: 'never',
    status: null, url: null, publishedAt: 0, snapshotUrl: null, snapshotAt: 0, orphaned: false,
  };
  it('every publish state yields real words — a row can never render blank', () => {
    for (const s of ['live', 'offline', 'banned', 'held', 'paused', 'never', 'unknown', 'made-up'] as const) {
      const v = publishStateView(s);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.meaning.length).toBeGreaterThan(0);
    }
    expect(publishStateView('never').label).toBe('Not published');
    expect(publishStateView('never').live).toBe(false);
    expect(publishStateView('live').live).toBe(true);
  });
  it('🔒 a preview source exists for a LIVE app and an OFFLINE app alike, and needs no machine', () => {
    const live = previewPlan({ ...base, publish: 'live', snapshotUrl: 'https://s-1.mitrify.in', snapshotAt: 1 });
    const offline = previewPlan({ ...base, publish: 'offline' });
    expect(live.source).toBe('copy');
    expect(offline.source).toBe('render');
    for (const p of [live, offline]) expect(p.label).not.toMatch(/sandbox|e2b|machine wakes/i);
  });
  it('the saved copy wins when there is one; the render is the fallback; no files is said plainly', () => {
    expect(previewPlan({ ...base, snapshotUrl: 'https://s-1.mitrify.in', snapshotAt: 0 })).toMatchObject({ source: 'copy', url: 'https://s-1.mitrify.in' });
    expect(previewPlan(base).source).toBe('render');
    expect(previewPlan({ ...base, fileCount: 0 })).toMatchObject({ source: 'none' });
    expect(previewPlan(base).label).toMatch(/frontend only/);
  });
  it('a fragment filters the loaded rows by id, owner and link', () => {
    const row = { ...base, url: 'https://a-e363.mitrify.in' };
    expect(matchesBuiltApp(row, 'E363')).toBe(true);
    expect(matchesBuiltApp(row, 'u1')).toBe(true);
    expect(matchesBuiltApp(row, 'agentv3-u1')).toBe(true);
    expect(matchesBuiltApp(row, 'zzz')).toBe(false);
    expect(matchesBuiltApp(row, '')).toBe(true);
  });
  it('replaceRow swaps one row in place and leaves the page alone', () => {
    const rows = [base, { ...base, workspaceId: 'agentv3-u1-s2' }];
    const fresh = { ...base, publish: 'offline' as const };
    expect(replaceRow(rows, fresh, 'agentv3-u1-s1').map((r) => r.publish)).toEqual(['offline', 'never']);
    expect(replaceRow(rows, null, 'agentv3-u1-s1')).toBe(rows);
  });
});

/**
 * 🔴 THE GHOST-WRITER GUARD (reversion-proven). `set(…, { merge: true })` on a missing doc CREATES it,
 * which is how status-only registry rows came to exist. The three methods that write a status, a flag
 * or a verdict onto an EXISTING record must use `update`, which refuses a missing doc. Read from the
 * source with comments stripped, so a comment cannot satisfy it.
 */
describe('DeploymentStore never mints a record from a status', () => {
  const src = stripComments(read('src/server/AgentV3/DeploymentStore.ts'));
  const method = (name: string) => {
    const at = src.indexOf(`async ${name}(`);
    expect(at, name).toBeGreaterThan(0);
    return src.slice(at, src.indexOf('\n  }\n', at));
  };
  for (const name of ['setStatus', 'markOrphaned', 'setOutboundVerdict']) {
    it(`${name} updates and never merge-sets`, () => {
      const body = method(name);
      expect(body).toContain('.update(');
      expect(body).not.toContain('merge: true');
    });
  }
  it('the CREATING write (record) still merges — a new publish must be able to write its first doc', () => {
    expect(method('record')).toContain('merge: true');
  });
  it('a record read back names itself by DOCUMENT id, so an old ghost still has an id on screen', () => {
    expect(src).toContain('workspaceId: typeof data.workspaceId === \'string\' && data.workspaceId ? data.workspaceId : d.id');
    expect(method('listWithCompleteness')).toContain('recordFromDoc(d)');
    expect(method('listByUser')).toContain('recordFromDoc(d)');
  });
});

describe('the wiring — the server pages, the preview never touches a sandbox, the dashboard renders the panel', () => {
  const route = stripComments(read('src/server/routes/admin.ts'));
  const panel = read('src/components/admin/BuiltAppsPanel.tsx');
  const dashboard = read('src/components/AdminDashboard.tsx');
  const fileStore = stripComments(read('src/server/AgentV3/WorkspaceFileStore.ts'));

  it('the list route exists and pages the FILE store by default, joined in batched reads', () => {
    expect(route).toContain("app.get('/api/admin/apps', verifyAdminToken");
    const block = route.slice(route.indexOf("app.get('/api/admin/apps'"), route.indexOf("app.post('/api/admin/apps/:workspaceId/preview'"));
    expect(block).toContain('listWorkspaceAppsPage({ limit, afterDocId: after })');
    expect(block).toContain('deploymentStore.getMany(ids)');
    expect(block).toContain('sandboxStore.getMany(ids)');
    expect(block).toContain('clampPageSize(req.query.limit ?? BUILT_APPS_PAGE_SIZE)');
    // A failed read is a 502, never an empty page.
    expect(block).toContain("res.status(502).json({ ok: false, error: 'Could not read the built-app list.' })");
    // Orphaned live publishes ride the first page so a live site is never unmoderatable.
    expect(block).toContain('deploymentStore.listOrphaned(50)');
  });

  it('🔒 the preview route reads the DURABLE files only — never an actuator, never a sandbox', () => {
    const block = route.slice(route.indexOf("app.post('/api/admin/apps/:workspaceId/preview'"), route.indexOf("app.post('/api/admin/deployments/:workspaceId/takedown'"));
    expect(block).toContain('await loadWorkspaceFiles(workspaceId)');
    expect(block).toContain('renderPreview(vfs');
    expect(block).not.toMatch(/buildActuator|getSandbox|collectFilesWithSavedFallback|previewDoor|resume/);
  });

  it('the file store pages by a document-snapshot cursor over savedAt, skipping snapshot keys and empty indexes', () => {
    const at = fileStore.indexOf('export async function listWorkspaceAppsPage');
    expect(at).toBeGreaterThan(0);
    const body = fileStore.slice(at, fileStore.indexOf('\nexport async function getWorkspaceAppsMany'));
    expect(body).toContain("orderBy('savedAt', 'desc')");
    expect(body).toContain('startAfter(after)');
    expect(body).toContain('isGreenSnapshotKey(d.id)');
    expect(body).toContain('if (fileCount <= 0) continue;');
    expect(body).toContain('return { ok: false, apps: [], nextAfterDocId: null };');
  });

  it('the panel asks for twelve, appends the next twelve, and offers a preview on every row', () => {
    expect(panel).toContain('const PAGE_SIZE = 12;');
    expect(panel).toContain("params.set('limit', String(PAGE_SIZE));");
    expect(panel).toContain('Load ${PAGE_SIZE} more');
    expect(panel).toContain('<Eye size={11} /> Preview');
    expect(panel).toContain("fetch(`/api/admin/apps/${encodeURIComponent(row.workspaceId)}/preview`");
    // The saved copy is framed by URL; the render by srcDoc — both in a sandboxed frame.
    expect(panel).toContain('src={plan.url}');
    expect(panel).toContain('srcDoc={preview.html}');
    expect(panel).toContain("const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';");
  });

  it('the dashboard renders the panel on the Security tab and refreshes ONE row after a moderation', () => {
    expect(dashboard).toContain('<BuiltAppsPanel');
    expect(dashboard).toContain("from './admin/BuiltAppsPanel'");
    expect(dashboard).toContain('setModerated({ workspaceId, tick: Date.now() })');
    expect(dashboard).not.toContain('/api/admin/deployments${q}');
  });
});
