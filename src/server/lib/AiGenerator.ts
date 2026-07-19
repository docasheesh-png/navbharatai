// U-4 (verified recipe modules) — AI/LLM text-generation generator (OpenAI + Anthropic).
//
// Real, working AI text generation wired into the app on the USER'S OWN provider key (Bring-Your-Own — the
// user pastes their OpenAI/Anthropic key into .env; NavBharatAI never stores it, and NavBharatAI's own AI
// account is never spent on a user app). This lets a generated app add real AI features — chat, summarise,
// draft, classify — instead of a fake "AI" placeholder. Each recipe is a SERVER helper (the API key is a
// secret and must never reach the browser): generateText(prompt) for a one-shot, and chat(messages) for a
// multi-turn conversation.
//
// The MODEL is env-driven (OPENAI_MODEL / ANTHROPIC_MODEL) with a sensible default, because model ids change
// often — this way the user upgrades to a newer model by editing .env, with no code change and no risk of a
// hardcoded id going stale. PURE builders; the generated code is correct and complete — no TODO stubs (the
// real-features rule). Unit-tested.

export type AiProvider = 'openai' | 'anthropic';

export interface AiConfig {
  provider: AiProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependency: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── OpenAI (Chat Completions) ────────────────────────────────────────────────────────────────────────────
const OPENAI_SERVER = `import OpenAI from 'openai';

// Bring-Your-Own OpenAI key — platform.openai.com → API keys. Pasted into .env as a SERVER secret; it must
// never reach the browser. The model is env-driven so you upgrade by editing .env, not code.
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY as string });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

// One-shot: send a prompt, get the text back.
export async function generateText(prompt: string): Promise<string> {
  const res = await client.chat.completions.create({ model: MODEL, messages: [{ role: 'user', content: prompt }] });
  return res.choices[0]?.message?.content ?? '';
}

// Multi-turn: pass the whole conversation (optionally starting with a system message).
export async function chat(messages: ChatMessage[]): Promise<string> {
  const res = await client.chat.completions.create({ model: MODEL, messages });
  return res.choices[0]?.message?.content ?? '';
}
`;

// ── Anthropic (Messages API) ─────────────────────────────────────────────────────────────────────────────
const ANTHROPIC_SERVER = `import Anthropic from '@anthropic-ai/sdk';

// Bring-Your-Own Anthropic key — console.anthropic.com → API keys. Pasted into .env as a SERVER secret; it
// must never reach the browser. The model is env-driven so you upgrade by editing .env, not code.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY as string });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

// Pull the text out of Anthropic's content blocks.
function textOf(res: Anthropic.Message): string {
  return res.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
}

// One-shot: send a prompt, get the text back. (Anthropic requires max_tokens.)
export async function generateText(prompt: string): Promise<string> {
  const res = await client.messages.create({ model: MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] });
  return textOf(res);
}

// Multi-turn: pass the whole conversation (a system prompt goes in the separate \`system\` field, not messages).
export async function chat(messages: ChatMessage[], system?: string): Promise<string> {
  const res = await client.messages.create({ model: MODEL, max_tokens: 1024, system, messages });
  return textOf(res);
}
`;

const OPENAI_INSTRUCTIONS =
  'OpenAI text generation wired (on YOUR OpenAI key). Paste OPENAI_API_KEY into .env — NavBharatAI never ' +
  'stores it, and its own account is never used. Optionally set OPENAI_MODEL (default gpt-4o-mini) to any ' +
  'model your key can access. Import generateText(prompt) or chat(messages) in server code — the key stays ' +
  'server-side, so proxy AI calls through your backend, never the browser.';

const ANTHROPIC_INSTRUCTIONS =
  'Anthropic (Claude) text generation wired (on YOUR Anthropic key). Paste ANTHROPIC_API_KEY into .env — ' +
  'NavBharatAI never stores it, and its own account is never used. Optionally set ANTHROPIC_MODEL (default ' +
  'claude-3-5-sonnet-latest) to any model your key can access. Import generateText(prompt) or chat(messages, ' +
  'system) in server code — the key stays server-side, so proxy AI calls through your backend, never the browser.';

export function generateAiIntegration(provider: AiProvider): AiConfig {
  if (provider === 'openai') {
    return {
      provider,
      files: {
        'server/lib/ai.ts': OPENAI_SERVER,
        [ENV_EXAMPLE]: 'OPENAI_API_KEY=\nOPENAI_MODEL=\n',
      },
      envKeys: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      dependency: { name: 'openai', version: '^4' },
      instructions: OPENAI_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/ai.ts': ANTHROPIC_SERVER,
      [ENV_EXAMPLE]: 'ANTHROPIC_API_KEY=\nANTHROPIC_MODEL=\n',
    },
    envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
    dependency: { name: '@anthropic-ai/sdk', version: '^0.30' },
    instructions: ANTHROPIC_INSTRUCTIONS,
  };
}

export function isAiProvider(v: unknown): v is AiProvider {
  return v === 'openai' || v === 'anthropic';
}
