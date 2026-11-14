// EVERY MODEL CALL PASSES ONE DOOR THAT HIDES EMBEDDED MEDIA (single-file game autopsy, 2026-11-14; closes Q-2666).
//
// `AgentRunner` already hides base64 media from the builder's request and tool results. But the fast lane, the one-shot builder, the
// judges and the surplus runners build their own prompts, so a page with a video inside it, pasted into one of THEM, still reached a
// model whole. The one place every lane's request meets a provider is the LEAF runner — the class that actually calls Claude,
// OpenAI-compatible, Gemini or a surplus model — so the elision lives there, four call sites, and a census test names every leaf.
//
// Text only: a vision block (`image`, `image_url`, `input_image`) is a picture the user meant the model to see and is never touched.
// PURE; returns the SAME object when nothing was hidden; never throws.
import { elideEmbeddedMedia } from '../../lib/embeddedMedia';

const VISION_BLOCK = new Set(['image', 'image_url', 'input_image', 'input_audio', 'audio', 'file']);

function elideValue(value: unknown, depth: number): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const r = elideEmbeddedMedia(value);
    return r.elided > 0 ? { value: r.text, changed: true } : { value, changed: false };
  }
  if (depth > 8 || value === null || typeof value !== 'object') return { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => { const r = elideValue(v, depth + 1); changed ||= r.changed; return r.value; });
    return changed ? { value: out, changed } : { value, changed };
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.type === 'string' && VISION_BLOCK.has(obj.type)) return { value, changed: false };
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) { const r = elideValue(v, depth + 1); changed ||= r.changed; out[k] = r.value; }
  return changed ? { value: out, changed } : { value, changed };
}

/** The request a model is sent, with embedded media replaced by short placeholders. */
export function elideTurnParams<P extends { messages?: unknown[]; system?: unknown }>(params: P): P {
  try {
    const messages = elideValue(params.messages, 0);
    const system = elideValue(params.system, 0);
    if (!messages.changed && !system.changed) return params;
    return { ...params, ...(messages.changed ? { messages: messages.value } : {}), ...(system.changed ? { system: system.value } : {}) } as P;
  } catch {
    return params; // a guard that fails sends the request as it was, never blocks a build
  }
}
