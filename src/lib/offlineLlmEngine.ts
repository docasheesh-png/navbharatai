// On-device LLM engine wrapper for "Offline Thinking (beta)" (Stage-1 roadmap, PR-3). Thin adapter over
// @mlc-ai/web-llm, which runs a small quantized model on the device via WebGPU. HONEST/SAFE by design:
// - web-llm is loaded via a DYNAMIC import — it is NEVER in the main bundle, only fetched when the user
//   explicitly turns the beta on, so the app (and the deterministic Offline chat) are untouched otherwise.
// - The model (~hundreds of MB) is downloaded once from the MLC/HuggingFace CDN and CACHED on-device by
//   web-llm itself (re-open = no re-download). Real progress is surfaced; failures are surfaced honestly.
// - This is EXPERIMENTAL: a tiny on-device model CAN be wrong. Callers must route facts to the
//   deterministic engine and only use this for open-ended text, with a "can be wrong" label.
//
// The real WebGPU generation path cannot run in CI (no GPU), so the control flow here is kept thin and is
// unit-tested via an injectable `factory`; correctness of the actual model run is verified on a real
// device. Nothing here fakes a result — if the engine can't load or generate, it throws and the UI says so.

import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm';

/** Default Stage-1 model: a ~0.5B instruct model, q4f32 for the widest WebGPU compatibility (no
 *  shader-f16 requirement). Overridable so we can tune the exact id after on-device testing. */
export const STAGE1_MODEL = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';

/** Load ladder: try the primary (~0.5B), then fall back to a lighter ~360M model if the primary fails to
 *  initialize on a weaker device (out-of-memory / adapter limits). Both ids are verified present in
 *  web-llm's prebuilt config; all q4f32 for the widest WebGPU compatibility. A single explicit `modelId`
 *  (from opts) overrides the ladder. */
export const STAGE1_MODELS: string[] = [STAGE1_MODEL, 'SmolLM2-360M-Instruct-q4f32_1-MLC'];

export interface LlmProgress {
  /** 0..1 download/load progress. */
  progress: number;
  /** Human-readable status from web-llm (e.g. "Fetching param shard 3/12"). */
  text: string;
}
export type ProgressCb = (p: LlmProgress) => void;

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OfflineLlm {
  /** Generate a reply for a message list. Non-streaming: resolves with the full text. */
  generate(messages: ChatTurn[]): Promise<string>;
  /** Free GPU/memory and drop the cached engine. */
  unload(): Promise<void>;
}

/** Factory that produces a raw web-llm engine — injectable so the wrapper is unit-testable without WebGPU. */
export type EngineFactory = (modelId: string, onProgress: (r: InitProgressReport) => void) => Promise<MLCEngineInterface>;

/** The real factory: dynamically import web-llm (lazy chunk) and create the engine. */
const defaultFactory: EngineFactory = async (modelId, onProgress) => {
  const webllm = await import('@mlc-ai/web-llm');
  return webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
};

let cached: Promise<OfflineLlm> | null = null;

/**
 * Load (or reuse) the on-device LLM. First call downloads + initializes the model (progress streamed to
 * `onProgress`); later calls reuse the same engine. Throws on any failure — never returns a fake engine.
 */
function wrapEngine(engine: MLCEngineInterface): OfflineLlm {
  return {
    async generate(messages: ChatTurn[]): Promise<string> {
      const reply = await engine.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 512,
      });
      return reply.choices?.[0]?.message?.content ?? '';
    },
    async unload(): Promise<void> {
      try { await engine.unload?.(); } catch { /* best-effort */ }
      cached = null;
    },
  };
}

export function loadOfflineLlm(opts: { modelId?: string; onProgress?: ProgressCb; factory?: EngineFactory } = {}): Promise<OfflineLlm> {
  if (cached) return cached;
  // An explicit modelId is used alone; otherwise walk the fallback ladder (primary → lighter model).
  const candidates = opts.modelId ? [opts.modelId] : STAGE1_MODELS;
  const factory = opts.factory ?? defaultFactory;

  cached = (async (): Promise<OfflineLlm> => {
    let lastErr: unknown;
    for (const id of candidates) {
      try {
        const engine = await factory(id, (r) => opts.onProgress?.({ progress: r.progress ?? 0, text: r.text ?? '' }));
        return wrapEngine(engine);
      } catch (err) {
        lastErr = err; // this model couldn't init on this device — try the next lighter one
      }
    }
    throw lastErr ?? new Error('No on-device model could be loaded');
  })();

  // If every candidate fails, clear the cache so the user can retry.
  cached.catch(() => { cached = null; });
  return cached;
}

/** Drop any cached engine (used on disable/reset). */
export function resetOfflineLlm(): void {
  cached = null;
}
