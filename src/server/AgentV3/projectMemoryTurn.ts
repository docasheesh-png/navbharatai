// The per-turn use of the project's requirements ledger, in one place so the route stays a single call.
//
// For a turn: make sure the ledger is readable (stored copy → rebuild from the canonical transcript), fold in
// what the user just said, and hand back the bounded block the builder reads. A fresh start / approved rebuild
// REPLACES the ledger with the new message (the user has changed what the project is). If neither the stored
// ledger nor the transcript can be read, the status says so and the caller stops an EDIT before it mutates
// anything — an edit made without the project's instructions is a guess.

import { applyMessage, emptyLedger, messageIdFor, renderRequirements, type RequirementLedger } from './projectRequirements';
import { ensureLedger, getRequirementsStore, type RequirementsStore } from './projectRequirementsStore';

export type ProjectMemoryStatus = 'ok' | 'rebuilt' | 'unrecoverable';

export interface ProjectMemoryTurn {
  status: ProjectMemoryStatus;
  /** The block the builder reads ('' when there is nothing to say, or on `unrecoverable`). */
  text: string;
  ledger: RequirementLedger | null;
  /** Admin-facing one-liner for the build report. */
  note: string;
}

export interface ProjectMemoryTurnInput {
  projectId: string;
  /** What the user typed this turn. */
  message: string;
  /** Whether this turn asks for the app (the first such message becomes the brief). */
  isBuildRequest: boolean;
  /** Fresh start / user-approved rebuild: the project is being redefined. */
  replace: boolean;
  readTranscript: () => Promise<readonly unknown[] | null>;
  /** Which transcript messages ask for the app (to pick the brief when the ledger is rebuilt). */
  isBuildText: (text: string) => boolean;
  now?: number;
  store?: RequirementsStore;
}

export async function prepareProjectMemory(i: ProjectMemoryTurnInput): Promise<ProjectMemoryTurn> {
  const store = i.store ?? getRequirementsStore();
  const now = i.now ?? Date.now();
  const msg = { id: messageIdFor(0, i.message), text: i.message, ts: now, isBuildRequest: i.isBuildRequest };
  if (i.replace) {
    const fresh = applyMessage(emptyLedger(), { ...msg, isBuildRequest: true });
    try { await store.replace(i.projectId, fresh); } catch { /* the in-memory ledger still serves this turn */ }
    return { status: 'ok', text: '', ledger: fresh, note: 'Project requirements were reset: the user started fresh or approved a rebuild.' };
  }
  const ensured = await ensureLedger(store, i.projectId, i.readTranscript, i.isBuildText);
  if (ensured.status === 'unrecoverable') return { status: 'unrecoverable', text: '', ledger: null, note: ensured.reason };
  let ledger = ensured.ledger;
  try { ledger = await store.record(i.projectId, msg); } catch { ledger = applyMessage(ledger, msg); }
  return {
    status: ensured.status,
    text: renderRequirements(ledger),
    ledger,
    note: ensured.status === 'rebuilt'
      ? 'Project requirements were rebuilt from the saved conversation (the stored copy was missing or unreadable).'
      : `Project requirements loaded: ${ledger.brief ? 'brief' : 'no brief'} + ${ledger.items.filter((r) => !r.supersededBy).length} active requirement(s).`,
  };
}

/** Fold a message into the ledger from a lane that does not build (chat), so a constraint said in chat is kept. Best-effort. */
export async function recordUserMessage(projectId: string, message: string, isBuildRequest: boolean, skip = false, store: RequirementsStore = getRequirementsStore()): Promise<void> {
  try {
    if (skip || !message.trim()) return;
    await store.record(projectId, { id: messageIdFor(0, message), text: message, ts: Date.now(), isBuildRequest });
  } catch { /* the conversation stays the canonical record; a rebuild recovers this */ }
}

/**
 * The turn's memory, with every guard the route would otherwise spell out as branches: an import turn brings its own
 * project (nothing to load), a slow or failed read is `unrecoverable` rather than an exception, and the result is
 * always a value. (The route's one function is at TypeScript's control-flow limit, so the branching lives here.)
 */
export async function loadProjectMemoryForTurn(i: ProjectMemoryTurnInput & { skip: boolean; timeoutMs?: number }): Promise<ProjectMemoryTurn> {
  if (i.skip) return { status: 'ok', text: '', ledger: null, note: 'Import turn: the imported project brings its own requirements.' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      prepareProjectMemory(i),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), i.timeoutMs ?? 6_000); }),
    ]);
  } catch (e) {
    return { status: 'unrecoverable', text: '', ledger: null, note: `the project's requirements could not be loaded in time (${String((e as Error)?.message ?? e).slice(0, 80)})` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The sentence that ends an EDIT before it writes anything, or null when the turn may go on. */
export function memoryStopMessage(turn: ProjectMemoryTurn, projectExists: boolean, hasImportIntent: boolean, isImportTurn: boolean, enabled = true): string | null {
  if (!enabled || turn.status !== 'unrecoverable' || !projectExists || hasImportIntent || isImportTurn) return null;
  return 'I could not load this project\'s saved instructions (your original request and your standing requirements), so I did not change anything — editing without them could replace what you built. Your app is exactly as it was. Please send your message again in a moment.';
}

/** The messages of a stored conversation record, or null when there is no record. PURE. */
export function transcriptOf(rec: unknown): readonly unknown[] | null {
  if (!rec) return null;
  const m = (rec as { messages?: unknown }).messages;
  return Array.isArray(m) ? m : [];
}
