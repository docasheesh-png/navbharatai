/**
 * In-memory Firestore for the Native Cloud Build store tests: doc get/set/update/delete, collection add,
 * equality and `in` queries, and transactions whose writes apply at commit (or not at all). Test-only.
 */
type Row = Record<string, unknown>;

export class NativeBuildFirestore {
  readonly data = new Map<string, Map<string, Row>>();
  private seq = 0;
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
      async set(v: Row) { self.col(name).set(id, structuredClone(v)); },
      async update(patch: Row) {
        const cur = self.col(name).get(id);
        if (!cur) throw new Error('NOT_FOUND');
        self.col(name).set(id, { ...cur, ...structuredClone(patch) });
      },
      async delete() { self.col(name).delete(id); },
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
    const writes: Array<() => void> = [];
    const tx = {
      get: (r: any) => r.get(),
      set: (r: any, v: Row) => { writes.push(() => this.col(r.__col).set(r.__id, structuredClone(v))); },
      create: (r: any, v: Row) => {
        if (this.col(r.__col).has(r.__id)) throw new Error('ALREADY_EXISTS');
        writes.push(() => this.col(r.__col).set(r.__id, structuredClone(v)));
      },
    };
    const out = await fn(tx);
    for (const w of writes) w();
    return out;
  }
}
