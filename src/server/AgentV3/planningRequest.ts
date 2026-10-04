// AgentV3 — THE REQUEST AS THE BUILDER WILL READ IT, for everything that sizes and plans it first.
//
// 🔴 WHY (autopsy e725e002, 2026-09-29). The user's message was the four words-and-a-path
// `mkdir src`. The builder — handed that message PLUS what gives it meaning (an attached file and/or
// the requests made earlier in this workspace) — built a 35-file e-commerce site: catalogue, search,
// cart, checkout with a demo payment, accounts, saved addresses, orders. Every judge that runs BEFORE
// the builder read `mkdir src` alone:
//   • the complexity score said 5 (the score of "hi") → the build opened on the cheapest rung;
//   • the ETA promised 2–4 minutes → it took 17.6 (6.1× the midpoint);
//   • the fast lane planned SEVEN files for "the main page" of a generic app, spent 267 s writing
//     them, and handed the builder boilerplate for an app nobody had asked for.
// The builder was right and every sizer was wrong, because they were not reading the same request.
//
// The class, named so it is recognised again: a judge that READS LESS THAN THE WORKER IT JUDGES.
// The fix is not to make each judge smarter; it is to give all of them the text the builder acts on,
// from ONE function, so the list of places that see the whole request cannot drift one reader at a
// time. PURE — the caller passes in what it already holds.
//
// 🔒 What goes in, and why each part is bounded:
//   • the user's own message, always, first, unchanged — nothing here can hide it;
//   • attached-file text (already extracted, redacted and fenced by the caller), because the file IS
//     this turn's request — capped, so a 200-page PDF cannot turn a sizing heuristic into a stall;
//   • 🔴 …and while the app that exists is still UNBUILT (autopsy 2f723acb, 2026-10-01). A UPSC mock-test
//     build was stopped at 108 s after writing `types.ts` and `store.tsx`; the user then pressed Continue.
//     Two files of their own made the workspace "an app", so this block dropped the original request and
//     every sizer read "Continue from where you left off…" alone: complexity 5 (the score of "hi"), a
//     3–5 minute estimate, the cheapest rung — for an 11.5-minute, 26-file build the builder made from
//     the very request this block had set aside. The entry point was still our starter, which is a
//     positive reading that the app was never assembled; the route passes it as `appStillUnbuilt`.
//   • the earlier requests of this workspace, ONLY while no user app exists yet. On a fresh workspace
//     the earlier turns are the spec being built (the builder already receives them as project
//     context); on an existing app they describe work already done, and adding them to "make the
//     button blue" would size a colour change as the whole app.
//   • 🔴 and ONLY the earlier turns that were BUILD requests (autopsy 6ae30b33, 2026-09-30). A student
//     asked, as three chat messages, for a Hindi essay on swimming, two SSC GK questions and history —
//     all three answered in chat — then typed "Make question". This block called those three answers
//     "the app being asked for", the fast lane planned a GK / swimming / history app from them, and the
//     builder shipped it. A question someone asked is conversation, never a spec. The lane that
//     answered each turn is recorded in memory (`Episode.lane`); a turn older than that tag is kept
//     only when the classifier does not read it as chat.
//   • 🔴 and an attached PICTURE only when it is a UI design (autopsy 19641ab5, 2026-10-01). A user
//     attached a portrait photo and typed "Create full image". The photo's description (hair, jewellery,
//     clothes, light) was added here under "their content describes what to build", counted as ~11
//     features, scored 83 and sent to the mega-app roadmap — for a request that was a picture. A
//     picture describes an app only when it IS one (a screenshot, mockup or wireframe — the describer
//     then returns a design contract); a photo of a person or a scene describes a subject. So the
//     caller passes only what describes an app, and says how many pictures it set aside. The builder
//     still receives every description in full; only the sizers stop reading a photo as a spec.
//   • 🔴 and, when the message POINTS at the conversation ("make this app", "yeh app bana do"), the
//     conversation itself (autopsy 5759ad8b, 2026-10-01): its chat turns AND the last answer. The rule
//     above still holds for every other message; see conversationReference.ts for why a pointer is the
//     one case where the chat IS the spec.
// Kill switch: AGENTV3_PLANNING_CONTEXT=off returns the message alone — the pre-change behaviour.

import { classifyIntentWithConfidence } from './IntentClassifier';
import { refersToConversation, CONVERSATION_REPLY_MAX } from './conversationReference';
import type { RequestLane } from './WorkspaceMemory';

/** Kill switch. Default ON. */
export function planningContextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PLANNING_CONTEXT ?? '').trim().toLowerCase() !== 'off';
}

/** Longest slice of attached-file text a sizer or planner is given. */
export const PLANNING_ATTACHMENT_MAX = 12_000;
/** Longest slice of each earlier request. */
export const PLANNING_EARLIER_REQUEST_MAX = 4_000;
/** How many earlier requests are carried — the most recent ones. */
export const PLANNING_EARLIER_REQUESTS = 3;

export type PlanningSource = 'attachment' | 'earlier-requests' | 'conversation';

export interface PlanningRequestInput {
  /** The user's message for this turn. */
  prompt: string;
  /**
   * Text extracted from files attached to THIS turn that DESCRIBES AN APP ('' when none): documents, and
   * pictures that are UI designs. A photo that is not a design is left out by the caller (see header).
   */
  attachmentText?: string | null;
  /** How many attached pictures the caller left out because they are not UI designs. For the report. */
  picturesSetAside?: number;
  /** Earlier requests the caller vouches were BUILD requests, oldest → newest. */
  recentRequests?: readonly string[] | null;
  /**
   * Earlier turns with the lane that answered each (`WorkspaceMemory.recentRequestTurns()`), oldest →
   * newest. A chat turn is dropped; an untagged (older) turn is kept unless it reads as chat.
   */
  recentTurns?: ReadonlyArray<{ text: string; lane?: RequestLane }> | null;
  /**
   * The last answer given in this workspace's conversation ('' or absent when none). Read ONLY when the
   * message points at the conversation (`refersToConversation`) and no finished app exists.
   */
  conversationReply?: string | null;
  /** Does the workspace already hold a user app? Earlier requests are added only when it does not. */
  userAppExists: boolean;
  /**
   * The workspace holds files of the user's, but the app's entry point is still OUR starter — an earlier
   * build was stopped or failed before the app was assembled (autopsy 2f723acb). The earlier requests are
   * then still the spec being built, exactly as on an empty workspace. Only a POSITIVE reading sets this;
   * an unreadable entry leaves it false, which is today's behaviour.
   */
  appStillUnbuilt?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface PlanningRequest {
  /** The text every sizer and planner reads. Equals `prompt` when nothing was added. */
  text: string;
  /** What was added beyond the message — empty when `text === prompt`. For the build report. */
  sources: PlanningSource[];
  /** Attached pictures NOT read as a spec (photos, not UI designs). For the build report. */
  picturesSetAside: number;
}

/**
 * Was this earlier turn a request to BUILD? A turn answered in chat never is. A turn older than the lane
 * tag is judged by what it says: the classifier's own verdict, so this cannot drift from the router's.
 * PURE.
 */
export function wasBuildRequest(turn: { text: string; lane?: RequestLane }): boolean {
  if (!turn || typeof turn.text !== 'string') return false;
  if (turn.lane === 'chat') return false;
  if (turn.lane === 'build') return true;
  return classifyIntentWithConfidence(turn.text).intent !== 'chat';
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}\n[… cut at ${max} characters]`;
}

/**
 * The request as the builder will read it. PURE.
 *
 * `recentRequests` from `WorkspaceMemory.recentRequests()` is oldest-first and kept in that order (the
 * last one is the most recent). The current message may or may not already be among them, so it is
 * dropped wherever it appears rather than assumed to be last.
 */
export function planningRequest(input: PlanningRequestInput): PlanningRequest {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (!planningContextEnabled(input.env)) return { text: prompt, sources: [], picturesSetAside: 0 };
  const setAside = Number(input.picturesSetAside);
  const picturesSetAside = Number.isFinite(setAside) && setAside > 0 ? Math.floor(setAside) : 0;

  const parts: string[] = [prompt];
  const sources: PlanningSource[] = [];

  const attachment = typeof input.attachmentText === 'string' ? input.attachmentText.trim() : '';
  if (attachment) {
    parts.push(`[The user attached file(s) with this message. Their content describes what to build:]\n${clip(attachment, PLANNING_ATTACHMENT_MAX)}`);
    sources.push('attachment');
  }

  const noFinishedApp = !input.userAppExists || input.appStillUnbuilt === true;
  // A message whose subject is a pointer into the conversation ("make this app") is sized from the
  // conversation: its chat turns count, and so does the last answer (autopsy 5759ad8b).
  const pointsAtConversation = noFinishedApp && refersToConversation(prompt);
  const candidates: string[] = [
    ...(Array.isArray(input.recentRequests) ? input.recentRequests : []),
    ...(Array.isArray(input.recentTurns)
      ? input.recentTurns.filter((t) => pointsAtConversation ? !!t && typeof t.text === 'string' : wasBuildRequest(t)).map((t) => t.text)
      : []),
  ];
  if (noFinishedApp && candidates.length > 0) {
    const own = prompt.trim();
    const earlier = candidates
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0 && r.trim() !== own)
      .slice(-PLANNING_EARLIER_REQUESTS);
    if (earlier.length > 0) {
      parts.push([
        input.userAppExists
          ? '[Earlier in this conversation — the app was started but never finished, so these still describe the app being asked for:]'
          : '[Earlier in this conversation — no app has been built yet, so these describe the app being asked for:]',
        ...earlier.map((r) => `- ${clip(r, PLANNING_EARLIER_REQUEST_MAX)}`),
      ].join('\n'));
      sources.push('earlier-requests');
    }
  }

  const reply = pointsAtConversation && typeof input.conversationReply === 'string' ? input.conversationReply.trim() : '';
  if (reply) {
    parts.push(`[The message refers to the conversation above. The last answer in it, which describes what to build:]\n${clip(reply, CONVERSATION_REPLY_MAX)}`);
    sources.push('conversation');
  }

  return { text: parts.join('\n\n'), sources, picturesSetAside };
}

/** The admin line for `PLANNING_CONTEXT`. PURE. */
export function planningContextNote(req: PlanningRequest, promptChars: number): string {
  const aside = req.picturesSetAside > 0
    ? ` ${req.picturesSetAside} attached picture(s) were not read as part of the request: they are photos, not UI designs, so their descriptions say what the picture shows, not what to build (the builder still sees them).`
    : '';
  if (req.sources.length === 0) return `Sized and planned from the message alone (${promptChars} characters).${aside}`;
  const what = req.sources.map((s) => (s === 'attachment'
    ? 'the attached file(s)'
    : s === 'conversation'
      ? 'the conversation\'s last answer (the message points at it)'
      : 'the earlier requests in this conversation')).join(' and ');
  return `Sized and planned from the message plus ${what} (${req.text.length} characters read, the message itself is ${promptChars}) — the same request the builder receives, so the complexity score, the ETA and the fast lane's file plan describe the app actually being built.${aside}`;
}
