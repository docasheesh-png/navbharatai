// THE OPENAI EMBEDDING INDEX IS OFF BY DEFAULT, AND THAT IS NOT CAUTION — IT IS BECAUSE NOTHING READS IT.
//
// ADMIN 2026-09-15: the admin set `OPENAI_API_KEY` in Cloud Run to try GPT as a build engine. That key
// alone changes no build (no tier ladder names an OPENAI rung), but it silently switched on something
// nobody decided: `EmbeddingSearch` reads the SAME env var, and `ToolDispatcher` calls
// `getEmbeddingStore(ws).addFile(...)` on EVERY file write — three call sites — so every file of every
// build would have gone to `text-embedding-ada-002` and then into Firestore.
//
// 🔴 AND THE INDEX HAS NO READER. `EmbeddingStore.search()` has no production call site at all — only
// `addFile` runs. Grep the repo: `getEmbeddingStore(` appears exactly three times outside this module's
// own exports, and all three are writes. So the key would have bought a vector index that is written on
// every build, stored for ever, and never once consulted.
//
// THE CLASS, named so it is recognised elsewhere: A FEATURE WHOSE WRITE HALF IS WIRED AND WHOSE READ
// HALF IS NOT can only ever cost. It looks alive in code review — a real API, a real store, real
// persistence — and it produces nothing. It stayed invisible here for a second reason worth stating:
// the spend sits OUTSIDE `captureTurnUsage`, so it would never have appeared in a build's cost, in the
// user's wallet, or on the admin's spend dashboard. A cost that no panel can show is the one that
// cannot be noticed.
//
// WHY A FLAG RATHER THAN DELETION. The module is real, tested, and persists through `EmbeddingStore` —
// deleting a working implementation to stop a bill would be the mistake this repo already paid for once
// (the `fileMentions.ts` overwrite). The flag makes the COST impossible while the code stays available
// for whoever wires the search half. ⚠️ Turning it on today still buys nothing until that half exists.

/** Values that mean "yes" for a switch that must be OFF unless somebody deliberately turned it on. */
const TRUTHY = new Set(['on', 'true', '1', 'yes', 'enabled']);

/**
 * Is the OpenAI-backed file embedding index enabled? **Default false.**
 *
 * Deliberately opt-IN, unlike most flags in this codebase: the usual default-on kill switch is right
 * for a feature that helps, and this one has no reader. A malformed or blank value is OFF for the same
 * reason — the safe direction here is "do not spend", and nobody types a stray word meaning "start
 * calling a paid API on every file write".
 */
export function embeddingsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY.has(String(env.AGENTV3_EMBEDDINGS ?? '').trim().toLowerCase());
}
