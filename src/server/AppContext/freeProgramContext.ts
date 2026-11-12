// WHAT EVERY AI MAY SAY ABOUT FREE TOKENS WHILE THE FREE PROGRAM IS PAUSED (admin 2026-10-22).
//
// "User ko lagna hi nahi chahiye ki koi free token system tha bhi." The screens hide their reward surfaces
// (freeProgramPaused public flag), and the server refuses the free doors (lib/freeProgram.ts) — but the AIs read
// `AppKnowledgeBase`, which describes the referral ladder, welcome gifts and the rewards checklist as LIVE. Left alone,
// "how do I earn free tokens?" would be answered with a feature that does not exist right now.
//
// So, while paused: (1) the referral entry is not shown to any AI or on the /guide site, and (2) a message that is
// about free things carries a standing note telling the model the truth in one breath, without ever describing what
// was removed. Chat entitlements are untouched; describe the allowance and paid continuation honestly. PURE.

import type { AppFeature } from './AppKnowledgeBase';

/** Entries that describe the free program itself. Hidden from every AI and the docs site while it is paused. */
export const FREE_PROGRAM_FEATURE_IDS: ReadonlySet<string> = new Set(['referral']);

export function visibleKnowledgeBase(all: readonly AppFeature[], paused: boolean): AppFeature[] {
  return paused ? all.filter((f) => !FREE_PROGRAM_FEATURE_IDS.has(f.id)) : [...all];
}

/** A message that is about getting something for free, in English or the Hinglish people actually type. */
const FREE_TOPIC = /(free|reward|referr|refer\b|invite|bonus|trial|earn|gift|promo|coupon|welcome|muft|मुफ़्त|मुफ्त|free\s*token|credit|token)/i;

export const FREE_PROGRAM_PAUSED_NOTE = [
  'CURRENT FACT (do not contradict): New promotional token and referral awards are unavailable while this setting is paused. This does not remove the separate daily chat allowance or an eligible administrator-issued build grant.',
  'AI chat has a daily allowance; eligible additional use is charged from the wallet at the displayed rate. App building and other paid features require spendable credit.',
  'Do not promise a free welcome credit or a programme restart. If asked how to get credits, explain the offers actually available to that account and Wallet & Billing; never claim all chat or app building is free.',
  'If a user says their free tokens are gone or the wallet shows 0 with "Free trial ended", say their free trial has ended and adding credits lets them keep building — do not promise any refund, restoration or date.',
].join(' ');

/** The standing note for this message, or '' (not paused, or the message is not about free things). */
export function freeProgramNoteFor(message: string, paused: boolean): string {
  return paused && FREE_TOPIC.test(message) ? FREE_PROGRAM_PAUSED_NOTE : '';
}

