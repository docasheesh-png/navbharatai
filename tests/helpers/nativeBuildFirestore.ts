/**
 * In-memory Firestore for the Native Cloud Build store tests: doc get/set/update/delete, collection add,
 * equality and `in` queries, and transactions with Firestore's OPTIMISTIC CONCURRENCY — writes apply at
 * commit, and a transaction whose read documents changed meanwhile is re-run (as the real SDK does), so a
 * read-then-write race that real Firestore would serialise is serialised here too. Test-only.
 */
type Row = Record<string, unknown>;

export class NativeBuildFirestore {
  readonly data = new Map<string, Map<string, Row>>();
  private seq = 0;
  private versions = new Map<string, number>();
  private bump(col: string, id: string): void { const k = `${col}/${id}`; this.versions.set(k, (this.versions.get(k) ?? 0) + 1); }
  private version(col: string, id: string): number { return this.versions.get(`${col}/${id}`) ?? 0; }
  private col(name: string): Map<string, Row> {
    let c = this.data.get(name);
    if (!c) { c = new Map(); this.data.set(name, c); }
    return c;
  }
  rows(name: string): Row[] { return [...this.col(name).values()].map((r) => structuredClone(r)); }

  collection(name: string) {
    const self = this;
    const ref = (id: string) => ({
      __col: name,
      __id: id,
      async get() {
        const v = self.col(name).get(id);
        return { exists: v !== undefined, id, data: () => (v ? structuredClone(v) : undefined) };
      },
      async set(v: Row) { self.col(name).set(id, structuredClone(v)); self.bump(name, id); },
      async update(patch: Row) {
        const cur = self.col(name).get(id);
        if (!cur) throw new Error('NOT_FOUND');
        self.col(name).set(id, { ...cur, ...structuredClone(patch) });
        self.bump(name, id);
      },
      async delete() { self.col(name).delete(id); self.bump(name, id); },
    });
    const query = (pred: (r: Row) => boolean) => ({
      async get() {
        const docs = [...self.col(name).values()].filter(pred).map((r) => ({ data: () => structuredClone(r) }));
        return { docs, size: docs.length, forEach: (fn: (d: { data: () => Row }) => void) => docs.forEach(fn) };
      },
    });
    return {
      doc: (id?: string) => ref(id ?? `auto${String(++self.seq).padStart(6, '0')}`),
      async add(v: Row) { const id = `auto${String(++self.seq).padStart(6, '0')}`; self.col(name).set(id, structuredClone(v)); return ref(id); },
      where(field: string, op: '==' | 'in', value: unknown) {
        return query((r) => (op === '==' ? r[field] === value : (value as unknown[]).includes(r[field])));
      },
    };
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, number>();
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: any) => { reads.set(`${r.__col}/${r.__id}`, this.version(r.__col, r.__id)); return r.get(); },
        set: (r: any, v: Row) => { writes.push(() => { this.col(r.__col).set(r.__id, structuredClone(v)); this.bump(r.__col, r.__id); }); },
        create: (r: any, v: Row) => {
          if (this.col(r.__col).has(r.__id)) throw new Error('ALREADY_EXISTS');
          writes.push(() => { this.col(r.__col).set(r.__id, structuredClone(v)); this.bump(r.__col, r.__id); });
        },
      };
      const out = await fn(tx);
      // Commit: re-run if anything this transaction read has changed since (Firestore's contention retry).
      const stale = [...reads].some(([k, v]) => (this.versions.get(k) ?? 0) !== v);
      if (stale) continue;
      for (const w of writes) w();
      return out;
    }
    throw new Error('ABORTED: too much contention');
  }
}
