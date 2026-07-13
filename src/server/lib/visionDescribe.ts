// Server-side vision description — turns an uploaded image or PDF into TEXT that
// any downstream text model (or the v3.0 build loop) can use, WITHOUT making the
// expensive model read it. Used by Pro v3.0 so file reading stays cheap: the
// cheap providers (Gemini → Grok) describe the file by default, and Claude is
// used ONLY when the caller asks (v3.0 "Power" / Only-Opus mode).
//
// Documents (Word/Excel/PowerPoint/ZIP/text) are handled by attachmentText.ts;
// this module covers the multimodal types (images + PDF) that need a vision model.

import { isVisionAttachment } from './attachmentText';
import { claudeVisionModel, grokVisionModels, geminiVisionModels } from './visionModels';
import { noClaudeZoneActive } from '../AgentV3/noClaudeZone';

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
async function describeWithGemini(att: RawAttachment): Promise<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  if (!key) return '';
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    for (const m of geminiVisionModels()) {
      try {
        const r = await ai.models.generateContent({
          model: m,
          contents: [{ parts: [{ text: DESCRIBE_INSTRUCTION }, { inlineData: { mimeType: att.type, data: att.base64 } }] }],
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
async function describeWithGrok(att: RawAttachment): Promise<string> {
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
            { type: 'text', text: DESCRIBE_INSTRUCTION },
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
async function describeWithClaude(att: RawAttachment): Promise<string> {
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
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: DESCRIBE_INSTRUCTION }] }],
    });
    return ((r.content.find((c: any) => c.type === 'text') as any)?.text || '').trim();
  } catch { return ''; }
}

/**
 * Describe all image/PDF attachments as text. By default uses the cheap providers
 * (Gemini → Grok) and only falls back to Claude if those are unavailable. When
 * `useClaude` is true (v3.0 Power / Only-Opus mode), Claude is used first for the
 * highest-fidelity read. Never throws; returns '' when nothing could be described.
 */
export async function describeVisionAttachments(
  atts: RawAttachment[],
  opts: { useClaude?: boolean; noClaude?: boolean } = {},
): Promise<string> {
  const vision = (atts || []).filter((a) => a && a.base64 && isVisionAttachment(a.type, a.name));
  if (vision.length === 0) return '';

  // UNBREAKABLE weak-module guard (admin absolute rule, 2026-07-13): a weak/free build must never spend
  // Claude anywhere — including vision. The routing policy pins free/weak vision to Gemini/Grok; drop the
  // Claude rung entirely (the raw-SDK sibling of the ClaudeClient chokepoint; the zone check in
  // describeWithClaude is the same rule for in-zone callers, since vision runs before the build zone).
  const noClaude = opts.noClaude === true;
  const blocks: string[] = [];
  for (const att of vision) {
    let desc = '';
    if (opts.useClaude && !noClaude) {
      // Power mode: Claude first, cheap providers as fallback.
      desc = (await describeWithClaude(att)) || (await describeWithGemini(att)) || (await describeWithGrok(att));
    } else if (noClaude) {
      // Weak/free build: cheap providers ONLY — Claude is never touched.
      desc = (await describeWithGemini(att)) || (await describeWithGrok(att));
    } else {
      // Default: cheap first, Claude only as last resort.
      desc = (await describeWithGemini(att)) || (await describeWithGrok(att)) || (await describeWithClaude(att));
    }
    const label = att.type === 'application/pdf' ? 'PDF' : 'Image';
    blocks.push(desc
      ? `[${label}: ${att.name}]\n${clamp(desc)}`
      : `[${label}: ${att.name} — could not be read by any available vision model.]`);
  }
  return blocks.join('\n\n');
}
