// State + routing for "Offline Thinking (beta)" (Stage-1 roadmap, PR-3). Pure & testable — the browser/
// WebGPU parts live in offlineLlmEngine.ts and the component. The beta is DEFAULT-OFF and per-device
// (localStorage). When it's on and the model is ready, the on-device LLM only fills the gap where the
// DETERMINISTIC engine had no confident answer — facts/navigation/math/date stay on the reliable engine,
// so the small model is used for open-ended text only (with a "can be wrong" label in the UI).

import type { ChatTurn } from './offlineLlmEngine';
import type { ChatReply } from './offlineChat';

export interface BetaState {
  /** The user turned the on-device AI beta on (and the model finished downloading at least once). */
  enabled: boolean;
  /** Which model id was enabled (so we can show/re-load the same one). */
  modelId?: string;
}

export const OFFLINE_BETA_KEY = 'navbharat_offline_beta_v1';

/** Load the beta state (safe: default disabled on any error). */
export function loadBetaState(storage?: Pick<Storage, 'getItem'>): BetaState {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = store?.getItem(OFFLINE_BETA_KEY);
    if (!raw) return { enabled: false };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.enabled === 'boolean') {
      return { enabled: parsed.enabled, modelId: typeof parsed.modelId === 'string' ? parsed.modelId : undefined };
    }
    return { enabled: false };
  } catch {
    return { enabled: false };
  }
}

/** Persist the beta state (safe). */
export function saveBetaState(state: BetaState, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    store?.setItem(OFFLINE_BETA_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

/**
 * Route to the on-device LLM only when the beta is ready AND the deterministic engine had no confident
 * answer (i.e. it would otherwise say "go online"). This keeps facts/navigation on the reliable path and
 * uses the small model just for the open-ended gap. Pure.
 */
export function shouldUseLlm(reply: ChatReply, betaReady: boolean): boolean {
  return betaReady && reply.online === true;
}

/** The on-device model's system prompt — honest, white-labelled (never names a vendor/model), and clear
 *  that it's a small offline model that can be wrong. */
export const LLM_SYSTEM_PROMPT =
  "You are NavBharatAI's on-device assistant, running privately on the user's phone with no internet. " +
  "You are a small model, so keep answers short and be honest — if you are unsure, or the question needs " +
  "live/online or factual information you can't be certain of, say so briefly instead of guessing. Never " +
  "claim to be any particular company's AI or reveal an underlying model — you are NavBharatAI.";

/** Build the message list for the on-device model: system prompt (+ the user's taught facts as memory),
 *  the recent conversation for continuity, then the new question. This is how it "remembers" and gets
 *  more helpful over a conversation — via context, not by training weights. Pure. */
export function buildLlmMessages(
  query: string,
  recentTurns: { role: 'user' | 'bot'; text: string }[],
  taughtFacts: string[],
  maxTurns = 6,
): ChatTurn[] {
  const memoryBlock = taughtFacts.length
    ? "\n\nThings the user told you to remember (use if relevant):\n- " + taughtFacts.slice(0, 20).join("\n- ")
    : "";
  const msgs: ChatTurn[] = [{ role: 'system', content: LLM_SYSTEM_PROMPT + memoryBlock }];
  for (const t of recentTurns.slice(-maxTurns)) {
    msgs.push({ role: t.role === 'user' ? 'user' : 'assistant', content: t.text });
  }
  msgs.push({ role: 'user', content: query });
  return msgs;
}
