// A PICTURE IS NOT AN APP (autopsy 19641ab5, 2026-10-01).
//
// 🔴 WHAT HAPPENED. A free user attached a portrait photo and typed "Create full image" into
// NavBharatAI Pro. Nothing in the build engine asked whether that was a picture or an app, so it was an
// app: the photo's description was counted as eleven features, the request scored 83 ("complex"), the
// mega-app roadmap planned a six-step "Image Generator" app, and the builder started writing one. The
// user stopped it at 108 seconds and was charged ₹7.62 for an app nobody asked for.
//
// 🔑 THE CLASS: a picture request reaching a surface that only builds. NavBharatAI already knows where
// pictures are made — free chat, Doctor AI and every Professional detect a picture request with
// `detectImageIntent` and point to Image Generator AI. NavBharatAI Pro was the one surface that did
// not, while `AppKnowledgeBase` (`ai_image_gen`) told every AI that Pro does. The instance was the
// three chat routes; this is the sibling that was never hunted.
//
// PRECISION. `detectImageIntent` is tuned for chat, where "create an image gallery" is rare. Here it is
// common, so a request is a picture request only when it also names nothing that is software: "create
// an image generator app", "make a photo gallery", "image slider banao" all still build (and #3430's
// image recipe makes those apps draw real pictures). A workspace that already holds the user's app is
// left alone too — there "make a logo" plausibly means "for this app". Wrong toward chat costs one
// message, and the reply offers to build the app; wrong toward build cost this user ₹7.62 and a stop.
//
// PURE. Kill switch: AGENTV3_PICTURE_ANSWER=off builds as before.

import { detectImageIntent } from '../lib/imageIntent';
import { IMAGE_STUDIO_MODE_NAME } from '../lib/freeChatModeGuide';

export function pictureAnswerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PICTURE_ANSWER ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Words that make the request about SOFTWARE: the picture is a feature of something to be built. Any
 * one of them sends the request down the build path exactly as before. English, Hinglish, Devanagari.
 */
const SOFTWARE_OBJECT = new RegExp(
  '\\b(?:apps?|application|webapp|website|site|webpage|page|pages|landing|dashboard|tool|tools|generator|'
  + 'editor|maker|creator|converter|compressor|resizer|gallery|slider|carousel|viewer|uploader|cropper|'
  + 'game|games|quiz|puzzle|portfolio|store|shop|platform|software|system|api|bot|chatbot|extension|plugin|'
  + 'widget|ui|interface|screen|screens|component|form|feature|button|backend|frontend|server|database|'
  + 'clone|template|project|code|program|script|function|module|wala|wali|vala|vali)\\b'
  + '|ऐप|एप|वेबसाइट|वेब साइट|सॉफ्टवेयर|गेम|वाला|वाली',
  'i',
);

/** Does this message ask for a PICTURE (and nothing that is software)? PURE. */
export function isPictureRequest(prompt: string): boolean {
  const text = String(prompt ?? '').trim();
  if (!text) return false;
  if (!detectImageIntent(text).wants) return false;
  return !SOFTWARE_OBJECT.test(text);
}

export interface PictureAnswerInput {
  prompt: string;
  /** Does the workspace already hold the user's own app? Then a picture may be meant for it. */
  userAppExists: boolean;
  /** A zip or a repository is being imported this turn — that is never a picture request. */
  importing: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Should Pro answer this message instead of building? PURE. */
export function shouldAnswerPictureRequest(input: PictureAnswerInput): boolean {
  if (!pictureAnswerEnabled(input.env)) return false;
  if (input.userAppExists || input.importing) return false;
  return isPictureRequest(input.prompt);
}

/** Where pictures are made, as a path the user can follow from Pro (which has no Mode button). */
export const PICTURE_STUDIO_PATH = `Home → Other AI → AI Image Gen (also: Mode → ${IMAGE_STUDIO_MODE_NAME} in the NavBharatAI FREE chat)`;

/** Added to the chat model's instructions for this turn. Written for the MODEL, in English. */
export const PICTURE_REQUEST_STEER =
  '\n\nTHIS MESSAGE ASKS FOR A PICTURE, NOT AN APP. NavBharatAI Pro builds apps and websites; it does not '
  + 'draw pictures, and nothing has been built. Reply briefly and warmly, in the user\'s own language: '
  + `pictures are made in **${IMAGE_STUDIO_MODE_NAME}** — ${PICTURE_STUDIO_PATH}. Describe the picture there `
  + 'and press send. If the user attached a photo and wants it changed (for example the full person, a wider '
  + 'frame, a new background), say that the same screen can change an attached photo: attach it, then type '
  + 'only what should change. Do not describe, imagine or claim to have made the picture. End with one line: '
  + 'if they wanted an APP that makes pictures, they can say so (for example "build an image generator app") '
  + 'and you will build it.';

/** The answer when no model could write one. English, deterministic, names no vendor. */
export function pictureRequestFallback(): string {
  return `NavBharatAI Pro builds apps and websites, so I haven't built anything for this one. Pictures are made in **${IMAGE_STUDIO_MODE_NAME}**: ${PICTURE_STUDIO_PATH}. Describe the picture there and press send. To change a photo you have, attach it there and type only what should change.\n\nIf you wanted an app that makes pictures, just say "build an image generator app" and I'll build it.`;
}
