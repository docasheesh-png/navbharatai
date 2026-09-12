import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildTakedownRecord, hashContent, TAKEDOWN_RETENTION_DAYS, TAKEDOWN_COLLECTION,
} from './takedownLedger';
import { RETENTION_POLICIES, USER_SCOPED_COLLECTIONS } from './DataRetentionManager';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('the record', () => {
  it('carries what an investigator actually asks for', () => {
    const r = buildTakedownRecord({
      surface: 'app_mart_web', contentId: 'app1', name: 'Scam Wallet', ownerUid: 'u1',
      ownerEmail: 'a@b.com', reason: 'wallet drainer', actor: 'admin', removedBy: 'admin@x',
      removedAt: 1000, contentHash: 'abc', findings: ['high:SEED_PHRASE_HARVEST'],
    });
    expect(r).toMatchObject({
      surface: 'app_mart_web', contentId: 'app1', name: 'Scam Wallet', ownerUid: 'u1',
      ownerEmail: 'a@b.com', reason: 'wallet drainer', actor: 'admin', removedAt: 1000,
    });
    expect(r.id).toBe('app_mart_web_app1_1000');
  });

  it('a re-removal is its own row — the id carries the moment', () => {
    const a = buildTakedownRecord({ surface: 'app_mart_web', contentId: 'x', actor: 'admin', removedAt: 1 });
    const b = buildTakedownRecord({ surface: 'app_mart_web', contentId: 'x', actor: 'admin', removedAt: 2 });
    expect(a.id).not.toBe(b.id);
  });

  it('a removal with no stated reason SAYS so — an empty string reads like data we lost', () => {
    expect(buildTakedownRecord({ surface: 'app_mart_apk', contentId: 'x', actor: 'admin', removedAt: 1 }).reason)
      .toBe('No reason recorded');
  });

  it('an owner unpublishing is recorded as `owner`, not as a takedown', () => {
    // An investigator must be able to tell the two apart at a glance rather than infer it.
    expect(buildTakedownRecord({ surface: 'app_mart_web', contentId: 'x', actor: 'owner', removedAt: 1 }).actor)
      .toBe('owner');
  });

  it('every field is bounded, so one bad input cannot poison a row', () => {
    const r = buildTakedownRecord({
      surface: 'app_mart_web', contentId: 'x', actor: 'admin', removedAt: 1,
      name: 'n'.repeat(500), reason: 'r'.repeat(5000),
      findings: Array.from({ length: 50 }, () => 'f'.repeat(500)),
    });
    expect(r.name.length).toBeLessThanOrEqual(120);
    expect(r.reason.length).toBeLessThanOrEqual(500);
    expect(r.findings.length).toBeLessThanOrEqual(10);
  });

  it('a nonsense timestamp becomes now, never 0 or NaN', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(buildTakedownRecord({ surface: 'app_mart_web', contentId: 'x', actor: 'admin', removedAt: bad }).removedAt)
        .toBeGreaterThan(0);
    }
  });
});

describe('🔒 a record of removal, NOT a copy of the content', () => {
  it('the hash identifies the content without keeping it', () => {
    const files = { 'index.html': '<h1>hi</h1>', 'app.js': 'x=1' };
    const h = hashContent(files);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('hi');
  });

  it('the same app always hashes the same, whatever order the files arrive in', () => {
    expect(hashContent({ a: '1', b: '2' })).toBe(hashContent({ b: '2', a: '1' }));
  });

  it('different content hashes differently — including a move between files', () => {
    expect(hashContent({ a: '1', b: '2' })).not.toBe(hashContent({ a: '12', b: '' }));
    expect(hashContent({ a: '1' })).not.toBe(hashContent({ b: '1' }));
  });

  it('nothing to hash is an honest empty string, never a hash of nothing', () => {
    expect(hashContent(null)).toBe('');
    expect(hashContent({})).toBe('');
    expect(hashContent({ a: 42 as unknown as string })).toBe('');
  });

  it('the RECORD SHAPE has no field that could hold content', () => {
    /**
     * Asserted against the interface, not the whole file. The first draft grepped the file for
     * `files:` and fired on `hashContent(files: Record<…>)` — a PARAMETER, which is exactly how the
     * content gets hashed without being kept. An assertion that catches the right word in the wrong
     * place gets loosened until it catches nothing; this one names the actual claim.
     */
    const src = read('server/lib/takedownLedger.ts');
    const shape = src.slice(src.indexOf('export interface TakedownRecord'), src.indexOf('/** Hash a file map'));
    for (const forbidden of ['files', 'content:', 'html', 'body', 'snippet', 'source']) {
      expect(shape, forbidden).not.toContain(forbidden);
    }
    // And the one content-derived field it DOES have is a hash.
    expect(shape).toContain('contentHash: string');
  });
});

describe('🔒 180 days — both halves of the duty', () => {
  it('it SURVIVES an account deletion, which is the whole point', () => {
    // Adding it to USER_SCOPED_COLLECTIONS would feel like completing the list and would destroy
    // the one record the retention duty exists for.
    expect(USER_SCOPED_COLLECTIONS.map((c) => c.collection)).not.toContain(TAKEDOWN_COLLECTION);
  });

  it('and it is NOT kept for ever — the half that gets forgotten', () => {
    const policy = RETENTION_POLICIES.find((p) => p.collection === TAKEDOWN_COLLECTION);
    expect(policy).toBeTruthy();
    expect(policy!.ttlDays).toBe(TAKEDOWN_RETENTION_DAYS);
    expect(TAKEDOWN_RETENTION_DAYS).toBe(180);
  });

  it('the timestamp KIND matches how the field is really written', () => {
    // A wrong kind here deletes nothing, for ever, while reporting itself configured — the exact
    // defect that made this field required in the first place.
    const policy = RETENTION_POLICIES.find((p) => p.collection === TAKEDOWN_COLLECTION)!;
    expect(policy.timestampField).toBe('removedAt');
    expect(policy.timestampKind).toBe('epochMs');
    expect(typeof buildTakedownRecord({ surface: 'app_mart_web', contentId: 'x', actor: 'admin', removedAt: 5 }).removedAt).toBe('number');
  });

  it('the exception is DISCLOSED — an exception nobody is told about is a surprise', () => {
    const policy = read('content/legal/privacyPolicy.ts');
    expect(policy).toContain('180 days');
    expect(policy).toContain('Removal records');
    expect(policy).toContain('never a copy of the content itself');
    // And the after-deletion clause must name it, or §6 contradicts what actually happens.
    const afterDeletion = policy.slice(policy.indexOf('**After deletion.**'), policy.indexOf('**After deletion.**') + 400);
    expect(afterDeletion).toContain('removal records');
  });
});

describe('wiring — every removal path writes one', () => {
  const store = () => read('server/routes/navStore.ts');
  const adminSrc = () => read('server/routes/admin.ts');

  it('App Mart APK: recorded BEFORE the bytes are deleted', () => {
    const s = store();
    const rec = s.indexOf("surface: 'app_mart_apk'");
    const del = s.indexOf('await deleteApk(found.storagePath)', rec);
    expect(rec).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(rec);
  });

  it('App Mart web: both the admin removal and the owner unpublish', () => {
    expect(store().match(/surface: 'app_mart_web'/g)?.length).toBe(2);
    expect(store()).toContain("actor: 'owner'");
    expect(store()).toContain("actor: 'admin'");
  });

  it('App Mart web: hashed BEFORE the snapshot is deleted, while the files still exist', () => {
    const s = store();
    const hash = s.lastIndexOf('hashContent(await getWebAppFiles');
    const remove = s.indexOf('await removeWebApp(id,', hash);
    expect(hash).toBeGreaterThan(0);
    expect(remove).toBeGreaterThan(hash);
  });

  it('NavBharatAI hosting: recorded only AFTER the channel is really gone', () => {
    // This route never claims a takedown it did not perform; a row for a failed removal is that claim.
    const s = adminSrc();
    const del = s.indexOf('deleteChannel(workspaceId)');
    const rec = s.indexOf("surface: 'navbharat_hosting'", del);
    expect(del).toBeGreaterThan(0);
    expect(rec).toBeGreaterThan(del);
  });

  it('🔒 a failed ledger write never blocks a removal', () => {
    // Leaving unlawful content up because we could not file the paperwork is the worst trade here.
    const src = read('server/lib/takedownLedger.ts');
    expect(src).toContain('[TAKEDOWN_LEDGER] could not record a removal');
    expect(src).toContain('return false');
  });

  it('the admin can read it, admin-gated, and a failed read is an error not an empty list', () => {
    const s = adminSrc();
    const route = s.slice(s.indexOf("app.get('/api/admin/takedowns'"), s.indexOf("app.post('/api/admin/users/:userId/tokens'"));
    expect(route).toContain('verifyAdminToken');
    expect(route).toContain('res.status(500)');
    expect(route).toContain('retentionDays');
  });
});
