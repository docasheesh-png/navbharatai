// Embedding client for semantic memory (admin 2026-07-17).
//
// Two backends, same @google/genai SDK, chosen by config:
//   • VERTEX AI (preferred) — auth via ADC (the Cloud Run service account), billed to the project's
//     Vertex credit. No API key needed. This is the default when GOOGLE_CLOUD_PROJECT is set, so the
//     admin's Vertex credit funds embeddings (admin 2026-07-17: "gemini ki jagah vertex use karo — 95k
//     Vertex credit hai"). Same auth the existing VertexProvider already uses in prod.
//   • GEMINI API (fallback) — auth via GEMINI_API_KEY (generativelanguage endpoint).
//
// Override with SEMANTIC_MEMORY_PROVIDER = 'vertex' | 'gemini'. Best-effort by construction: no usable
// backend, an SDK failure, or a malformed response → returns null (the caller skips memory for that
// turn). It NEVER throws, so a chat is never broken by it.

import { memoryEmbedModel } from './semanticMemory';

type Backend = 'vertex' | 'gemini';

function vertexProject(): string {
  return (process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '').trim();
}
function vertexLocation(): string {
  return (process.env.SEMANTIC_MEMORY_VERTEX_LOCATION || process.env.GOOGLE_CLOUD_REGION || 'us-central1').trim() || 'us-central1';
}
function geminiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ''
  ).trim();
}

/**
 * Which embedding backend to use. Explicit SEMANTIC_MEMORY_PROVIDER wins (when that backend is
 * configured). Otherwise prefer Vertex when a project is set (uses the Vertex credit via ADC), else
 * fall back to the Gemini API key. Returns null when neither is configured. Pure over env.
 */
export function selectBackend(): Backend | null {
  const forced = (process.env.SEMANTIC_MEMORY_PROVIDER || '').trim().toLowerCase();
  if (forced === 'vertex' && vertexProject()) return 'vertex';
  if (forced === 'gemini' && geminiKey()) return 'gemini';
  if (vertexProject()) return 'vertex'; // default: spend the Vertex credit
  if (geminiKey()) return 'gemini';
  return null;
}

/** True when embeddings can actually be produced (some backend is configured). Cheap, synchronous. */
export function embeddingsAvailable(): boolean {
  return selectBackend() !== null;
}

let _client: any = null;
let _clientBackend: Backend | null = null;
async function getClient(): Promise<any> {
  const backend = selectBackend();
  if (!backend) return null;
  if (_client && _clientBackend === backend) return _client;
  try {
    const mod: any = await import('@google/genai');
    const GoogleGenAI = mod.GoogleGenAI ?? mod.default?.GoogleGenAI ?? mod.default;
    if (!GoogleGenAI) return null;
    _client =
      backend === 'vertex'
        ? new GoogleGenAI({ vertexai: true, project: vertexProject(), location: vertexLocation() })
        : new GoogleGenAI({ apiKey: geminiKey() });
    _clientBackend = backend;
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
 * Embed one text → its vector, or null on any failure (no backend, SDK error, empty text, bad
 * response). Bounded by a hard timeout so a slow embedding call can never delay a chat reply for long.
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
