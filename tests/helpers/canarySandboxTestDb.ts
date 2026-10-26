// Offline optimistic transaction fixture; never imported by production.
import type { Firestore, Transaction } from 'firebase-admin/firestore';
export function database() {
  const docs = new Map<string, unknown>();
  const versions = new Map<string, number>();
  let retries = 0;
  let loseNextResponse = false;
  let beforeCommit: (() => void) | undefined;
  let onRead: ((path: string) => void) | undefined;
  const reads: string[] = [];
  let transactions = 0;
  const copy = <T>(v: T): T => structuredClone(v);
  const seed = (path: string, value: unknown) => { docs.set(path, copy(value)); versions.set(path, (versions.get(path) ?? 0) + 1); };
  const doc = (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => copy(docs.get(path)) }) });
  const db = {
    doc,
    async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      transactions++;
      for (let round = 0; round < 100; round++) {
        const read = new Map<string, number>();
        const pending = new Map<string, unknown>();
        const tx = {
          async get(ref: { path: string }) {
            if (pending.size) throw new Error('Firestore transactions require all reads before writes');
            reads.push(ref.path); onRead?.(ref.path);
            read.set(ref.path, versions.get(ref.path) ?? 0);
            const value = copy(docs.get(ref.path));
            return { exists: docs.has(ref.path), data: () => value };
          },
          set(ref: { path: string }, data: unknown) { pending.set(ref.path, copy(data)); return tx; },
          create(ref: { path: string }, data: unknown) {
            if (!read.has(ref.path)) throw new Error('Test requires a prior absence read');
            if (docs.has(ref.path)) throw new Error('Already exists');
            pending.set(ref.path, copy(data)); return tx;
          },
        };
        const result = await fn(tx as unknown as Transaction);
        const hook = beforeCommit; beforeCommit = undefined; hook?.();
        if ([...read].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
        for (const [path, value] of pending) seed(path, value);
        if (loseNextResponse && pending.size) { loseNextResponse = false; throw new Error('Commit response lost'); }
        return result;
      }
      throw new Error('Contention exhausted');
    },
  };
  return { reads, get transactions() { return transactions; }, onRead: (hook: (path: string) => void) => { onRead = hook; },
    db: db as unknown as Pick<Firestore, 'doc' | 'runTransaction'>, docs, seed,
    get retries() { return retries; }, loseResponse: () => { loseNextResponse = true; },
    beforeCommit: (hook: () => void) => { beforeCommit = hook; } };
}