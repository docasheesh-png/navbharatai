import { describe, it, expect, afterEach } from 'vitest';
import { watchedMsFrom, buildOutcomeTrackingEnabled, buildOutcomeStore, bindBuildOutcomeDbForTests, unbindBuildOutcomeDbForTests } from './BuildOutcomeStore';

describe('watchedMsFrom — "never measured" and "measured as zero" are different facts', () => {
  it('is null when the preview was never seen', () => {
    expect(watchedMsFrom(null)).toBeNull();
    expect(watchedMsFrom(undefined)).toBeNull();
    expect(watchedMsFrom({})).toBeNull();
    expect(watchedMsFrom({ previewLastSeenAt: 5 })).toBeNull(); // a last with no first is not a span
  });

  it('is 0 for a single ping — seen, but no span yet', () => {
    // Collapsing this into null is how "never measured" would start reading as "watched briefly", and
    // collapsing null into 0 is how it would start reading as "abandoned instantly". Both are lies the
    // scorer would then act on.
    expect(watchedMsFrom({ previewFirstSeenAt: 1_000 })).toBe(0);
    expect(watchedMsFrom({ previewFirstSeenAt: 1_000, previewLastSeenAt: 1_000 })).toBe(0);
  });

  it('is the real span across pings', () => {
    expect(watchedMsFrom({ previewFirstSeenAt: 1_000, previewLastSeenAt: 181_000 })).toBe(180_000);
  });

  it('never returns a negative span from an out-of-order clock', () => {
    expect(watchedMsFrom({ previewFirstSeenAt: 9_000, previewLastSeenAt: 1_000 })).toBe(0);
  });
});

describe('buildOutcomeTrackingEnabled', () => {
  it('is on by default and off only for the explicit kill switch', () => {
    expect(buildOutcomeTrackingEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(buildOutcomeTrackingEnabled({ AGENTV3_OUTCOME_TRACKING: 'off' } as never)).toBe(false);
    expect(buildOutcomeTrackingEnabled({ AGENTV3_OUTCOME_TRACKING: 'on' } as never)).toBe(true);
  });
});

/**
 * A note that read build A must not write A's fields back after startBuild('B').
 * The old note() did `{ ...snap.data(), ...patch }` outside a transaction.
 */
function memoryOutcomeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const apply = (id: string, data: Record<string, unknown>, merge: boolean) => {
    if (merge && docs.has(id)) docs.set(id, { ...docs.get(id), ...data });
    else docs.set(id, { ...data });
  };
  const doc = (id: string) => ({
    id,
    async get() {
      const data = docs.get(id);
      return { exists: !!data, data: () => (data ? { ...data } : undefined) };
    },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      apply(id, data, opts?.merge === true);
    },
  });
  const db = {
    collection() { return { doc }; },
    async runTransaction(fn: (tx: {
      get: (ref: { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }> }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (ref: { id: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
    }) => Promise<unknown>) {
      return fn({
        async get(ref) { return ref.get(); },
        set(ref, data, opts) { apply(ref.id, data, opts?.merge === true); },
      });
    },
  };
  return { db, docs };
}

describe('note() cannot resurrect an older build', () => {
  afterEach(() => { unbindBuildOutcomeDbForTests(); });

  it('note({ buildId: A, complained: true }) after startBuild(B) leaves B without complained', async () => {
    const { db, docs } = memoryOutcomeDb();
    bindBuildOutcomeDbForTests(db as never);
    await buildOutcomeStore.startBuild('ws', 'B', true);
    const rec = await buildOutcomeStore.note('ws', { buildId: 'A', complained: true });
    expect(rec).toBeNull();
    const stored = docs.get('ws');
    expect(stored?.buildId).toBe('B');
    expect(stored?.buildOk).toBe(true);
    expect(stored?.complained).toBeUndefined();
  });

  it('a note for the build that is stored writes only the patch', async () => {
    const { db, docs } = memoryOutcomeDb();
    bindBuildOutcomeDbForTests(db as never);
    await buildOutcomeStore.startBuild('ws', 'B', true);
    const rec = await buildOutcomeStore.note('ws', { complained: true }, 'B');
    expect(rec?.buildId).toBe('B');
    expect(rec?.complained).toBe(true);
    expect(rec?.buildOk).toBe(true);
    expect(docs.get('ws')?.buildOk).toBe(true);
    expect(docs.get('ws')?.complained).toBe(true);
  });
});

