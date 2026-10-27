/** Transaction clocks must follow the snapshot actually read, not request arrival order. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { FreeChainStore } from '../src/server/AI/FreeChain/store';
import { civilDayWindow, HOUR_MS, MINUTE_MS, type QuotaReservationInput } from '../src/server/AI/FreeChain/quota';

const START = Date.parse('2026-10-26T14:00:00.000Z');
const input = (overrides: Partial<QuotaReservationInput> = {}): QuotaReservationInput => ({
  provider: 'synthetic', model: 'synthetic', timeZone: 'rolling24h', inputTokens: 12, outputTokens: 10,
  limits: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, ...overrides,
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
class Database {
  docs = new Map<string, any>();
  transactions = 0;
  callbacks = 0;
  writes = 0;
  retryFirst = false;
  firstAttempt = deferred();
  retry = deferred();
  beforeRead?: (transaction: number) => Promise<void>;
  doc(path: string) { return { path }; }
  async runTransaction(run: (tx: any) => Promise<any>) {
    const transaction = ++this.transactions;
    const attempt = async (commit: boolean) => {
      this.callbacks++;
      const writes = new Map<string, unknown>();
      const result = await run({
        get: async (ref: { path: string }) => {
          if (writes.size) throw new Error('Read after write');
          await this.beforeRead?.(transaction);
          return { exists: this.docs.has(ref.path), data: () => structuredClone(this.docs.get(ref.path)) };
        },
        set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)),
      });
      if (commit) for (const [path, value] of writes) { this.docs.set(path, value); this.writes++; }
      return result;
    };
    if (this.retryFirst && transaction === 1) {
      await attempt(false); // The SDK discards an aborted attempt before retrying it.
      this.firstAttempt.resolve(); await this.retry.promise;
    }
    return attempt(true);
  }
  store() { return new FreeChainStore(this as any); }
  quota() { return [...this.docs.values()].find(d => d.kind === 'quota'); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('FreeChain admission and status use trusted post-read transaction time', () => {
  it('admits an older retried request after another valid request commits at a later timestamp', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); db.retryFirst = true;
    const older = db.store().reserveQuota(input()); await db.firstAttempt.promise;
    now.mockReturnValue(START + 50);
    expect((await db.store().reserveQuota(input())).allowed).toBe(true);
    now.mockReturnValue(START + 100); db.retry.resolve();
    expect(await older).toMatchObject({ allowed: true, reason: 'allowed' });
    expect(db.callbacks).toBe(3); expect(db.quota().minutes[0].requests).toBe(2);
    expect(db.quota().updatedAt).toBe(START + 100); expect(db.writes).toBe(2);
  });

  it.each(['reserve', 'snapshot'] as const)('samples after delayed reads without a retry: %s', async operation => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); const reading = deferred(), release = deferred();
    db.beforeRead = async transaction => { if (transaction === 1) { reading.resolve(); await release.promise; } };
    const older = operation === 'reserve' ? db.store().reserveQuota(input()) : db.store().quotaSnapshot(input());
    await reading.promise; now.mockReturnValue(START + 50);
    expect((await db.store().reserveQuota(input())).allowed).toBe(true);
    now.mockReturnValue(START + 100); release.resolve();
    expect(await older).toMatchObject(operation === 'reserve' ? { allowed: true } : { available: true, usage: { rpm: 1 } });
    expect(db.callbacks).toBe(2); expect(db.quota().minutes[0].requests).toBe(operation === 'reserve' ? 2 : 1);
  });

  it('refreshes read-only status on a transaction retry without modifying counters', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); db.retryFirst = true;
    const status = db.store().quotaSnapshot(input()); await db.firstAttempt.promise;
    now.mockReturnValue(START + 50); await db.store().reserveQuota(input());
    now.mockReturnValue(START + 100); db.retry.resolve();
    expect(await status).toMatchObject({ available: true, usage: { rpm: 1 } }); expect(db.writes).toBe(1);
  });

  it.each(['future-time', 'future-bucket', 'negative-counter'] as const)('still refuses genuine malformed state: %s', async corruption => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); await db.store().reserveQuota(input());
    const ledger = db.quota();
    if (corruption === 'future-time') ledger.updatedAt = START + 60_000;
    if (corruption === 'future-bucket') ledger.minutes[0].startAt = START + MINUTE_MS;
    if (corruption === 'negative-counter') ledger.minutes[0].requests = -1;
    const before = JSON.stringify([...db.docs]); now.mockReturnValue(START + 100);
    expect(await db.store().reserveQuota(input())).toMatchObject({ allowed: false, reason: 'store_corrupt' });
    await expect(db.store().quotaSnapshot(input())).rejects.toThrow();
    expect(JSON.stringify([...db.docs])).toBe(before);
  });

  it.each(['reserve', 'snapshot'] as const)('fails closed when the trusted clock moves backwards during %s reads', async operation => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); db.beforeRead = async () => { now.mockReturnValue(START - 1); };
    if (operation === 'reserve') expect(await db.store().reserveQuota(input())).toMatchObject({ allowed: false, reason: 'store_corrupt' });
    else await expect(db.store().quotaSnapshot(input())).rejects.toThrow('clock moved backwards');
    expect(db.writes).toBe(0);
  });

  it('uses the post-read minute for both increment and reset without losing the prior rolling minute', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START - 1);
    const db = new Database(); await db.store().reserveQuota(input());
    db.beforeRead = async () => { now.mockReturnValue(START + 1); };
    const result = await db.store().reserveQuota(input());
    expect(result.allowed).toBe(true);
    expect(db.quota().minutes.map((b: any) => [b.startAt, b.requests])).toEqual([[START - MINUTE_MS, 1], [START, 1]]);
    expect(db.quota().updatedAt).toBe(START + 1);
    expect((await db.store().quotaSnapshot(input())).usage.rpm).toBe(2);
  });

  it('uses the post-read IST civil day consistently when a request crosses midnight', async () => {
    const midnight = Date.parse('2026-10-26T18:30:00.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(midnight - 1);
    const db = new Database(); const q = input({ timeZone: 'Asia/Kolkata' }); await db.store().reserveQuota(q);
    db.beforeRead = async () => { now.mockReturnValue(midnight + 1); };
    const result = await db.store().reserveQuota(q); const window = civilDayWindow(midnight + 1, 'Asia/Kolkata');
    expect(result).toMatchObject({ allowed: true, resetAt: window.resetAt });
    expect(db.quota().days).toEqual([{ ...window, requests: 1, tokens: 22, neurons: 0 }]);
    const status = await db.store().quotaSnapshot(q);
    expect(status.dailyResetAt).toBe(window.resetAt); expect(status.usage).toMatchObject({ rpm: 2, rpd: 1 });
  });

  it('prunes an expired rolling-day bucket using the same post-read time used for the new bucket', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); await db.store().reserveQuota(input());
    now.mockReturnValue(START + 25 * HOUR_MS - 1);
    db.beforeRead = async () => { now.mockReturnValue(START + 25 * HOUR_MS + 1); };
    expect((await db.store().reserveQuota(input())).allowed).toBe(true);
    expect(db.quota().days).toHaveLength(1); expect(db.quota().days[0].requests).toBe(1);
    expect(db.quota().days[0].startAt).toBe(START + 25 * HOUR_MS);
  });

  it('does not double-count an aborted attempt or admit over the quota after a concurrent commit', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(START);
    const db = new Database(); db.retryFirst = true;
    const q = input({ limits: { rpm: 2 }, safetyMargin: 0.9 }); // Exactly one admitted request.
    const older = db.store().reserveQuota(q); await db.firstAttempt.promise;
    now.mockReturnValue(START + 50); expect((await db.store().reserveQuota(q)).allowed).toBe(true);
    now.mockReturnValue(START + 100); db.retry.resolve();
    expect(await older).toMatchObject({ allowed: false, reason: 'rpm' });
    expect(db.quota().minutes[0].requests).toBe(1); expect(db.writes).toBe(1);
  });

  it('preserves the explicit fixed-time fixture seam without consulting or trusting stored future times', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(START + 99_000);
    const db = new Database(); await db.store().reserveQuota(input(), START);
    expect(db.quota().updatedAt).toBe(START);
    db.quota().updatedAt = START + 1;
    expect(await db.store().reserveQuota(input(), START)).toMatchObject({ allowed: false, reason: 'store_corrupt' });
    await expect(db.store().quotaSnapshot(input(), START)).rejects.toThrow('Malformed quota ledger');
  });

  it.each([null, NaN, Infinity, -1])('still rejects an invalid explicit fixture clock: %s', async invalid => {
    const db = new Database();
    expect(await db.store().reserveQuota(input(), invalid as number)).toMatchObject({ allowed: false, reason: 'invalid_quota' });
    await expect(db.store().quotaSnapshot(input(), invalid as number)).rejects.toThrow('Invalid clock');
    expect(db.transactions).toBe(0); expect(db.writes).toBe(0);
  });

  it('keeps every current production quota caller on the live-clock API', () => {
    // Production census: runtime.ts owns both admissions and the shared admin status query.
    const source = ts.createSourceFile('runtime.ts', readFileSync(new URL('../src/server/AI/FreeChain/runtime.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['reserveQuota', 'quotaSnapshot'].includes(node.expression.name.text)) calls.push(node); ts.forEachChild(node, visit); };
    visit(source); expect(calls).toHaveLength(3); expect(calls.map(call => call.arguments.length)).toEqual([1, 1, 1]);
  });
});
