/**
 * EVERY MARKER THE CHAT PROMPT TELLS THE MODEL TO EMIT, IN ONE PLACE.
 *
 * 🔴 WHY THIS EXISTS (Q-600's sweep, 2026-10-09). The server prompt instructs the model to append
 * control strings to its reply, and the chat renderer strips each one and acts on it. That is a
 * CONTRACT between `src/server/lib/prompts.ts` and the component that renders the surface — and
 * nothing held the two ends together, so one end quietly stopped existing.
 *
 * `[ACTION_SECRET_HELPER:provider]` was the one that broke. The prompt said, in its own words, that
 * the model must "ALWAYS append" it and that it "immediately triggers our high-tech inline Direct-Fill
 * Assistant in their chat window, letting them paste and save it instantly". The only code in the repo
 * that could strip it was a local in `AIChat.tsx` that nothing called. So every time the AI talked
 * about an API key, the user read `[ACTION_SECRET_HELPER:gemini]` in the message bubble, and the
 * assistant they had just been promised did not exist anywhere.
 *
 * ⛔ AND THE FIX WAS NOT TO BUILD IT. `SecretManager.tsx` says it plainly: "This component is the
 * vault's UI, and it is deliberately the ONLY one… there is no second store to keep in step, because
 * there is no second implementation", and `tests/secretsOneVault.test.ts` fails CI if a change forks
 * that. An inline key form in the chat bubble would have been a THIRD implementation of saving a
 * secret — the exact thing that test exists to prevent — built to make a sentence in a prompt true.
 * So the sentence went instead: the prompt now names the two real doors (Settings → App Settings →
 * Secrets & API Keys, and ⋮ More → Keys & Secrets) and promises nothing else.
 *
 * 🔒 THE MARKER IS STILL STRIPPED, and that is not belt-and-braces. Chat history is stored, so every
 * message already written with the marker is still rendered every time a user scrolls back. Removing
 * the instruction stops new ones; stripping is what fixes the ones that exist.
 *
 * `tests/everyPromptMarkerHasARenderer.test.ts` reads `prompts.ts` and fails when it tells the model
 * to emit a marker this module does not know — so the end that broke cannot break silently again.
 *
 * Everything here is PURE and has no React dependency, so the contract is testable without a DOM.
 */

/**
 * The bare markers: the prompt asks for the literal string, and the renderer both strips it and
 * branches on its presence. Each is matched exactly, so a marker inside a code block the user pasted
 * is treated the same way — which is right: it is a control string either way, and showing it is the
 * defect this module fixes.
 */
export const CHAT_FLAG_MARKERS = [
  '__SWITCH_TO_BUILD__',
  '__URGENT_BUILD__',
  '__VIEW_PREVIEW__',
  '__DEPLOY_ACTIONS__',
  '__AUTO_PLAN__',
  '__AUTO_BUILD__',
] as const;

/**
 * Markers that carry a VALUE, as `[NAME:value]`. Only one exists, and it is the one that broke.
 *
 * The value is read back out rather than thrown away, because a reader of this module will ask what
 * happened to it: the provider name the model chose is no longer used for anything, now that the
 * prompt no longer promises a surface for it. `secretHelperProvider` is kept because it is the honest
 * way to say so in code, and because a future surface would need exactly this and nothing more.
 */
export const CHAT_VALUE_MARKERS = ['ACTION_SECRET_HELPER'] as const;

/** Every marker name this module knows, flags and value-carrying alike. PURE. */
export function knownMarkerNames(): string[] {
  return [...CHAT_FLAG_MARKERS, ...CHAT_VALUE_MARKERS];
}

const VALUE_MARKER_RE = new RegExp(`\\[(?:${CHAT_VALUE_MARKERS.join('|')}):([^\\]]*)\\]`, 'gi');

/**
 * The provider the model named in `[ACTION_SECRET_HELPER:…]`, lower-cased and trimmed, or null.
 *
 * Returns the FIRST one: the prompt asked for one marker per message, and acting on a second would be
 * guessing at a message the model was not told how to write. PURE.
 */
export function secretHelperProvider(text: string | null | undefined): string | null {
  const m = String(text ?? '').match(/\[ACTION_SECRET_HELPER:([^\]]*)\]/i);
  const provider = m ? m[1].toLowerCase().trim() : '';
  return provider ? provider : null;
}

/**
 * The message as the user should read it: every known marker removed, and the whitespace the removal
 * left behind tidied up.
 *
 * Only the collapsing of runs of spaces and of blank lines is cosmetic; everything else about the text
 * is left exactly as the model wrote it, because this runs on content a user is about to read and a
 * renderer must not rewrite that. PURE.
 */
export function stripChatMarkers(text: string | null | undefined): string {
  let out = String(text ?? '');
  for (const marker of CHAT_FLAG_MARKERS) out = out.split(marker).join('');
  out = out.replace(VALUE_MARKER_RE, '');
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
