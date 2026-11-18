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
import { chooseModels, NON_CHAT_MODEL, type ModelPurpose } from './modelChoice';
import { createHash } from 'node:crypto';
import { fetchProviderModelIds } from './testChatBotOfficial';
import { BoundedCache } from './boundedCache';

/**
 * The key's own models, in the order the SHARED RULE gives (modelChoice.ts, admin 2026-11-18): strong families for the
 * purpose first (none of these lists carry prices, so by strength), then every other chat model alphabetically, so a key
 * with no strong model still has something to try. A configured model the list contains always leads.
 */
export function rankChatModels(ids: readonly string[], configured?: string | null, purpose: ModelPurpose = 'text'): string[] {
  const chat = [...new Set(ids)].filter(id => !NON_CHAT_MODEL.test(id)).sort((a, b) => a.localeCompare(b));
  const choice = chooseModels(chat.map(id => ({ id })), { purpose, max: chat.length });
  const lead = choice.basis === 'strong' ? choice.models : [];
  const ranked = [...lead, ...chat.filter(id => !lead.includes(id))];
  return configured && ranked.includes(configured) ? [configured, ...ranked.filter(id => id !== configured)] : ranked;
}

const TTL_MS = 10 * 60_000;
/** One entry per provider key, ten minutes each; bounded so it cannot grow with traffic (tests/boundedCaches.test.ts). */
const cache = new BoundedCache<string, string[]>({ maxEntries: 64, ttlMs: TTL_MS });

/**
 * The ordered models to try for this key: the provider's own chat models, ranked, capped at `max`. When the list cannot
 * be read or is empty, the configured model alone — an honest fallback, never a guessed id.
 */
export async function pickProviderModels(baseURL: string, apiKey: string, configured: string | null, max = 3,
  fetchImpl: typeof fetch = fetch, now: () => number = Date.now, purpose: ModelPurpose = 'text'): Promise<{ models: string[]; source: 'provider-list' | 'configured-only'; note?: string }> {
  const slot = createHash('sha256').update(`${baseURL}|${apiKey}`).digest('hex');
  let ids = cache.get(slot, now());
  if (!ids) {
    const listed = await fetchProviderModelIds(baseURL, apiKey, fetchImpl);
    if (!listed.ok || !listed.ids.length) {
      return { models: configured ? [configured] : [], source: 'configured-only', note: listed.ok ? 'the provider listed no models' : `model list ${listed.reason}` };
    }
    ids = listed.ids;
    cache.set(slot, ids, now());
  }
  const ranked = rankChatModels(ids, configured, purpose).slice(0, Math.max(1, max));
  return ranked.length ? { models: ranked, source: 'provider-list' } : { models: configured ? [configured] : [], source: 'configured-only', note: 'no chat models listed' };
}

/** TEST ONLY. */
export function __resetProviderModelCache(): void { cache.clear(); }

/**
 * The ranked models already cached for this key, synchronously, and a background refresh when there are none —
 * for a caller that must build its chain without waiting (a builder rung). Never throws; [] when nothing is known.
 */
export function cachedProviderModels(baseURL: string, apiKey: string, max = 3, fetchImpl: typeof fetch = fetch, now: () => number = Date.now, purpose: ModelPurpose = 'coding'): string[] {
  try {
    const slot = createHash('sha256').update(`${baseURL}|${apiKey}`).digest('hex');
    const ids = cache.get(slot, now());
    if (ids) return rankChatModels(ids, null, purpose).slice(0, Math.max(1, max));
    void pickProviderModels(baseURL, apiKey, null, max, fetchImpl, now, purpose).catch(() => {});
  } catch { /* a cache that cannot be read is an empty one */ }
  return [];
}

