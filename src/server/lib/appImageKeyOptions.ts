// THE IMAGE KEYS AN APP CAN USE — the one table (admin 2026-10-04: "user ko navbhatai api keys ka offer den,
// aur bhi api keys ke bare me bataye jaise grok, gemini, chatgpt — user jo bhi select kare uski
// location/link bataye, user ko guide kare ki keys kaha dalni hai").
//
// Read by the builder's instruction (inAppImageGeneration.ts), the recipe (ImageAiGenerator.ts), the owner's
// error message and the vault lookup (appImageKeys.ts). The secret NAMES and console links come from
// src/lib/imageKeyNames.ts, which the end-of-build checklist (AppRequirements.ts) and the "where do I get this
// key" screens (credentialRecipes.ts) read too — so a secret's name and its link cannot drift between them.
// PURE — no I/O.

import { IMAGE_KEY_NAMES, type AppImageProvider } from '../../lib/imageKeyNames';

export type { AppImageProvider } from '../../lib/imageKeyNames';

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

/** What the owner reads for each key. The name and the link come from IMAGE_KEY_NAMES. */
const OWNER_WORDS: Record<AppImageProvider, { label: string; getIt?: string; note: string }> = {
  navbharatai: {
    label: 'NavBharatAI API key',
    getIt: 'Home → Other AI → Developer Tools → NavBharatAI API → create a key with the "Images" permission',
    note: 'No other account needed. 5 free pictures a day, then ₹1 each from your NavBharatAI wallet.',
  },
  openai: { label: 'OpenAI (ChatGPT) key', note: 'Billed by OpenAI to your OpenAI account.' },
  gemini: { label: 'Google Gemini key', note: 'Billed by Google to your Google account.' },
  xai: { label: 'xAI Grok key', note: 'Billed by xAI to your xAI account.' },
  pollinations: {
    label: 'Pollinations secret key (sk_…)',
    note: 'Use the SECRET key (sk_…), never the publishable pk_ key. Billed in Pollinations "pollen".',
  },
};

export const APP_IMAGE_KEY_OPTIONS: readonly AppImageKeyOption[] = IMAGE_KEY_NAMES.map((k) => ({
  provider: k.provider,
  secret: k.secret,
  aliases: k.aliases,
  label: OWNER_WORDS[k.provider].label,
  getIt: OWNER_WORDS[k.provider].getIt ?? k.consoleLink,
  note: OWNER_WORDS[k.provider].note,
}));

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

