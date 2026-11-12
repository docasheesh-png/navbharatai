/** Admin-shaped Firestore fixture with optimistic transaction conflict retries.
 * This intentionally runs the real serverDb shim and real wallet arithmetic. It is
 * not evidence of emulator locking: scripts/voiceAi.check.mjs covers that separately.
 */
export function voiceFirestore() {
  const rows = new Map<string, any>();
  const versions = new Map<string, number>();
  let attempts = 0;
  let commits = 0;
  let failCommit = false;
  const write = (path: string, value: any) => {
    rows.set(path, structuredClone(value));
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const snap = (path: string) => {
    const value = structuredClone(rows.get(path));
    return { exists: rows.has(path), id: path.split('/').at(-1), ref: { path },
      data: () => structuredClone(value), get: (field: string) => value?.[field] };
  };
  const db = {
    rows, write,
    get attempts() { return attempts; },
    get commits() { return commits; },
    failNextCommit() { failCommit = true; },
    doc(path: string) { return { path, get: async () => snap(path) }; },
    collection(name: string) {
      const constraints: Array<(value: any) => boolean> = [];
      let maximum = Infinity;
      let orderField: string | undefined;
      let cursor: { id: string; data: () => any } | undefined;
      const query = {
        where(field: string, operator: string, rhs: number) {
          constraints.push(value => typeof value[field] === 'number' && (operator === '<=' ? value[field] <= rhs : value[field] > rhs));
          return query;
        },
        limit(value: number) { maximum = value; return query; },
        orderBy(field: string) { orderField = field; return query; },
        startAfter(value: typeof cursor) { cursor = value; return query; },
        async get() {
          const documents = [...rows.keys()].filter(path => path.startsWith(`${name}/`) && constraints.every(match => match(rows.get(path))));
          if (orderField) documents.sort((left, right) => rows.get(left)[orderField!] - rows.get(right)[orderField!] || left.localeCompare(right));
          return { docs: documents.filter(path => !cursor || !orderField || rows.get(path)[orderField] > cursor.data()[orderField]
            || (rows.get(path)[orderField] === cursor.data()[orderField] && path.split('/').at(-1)! > cursor.id))
            .slice(0, maximum).map(snap) };
        },
      };
      return query;
    },
    async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      for (let retry = 0; retry < 100; retry++) {
        attempts++;
        const reads = new Map<string, number>();
        const writes = new Map<string, any>();
        const result = await callback({
          async get(ref: { path: string }) {
            if (writes.size) throw new Error('Firestore requires all reads before writes');
            reads.set(ref.path, versions.get(ref.path) ?? 0);
            return snap(ref.path);
          },
          set(ref: { path: string }, value: any) { writes.set(ref.path, structuredClone(value)); },
        });
        if ([...reads].some(([path, version]) => version !== (versions.get(path) ?? 0))) continue;
        if (failCommit) { failCommit = false; throw new Error('synthetic commit failure'); }
        for (const [path, value] of writes) write(path, value);
        commits++;
        return result;
      }
      throw new Error('Fixture transaction retry limit');
    },
  };
  return db;
}
