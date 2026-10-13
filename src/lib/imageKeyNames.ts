// THE NAMES OF THE IMAGE KEYS AN APP CAN USE — the one list both sides read (autopsy 303e8a6f, 2026-10-12).
//
// The server's owner-facing table (src/server/lib/appImageKeyOptions.ts, admin 2026-10-04) says which keys make
// an app's pictures and where to get each one. The end-of-build checklist (AppRequirements.ts) and the "where do
// I get this key" screens (credentialRecipes.ts) must name EXACTLY the same secrets, and credentialRecipes is
// also read by the client, so the names live here: pure, dependency-free, and free of display names. A second
// hand-written copy of these names is the drift that let the AI-image chip keep saying "no API key" for a week
// after the rule changed.
//
// PURE — no imports, no I/O.

export type AppImageProvider = 'navbharatai' | 'openai' | 'gemini' | 'xai' | 'pollinations';

export interface ImageKeyName {
  provider: AppImageProvider;
  /** The name the owner gives the secret in Keys & Secrets. */
  secret: string;
  /** Other names the same key is accepted under (a key saved for the text assistant, say). */
  aliases: readonly string[];
  /** The https page where this key is made. */
  consoleLink: string;
  /** How a real value of this key starts — a value that matches none of them is not this key at all. */
  valuePrefixes: readonly string[];
}

/** In the order an owner is offered them: NavBharatAI's own key first, because it needs no other account. */
export const IMAGE_KEY_NAMES: readonly ImageKeyName[] = [
  { provider: 'navbharatai', secret: 'NAVBHARATAI_API_KEY', aliases: [], consoleLink: 'https://navbharatai.com', valuePrefixes: ['nbai_'] },
  { provider: 'openai', secret: 'OPENAI_API_KEY', aliases: [], consoleLink: 'https://platform.openai.com/api-keys', valuePrefixes: ['sk-'] },
  { provider: 'gemini', secret: 'GEMINI_API_KEY', aliases: ['GOOGLE_API_KEY'], consoleLink: 'https://aistudio.google.com/apikey', valuePrefixes: ['AIza'] },
  { provider: 'xai', secret: 'XAI_API_KEY', aliases: ['GROK_API_KEY'], consoleLink: 'https://console.x.ai', valuePrefixes: ['xai-'] },
  { provider: 'pollinations', secret: 'POLLINATIONS_API_KEY', aliases: [], consoleLink: 'https://enter.pollinations.ai', valuePrefixes: ['sk_'] },
];

/** Every secret name that makes an app's pictures work — any ONE saved is enough. PURE. */
export function imageKeySecretNames(): string[] {
  return IMAGE_KEY_NAMES.flatMap((k) => [k.secret, ...k.aliases]);
}

/** The key an owner is asked for first: NavBharatAI's own, which needs no other account. */
export const RECOMMENDED_IMAGE_KEY = IMAGE_KEY_NAMES[0]!.secret;
