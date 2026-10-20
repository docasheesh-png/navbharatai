import { describe, it, expect, vi } from 'vitest';
import { platformSupabaseConfig, createPlatformDatabase } from '../src/server/lib/platformDatabase';
import { approvedProjectLimit, platformSupabaseDefault, organizationProjectCount, acquirePlatformAdmission } from '../src/server/lib/platformSupabaseAdmission';
import type { Firestore } from 'firebase-admin/firestore';

// Transactional memory fixture: commits are serialized and can lose their acknowledgement.
function store() {
  let row: Record<string, unknown> | undefined;
  let tail = Promise.resolve();
  let loseAck = false;
  const db = {
    collection: () => ({ doc: () => ({}) }),
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const run = tail.then(async () => {
        let pending = row;
        const out = await fn({
          get: async () => ({ exists: !!row, data: () => row }),
          set: (_: unknown, value: typeof row) => { pending = value; },
          update: (_: unknown, value: typeof row) => { pending = { ...row, ...value }; },
          delete: () => { pending = undefined; },
        });
        row = pending;
        if (loseAck) { loseAck = false; throw Error('ack lost after commit'); }
        return out;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  } as unknown as Firestore;
  return { db, data: () => row, loseNextAck: () => { loseAck = true; } };
}

const approval = { NAVBHARAT_SUPABASE_PRODUCTION_APPROVED: 'on', NAVBHARAT_SUPABASE_MAX_PROJECTS: '2' };
describe('managed default activation', () => {
  it('requires exact activation and a bounded explicit project limit', () => {
    expect(platformSupabaseDefault({ NAVBHARAT_SUPABASE_DEFAULT: 'on' })).toBe(true);
    expect(platformSupabaseDefault({ NAVBHARAT_SUPABASE_DEFAULT: 'true' })).toBe(false);
    for (const raw of ['', '0', '-1', '2.5', '1000', 'Infinity', '02']) {
      expect(approvedProjectLimit({ ...approval, NAVBHARAT_SUPABASE_MAX_PROJECTS: raw })).toBeNull();
    }
    expect(approvedProjectLimit(approval)).toBe(2);
    expect(approvedProjectLimit({ ...approval, NAVBHARAT_SUPABASE_PRODUCTION_APPROVED: 'off' })).toBeNull();
  });
  it('keeps lifecycle credentials available when new paid purchases are disabled', () => {
    expect(platformSupabaseConfig({ ...approval, NAVBHARAT_SUPABASE_DEFAULT: 'on', NAVBHARAT_SUPABASE_PRODUCTION_APPROVED: 'off', NAVBHARAT_SUPABASE_TOKEN: 'fixture', NAVBHARAT_SUPABASE_ORG: 'org' })).toMatchObject({ token: 'fixture', orgId: 'org' });
  });
});

describe('provider capacity', () => {
  it('counts existing and paused projects only in the selected organization', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { id: 'a', organization_id: 'chosen', status: 'ACTIVE_HEALTHY' },
      { id: 'b', organization_id: 'chosen', status: 'INACTIVE' },
      { id: 'c', organization_id: 'other' },
    ])));
    expect(await organizationProjectCount('fixture', 'chosen', fetcher)).toBe(2);
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it.each([{}, [{}], [{ id: 'missing-org' }]])('refuses malformed capacity %j', async (rows) => {
    await expect(organizationProjectCount('fixture', 'chosen', async () => new Response(JSON.stringify(rows)))).rejects.toThrow('incomplete');
  });
  it('refuses a provider outage rather than assuming zero projects', async () => {
    await expect(organizationProjectCount('fixture', 'chosen', async () => new Response('', { status: 503 }))).rejects.toThrow('verified');
  });
});

describe('durable creation admission', () => {
  const input = { orgId: 'chosen', workspaceId: 'agentv3-owner-app' };
  it('admits one of simultaneous workers and records only an opaque app identity', async () => {
    const s = store();
    const holders = await Promise.all(Array.from({ length: 12 }, () => acquirePlatformAdmission(s.db, input)));
    expect(holders.filter(Boolean)).toHaveLength(1);
    expect(JSON.stringify(s.data())).not.toContain(input.workspaceId);
    await holders.find(Boolean)!.noteProject('project-ref');
    expect(s.data()?.projectRef).toBe('project-ref');
    await holders.find(Boolean)!.release();
    expect(await acquirePlatformAdmission(s.db, input)).not.toBeNull();
  });
  it('does not expire an interrupted operation or acquire after a lost commit response', async () => {
    const s = store(); s.loseNextAck();
    expect(await acquirePlatformAdmission(s.db, input)).toBeNull();
    expect(s.data()).toBeDefined();
    expect(await acquirePlatformAdmission(s.db, input)).toBeNull();
  });
  it('fails closed without durable storage', async () => {
    expect(await acquirePlatformAdmission(null, input)).toBeNull();
  });
});

describe('ambiguous project creation', () => {
  it('never declares a possibly created paid project cleaned', async () => {
    const deleteProject = vi.fn();
    const result = await createPlatformDatabase({ token: 'fixture', orgId: 'chosen', region: 'ap-south-1' }, {
      createProject: async () => ({ ok: false, failure: 'api-error', message: 'ack lost' }), deleteProject,
    });
    expect(result).toMatchObject({ ok: false, cleaned: false });
    expect(deleteProject).not.toHaveBeenCalled();
  });
});
