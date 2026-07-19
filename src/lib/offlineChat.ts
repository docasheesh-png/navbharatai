// Offline conversational layer (admin ask 2026-07-18: "offline AI chat me bot jaisa respond kare").
// HONEST SCOPE (rules 2 & 3): this is NOT an offline language model and does NOT "think" — real reasoning
// needs the online engine. It is a deterministic conversational wrapper over the Offline AI's real skills
// (app guide, math, date/time, greetings, taught memory, phone-settings help). It makes the experience
// FEEL like a chat bot — turn-by-turn replies in a natural sentence — WITHOUT ever inventing a fact: for
// anything requiring real reasoning / open knowledge it honestly points the user online. Pure & testable.

import { answerOffline, searchFeatures, type QuickAnswerKind, type DeviceHelp } from './offlineAssistant';
import type { AppFeature } from '../server/AppContext/AppKnowledgeBase';
import type { UserMemory, ParsedTeaching } from './offlineMemory';

// A feature is a CONFIDENT answer only at a keyword-level match (score ≥ 3). Below that, a match is a
// coincidental keyword graze (e.g. "capital of france" → an accounting feature via the word "capital"),
// so we do NOT present it as an answer — we honestly send the user online instead of showing a misleading
// card. (This is stricter than the search UI on purpose: a chat reply reads as an answer, a search result
// reads as a suggestion.)
const CONFIDENT_FEATURE_SCORE = 3;

const NONE_TEXT =
  "I can't answer that one offline — it needs the internet. But I can open any NavBharatAI feature for you, do a calculation, tell the date & time, fix a phone-settings problem, or remember something you teach me. Tap Ask online for the rest.";
const CAPABILITIES_TEXT =
  "I can guide you around NavBharatAI, do quick calculations, tell you the date & time, remember anything you teach me, and help fix phone-settings problems — all offline. What do you need?";

export interface ChatReply {
  /** The bot's conversational reply text. */
  text: string;
  /** Category of a deterministic answer (drives the reply's small icon), if any. */
  answerKind?: QuickAnswerKind | 'memory';
  /** App-guide feature cards to render under the reply (each may carry a working "Open" target). */
  features: AppFeature[];
  /** Phone/device-settings help cards to render under the reply. */
  deviceMatches: DeviceHelp[];
  /** True when the honest answer is "this needs the internet" — the UI offers an "ask online" action. */
  online: boolean;
}

/**
 * Produce the bot's reply to a user message, purely from on-device skills. Never invents an open-knowledge
 * fact — returns a real computation, real feature/phone-help cards, the user's own taught text, or an
 * honest "go online for that". Pure given `now` and `memories`. (Teaching commands are handled by the
 * caller via parseTeaching + teachAck, so they get an explicit confirmation reply.)
 */
export function buildChatReply(query: string, now: Date = new Date(), memories: UserMemory[] = []): ChatReply {
  const a = answerOffline(query, now, memories);

  // A deterministic on-device answer (math / date / greeting / identity / recalled memory). The reply IS
  // the text — a bot must NOT dump feature/phone cards under a greeting or a calculation (that turned "hi"
  // into a wall of cards). Cards belong to "where is X / how do I Y" queries (the 'matches' path below).
  if (a.kind === 'answer') {
    return {
      text: a.answerText || '',
      answerKind: a.answerKind,
      features: [],
      deviceMatches: [],
      online: false,
    };
  }

  // "what can you do" — a capabilities tour.
  if (a.kind === 'overview') {
    return { text: CAPABILITIES_TEXT, features: a.matches, deviceMatches: [], online: false };
  }

  if (a.kind === 'matches') {
    const device = a.deviceMatches ?? [];
    // A phone-settings fix is a confident answer on its own.
    if (device.length) {
      return { text: a.lead, features: a.matches, deviceMatches: device, online: false };
    }
    // Feature-only: present cards ONLY when the top match is keyword-strong; otherwise it's a coincidental
    // graze of a general question, so answer honestly with "go online" and no misleading card.
    const confident = searchFeatures(query).some((m) => m.score >= CONFIDENT_FEATURE_SCORE);
    if (confident) {
      return {
        text: a.matches.length === 1 ? "Here it is 👇" : "Here's what I found in NavBharatAI 👇",
        features: a.matches,
        deviceMatches: [],
        online: false,
      };
    }
    return { text: NONE_TEXT, features: [], deviceMatches: [], online: true };
  }

  // 'none' — honestly out of offline scope.
  return { text: NONE_TEXT, features: [], deviceMatches: [], online: true };
}

/** A friendly confirmation shown after the user teaches the AI something (deterministic, on-device). Pure. */
export function teachAck(parsed: ParsedTeaching): string {
  return parsed.kind === 'qa'
    ? `Got it 👍 — when you ask “${parsed.trigger}”, I'll say “${parsed.text}”. Saved on this device only.`
    : `Got it 👍 — I'll remember: “${parsed.text}”. Saved on this device only.`;
}

/** The bot's opening line for a fresh chat (welcome state). Pure/static. */
export const CHAT_WELCOME =
  "Hi! I'm your on-device assistant — I work even without internet. Ask me where a feature is, a quick calculation, today's date, a phone-settings fix, or teach me something to remember. What can I help with?";
