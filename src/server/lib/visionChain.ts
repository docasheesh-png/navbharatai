// Vision chain — reads images + PDFs for the chat handler across ALL provider
// universes, honestly and with correct isolation.
//
// WHY THIS EXISTS (root-cause fix): the old inline vision path in chat.ts only
// supported an API-key Gemini client (`GoogleGenAI({ apiKey })`) and fell back to
// the literal bogus string `apiKey: 'vertex'`. On NavBharatAI's real deployment the
// Free universe authenticates to Google through **Vertex service-account** creds
// (GOOGLE_CLOUD_PROJECT), NOT a standalone GEMINI_API_KEY — so images and PDFs
// silently failed in Free chat even though text worked. It also fell back to Claude
// for EVERY tier, violating the absolute rule that the Free universe never uses
// Claude (and leaking NavBharatAI's Anthropic credits to free users).
//
// This module fixes both: it tries a REAL Vertex vision call first (matching the
// working VertexProvider auth), then API-key Gemini, then Grok (images only), and
// only reaches Claude when the caller's universe explicitly allows it (never Free).
// Every provider is best-effort with a hard timeout; the chain returns the first
// non-empty reply, or null when every allowed provider failed (caller shows an
// honest message — never a fake result).

export interface VisionAttachment {
  name: string;
  type: string;   // MIME, e.g. image/png, application/pdf
  base64: string; // raw base64, no data: prefix
}

export interface VisionResult {
  text: string;
  provider: 'VERTEX' | 'GEMINI' | 'GROK' | 'CLAUDE';
}

export interface VisionOptions {
  /** The composed user prompt (already includes any memory/context prefix). */
  prompt: string;
  /** Optional system instruction. */
  systemPrompt?: string;
  /** Claude is allowed ONLY for non-Free universes (pro/professional). Free = false. */
  allowClaude: boolean;
  /** Hard per-provider timeout in ms (default 28s to stay under proxy limits). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 28_000;

/** Race a promise against a hard timeout so a stuck provider never hangs the chain. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Vertex vision via @google-cloud/vertexai (service-account auth) — the Free universe's primary. */
async function tryVertex(atts: VisionAttachment[], o: VisionOptions): Promise<string | null> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!projectId) return null;
  const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
  const { VertexAI } = await import('@google-cloud/vertexai');
  const vertex = new VertexAI({ project: projectId, location });
  const modelConfig: any = { model: 'gemini-2.0-flash-001' };
  if (o.systemPrompt) modelConfig.systemInstruction = { role: 'system', parts: [{ text: o.systemPrompt }] };
  const model = vertex.getGenerativeModel(modelConfig);
  const parts: any[] = [
    ...atts.map((f) => ({ inlineData: { mimeType: f.type, data: f.base64 } })),
    { text: o.prompt },
  ];
  const result: any = await withTimeout(
    model.generateContent({ contents: [{ role: 'user', parts }] }),
    o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'Vertex vision',
  );
  const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return text || null;
}

/** API-key Gemini via @google/genai (only when a real GEMINI_API_KEY is present). */
async function tryGeminiKey(atts: VisionAttachment[], o: VisionOptions): Promise<string | null> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) return null;
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const parts: any[] = [{ text: o.prompt }, ...atts.map((f) => ({ inlineData: { mimeType: f.type, data: f.base64 } }))];
  const config: any = { thinkingConfig: { thinkingBudget: 0 } };
  if (o.systemPrompt) config.systemInstruction = o.systemPrompt;
  const result: any = await withTimeout(
    ai.models.generateContent({ model: 'gemini-2.0-flash', contents: [{ parts }], config }),
    o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'Gemini vision',
  );
  const text = (result?.text as string | undefined)?.trim();
  return text || null;
}

/** Grok vision (images only — Grok cannot read PDFs). */
async function tryGrok(atts: VisionAttachment[], o: VisionOptions): Promise<string | null> {
  const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const images = atts.filter((f) => f.type.startsWith('image/'));
  if (!key || images.length === 0) return null;
  const OpenAI = (await import('openai')).default;
  const grok = new OpenAI({ apiKey: key, baseURL: 'https://api.x.ai/v1' });
  const content: any[] = [
    ...images.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.type};base64,${f.base64}` } })),
    { type: 'text', text: o.prompt },
  ];
  const messages: any[] = [
    ...(o.systemPrompt ? [{ role: 'system', content: o.systemPrompt }] : []),
    { role: 'user', content },
  ];
  for (const model of ['grok-2-vision-1212', 'grok-2-mini-vision-1212']) {
    try {
      const r: any = await withTimeout(
        grok.chat.completions.create({ model, messages, max_tokens: 1500 }),
        o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        `Grok vision (${model})`,
      );
      const text = r?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      /* try the next Grok model */
    }
  }
  return null;
}

/** Claude vision (images + PDFs). ONLY reachable when allowClaude is true (never Free). */
async function tryClaude(atts: VisionAttachment[], o: VisionOptions): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) return null;
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const claude = new Anthropic({ apiKey: key });
  const content: any[] = [
    ...atts.map((f) => (f.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: f.type, data: f.base64 } })),
    { type: 'text', text: o.prompt },
  ];
  const cr: any = await withTimeout(
    claude.messages.create({
      model: 'claude-3-5-sonnet-20241022', max_tokens: 1500,
      system: o.systemPrompt || undefined,
      messages: [{ role: 'user', content }],
    }),
    o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'Claude vision',
  );
  const text = (cr?.content?.find((c: any) => c.type === 'text') as any)?.text?.trim();
  return text || null;
}

/**
 * The ordered list of vision providers for a universe. Free (allowClaude=false) is
 * Vertex → Gemini(key) → Grok. Non-Free adds Claude last. Vertex leads because it
 * is the Free universe's primary Google auth and reads BOTH images and PDFs.
 */
export function visionProviderOrder(allowClaude: boolean): VisionResult['provider'][] {
  const base: VisionResult['provider'][] = ['VERTEX', 'GEMINI', 'GROK'];
  return allowClaude ? [...base, 'CLAUDE'] : base;
}

/**
 * Try each allowed provider in order and return the first non-empty reply, or null
 * when every allowed provider failed (missing creds or errors). NEVER throws — a
 * provider error is logged and the chain moves on, so one bad key can't kill vision.
 */
export async function runVisionChain(atts: VisionAttachment[], o: VisionOptions): Promise<VisionResult | null> {
  if (!atts || atts.length === 0) return null;
  const runners: Record<VisionResult['provider'], (a: VisionAttachment[], opt: VisionOptions) => Promise<string | null>> = {
    VERTEX: tryVertex,
    GEMINI: tryGeminiKey,
    GROK: tryGrok,
    CLAUDE: tryClaude,
  };
  for (const provider of visionProviderOrder(o.allowClaude)) {
    try {
      const text = await runners[provider](atts, o);
      if (text) return { text, provider };
    } catch (err: any) {
      console.warn(`[VISION_CHAIN] ${provider} failed: ${err?.message || err}`);
    }
  }
  return null;
}
