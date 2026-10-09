/**
 * P4c — REASONING CONTINUITY FOR KIMI / GLM (fix/build-reliability, AGENTV3_REASONING_PASSBACK).
 *
 * Kimi's coding models (kimi-k2.x thinking / -code) document that the `reasoning_content` of every
 * historical assistant message should be sent back on the next request; GLM's "preserved thinking"
 * reads it too. Our transcript is Anthropic-shaped, and `parseOpenAiCompletion` dropped the reasoning
 * on the floor — so every turn the model lost the plan it had just made, and re-derived (or changed)
 * it. That is the "same model works in its own app, not in ours" gap for multi-turn builds.
 *
 * The transcript itself must stay Anthropic-valid (a Claude rung may read it — an unknown block type
 * is a hard 400 there), so the reasoning is NOT put in the transcript. It is kept in a small bounded
 * side table keyed by the turn's first tool_call id (ids are unique per call), and re-attached only
 * when the request goes to a model that understands the field. Bounded: a long build never grows it
 * past MAX_ENTRIES, and each entry is capped.
 */
import { reliabilityFlag } from './flags';

const MAX_ENTRIES = 4000;
const MAX_CHARS = 24_000;
const store = new Map<string, string>();

export function reasoningPassbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('REASONING_PASSBACK', env);
}

/** Models known to read `reasoning_content` on assistant history. Anything else never gets it. */
export function modelAcceptsReasoningPassback(model: string | undefined): boolean {
  return /kimi|moonshot|glm/i.test(String(model ?? ''));
}

/** Remember the reasoning that produced the tool calls with these ids. */
export function rememberReasoning(toolCallIds: readonly string[], reasoning: string): void {
  const id = toolCallIds.find((x) => typeof x === 'string' && x.length > 0);
  if (!id || !reasoning) return;
  // Keep the TAIL when capping — the end of a reasoning block is where the decision is.
  store.set(id, reasoning.length > MAX_CHARS ? reasoning.slice(-MAX_CHARS) : reasoning);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** The reasoning recorded for an assistant message whose tool calls carry these ids, if any. */
export function recalledReasoning(toolCallIds: readonly string[]): string | undefined {
  for (const id of toolCallIds) {
    const r = store.get(id);
    if (r) return r;
  }
  return undefined;
}

/** Test hook. */
export function clearReasoningStore(): void {
  store.clear();
}

export function reasoningStoreSize(): number {
  return store.size;
}
