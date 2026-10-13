// Go-live PR 10: provisioning state machine.
import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS, applyTransition, canTransition, jobIdFor, newJob, openJob, staleJobs, transitionJob,
  provisionJobsEnabled, type JobState,
} from '../src/server/lib/provisioningJobs';

const input = { uid: 'u1', workspaceId: 'ws_12345678', skuId: 'byo.supabase', providerKey: 'supabase-byo', clientRequestId: 'req_00000001' };
function fakeDb() {
  const docs: Record<string, any> = {};
  return {
    docs,
    doc: (p: string) => p,
    runTransaction: async (fn: any) => fn({
      get: async (r: string) => ({ exists: r in docs, data: () => structuredClone(docs[r]) }),
      set: (r: string, v: any) => { docs[r] = structuredClone(v); },
    }),
  } as any;
}

describe('state machine', () => {
  it('is off by default', () => expect(provisionJobsEnabled({} as any)).toBe(false));
  it('money moves only LINKED → CHARGED', () => {
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      if ((tos as readonly string[]).includes('CHARGED')) expect(from).toBe('LINKED');
    }
  });
  it('terminal states go nowhere', () => {
    expect(TRANSITIONS.RELEASED).toEqual([]);
    expect(TRANSITIONS.DELETED).toEqual([]);
  });
  it('illegal transitions and missing refs are refused', () => {
    const j = newJob(input, 't0');
    expect(applyTransition(j, 'ACTIVE', 't1').ok).toBe(false);
    const linked = { ...j, state: 'LINKED' as JobState };
    expect(applyTransition(linked, 'CHARGED', 't1').ok).toBe(false);
    expect(applyTransition(linked, 'CHARGED', 't1', { chargeRef: 'c1' }).ok).toBe(true);
    expect(canTransition('PROVISIONING', 'READY')).toBe(true);
    expect(applyTransition({ ...j, state: 'PROVISIONING' }, 'READY', 't1').ok).toBe(false);
  });
  it('retries are bounded', () => {
    let j: any = { ...newJob(input, 't0'), state: 'FAILED_RETRYABLE', attempts: 5 };
    expect(applyTransition(j, 'PROVISIONING', 't1').ok).toBe(false);
    j = { ...j, attempts: 1 };
    const r = applyTransition(j, 'PROVISIONING', 't1');
    expect(r.ok && r.job.attempts).toBe(2);
  });
  it('job ids are stable per request', () => {
    expect(jobIdFor('u', 'w', 's', 'r')).toBe(jobIdFor('u', 'w', 's', 'r'));
    expect(jobIdFor('u', 'w', 's', 'r')).not.toBe(jobIdFor('u', 'w', 's', 'r2'));
  });
  it('stale sweep picks stuck non-terminal jobs only', () => {
    const old = { ...newJob(input, '2026-01-01T00:00:00Z'), state: 'PROVISIONING' as JobState };
    const done = { ...old, state: 'RELEASED' as JobState };
    const live = { ...old, state: 'ACTIVE' as JobState };
    expect(staleJobs([old, done, live], Date.parse('2026-01-01T01:00:00Z')).map((j) => j.state)).toEqual(['PROVISIONING']);
  });
});

describe('store', () => {
  it('opening the same request twice returns the same job (no second resource)', async () => {
    const db = fakeDb();
    const a = await openJob(db, input, 't0');
    const b = await openJob(db, input, 't1');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(Object.keys(db.docs)).toHaveLength(1);
  });
  it('a transition checks the FROM state; the loser of a race is told', async () => {
    const db = fakeDb();
    const { job } = await openJob(db, input, 't0');
    expect((await transitionJob(db, job.id, 'REQUESTED', 'QUOTED')).ok).toBe(true);
    const again = await transitionJob(db, job.id, 'REQUESTED', 'QUOTED');
    expect(again.ok).toBe(false);
    expect(db.docs[`provisioning_jobs/${job.id}`].history.map((h: any) => h.to)).toEqual(['REQUESTED', 'QUOTED']);
  });
  it('full happy path', async () => {
    const db = fakeDb();
    const { job } = await openJob(db, input);
    const steps: Array<[JobState, JobState, any]> = [
      ['REQUESTED', 'QUOTED', {}], ['QUOTED', 'PROVISIONING', {}], ['PROVISIONING', 'READY', { resourceRef: 'proj' }],
      ['READY', 'LINKED', {}], ['LINKED', 'CHARGED', { chargeRef: 'c' }], ['CHARGED', 'ACTIVE', {}],
    ];
    for (const [f, t, p] of steps) expect((await transitionJob(db, job.id, f, t, p)).ok, `${f}->${t}`).toBe(true);
  });
});
