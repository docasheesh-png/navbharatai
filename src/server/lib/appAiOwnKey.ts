import { strictFreeRequired } from '../AI/inferencePolicy';
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
// SINCE 2026-11-25 THERE IS A THIRD, FREE ONE: `ZAI_API_KEY`, set up from the ❗ tray in three guided
// steps (appFreeAi.ts, freeAiSetup.ts). Same shape as the two above — the owner's own account, read on
// our server, never in the page — with one difference that matters: the models it may use are an
// ALLOWLIST of the three Z.ai prints as free, so an app set up through a button that said "free" can
// never spend the owner's own balance on a paid model.
//
// 🔒 A KEY THAT IS REFUSED IS NOT SILENTLY REPLACED BY OURS. If the owner chose their own key and it fails
// (revoked, out of credit), the answer is an honest failure — quietly falling back to NavBharatAI's engine
// would spend the owner's wallet behind a choice they made not to.

import { BoundedCache } from './boundedCache';
import { loadUserVaultSecrets } from './secrets';
import {
  FREE_AI_ENDPOINT, FREE_AI_KEY_NAME, FREE_AI_MODELS, freeAiKeyLooksUsable, freeAiTextLadder, isFreeAiBusy, isFreeAiModel,
} from './appFreeAi';

/**
 * `zai` is the FREE one (appFreeAi.ts, admin 2026-11-25): the owner's own Z.ai account on the three
 * models Z.ai prints as Free, set up from the ❗ tray. The other two are paid accounts the owner typed
 * into Keys & Secrets themselves.
 */
export type OwnKeyProvider = 'openai' | 'anthropic' | 'zai';

export interface OwnKey {
  provider: OwnKeyProvider;
  key: string;
  model: string;
}

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';
const CALL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;

/**
 * Pick the owner's key from their vault secrets.
 *
 * 🔒 THE FREE KEY WINS, AND THAT IS DELIBERATE (admin 2026-11-25). An owner who has set up the free
 * AI from the ❗ tray asked for an app that costs nothing to answer; sending their questions to a paid
 * account they saved months ago would spend real money behind a button that said "free". The Keys &
 * Secrets card says plainly which key is answering and deleting it goes back to the other one, so the
 * choice stays theirs — but the default can never be the one that charges them. PURE.
 */
export function ownKeyFromSecrets(secrets: Readonly<Record<string, string>> | null | undefined): OwnKey | null {
  if (!secrets) return null;
  const free = String(secrets[FREE_AI_KEY_NAME] ?? '').trim();
  if (freeAiKeyLooksUsable(free)) return { provider: 'zai', key: free, model: freeAiTextLadder()[0] ?? FREE_AI_MODELS.chat };
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

const CACHE_MS = 60_000;
/**
 * Bounded (audit 2026-10-11): one entry per app ever asked used to stay for the life of the instance, holding
 * the owner's decrypted key. Now an entry leaves after a minute or at the bound. `forgetOwnKey` records WHEN a
 * user's keys changed instead of walking every entry: an entry older than that moment is a miss.
 */
const cache = new BoundedCache<string, { key: OwnKey | null; at: number }>({ maxEntries: 5_000, ttlMs: CACHE_MS });
const forgottenAt = new BoundedCache<string, number>({ maxEntries: 20_000, ttlMs: CACHE_MS });

/** The owner's own key for this app, if any. A vault read at most once a minute per app. Never throws. */
export async function ownKeyFor(userId: string, workspaceId: string): Promise<OwnKey | null> {
  if (!userId) return null;
  const k = `${userId}::${workspaceId}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS && hit.at > (forgottenAt.get(userId) ?? -1)) return hit.key;
  let key: OwnKey | null = null;
  try { key = ownKeyFromSecrets(await loadUserVaultSecrets(userId, workspaceId)); } catch { key = null; }
  cache.set(k, { key, at: Date.now() });
  return key;
}

/** Forget a cached key (after the owner saves or deletes one). */
export function forgetOwnKey(userId: string): void {
  forgottenAt.set(userId, Date.now());
}

/** `busy` is the free tier's rate limit: the same question works a moment later, so it is said as such. */
export type OwnKeyAnswer = { ok: true; text: string } | { ok: false; reason: 'refused' | 'failed' | 'busy' };

/**
 * THE FREE LADDER (admin 2026-11-25: *"agar 4.7 busy ho ya limit lag jaye, to apne aap isse jawab aaye"*).
 *
 * The default model, then the second free model when the first is busy or rate-limited — the user never
 * picks one and never sees one named. Only ids on `appFreeAi.ts`'s allowlist are sent, so this can never
 * spend the owner's own Z.ai balance on a paid model. Both rungs busy is reported as `busy`, never as a
 * failure, because "wait a moment and ask again" is the true and useful thing to say.
 *
 * `fetchImpl` is a test seam. Never throws.
 */
export async function askFreeAi(
  key: string,
  system: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
  models: readonly string[] = freeAiTextLadder(),
): Promise<OwnKeyAnswer> {
  const ladder = models.filter(isFreeAiModel);
  if (ladder.length === 0) return { ok: false, reason: 'failed' };
  let lastBusy = false;
  for (const model of ladder) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetchImpl(FREE_AI_ENDPOINT, {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        }),
      });
      // ONE read of the body, because Z.ai answers some limits with a 200 and an error code in the
      // body — a check that only looked at `res.status` would call that a broken reply.
      const body = (await res.json().catch(() => null)) as
        { choices?: Array<{ message?: { content?: unknown } }>; error?: { code?: unknown } } | null;
      if (isFreeAiBusy(res.status, body)) { lastBusy = true; continue; } // the next free model
      // 401/403 is the key itself: no other model on the same key can answer, so stop here.
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'refused' };
      if (!res.ok) return { ok: false, reason: 'failed' };
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) return { ok: true, text };
      return { ok: false, reason: 'failed' };
    } catch {
      return { ok: false, reason: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: lastBusy ? 'busy' : 'failed' };
}

/** Ask with the owner's key. `fetchImpl` is a test seam. Never throws. */
export async function askWithOwnKey(
  own: OwnKey,
  system: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnKeyAnswer> {
  if (strictFreeRequired()) return { ok: false, reason: 'refused' }; // An owner key does not establish zero cost.
  if (own.provider === 'zai') return askFreeAi(own.key, system, prompt, fetchImpl);
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
