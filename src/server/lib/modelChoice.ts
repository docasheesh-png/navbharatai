/**
 * ONE WAY TO CHOOSE A MODEL, FOR EVERY GATEWAY (admin 2026-11-18, verbatim: "jitne bhi provider hai, sabhi me module
 * chunne ka ek same tarika bana do … top 10 strong module family chuno, usme se sabse sasta ho usko call ki jaye.
 * choose karne se pahle: kaam accha ho, jo user ki request ke anusar perform accha kare (text ke liye jo best ho, coding
 * request ke liye jo coding acchi kare); sasta ho, admin ka load kam se kam ho").
 *
 * Before this, every gateway chose its own way: Router One by price alone, Qubax by its catalogue, Moyi by its price
 * list, BluesMinds and DiscountedTokens by name only. A cheap weak model could win on one gateway and a strong dear one
 * on another, for the same request. This is the one rule they all ask now — in this order, every time:
 *
 *   1. FIT FOR THE REQUEST. A coding request (every builder turn) draws from the ten strongest CODING families and needs
 *      tool calling; a text request (chat) draws from the ten strongest TEXT families. Image, audio, embedding and
 *      moderation models are never candidates.
 *   2. STRONG. Only those ten families — a model outside them is chosen only when a gateway offers no strong one at all
 *      (never-empty: the gateway's own order then stands, so no build loses its engine to this rule).
 *   3. CHEAPEST. Among the strong, fitting models, the lowest blended price first — weighted for the work: a builder turn
 *      is input-heavy (the whole project goes in, a diff comes out), a chat turn is answer-heavy. A model whose price the
 *      gateway does not publish comes AFTER every priced one (an unknown cost is never "cheapest"), ordered by strength.
 *
 * The tier guard is applied here too: a Weak (noClaude) build never receives Sonnet or Opus, whichever gateway serves it.
 * The family table is one list, in one place, so a model that changes rank changes everywhere at once. PURE.
 */

export type ModelPurpose = 'coding' | 'text';

export interface ModelCandidate {
  id: string;
  /** USD per 1M input tokens, when the gateway publishes it. */
  inputPerMTok?: number;
  /** USD per 1M output tokens, when the gateway publishes it. */
  outputPerMTok?: number;
  /** false = the gateway says this model cannot call tools. undefined = not stated. */
  tools?: boolean;
}

export interface StrongFamily { name: string; match: RegExp }

/** Image, audio, video, embedding, moderation, rerank and OCR models — never a chat or coding candidate. */
export const NON_CHAT_MODEL = /(embed|whisper|tts|speech|audio|transcri|image|dall-?e|imagen|vision-only|moderation|rerank|ocr|video|sora|veo|flux|stable-diffusion|sdxl|midjourney|kling|suno)/i;

/** The ten strongest families for writing and repairing code with tools, strongest first. */
export const CODING_FAMILIES: readonly StrongFamily[] = Object.freeze([
  { name: 'claude', match: /claude|sonnet|opus/i },
  { name: 'gpt-5/6 & codex', match: /\b(?:gpt-[56](?:[.\-]\w+)*|codex[\w.-]*|o[34](?:-[\w.]+)?)\b/i },
  { name: 'gemini pro', match: /gemini[\w.-]*pro/i },
  { name: 'kimi', match: /kimi/i },
  { name: 'glm 4.5+ / 5', match: /glm[-_.]?(?:5|4\.[5-9])/i },
  { name: 'deepseek', match: /deepseek/i },
  { name: 'qwen coder / qwen3', match: /qwen[\w.-]*(?:coder|qwen3|235b|480b|max)|qwen3/i },
  { name: 'grok', match: /grok/i },
  { name: 'minimax', match: /minimax/i },
  { name: 'gpt-oss', match: /gpt-oss/i },
]);

/** The ten strongest families for answering in natural language, strongest first. */
export const TEXT_FAMILIES: readonly StrongFamily[] = Object.freeze([
  { name: 'claude', match: /claude|sonnet|opus|haiku/i },
  { name: 'gpt', match: /\b(?:gpt-[456](?:[.\-]\w+)*|chatgpt[\w.-]*|o[34](?:-[\w.]+)?)\b/i },
  { name: 'gemini', match: /gemini/i },
  { name: 'deepseek', match: /deepseek/i },
  { name: 'qwen', match: /qwen/i },
  { name: 'kimi', match: /kimi/i },
  { name: 'glm', match: /glm/i },
  { name: 'grok', match: /grok/i },
  { name: 'llama 3.3 70b+ / 4', match: /llama[-_.]?(?:4|3\.3[\w.-]*70b|3\.1[\w.-]*405b)/i },
  { name: 'mistral large / medium', match: /mistral[\w.-]*(?:large|medium)|magistral/i },
]);

function familiesFor(purpose: ModelPurpose): readonly StrongFamily[] {
  return purpose === 'coding' ? CODING_FAMILIES : TEXT_FAMILIES;
}

/** The strength rank (0 = strongest) of a model's family for this purpose, or -1 when it is not a strong family. PURE. */
export function familyRank(id: string, purpose: ModelPurpose): number {
  const name = String(id ?? '');
  if (!name || NON_CHAT_MODEL.test(name)) return -1;
  // gpt-oss is an open-weight family of its own; it must not be counted as gpt-5/6.
  const families = familiesFor(purpose);
  if (/gpt-oss/i.test(name)) return families.findIndex((f) => f.name === 'gpt-oss');
  return families.findIndex((f) => f.match.test(name));
}

/** Sonnet and Opus — never on a Weak (noClaude) build. Haiku is Weak's own Claude rung and stays allowed. */
const WEAK_FORBIDDEN = /sonnet|opus|claude-(?:3-)?(?:5|4|3-7|3-5)(?!.*haiku)/i;

function priced(c: ModelCandidate): boolean {
  return Number.isFinite(c.inputPerMTok) && Number.isFinite(c.outputPerMTok) && (c.inputPerMTok! > 0 || c.outputPerMTok! > 0);
}

/** Blended price for this kind of work: a builder turn ≈ 3:1 input to output, a chat turn ≈ 1:3. PURE. */
export function blendedPrice(c: ModelCandidate, purpose: ModelPurpose): number {
  if (!priced(c)) return Number.POSITIVE_INFINITY;
  return purpose === 'coding' ? 0.75 * c.inputPerMTok! + 0.25 * c.outputPerMTok! : 0.25 * c.inputPerMTok! + 0.75 * c.outputPerMTok!;
}

export interface ModelChoice {
  /** The models to try, in order. Never empty when any usable candidate was offered. */
  models: string[];
  /** 'strong' — every model is from a strong family; 'fallback' — the gateway offered none, its own order stands. */
  basis: 'strong' | 'fallback' | 'none';
}

export function modelChoiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0|no)$/i.test(String(env.MODEL_CHOICE ?? '').trim());
}

/**
 * THE RULE. Fit and strong first, then cheapest, at most `max`. A gateway that offers no strong, fitting model keeps its
 * own order (never-empty), so this can narrow a choice but never take an engine away. PURE.
 */
export function chooseModels(
  candidates: readonly ModelCandidate[],
  opts: { purpose: ModelPurpose; max?: number; noClaude?: boolean; env?: NodeJS.ProcessEnv },
): ModelChoice {
  const max = Math.max(1, opts.max ?? 3);
  const seen = new Set<string>();
  const usable = candidates.filter((c) => {
    const id = String(c?.id ?? '').trim();
    if (!id || seen.has(id) || NON_CHAT_MODEL.test(id)) return false;
    if (opts.noClaude && WEAK_FORBIDDEN.test(id)) return false;
    seen.add(id);
    return true;
  });
  if (usable.length === 0) return { models: [], basis: 'none' };
  if (!modelChoiceEnabled(opts.env)) return { models: usable.slice(0, max).map((c) => c.id), basis: 'fallback' };
  const strong = usable
    .map((c) => ({ c, rank: familyRank(c.id, opts.purpose) }))
    .filter(({ c, rank }) => rank >= 0 && !(opts.purpose === 'coding' && c.tools === false));
  if (strong.length === 0) return { models: usable.slice(0, max).map((c) => c.id), basis: 'fallback' };
  strong.sort((a, b) => {
    const pa = blendedPrice(a.c, opts.purpose), pb = blendedPrice(b.c, opts.purpose);
    if (pa !== pb) return pa - pb;          // cheapest first; every unpriced model (∞) after every priced one
    return a.rank - b.rank || a.c.id.localeCompare(b.c.id); // then the stronger family
  });
  return { models: strong.slice(0, max).map(({ c }) => c.id), basis: 'strong' };
}
