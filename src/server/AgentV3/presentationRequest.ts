// A PRESENTATION IS A DOCUMENT, NOT AN APP (failedbr #684, queue Q-3212).
//
// 🔴 WHAT HAPPENED. "Create a ppt on any randomly product" reached the builder, which decided to "build this as a
// real, working web app … with a Download .pptx button", installed a slide library, wrote leaf modules nobody wired,
// and ran 29 minutes into the cap. The user got no deck. REQUIREMENT_GAPS even read "product" as a shop and asked
// about cart and checkout.
//
// 🔑 THE CLASS is the one `pictureRequest.ts` and `spreadsheetRequest.ts` closed: a request for a DELIVERABLE
// reaching a surface that only knows how to build software. NavBharatAI cannot write a .pptx file yet, so the honest
// answer is the one a person would give: the whole deck, slide by slide, written in the chat to paste into
// PowerPoint or Google Slides — saying plainly that a downloadable .pptx is not available yet, and offering to build
// a slide-show app if that is what was meant. Never a fake file, never a button that pretends.
//
// PRECISION FIRST ("build a presentation maker app" is a real build): a request is a deck request only when it names
// a deck (ppt / pptx / powerpoint / presentation / slide deck / slides), asks for one to be MADE, names nothing that
// is software (app, website, tool, maker, generator, viewer, button, editor …), and is not a how-to question.
// PURE. Kill switch: AGENTV3_PRESENTATION_ANSWER=off builds as before.

import { shouldAnswerPictureRequest, PICTURE_REQUEST_STEER, pictureRequestFallback, type PictureAnswerInput } from './pictureRequest';

export function presentationAnswerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PRESENTATION_ANSWER ?? '').trim().toLowerCase() !== 'off';
}

const DECK_NOUN = /\b(?:ppts?|pptx|power\s?points?|presentations?|slide\s?decks?|slides?\s+(?:on|about|for)|google\s+slides)\b|प्रेजेंटेशन|प्रेज़ेंटेशन|पीपीटी|स्लाइड/i;
const CREATE = /\b(?:create|make|prepare|generate|write|design|build|draft|give|need|want|bana(?:o|do|ke|kar|na|ni|iye)?|bnao|bna\s?do|banwa\w*|taiyar)\b|बना|तैयार/i;
const SOFTWARE = /\b(?:apps?|application|website|web\s?site|webapp|site|tool|maker|generator|builder|viewer|editor|player|software|dashboard|button|component|react|html|javascript|code|script|api|plugin|extension|template\s+engine)\b|ऐप|वेबसाइट/i;
const HOW_TO = /\b(?:how\s+(?:do|can|to)|kaise|kese|tips?\s+(?:for|on)|steps?\s+to)\b|कैसे/i;

export function shouldAnswerPresentationRequest(input: { prompt: string; importing?: boolean; env?: NodeJS.ProcessEnv }): boolean {
  if (!presentationAnswerEnabled(input.env)) return false;
  if (input.importing) return false;
  const p = String(input.prompt ?? '');
  if (!p.trim() || p.length > 1500) return false;
  return DECK_NOUN.test(p) && CREATE.test(p) && !SOFTWARE.test(p) && !HOW_TO.test(p);
}

/** Added to the chat system prompt for that one turn. */
export const PRESENTATION_REQUEST_STEER = '\n\nTHIS TURN: the user asked for a PRESENTATION (a slide deck), not an app. NavBharatAI cannot create a downloadable .pptx file yet — never say a file was made, never offer a download. '
  + 'Write the whole deck here in the chat, in the user\'s language: a title slide, then 8–12 numbered slides, each with a short heading, 3–5 crisp bullet points and one line of speaker notes, and a closing slide. '
  + 'If they left the topic open, choose a sensible one and say which in one line. End with one sentence saying a downloadable .pptx is not available yet, so they can paste this into PowerPoint or Google Slides — and offer to build a slide-show app instead if that is what they meant.';

/** When the chat could not answer: the honest deterministic reply (never a fall-through to a build). */
export function presentationRequestFallback(): string {
  return 'I can write the slides for your presentation here in the chat — a title, each slide\'s heading and bullet points, and speaker notes — to paste into PowerPoint or Google Slides. '
    + 'A downloadable .pptx file is not available yet. Tell me the topic and how many slides you want, and I will write them. If you meant a slide-show app, say so and I will build that instead.';
}

/**
 * ONE "this is a deliverable, not an app" lane for the route (pictures and decks), so the chat handler carries one
 * flag instead of two — the handler is at its branch budget (theChatHandlerHasHeadroom). A deck is answered even when
 * the user has an app (a presentation is never a change to it); a picture keeps its own rules. PURE.
 */
export function shouldAnswerDeliverableRequest(input: PictureAnswerInput): boolean {
  return shouldAnswerPresentationRequest({ prompt: input.prompt, ...(input.importing !== undefined ? { importing: input.importing } : {}), ...(input.env ? { env: input.env } : {}) })
    || shouldAnswerPictureRequest(input);
}

/** The steer for that lane: the deck's when the message asks for a deck, else the picture's. */
export function deliverableSteer(prompt: string): string {
  return shouldAnswerPresentationRequest({ prompt }) ? PRESENTATION_REQUEST_STEER : PICTURE_REQUEST_STEER;
}

/** The deterministic fallback for that lane. */
export function deliverableFallback(prompt: string): string {
  return shouldAnswerPresentationRequest({ prompt }) ? presentationRequestFallback() : pictureRequestFallback();
}
