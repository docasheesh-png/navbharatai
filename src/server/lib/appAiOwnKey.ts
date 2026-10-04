// AN APP'S AI ON THE OWNER'S OWN KEY — server-side, never in the browser (admin 2026-10-04).
//
// Admin, verbatim: "user apni api keys jab chahe use kar sakta hai … navbharatai api browser me na jaye,
// miss use ho sakti hai". So the app's code does not change at all when the owner switches engines: the
// page still calls `window.NavAI.ask(...)`, our gateway still receives it, and only the SERVER decides
// whose key answers. When the owner has saved `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in Keys & Secrets
// (for this app, or shared), that key answers and nothing is charged to their NavBharatAI wallet. The key
// is read from the encrypted vault on our server and is never written into the page, the bundle, or any
// response.
//
// 🔒 A KEY THAT IS REFUSED IS NOT SILENTLY REPLACED BY OURS. If the owner chose their own key and it fails
// (revoked, out of credit), the answer is an honest failure — quietly falling back to NavBharatAI's engine
// would spend the owner's wallet behind a choice they made not to.

import { loadUserVaultSecrets } from './secrets';

export type OwnKeyProvider = 'openai' | 'anthropic';

export interface OwnKey {
  provider: OwnKeyProvider;
  key: string;
  model: string;
}

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';
const CALL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;

/** Pick the owner's key from their vault secrets. OpenAI first when both exist. Pure. */
export function ownKeyFromSecrets(secrets: Readonly<Record<string, string>> | null | undefined): OwnKey | null {
  if (!secrets) return null;
  const openai = String(secrets.OPENAI_API_KEY ?? '').trim();
  if (openai.length >= 20) {
    return { provider: 'openai', key: openai, model: String(secrets.OPENAI_MODEL ?? '').trim() || DEFAULT_OPENAI_MODEL };
  }
  const anthropic = String(secrets.ANTHROPIC_API_KEY ?? '').trim();
  if (anthropic.length >= 20) {
    return { provider: 'anthropic', key: anthropic, model: String(secrets.ANTHROPIC_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL };
  }
  return null;
}

const cache = new Map<string, { key: OwnKey | null; at: number }>();
const CACHE_MS = 60_000;

/** The owner's own key for this app, if any. A vault read at most once a minute per app. Never throws. */
export async function ownKeyFor(userId: string, workspaceId: string): Promise<OwnKey | null> {
  if (!userId) return null;
  const k = `${userId}::${workspaceId}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.key;
  let key: OwnKey | null = null;
  try { key = ownKeyFromSecrets(await loadUserVaultSecrets(userId, workspaceId)); } catch { key = null; }
  cache.set(k, { key, at: Date.now() });
  return key;
}

/** Forget a cached key (after the owner saves or deletes one). */
export function forgetOwnKey(userId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${userId}::`)) cache.delete(k);
}

export type OwnKeyAnswer = { ok: true; text: string } | { ok: false; reason: 'refused' | 'failed' };

/** Ask with the owner's key. `fetchImpl` is a test seam. Never throws. */
export async function askWithOwnKey(
  own: OwnKey,
  system: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnKeyAnswer> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CALL_TIMEOUT_MS);
  try {
    if (own.provider === 'openai') {
      const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${own.key}` },
        body: JSON.stringify({ model: own.model, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) return { ok: false, reason: 'refused' };
      if (!res.ok) return { ok: false, reason: 'failed' };
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = j?.choices?.[0]?.message?.content;
      return typeof text === 'string' && text.trim() ? { ok: true, text } : { ok: false, reason: 'failed' };
    }
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': own.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: own.model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) return { ok: false, reason: 'refused' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    const j = (await res.json()) as { content?: Array<{ type?: string; text?: unknown }> };
    const text = (j?.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
    return text.trim() ? { ok: true, text } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
