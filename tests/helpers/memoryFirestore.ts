/**
 * A small in-memory Firestore for control-store tests: get/set/create, transactions that apply all writes at commit
 * or none, `create` that fails when the document exists, and orderBy(desc)/limit queries. Test-only.
 */
export class MemoryFirestore {
  readonly data = new Map<string, Map<string, Record<string, unknown>>>();
  failReads = false;
  private seq = 0;
  private col(name: string) { let c = this.data.get(name); if (!c) { c = new Map(); this.data.set(name, c); } return c; }
  collection(name: string) {
    const self = this;
    const ref = (id: string) => ({
      __col: name, __id: id,
      async get() { if (self.failReads) throw new Error('read failed'); const v = self.col(name).get(id); return { exists: v !== undefined, data: () => (v ? structuredClone(v) : undefined) }; },
    });
    return {
      doc: (id?: string) => ref(id ?? `auto${String(++self.seq).padStart(6, '0')}`),
      orderBy: (field: string, dir: 'asc' | 'desc') => ({
        limit: (n: number) => ({
          async get() {
            const rows = [...self.col(name).values()].sort((a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1)).slice(0, n);
            return { docs: rows.map(r => ({ data: () => structuredClone(r) })) };
          },
        }),
      }),
    };
  }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const tx = {
      get: (r: any) => r.get(),
      set: (r: any, v: Record<string, unknown>) => { writes.push(() => this.col(r.__col).set(r.__id, structuredClone(v))); },
      create: (r: any, v: Record<string, unknown>) => {
        if (this.col(r.__col).has(r.__id)) throw new Error('ALREADY_EXISTS');
        writes.push(() => { if (this.col(r.__col).has(r.__id)) throw new Error('ALREADY_EXISTS'); this.col(r.__col).set(r.__id, structuredClone(v)); });
      },
    };
    const out = await fn(tx);
    for (const w of writes) w();
    return out;
  }
}
