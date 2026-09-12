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

export type AiProvider = 'navbharat' | 'openai' | 'anthropic';

export interface AiConfig {
  provider: AiProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Null for the NavBharatAI gateway — it is plain `fetch`, so there is nothing to install. */
  dependency: { name: string; version: string } | null;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── NavBharatAI gateway (the default — no key, no signup, no backend) ─────────────────────────────
//
// THE WALL THIS REMOVES. Both recipes below are real and correct, and both end the same way: the app
// works only after its owner opens an account with a model vendor, pastes a card, and copies a secret
// into a file. That is where most people stop, and every competitor has the same wall. Calling the
// platform's own gateway instead means a generated chatbot answers on the first publish, on the
// owner's existing NavBharatAI balance (ROADMAP §13, 3.1).
//
// It is CLIENT-side on purpose: the published page carries an app token that is public by design (see
// server/lib/appAiGateway.ts), so a static app gets a working assistant with no backend at all — the
// one thing a BYO key can never do, because a real API key must never reach a browser.
//
// The helper is honest about the two states it can be in. `window.NavAI` is stamped into the page at
// PUBLISH, so while the app is still a preview it is genuinely absent, and the code says so in words
// rather than throwing something the app author would have to decode.
const NAVBHARAT_CLIENT = `// AI text generation through NavBharatAI — no API key, no backend, nothing to sign up for.
//
// The assistant is wired into this app when you PUBLISH it: publishing stamps this app's own
// assistant into the page. Before that, isAiReady() is false and the helpers say so instead of
// failing silently. Cost is charged to the NavBharatAI balance of whoever owns this app.

interface NavAiBridge { app: string; available: boolean; ask(prompt: string, opts?: { system?: string }): Promise<string>; }

function bridge(): NavAiBridge | null {
  const w = globalThis as unknown as { NavAI?: NavAiBridge };
  return w.NavAI && typeof w.NavAI.ask === 'function' ? w.NavAI : null;
}

/** True once this app is published and its assistant is live. */
export function isAiReady(): boolean {
  return bridge() !== null;
}

const NOT_READY = 'The assistant becomes available once this app is published.';

/** One-shot: send a prompt, get the text back. The optional system text sets the assistant's role. */
export async function generateText(prompt: string, system?: string): Promise<string> {
  const b = bridge();
  if (!b) throw new Error(NOT_READY);
  return b.ask(prompt, system ? { system } : undefined);
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

/**
 * Multi-turn. The gateway takes one prompt, so the conversation is flattened into it — which keeps
 * the whole thing a single call and means there is no session to lose.
 */
export async function chat(messages: ChatMessage[], system?: string): Promise<string> {
  const b = bridge();
  if (!b) throw new Error(NOT_READY);
  const transcript = messages
    .map((m) => (m.role === 'assistant' ? 'Assistant: ' : 'User: ') + m.content)
    .join('\\n');
  return b.ask(transcript + '\\nAssistant:', system ? { system } : undefined);
}
`;

const NAVBHARAT_INSTRUCTIONS =
  'AI text generation wired through NavBharatAI — no API key and no backend needed. Import ' +
  'generateText(prompt) or chat(messages) from src/lib/ai.ts and call them straight from the browser. ' +
  'The assistant goes live when you PUBLISH the app (isAiReady() is false until then, and the helpers ' +
  'say so rather than failing quietly), and each answer is charged to the app owner\'s NavBharatAI ' +
  'balance. Each app has a daily limit, so a busy day can never drain the balance. To use your own OpenAI or Anthropic key instead, ask for provider = "openai" or ' +
  '"anthropic".';

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
  if (provider === 'navbharat') {
    return {
      provider,
      files: { 'src/lib/ai.ts': NAVBHARAT_CLIENT },
      envKeys: [],
      dependency: null,
      instructions: NAVBHARAT_INSTRUCTIONS,
    };
  }
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
  return v === 'navbharat' || v === 'openai' || v === 'anthropic';
}

/**
 * Which provider an unspecified request means.
 *
 * ABSENT means the NavBharatAI gateway — the one that works with nothing pasted anywhere, so the
 * default is the path that does not stop at a wall.
 *
 * 🔴 BUT ONLY WHEN THE GATEWAY IS ACTUALLY SWITCHED ON, and this parameter exists because the first
 * version of this function did not have it. With `APP_AI_GATEWAY` unset, publishing stamps no token,
 * so `window.NavAI` is never defined and `isAiReady()` is false FOREVER — while the generated helper
 * says "The assistant becomes available once this app is published". The user would publish, and be
 * told the same thing again, with nothing anywhere to explain it. That is a status indicator
 * reporting a state that cannot arrive, which is precisely what the real-features rule forbids — and
 * it also broke the flag's own promise that unset means today's behaviour EXACTLY.
 *
 * So with the gateway off, an unspecified request is an error naming the two BYO providers: today's
 * behaviour, unchanged, exactly as it was before this feature existed.
 *
 * A provider that is PRESENT but unrecognised is still an error either way: silently substituting a
 * default for a typo would hand somebody a different integration from the one they named.
 */
export function resolveAiProvider(v: unknown, gatewayEnabled: boolean): AiProvider | null {
  if (v === undefined || v === null || v === '') return gatewayEnabled ? 'navbharat' : null;
  return isAiProvider(v) ? v : null;
}
