// IMAGES MADE BY AI INSIDE THE USER'S APP (admin 2026-10-01).
//
// Admin, verbatim: "jab user apni api key dalna chahe kisi aur provider ki to bhi dal sakta ho, jab chahe
// change kare, agar user keys na de, to default pollination ai" — with a brief asking that "build me an AI
// image generator" produce an app that really makes pictures, not a mock-up.
//
// The capability itself is the `generate_image_ai` recipe (src/server/lib/ImageAiGenerator.ts). This module
// holds the three things around it that are not code generation:
//   1. IMAGE_IN_APP_RULE — the builder's instruction, read by the architect AND every writing sub-agent, so
//      the recipe is reached for instead of a hand-written provider call or a stock photo passed off as a
//      result.
//   2. appGeneratesImages(prompt) — does the REQUEST describe an app that creates pictures? Precision-first:
//      an image gallery, an uploader, a resizer or a "placeholder image" are not image generation.
//   3. fastLaneSkipsImageApp — the fast lane has no tools, so it cannot run the recipe. The same reasoning,
//      and the same shape, as fastLaneSkipsGame (autopsy 0bb437b4).
//
// PURE — no I/O.

export const IMAGE_IN_APP_RULE =
  'IMAGES MADE BY AI INSIDE THE APP: if the app itself must create pictures from text (an AI image ' +
  'generator, an AI art / logo / wallpaper / avatar maker, "generate an image from a prompt"), call ' +
  'run_recipe with name "generate_image_ai" — never hand-write the provider call, and never show a stock, ' +
  'placeholder or random photo as a generated result. Input { "server": false } for an app without a ' +
  'server: it uses Pollinations AI with no key, and it works in the preview and after publishing. Pass ' +
  '{ "server": true } only when the app already has a server or the user wants to use their OWN image ' +
  'provider key (a key must never be in browser code). Build the screen the recipe describes (prompt box, ' +
  'Generate, a visible progress state, the picture, Download, generate again, errors with Retry). In your ' +
  'final message say which engine makes the pictures and how the owner can switch to their own key.';

/**
 * Words that NAME the thing being generated — a picture of some kind. Kept to nouns that are a picture by
 * themselves ("logo", "avatar"), never words that are often something else ("card", "post").
 */
const PICTURE = '(?:images?|pictures?|pics?|photos?|art(?:work)?|illustrations?|drawings?|paintings?|wallpapers?|logos?|avatars?|portraits?|posters?|thumbnails?|stickers?)';

const IMAGE_APP_PATTERNS: RegExp[] = [
  // "AI image generator", "art generator", "wallpaper generator", "text-to-image"
  new RegExp(`\\b${PICTURE}\\s*(?:generator|generation)\\b`, 'i'),
  /\btext[\s-]*(?:to|2)[\s-]*(?:image|picture|photo|art)\b/i,
  // "AI image maker", "AI logo creator" — "maker"/"creator" alone is too often a template editor, so it
  // needs "AI" in front of the picture word.
  new RegExp(`\\bai\\s+${PICTURE}\\s*(?:maker|creator|studio)\\b`, 'i'),
  /\bimage\s+maker\b/i,
  // "generate images from a prompt", "create pictures from text", "draws art from a description"
  new RegExp(`\\b(?:generat|creat|mak|draw|produc)(?:e|es|ed|ing|s)?\\s+(?:an?\\s+|the\\s+)?(?:ai\\s+)?${PICTURE}\\s+(?:from|using|based\\s+on|out\\s+of)\\s+(?:an?\\s+|the\\s+|their\\s+|user\\s+|your\\s+)?(?:text|prompts?|descriptions?|words?)\\b`, 'i'),
  // Hinglish: "image banane wala app", "photo generate karne wala", "prompt se tasveer"
  /\b(?:image|photo|tasveer|tasvir|picture|chitra|art)\s+(?:banane|bnane|banaane|generate\s+karne|create\s+karne)\s+(?:wal[aie]|vaal[aie])\b/i,
  /\b(?:prompt|text|likh(?:kar|ke))\s+(?:se|sey)\s+(?:image|photo|tasveer|tasvir|picture|chitra)\b/i,
  // Devanagari: "इमेज बनाने वाला", "फोटो जनरेट", "तस्वीर बनाने"
  /(?:इमेज|फ़ोटो|फोटो|तस्वीर|चित्र)\s*(?:बनाने|जनरेट|जेनरेट)/,
];

/** Things that contain the words but are not AI image generation. */
const NOT_IMAGE_GENERATION = /\b(?:placeholder|dummy|qr|barcode|favicon|meme)\s+(?:image|picture|photo)?\s*generator\b/i;

/**
 * True when the request describes an app that CREATES pictures from text. Precision-first: a miss costs
 * nothing (the architect still reads IMAGE_IN_APP_RULE on every build); a false positive only sends an
 * ordinary app to the full builder.
 */
export function appGeneratesImages(prompt: string): boolean {
  const text = String(prompt ?? '');
  if (!text.trim()) return false;
  if (NOT_IMAGE_GENERATION.test(text) && !IMAGE_APP_PATTERNS.slice(1).some((re) => re.test(text))) return false;
  return IMAGE_APP_PATTERNS.some((re) => re.test(text));
}

/**
 * The fast lane writes files from a plan with no tools, so an app that makes pictures would get a
 * hand-written provider call (or a stock photo) instead of the recipe. Send it to the full builder.
 * `AGENTV3_FASTLANE_IMAGE_APPS=on` lets the lane try them again, with no deploy.
 */
export function fastLaneSkipsImageApp(prompt: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.AGENTV3_FASTLANE_IMAGE_APPS ?? '').trim().toLowerCase() === 'on') return false;
  return appGeneratesImages(prompt);
}
