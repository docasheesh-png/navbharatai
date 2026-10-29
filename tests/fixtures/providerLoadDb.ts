import type { Firestore } from 'firebase-admin/firestore';
/** Serialized transaction mock, not a substitute for real emulator drills. */
export function providerLoadDb() {
  const docs = new Map<string, any>([['free_chat_chain/provider_diagnostics/control/cheaperinference', { enabled: true, revision: 1 }]]);
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  let serial = Promise.resolve();
  const db = { doc: (path: string) => ({ path, get: async () => snapshot(path) }), runTransaction: (callback: any) => {
    const work = serial.then(async () => {
      const writes = new Map<string, any>();
      const result = await callback({ get: async (ref: any) => snapshot(ref.path), set: (ref: any, value: any) => writes.set(ref.path, structuredClone(value)),
        create: (ref: any, value: any) => { if (docs.has(ref.path)) throw Error('exists'); writes.set(ref.path, structuredClone(value)); } });
      for (const [path, value] of writes) docs.set(path, value); return result;
    }); serial = work.then(() => undefined, () => undefined); return work;
  } } as unknown as Firestore;
  return { docs, db };
}
