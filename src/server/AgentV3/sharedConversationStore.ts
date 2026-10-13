// The ONE conversation store per process, in a module of its own.
//
// WHY IT MOVED OUT OF routes/agentv3.ts (Q-867, 2026-10-12). `getConversationStore()` was exported
// from the build engine's route on 2026-09-07 so other routes would read the SAME singleton — and three
// of them (`supabaseIntegration`, `developerApi`, `nbaiDomains`) then imported it from there, each
// loading the whole engine (~1.9 MB route plus its graph, ~22 s per import under vitest) to reach one
// accessor. The singleton was right; its address was not. It lives here now, with only the store
// classes behind it, and `routes/agentv3.ts` re-exports it so every existing importer keeps working.
//
// ONE STORE, NOT TWO: this is the only module that constructs a ConversationStore for the server
// (tests/aRouteDoesNotLoadTheBuildEngine.test.ts counts the construction sites). Two stores in one
// process would each hold their own Firestore client and, worse, their own in-memory fallback — so a
// fact written through one would be invisible through the other, which is exactly the drift this
// codebase keeps having to unlearn.

import { InMemoryConversationStore, type ConversationStore } from './ConversationStore';
import { FirestoreConversationStore } from './FirestoreConversationStore';
import { notePersistenceFailure } from '../lib/persistenceHealth';

// ── Conversation persistence (D7) ──────────────────────────────────────────────
let sharedConversationStore: ConversationStore | null = null;
/**
 * The durable transcript store: Firestore when explicitly enabled (real cross-instance
 * durability in Cloud Run), otherwise the in-memory store (dev/CI, and a safe default so a
 * missing-credentials environment never errors). Singleton. Gated on AGENTV3_PERSIST_FIRESTORE
 * so CI/local stay on the in-memory store, matching the cautious v5.0 flag-gating.
 */
export function getConversationStore(): ConversationStore {
  if (sharedConversationStore) return sharedConversationStore;
  // Durable chat history by DEFAULT — it survives a process restart, a redeploy, and
  // horizontal scaling across Cloud Run instances. Previously this was OFF unless
  // AGENTV3_PERSIST_FIRESTORE='true' was set, so the store fell back to IN-MEMORY: a
  // reload that landed on a different instance — or any redeploy — lost the whole
  // conversation ("reload pe data gayab"). Now Firestore is the default; opt out with
  // AGENTV3_PERSIST_FIRESTORE=false. Unit tests (VITEST) always use the in-memory store.
  const useFirestore = process.env.AGENTV3_PERSIST_FIRESTORE !== 'false' && !process.env.VITEST;
  if (useFirestore) {
    try {
      sharedConversationStore = new FirestoreConversationStore();
    } catch (e) {
      // Durable chat history is UNAVAILABLE — the in-memory fallback means transcripts vanish on any
      // redeploy / instance rotation. Surface it (throttled) so this isn't a silent prod degradation.
      notePersistenceFailure('conversation_store', 'init', e);
      sharedConversationStore = new InMemoryConversationStore();
    }
  } else {
    sharedConversationStore = new InMemoryConversationStore();
  }
  return sharedConversationStore;
}
