import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debitWalletForBuild, MAX_WALLET_LEDGER_ENTRIES, TOKEN_CARRY_FIELD, type WalletDebitTx } from '../src/server/lib/walletDebit';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import { WALLET_OPS, walletOpId } from '../src/server/lib/walletOps';
import { checkLedgerV2Chain, WALLET_LEDGER_V2, type LedgerV2Row } from '../src/server/lib/ledgerV2';

type Data = Record<string, any>;
interface Ref { path: string; id: string; get(): Promise<ReturnType<AtomicWalletStore['snapshot']>> }
interface Attempt { client: string; number: number; paths: string[]; committed: boolean; conflicted: boolean }

/**
 * Admin-shaped optimistic transaction model, used through the REAL serverDb adapter and wallet method.
 * Reads remember committed revisions; writes remain invisible until an atomic commit. A conflict reruns
 * the whole callback against fresh snapshots. Commit faults never publish a prefix of the write set.
 * This models the guarantees the money code depends on; a separate emulator drill covers Firestore.
 */
class AtomicWalletStore {
  private docs = new Map<string, Data>();
  private versions = new Map<string, number>();
  readonly attempts: Attempt[] = [];
  beforeCommit?: (attempt: Attempt) => Promise<void>;
  failCommitWrite: number | null = null;
  loseNextCommitAcknowledgement = false;

  put(path: string, value: Data) {
    this.docs.set(path, structuredClone(value));
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
  }

  read(path: string): Data | undefined {
    const value = this.docs.get(path);
    return value === undefined ? undefined : structuredClone(value);
  }

  rows(collection: string): Data[] {
    return [...this.docs].filter(([path]) => path.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row));
  }

  snapshot(path: string) {
    const value = this.read(path);
    return { exists: value !== undefined, data: () => structuredClone(value), id: path.split('/').at(-1),
      ref: { path }, get: (field: string) => value?.[field] };
  }

  client(name: string) {
    return {
      doc: (path: string): Ref => ({ path, id: path.split('/').at(-1)!, get: async () => this.snapshot(path) }),
      runTransaction: async <T>(body: (transaction: any) => Promise<T>): Promise<T> => {
        for (let number = 1; number <= 8; number++) {
          const reads = new Map<string, { version: number; snapshot: ReturnType<AtomicWalletStore['snapshot']> }>();
          const writes: Array<{ path: string; data: Data }> = [];
          const attempt: Attempt = { client: name, number, paths: [], committed: false, conflicted: false };
          this.attempts.push(attempt);
          const transaction = {
            get: async (ref: Ref) => {
              if (writes.length > 0) throw new Error('Firestore transactions require all reads before writes');
              if (!reads.has(ref.path)) reads.set(ref.path, {
                version: this.versions.get(ref.path) ?? 0, snapshot: this.snapshot(ref.path),
              });
              return reads.get(ref.path)!.snapshot;
            },
            set: (ref: Ref, data: Data) => {
              writes.push({ path: ref.path, data: structuredClone(data) });
              attempt.paths.push(ref.path);
            },
          };
          const result = await body(transaction);
          await this.beforeCommit?.(attempt);
          if ([...reads].some(([path, read]) => (this.versions.get(path) ?? 0) !== read.version)) {
            attempt.conflicted = true;
            continue;
          }
          const next = new Map(this.docs);
          for (const [index, write] of writes.entries()) {
            if (this.failCommitWrite === index + 1) {
              this.failCommitWrite = null;
              throw new Error('injected atomic commit rejection');
            }
            next.set(write.path, structuredClone(write.data));
          }
          this.docs = next;
          for (const write of writes) this.versions.set(write.path, (this.versions.get(write.path) ?? 0) + 1);
          attempt.committed = true;
          if (writes.length > 0 && this.loseNextCommitAcknowledgement) {
            this.loseNextCommitAcknowledgement = false;
            throw new Error('commit succeeded but acknowledgement was lost');
          }
          return result;
        }
        throw new Error('transaction retry limit exceeded');
      },
    };
  }
}

/** Both callers finish reading/queueing before either is permitted to commit. No timers or eager writes. */
function firstCommitBarrier(participants: number) {
  let arrivals = 0;
  let release!: () => void;
  const allReady = new Promise<void>((resolve) => { release = resolve; });
  return async (attempt: Attempt) => {
    if (attempt.number !== 1 || arrivals >= participants) return;
    arrivals++;
    if (arrivals === participants) release();
    await allReady;
  };
}

const OWNER = 'buyer';
const WALLET = `user_token_wallets/${OWNER}`;
const START = 100 * TOKENS_PER_RUPEE;
const tx = (buildRef = 'agentv3-buyer-app_attempt-1', billedInr = 5): WalletDebitTx =>
  ({ buildRef, billedInr, description: 'NavBharatAI Pro build' });
const wallet = (tokens = START): Data => ({
  userId: OWNER, tokenBalance: tokens, totalTokensUsed: 0, remaining_balance: tokens / TOKENS_PER_RUPEE,
  walletLedger: [], giftTokensRemaining: 0,
});
const opPath = (buildRef: string) => `${WALLET_OPS}/${walletOpId(OWNER, 'build', buildRef)}`;
const immutable = (store: AtomicWalletStore) => store.rows(WALLET_LEDGER_V2) as LedgerV2Row[];

beforeEach(() => {
  vi.stubEnv('WALLET_MERGE_RESOLVE', 'off');
  vi.stubEnv('WALLET_LEDGER_V2_DUALWRITE', 'on');
  vi.stubEnv('WALLET_OVERDRAFT_FLOOR_INR', '50');
});
afterEach(() => vi.unstubAllEnvs());

describe('build debit transaction fault boundaries', () => {
  it.each(['', '   ', undefined])('refuses a missing idempotency key (%s) before any transaction', async (buildRef) => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    const charge = { ...tx(), buildRef } as WalletDebitTx;
    const first = await debitWalletForBuild(store.client('first'), OWNER, charge);
    const retry = await debitWalletForBuild(store.client('retry'), OWNER, charge);
    expect(first).toMatchObject({ ok: false, error: 'Missing buildRef' });
    expect(retry).toMatchObject({ ok: false, error: 'Missing buildRef' });
    expect(store.read(WALLET)).toEqual(wallet());
    expect(store.attempts).toHaveLength(0);
    expect(store.rows(WALLET_OPS)).toHaveLength(0);
    expect(immutable(store)).toHaveLength(0);
  });

  it('two clients settling the same attempt charge once after a real read conflict', async () => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    store.beforeCommit = firstCommitBarrier(2);
    const charge = tx();
    const result = await Promise.all([
      debitWalletForBuild(store.client('normal-settle'), OWNER, charge),
      debitWalletForBuild(store.client('deadline-finalizer'), OWNER, charge),
    ]);
    expect(result.every((r) => r.ok)).toBe(true);
    expect(result.map((r) => r.ok ? r.tokensDebited : -1).sort((a, b) => a - b)).toEqual([0, 500]);
    expect(store.attempts.some((a) => a.conflicted)).toBe(true);
    expect(store.attempts.some((a) => a.number === 2)).toBe(true);
    expect(store.read(WALLET)?.tokenBalance).toBe(START - 500);
    expect(store.rows(WALLET_OPS)).toHaveLength(1);
    expect(immutable(store)).toHaveLength(1);
    expect(checkLedgerV2Chain(immutable(store), START - 500).ok).toBe(true);
  });

  it('different attempts settling concurrently both apply to the latest wallet, without a lost update', async () => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    store.beforeCommit = firstCommitBarrier(2);
    const result = await Promise.all([
      debitWalletForBuild(store.client('instance-a'), OWNER, tx('attempt-a', 3)),
      debitWalletForBuild(store.client('instance-b'), OWNER, tx('attempt-b', 7)),
    ]);
    expect(result.every((r) => r.ok)).toBe(true);
    expect(store.read(WALLET)).toMatchObject({ tokenBalance: START - 1000, totalTokensUsed: 1000, remaining_balance: 90 });
    expect(store.rows(WALLET_OPS)).toHaveLength(2);
    expect(immutable(store)).toHaveLength(2);
    expect(checkLedgerV2Chain(immutable(store), START - 1000)).toEqual({ ok: true, problems: [] });
  });

  it.each([1, 2, 3])('a commit rejected at write %i leaves wallet, dedupe and immutable ledger unchanged', async (write) => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    store.failCommitWrite = write;
    const charge = tx();
    const failed = await debitWalletForBuild(store.client('first'), OWNER, charge);
    expect(failed).toMatchObject({ ok: false, error: 'injected atomic commit rejection' });
    expect(store.read(WALLET)).toEqual(wallet());
    expect(store.read(opPath(charge.buildRef))).toBeUndefined();
    expect(immutable(store)).toHaveLength(0);
    expect(store.attempts[0].committed).toBe(false);
    expect(await debitWalletForBuild(store.client('retry-after-failure'), OWNER, charge))
      .toMatchObject({ ok: true, tokensDebited: 500, tokenBalance: START - 500 });
    expect(store.rows(WALLET_OPS)).toHaveLength(1);
    expect(immutable(store)).toHaveLength(1);
  });

  it('an acknowledgement lost after commit is an uncertain result; replay observes the durable charge and debits nothing', async () => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    store.loseNextCommitAcknowledgement = true;
    const charge = tx();
    const uncertain = await debitWalletForBuild(store.client('disconnected'), OWNER, charge);
    expect(uncertain).toMatchObject({ ok: false, error: 'commit succeeded but acknowledgement was lost' });
    expect(store.read(WALLET)?.tokenBalance).toBe(START - 500);
    expect(store.read(opPath(charge.buildRef))).toMatchObject({ ref: charge.buildRef, ownerId: OWNER });
    expect(await debitWalletForBuild(store.client('new-connection'), OWNER, charge))
      .toMatchObject({ ok: true, tokensDebited: 0, tokenBalance: START - 500 });
    expect(store.rows(WALLET_OPS)).toHaveLength(1);
    expect(immutable(store)).toHaveLength(1);
  });

  it('a transaction callback retry rereads a concurrent credit instead of overwriting it', async () => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    vi.stubEnv('WALLET_LEDGER_V2_DUALWRITE', 'off');
    store.beforeCommit = async (attempt) => {
      if (attempt.number === 1) store.put(WALLET, wallet(START + 1000));
    };
    expect(await debitWalletForBuild(store.client('build-settle'), OWNER, tx()))
      .toMatchObject({ ok: true, tokensDebited: 500, tokenBalance: START + 1000 - 500 });
    expect(store.attempts.map((a) => a.conflicted)).toEqual([true, false]);
    expect(store.read(WALLET)?.tokenBalance).toBe(START + 500);
    expect(store.rows(WALLET_OPS)).toHaveLength(1);
  });

  it('durable dedupe survives a fresh module/client and more than a full embedded ledger of later charges', async () => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet(1000 * TOKENS_PER_RUPEE));
    const charge = tx('old-attempt', 2);
    expect(await debitWalletForBuild(store.client('before-restart'), OWNER, charge)).toMatchObject({ ok: true, tokensDebited: 200 });
    const client = store.client('later-builds');
    for (let i = 0; i <= MAX_WALLET_LEDGER_ENTRIES; i++) {
      expect(await debitWalletForBuild(client, OWNER, tx(`later-${i}`, 0.01))).toMatchObject({ ok: true, tokensDebited: 1 });
    }
    const beforeReplay = store.read(WALLET)!;
    expect(beforeReplay.walletLedger).toHaveLength(MAX_WALLET_LEDGER_ENTRIES);
    expect(beforeReplay.walletLedger.some((r: any) => r.buildRef === charge.buildRef)).toBe(false);
    vi.resetModules();
    const restarted = await import('../src/server/lib/walletDebit');
    expect(await restarted.debitWalletForBuild(store.client('new-process-connection'), OWNER, charge))
      .toMatchObject({ ok: true, tokensDebited: 0, tokenBalance: beforeReplay.tokenBalance });
    expect(store.read(WALLET)).toEqual(beforeReplay);
    expect(store.rows(WALLET_OPS)).toHaveLength(MAX_WALLET_LEDGER_ENTRIES + 2);
    expect(checkLedgerV2Chain(immutable(store), beforeReplay.tokenBalance).ok).toBe(true);
  });

  it('same-attempt retries carry a fractional-token charge only once', async () => {
    const store = new AtomicWalletStore(); store.put(WALLET, wallet());
    store.beforeCommit = firstCommitBarrier(2);
    const charge = tx('fractional-attempt', 0.004);
    const results = await Promise.all([
      debitWalletForBuild(store.client('a'), OWNER, charge),
      debitWalletForBuild(store.client('b'), OWNER, charge),
    ]);
    expect(results.every((r) => r.ok && r.tokensDebited === 0)).toBe(true);
    expect(store.read(WALLET)).toMatchObject({ tokenBalance: START, [TOKEN_CARRY_FIELD]: 0.4 });
    expect(store.read(WALLET)?.walletLedger).toHaveLength(1);
    expect(store.rows(WALLET_OPS)).toHaveLength(1);
    expect(immutable(store)).toHaveLength(1);
  });
});
