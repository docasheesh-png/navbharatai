import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AI provider clients + API-key resolution, extracted from the server.ts
 * monolith (Phase 1, AI-core step a). Behavior unchanged.
 *
 * - Lazy system-client singletons (created on first use from env keys).
 * - `resolveApiKey` prefers a valid user-supplied key, else a system env key.
 * - `getXxx(userKey?)` factories return a ready provider client (or null).
 */

// P0a C1 — hardcoded Gemini key removed. Set LEGACY_EMBEDDED_API_KEY env var in Cloud Run.
// If unset the Gemini provider is simply unavailable (fallback chain: Groq → Anthropic → Vertex).
if (!process.env.LEGACY_EMBEDDED_API_KEY) {
  console.warn('[SECURITY] LEGACY_EMBEDDED_API_KEY is not set — Gemini legacy path unavailable. Set this env var in Cloud Run.');
}
export const LEGACY_EMBEDDED_API_KEY = process.env.LEGACY_EMBEDDED_API_KEY || '';

// AI Clients Initialization (Lazy system-key singletons)
let geminiClient: GoogleGenAI | null = null;
let groqClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;
let openaiClient: OpenAI | null = null;
let openrouterClient: OpenAI | null = null;

export const isPlaceholder = (key: string | undefined, strict: boolean = true, provider?: string): boolean => {
  if (!key) return true;
  const k = key.trim();
  if (
    k === LEGACY_EMBEDDED_API_KEY ||
    k.startsWith('MY_') ||
    k === 'undefined' ||
    k === 'null' ||
    k === 'YOUR_API_KEY'
  ) return true;

  if (strict) {
    if (provider && provider.toLowerCase() === 'gemini') {
      return k.length < 20 || !k.startsWith('AIza');
    }
    return k.length < 10;
  }
  return false;
};

export const resolveApiKey = (provider: string, userKey?: string): { key: string | null; source: string } => {
  const p = provider.toUpperCase();

  // 1. Check user key if provided and not a placeholder
  if (userKey && !isPlaceholder(userKey, true, provider)) {
    const masked = userKey.substring(0, 6) + '...' + userKey.substring(userKey.length - 4);
    console.log(`[AUTH] Using USER ${p} key: ${masked}`);
    return { key: userKey, source: 'USER' };
  }

  // 2. Check provider-specific system environment keys
  let envKey: string | undefined = undefined;
  const providerLower = provider.toLowerCase();

  if (providerLower === 'gemini') {
    envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  } else if (providerLower === 'claude' || providerLower === 'anthropic') {
    envKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || process.env.VITE_CLAUDE_API_KEY;
  } else {
    envKey = process.env[`${p}_API_KEY`] || process.env[`${p}_KEY`];
  }

  console.log(`[DEBUG_AUTH] Provider: ${provider}. System key found: ${!!envKey}`);

  if (envKey && !isPlaceholder(envKey, true, provider)) {
    envKey = envKey.trim();
    const masked = envKey.substring(0, 6) + '...' + envKey.substring(envKey.length - 4);
    console.log(`[AUTH] Using SYSTEM ${p} key (Fallback): ${masked}`);
    return { key: envKey, source: 'SYSTEM' };
  }

  console.log(`[AUTH] No valid key found for ${p}. UserKey provided: ${userKey ? 'present' : 'absent'}.`);
  return { key: null, source: 'NONE' };
};

export const hasKey = (provider: string, userKey?: string): boolean => {
  return resolveApiKey(provider, userKey).source !== 'NONE';
};

export const getGemini = (userKey?: string): GoogleGenAI | null => {
  // If user provides a key, we *must* create a new client for it
  if (userKey && !isPlaceholder(userKey, true, 'gemini')) {
      return new GoogleGenAI({ apiKey: userKey });
  }

  // Fallback to system key
  if (!geminiClient) {
      const { key, source } = resolveApiKey('gemini', undefined);
      console.log(`[AUTH] Attempting to resolve system Gemini key. Source: ${source}, Key found: ${!!key}`);
      if (key) {
          geminiClient = new GoogleGenAI({ apiKey: key });
      } else {
          console.error(`[AUTH] CRITICAL: System Gemini key resolution failed!`);
      }
  }
  return geminiClient;
};

export const getGroq = (userKey?: string): OpenAI | null => {
  const { key } = resolveApiKey('groq', userKey);
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.groq.com/openai/v1',
  });
};

export const getDeepSeek = (userKey?: string): OpenAI | null => {
  const { key } = resolveApiKey('deepseek', userKey);
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.deepseek.com',
  });
};

export const getOpenAI = (userKey?: string): OpenAI | null => {
  const { key } = resolveApiKey('openai', userKey);
  if (!key) return null;
  return new OpenAI({ apiKey: key });
};

export const getOpenRouter = (userKey?: string): OpenAI | null => {
  const { key } = resolveApiKey('openrouter', userKey);
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'navBharatAI',
    },
  });
};

export const getClaude = (userKey?: string): Anthropic | null => {
  const { key, source } = resolveApiKey('claude', userKey);
  if (!key) {
      console.log(`[DEBUG] getClaude: No key found.`);
      return null;
  }
  console.log(`[DEBUG] getClaude: Key found, source: ${source}, length: ${key.length}`);
  let baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (baseUrl && source === 'SYSTEM') {
    if (baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.slice(0, -3);
    } else if (baseUrl.endsWith('/v1/')) {
      baseUrl = baseUrl.slice(0, -4);
    }
  }
  console.log(`[DEBUG] getClaude: BaseURL: ${baseUrl || 'default'}`);
  return new Anthropic({
    apiKey: key,
    ...(baseUrl ? { baseURL: baseUrl } : {})
  });
};
