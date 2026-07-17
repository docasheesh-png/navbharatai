// Gemini embedding client for semantic memory (admin 2026-07-17).
//
// The existing EmbeddingSearch uses OpenAI (OPENAI_API_KEY), which is ABSENT in prod — so that path is
// dormant. This client uses GEMINI_API_KEY (present in prod, already powering vision + a fallback model)
// via @google/genai's models.embedContent, so RAG memory actually runs on real infrastructure.
//
// Best-effort by construction: no key, an SDK failure, or a malformed response → returns null (the
// caller then simply skips memory for that turn). It NEVER throws, so a chat is never broken by it.

import { memoryEmbedModel } from './semanticMemory';

function apiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ''
  ).trim();
}

/** True when embeddings can actually be produced (a key is configured). Cheap, synchronous. */
export function embeddingsAvailable(): boolean {
  return apiKey().length > 0;
}

let _client: any = null;
async function getClient(): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  if (_client) return _client;
  try {
    const mod: any = await import('@google/genai');
    const GoogleGenAI = mod.GoogleGenAI ?? mod.default?.GoogleGenAI ?? mod.default;
    if (!GoogleGenAI) return null;
    _client = new GoogleGenAI({ apiKey: key });
    return _client;
  } catch {
    return null;
  }
}

/** Pull the first embedding vector out of the SDK's response shape. Defensive across minor shape drift. */
function extractVector(res: any): number[] | null {
  const values =
    res?.embeddings?.[0]?.values ??
    res?.embedding?.values ??
    (Array.isArray(res?.embeddings?.[0]) ? res.embeddings[0] : undefined);
  if (Array.isArray(values) && values.length > 0 && values.every((n: unknown) => typeof n === 'number')) {
    return values as number[];
  }
  return null;
}

/**
 * Embed one text → its vector, or null on any failure (no key, SDK error, empty text, bad response).
 * Bounded by a hard timeout so a slow embedding call can never delay a chat reply for long.
 */
export async function embedText(text: string, timeoutMs = 6000): Promise<number[] | null> {
  const t = (text || '').trim();
  if (!t) return null;
  const client = await getClient();
  if (!client) return null;
  try {
    const call = client.models.embedContent({ model: memoryEmbedModel(), contents: t });
    const res = await withTimeout(call, timeoutMs);
    return extractVector(res);
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('embed-timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
