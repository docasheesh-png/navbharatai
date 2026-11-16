// The durable home of a project's requirements ledger (see projectRequirements.ts for what is in it and why).
//
// Its own Firestore document — NOT inside `workspace_memory_v3`, whose episodes are capped at 100 on write and
// ignored after 30 days. This one has no age limit and no episode cap; the ledger carries its own bound.
// The canonical record stays the conversation store: when this document is missing or unreadable the ledger is
// REBUILT from the transcript, so losing it costs a rebuild, never the user's instructions.

import {
  applyMessage, emptyLedger, rebuildLedger, userMessagesOf,
  type LedgerMessage, type RequirementLedger,
} from './projectRequirements';
import { getServerDb } from '../lib/serverDb';

const COLLECTION = 'project_requirements_v3';

export type LedgerLoad =
  | { status: 'ok'; ledger: RequirementLedger }
  | { status: 'missing' }
  | { status: 'unreadable'; error: string };

export interface RequirementsStore {
  load(projectId: string): Promise<LedgerLoad>;
  /** Fold one message into the stored ledger atomically (create it if absent). Returns the result. */
  record(projectId: string, msg: LedgerMessage): Promise<RequirementLedger>;
  /** Replace the stored ledger (used after a rebuild from the canonical transcript). */
  replace(projectId: string, ledger: RequirementLedger): Promise<void>;
}

export class InMemoryRequirementsStore implements RequirementsStore {
  private docs = new Map<string, RequirementLedger>();
  /** Tests flip this to simulate an outage or a worker restart that loses process memory. */
  failReads = false;
  async load(projectId: string): Promise<LedgerLoad> {
    if (this.failReads) return { status: 'unreadable', error: 'simulated read failure' };
    const l = this.docs.get(projectId);
    return l ? { status: 'ok', ledger: JSON.parse(JSON.stringify(l)) as RequirementLedger } : { status: 'missing' };
  }
  async record(projectId: string, msg: LedgerMessage): Promise<RequirementLedger> {
    const next = applyMessage(this.docs.get(projectId) ?? emptyLedger(), msg);
    this.docs.set(projectId, next);
    return next;
  }
  async replace(projectId: string, ledger: RequirementLedger): Promise<void> { this.docs.set(projectId, ledger); }
  clear(): void { this.docs.clear(); }
}

export class FirestoreRequirementsStore implements RequirementsStore {
  constructor(private readonly db: FirebaseFirestore.Firestore) {}
  private doc(projectId: string) { return this.db.collection(COLLECTION).doc(projectId); }

  async load(projectId: string): Promise<LedgerLoad> {
    try {
      const s = await this.doc(projectId).get();
      if (!s.exists) return { status: 'missing' };
      const l = (s.data() as { ledger?: RequirementLedger }).ledger;
      return l && l.version === 1 ? { status: 'ok', ledger: l } : { status: 'missing' };
    } catch (e) {
      return { status: 'unreadable', error: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }
  async record(projectId: string, msg: LedgerMessage): Promise<RequirementLedger> {
    const ref = this.doc(projectId);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = s.exists ? (s.data() as { ledger?: RequirementLedger }).ledger : undefined;
      const next = applyMessage(cur && cur.version === 1 ? cur : emptyLedger(), msg);
      if (next !== cur) tx.set(ref, { ledger: next, updatedAt: Date.now() });
      return next;
    });
  }
  async replace(projectId: string, ledger: RequirementLedger): Promise<void> {
    await this.doc(projectId).set({ ledger, updatedAt: Date.now() });
  }
}

let override: RequirementsStore | null = null;
let memory: InMemoryRequirementsStore | null = null;
let firestore: FirestoreRequirementsStore | null = null;

export function getRequirementsStore(): RequirementsStore {
  if (override) return override;
  if (!process.env.VITEST) {
    try {
      const db = getServerDb();
      if (db) {
        if (!firestore) firestore = new FirestoreRequirementsStore(db);
        return firestore;
      }
    } catch { /* no Firestore: memory */ }
  }
  if (!memory) memory = new InMemoryRequirementsStore();
  return memory;
}
export function setRequirementsStoreForTests(s: RequirementsStore | null): void { override = s; memory = null; }

export type EnsureResult =
  | { status: 'ok' | 'rebuilt'; ledger: RequirementLedger }
  /** Neither the stored ledger nor the transcript could be read: the instructions cannot be recovered. */
  | { status: 'unrecoverable'; reason: string };

/**
 * The ledger an edit is allowed to use. Order: the stored ledger → rebuild from the canonical transcript (and
 * store the rebuild). `isBuildRequest` marks which message asked for the app, so the brief is the right one.
 *
 * `unrecoverable` is returned ONLY when a read failed on both sides — never for an empty project. The caller
 * stops the edit before any mutation in that case (an edit without its requirements is a guess).
 */
export async function ensureLedger(
  store: RequirementsStore,
  projectId: string,
  readTranscript: () => Promise<readonly unknown[] | null>,
  isBuildRequest: (text: string) => boolean,
): Promise<EnsureResult> {
  const loaded = await store.load(projectId);
  if (loaded.status === 'ok' && loaded.ledger.brief) return { status: 'ok', ledger: loaded.ledger };
  // A stored ledger WITHOUT a brief (every ledger written before the brief was chosen by content) is repaired from
  // the canonical transcript: the brief and requirements it finds are merged under what was stored.
  if (loaded.status === 'ok') {
    let tr: readonly unknown[] | null = null;
    try { tr = await readTranscript(); } catch { tr = null; }
    if (tr === null) return { status: 'ok', ledger: loaded.ledger };
    const rebuilt = rebuildLedger(userMessagesOf(tr).map((m) => ({ ...m, isBuildRequest: isBuildRequest(m.text) })));
    if (!rebuilt.brief) return { status: 'ok', ledger: loaded.ledger };
    const known = new Set(rebuilt.processed);
    let merged = rebuilt;
    for (const r of loaded.ledger.items) if (!known.has(r.sourceId) && !merged.items.some((x) => x.id === r.id)) merged = { ...merged, items: [...merged.items, r] };
    try { await store.replace(projectId, merged); } catch { /* the merge still serves this turn */ }
    return { status: 'rebuilt', ledger: merged };
  }

  let transcript: readonly unknown[] | null = null;
  try { transcript = await readTranscript(); } catch { transcript = null; }
  if (transcript === null) {
    return loaded.status === 'missing'
      // Nothing stored and no transcript to read: a project with no history, not an outage.
      ? { status: 'ok', ledger: emptyLedger() }
      : { status: 'unrecoverable', reason: `the saved requirements could not be read (${loaded.error}) and neither could the conversation` };
  }
  const messages = userMessagesOf(transcript).map((m) => ({ ...m, isBuildRequest: isBuildRequest(m.text) }));
  const ledger = rebuildLedger(messages);
  if (loaded.status === 'missing' || loaded.status === 'unreadable') {
    try { await store.replace(projectId, ledger); } catch { /* the rebuild is still usable this turn */ }
  }
  return { status: 'rebuilt', ledger };
}
