/**
 * PROVIDER MODEL PICKER (admin 2026-11-16: "ek aur engine banao, jo andar se chune ki kis AI ko request karni hai, aur
 * ek bar me request na aaye to BluesMinds ke andar hi 2nd and 3rd AI ko try kare — jaise Surplus aur Router One me").
 *
 * A gateway such as BluesMinds serves a different set of models to each key's group, and a configured model id can be
 * missing from it (BluesMinds answered "No available channel for model z-ai/glm4.7 under group default") or hang
 * (openai/gpt-oss-20b held the request for 60 s). This reads the provider's OWN list for the key, keeps chat models,
 * ranks them, and hands the caller an ordered shortlist to try one after another — the Router One catalog idea for a
 * gateway that publishes no prices. The list is cached per key for ten minutes; nothing is invented when it cannot be
 * read (the configured model is the only candidate then).
 */
import { createHash } from 'node:crypto';
import { fetchProviderModelIds } from './testChatBotOfficial';

/** Not chat: image, audio, video, embedding, moderation and rerank models. */
const NON_CHAT = /(embed|whisper|tts|speech|audio|transcri|image|dall-?e|imagen|vision-only|moderation|rerank|ocr|video|sora|veo|flux|stable-diffusion|sdxl|midjourney|kling|suno)/i;
/** Families that answer ordinary chat well, earliest first. Unmatched chat models follow, alphabetically. */
const PREFERRED: readonly RegExp[] = [/gpt-oss/i, /deepseek/i, /qwen/i, /glm/i, /kimi/i, /llama/i, /gemini.*flash/i, /gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini/i, /mistral|mixtral/i, /gemma/i];

export function rankChatModels(ids: readonly string[], configured?: string | null): string[] {
  const chat = [...new Set(ids)].filter(id => !NON_CHAT.test(id));
  const score = (id: string) => { const i = PREFERRED.findIndex(rx => rx.test(id)); return i === -1 ? PREFERRED.length : i; };
  const ranked = chat.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
  return configured && ranked.includes(configured) ? [configured, ...ranked.filter(id => id !== configured)] : ranked;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; ids: string[] }>();

/**
 * The ordered models to try for this key: the provider's own chat models, ranked, capped at `max`. When the list cannot
 * be read or is empty, the configured model alone — an honest fallback, never a guessed id.
 */
export async function pickProviderModels(baseURL: string, apiKey: string, configured: string | null, max = 3,
  fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<{ models: string[]; source: 'provider-list' | 'configured-only'; note?: string }> {
  const slot = createHash('sha256').update(`${baseURL}|${apiKey}`).digest('hex');
  let ids = cache.get(slot);
  if (!ids || now() - ids.at > TTL_MS) {
    const listed = await fetchProviderModelIds(baseURL, apiKey, fetchImpl);
    if (listed.ok && listed.ids.length) { ids = { at: now(), ids: listed.ids }; cache.set(slot, ids); if (cache.size > 64) cache.delete(cache.keys().next().value!); }
    else return { models: configured ? [configured] : [], source: 'configured-only', note: listed.ok ? 'the provider listed no models' : `model list ${listed.reason}` };
  }
  const ranked = rankChatModels(ids.ids, configured).slice(0, Math.max(1, max));
  return ranked.length ? { models: ranked, source: 'provider-list' } : { models: configured ? [configured] : [], source: 'configured-only', note: 'no chat models listed' };
}

/** TEST ONLY. */
export function __resetProviderModelCache(): void { cache.clear(); }
