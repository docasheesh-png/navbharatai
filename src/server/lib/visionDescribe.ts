// Server-side vision description — turns an uploaded image or PDF into TEXT that
// any downstream text model (or the v5.0 build loop) can use, WITHOUT making the
// expensive model read it. Used by Pro v5.0 so file reading stays cheap: the
// cheap providers (Gemini → Grok) describe the file by default, and Claude is
// used ONLY when the caller asks (v5.0 "Power" / Only-Opus mode).
//
// Documents (Word/Excel/PowerPoint/ZIP/text) are handled by attachmentText.ts;
// this module covers the multimodal types (images + PDF) that need a vision model.

import { isVisionAttachment } from './attachmentText';
import { claudeVisionModel, grokVisionModels, geminiVisionModels } from './visionModels';
import { noClaudeZoneActive } from '../AgentV3/noClaudeZone';
import { DESIGN_CONTRACT_INSTRUCTION } from '../AgentV3/designContract';

export interface RawAttachment {
  name: string;
  type: string;
  base64: string;
}

const DESCRIBE_INSTRUCTION =
  'You are reading an uploaded file for a software engineer. Describe it in precise, ' +
  'useful detail: all visible text (verbatim where it matters), UI layout/structure, ' +
  'data/tables, charts, colors, and anything an engineer would need to act on it. ' +
  'Be thorough and factual — do not speculate beyond what is shown.';

const PER_FILE_MAX = 6000;

function clamp(s: string): string {
  return s.length > PER_FILE_MAX ? s.slice(0, PER_FILE_MAX) + '…' : s;
}

/** Describe one image/PDF via Gemini (cheap). Returns '' on any failure. */
async function describeWithGemini(att: RawAttachment, instruction: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  if (!key) return '';
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    for (const m of geminiVisionModels()) {
      try {
        const r = await ai.models.generateContent({
          model: m,
          contents: [{ parts: [{ text: instruction }, { inlineData: { mimeType: att.type, data: att.base64 } }] }],
          config: { thinkingConfig: { thinkingBudget: 0 } } as any,
        });
        const t = (r.text || '').trim();
        if (t) return t;
      } catch { /* try next model */ }
    }
    return '';
  } catch { return ''; }
}

/** Describe one image via Grok vision (cheap fallback; Grok can't read PDFs). */
async function describeWithGrok(att: RawAttachment, instruction: string): Promise<string> {
  if (att.type === 'application/pdf') return '';
  const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
  if (!key) return '';
  try {
    const { default: OpenAI } = await import('openai');
    const c = new OpenAI({ apiKey: key, baseURL: 'https://api.x.ai/v1' });
    for (const m of grokVisionModels()) {
      try {
        const r = await c.chat.completions.create({
          model: m, max_tokens: 1200,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${att.type};base64,${att.base64}` } },
            { type: 'text', text: instruction },
          ] }],
        });
        const t = r.choices[0]?.message?.content?.trim();
        if (t) return t;
      } catch { /* try next model */ }
    }
  } catch { /* fall through */ }
  return '';
}

/** Describe one image/PDF via Claude (used only in Power mode, or as last resort). */
async function describeWithClaude(att: RawAttachment, instruction: string): Promise<string> {
  // UNBREAKABLE weak-module guard (admin absolute rule, 2026-07-13): if a weak/free build is in progress
  // (a no-Claude zone is active), vision must stay on the cheap providers (Gemini/Grok) — never Claude,
  // even as a last resort. This is the raw-SDK sibling of the ClaudeClient chokepoint (rule 3 — hunt the
  // siblings): the routing policy pins free/weak vision to Gemini/Grok. Returns '' so the caller records
  // an honest "could not be read" rather than silently spending NavBharatAI's Claude budget.
  if (noClaudeZoneActive()) return '';
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
  if (!key) return '';
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const claude = new Anthropic({ apiKey: key });
    const block = att.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: att.type, data: att.base64 } };
    const r = await claude.messages.create({
      model: claudeVisionModel(), max_tokens: 1500,
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: instruction }] }],
    });
    return ((r.content.find((c: any) => c.type === 'text') as any)?.text || '').trim();
  } catch { return ''; }
}

export type VisionProvider = 'gemini' | 'grok' | 'claude';

/**
 * The ORDERED provider rungs a vision describe may use — the single source of truth for which
 * models are allowed to read an attachment, per tier. Pure + exported so the invariant is
 * unit-testable:
 *   noClaude (WEAK tier)   → Gemini → Grok. Claude NEVER — this helper calls Anthropic directly
 *                            (outside buildTurnRunner/enforceNoClaude), so the weak tier must
 *                            exclude the Claude rung HERE. Audit 2026-07-13 confirmed the leak:
 *                            a free build with an image + one Gemini failure landed on a real
 *                            Claude vision call. `noClaude` wins over `useClaude` by design.
 *   useClaude (Opus tiers) → Claude → Gemini → Grok (highest-fidelity read first).
 *   default                → Gemini → Grok → Claude (cheap first, Claude last resort).
 */
export function visionProviderChain(opts: { useClaude?: boolean; noClaude?: boolean } = {}): VisionProvider[] {
  if (opts.noClaude) return ['gemini', 'grok'];
  if (opts.useClaude) return ['claude', 'gemini', 'grok'];
  return ['gemini', 'grok', 'claude'];
}

/**
 * Describe all image/PDF attachments as text. The provider order comes from
 * visionProviderChain() (see its doc for the per-tier rules). Never throws;
 * returns '' when nothing could be described.
 */
export async function describeVisionAttachments(
  atts: RawAttachment[],
  opts: { useClaude?: boolean; noClaude?: boolean; designContract?: boolean } = {},
): Promise<string> {
  const vision = (atts || []).filter((a) => a && a.base64 && isVisionAttachment(a.type, a.name));
  if (vision.length === 0) return '';

  // The rung order comes from visionProviderChain (pure, tested): a weak/free (noClaude) build never
  // even lists the Claude rung. Belt & braces: the noClaudeZone check inside describeWithClaude is the
  // same rule for in-zone callers that forget the flag.
  const describers: Record<VisionProvider, (att: RawAttachment, instruction: string) => Promise<string>> = {
    gemini: describeWithGemini,
    grok: describeWithGrok,
    claude: describeWithClaude,
  };
  const chain = visionProviderChain(opts);
  // AP-8: when the caller is a v5.0 BUILD, the same single vision call also asks for a structured
  // design contract (see AgentV3/designContract.ts). Requesting it here rather than in a second pass
  // is the whole reason the contract is free — a separate structured call would double the vision
  // cost of every screenshot upload to buy the same information twice.
  const instruction = opts.designContract
    ? `${DESCRIBE_INSTRUCTION}\n${DESIGN_CONTRACT_INSTRUCTION}`
    : DESCRIBE_INSTRUCTION;
  // Each attachment is described INDEPENDENTLY, so fan them out concurrently instead of N sequential
  // round-trips (perf audit 2026-07-18: multi-image/PDF prompts paid N× latency). The inner provider
  // FALLBACK stays sequential PER attachment (try gemini → grok → …, stop at the first that succeeds),
  // and Promise.all preserves input order, so the joined output is byte-identical to the old loop —
  // only the wall-clock changes. describeWith* never throw (they catch → return ''), so no rejection.
  const blocks = await Promise.all(
    vision.map(async (att) => {
      let desc = '';
      for (const provider of chain) {
        desc = await describers[provider](att, instruction);
        if (desc) break;
      }
      const label = att.type === 'application/pdf' ? 'PDF' : 'Image';
      return desc
        ? `[${label}: ${att.name}]\n${clamp(desc)}`
        : `[${label}: ${att.name} — could not be read by any available vision model.]`;
    }),
  );
  return blocks.join('\n\n');
}
