// THE IMAGE KEYS AN APP CAN USE — the one table (admin 2026-10-04: "user ko navbhatai api keys ka offer den,
// aur bhi api keys ke bare me bataye jaise grok, gemini, chatgpt — user jo bhi select kare uski
// location/link bataye, user ko guide kare ki keys kaha dalni hai").
//
// Read by the builder's instruction (inAppImageGeneration.ts), the recipe (ImageAiGenerator.ts), the
// checklist at the end of a build (AppRequirements.ts), the owner's error message and the vault lookup
// (appImageKeys.ts) — so a secret's name, its link and where it goes cannot drift between them.
// PURE — no imports, no I/O.

export type AppImageProvider = 'navbharatai' | 'openai' | 'gemini' | 'xai' | 'pollinations';

export interface AppImageKeyOption {
  provider: AppImageProvider;
  /** The name the owner gives the secret in Keys & Secrets. */
  secret: string;
  /** Other names the same key is accepted under (a key saved for the text assistant, say). */
  aliases: readonly string[];
  /** What the owner reads. */
  label: string;
  /** Where the key is made. An in-app path for NavBharatAI, a web address for the others. */
  getIt: string;
  note: string;
}

/** Where the owner pastes any of them. One sentence, used everywhere. */
export const APP_KEYS_PLACE = 'NavBharatAI Pro → More → Keys & Secrets (or Settings → App Settings → Secrets & API Keys)';

export const APP_IMAGE_KEY_OPTIONS: readonly AppImageKeyOption[] = [
  {
    provider: 'navbharatai', secret: 'NAVBHARATAI_API_KEY', aliases: [],
    label: 'NavBharatAI API key',
    getIt: 'Home → Other AI → Developer Tools → NavBharatAI API → create a key with the "Images" permission',
    note: 'No other account needed. 5 free pictures a day, then ₹1 each from your NavBharatAI wallet.',
  },
  {
    provider: 'openai', secret: 'OPENAI_API_KEY', aliases: [],
    label: 'OpenAI (ChatGPT) key',
    getIt: 'https://platform.openai.com/api-keys',
    note: 'Billed by OpenAI to your OpenAI account.',
  },
  {
    provider: 'gemini', secret: 'GEMINI_API_KEY', aliases: ['GOOGLE_API_KEY'],
    label: 'Google Gemini key',
    getIt: 'https://aistudio.google.com/apikey',
    note: 'Billed by Google to your Google account.',
  },
  {
    provider: 'xai', secret: 'XAI_API_KEY', aliases: ['GROK_API_KEY'],
    label: 'xAI Grok key',
    getIt: 'https://console.x.ai',
    note: 'Billed by xAI to your xAI account.',
  },
  {
    provider: 'pollinations', secret: 'POLLINATIONS_API_KEY', aliases: [],
    label: 'Pollinations secret key (sk_…)',
    getIt: 'https://enter.pollinations.ai',
    note: 'Use the SECRET key (sk_…), never the publishable pk_ key. Billed in Pollinations "pollen".',
  },
];

/** The plain-words list of options, for the owner. PURE. */
export function appImageKeyOptionsText(): string {
  return APP_IMAGE_KEY_OPTIONS
    .map((o, i) => `${i + 1}. ${o.label} — get it: ${o.getIt}. Save it as ${o.secret}. ${o.note}`)
    .join('\n');
}

/** What the OWNER reads when their app has no image key yet. PURE. */
export function needsImageKeyMessage(): string {
  return 'This app makes pictures with an AI image service, and that needs an API key. ' +
    `Add ONE of these in ${APP_KEYS_PLACE}:\n${appImageKeyOptionsText()}`;
}

/** What a VISITOR reads — never the owner's setup, never a vendor name (White-Label Law). */
export const VISITOR_IMAGE_UNAVAILABLE = 'The picture maker in this app is not set up yet. Please try again later.';

