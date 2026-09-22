/**
 * Session-surface routing — pure logic extracted from App.tsx's restore flow.
 *
 * Given a session's agent id and its optionally-saved tab, decides which chat surface
 * (Free / Pro / Doctor) the session belongs to and which tab to open. Each surface owns separate
 * message state, so routing a restored session to the wrong one loses its history.
 *
 * 🔴 THE LEGACY CASE THIS FILE EXISTS TO GET RIGHT (2026-09-12, when Vishwakarma was deleted).
 * The `asc_chat` surface is gone, but sessions SAVED against it are not — they sit in real users'
 * History with `agent: 'vishwakarma_pro'` or a `savedTab` of `asc_chat`. Dropping the branch without
 * replacing it would have sent those sessions to the FREE chat, which owns different message state,
 * so opening one would have shown an empty conversation: their history would look deleted.
 *
 * So a legacy Vishwakarma session now resolves to the **Pro** surface. That is the honest mapping —
 * Vishwakarma was the app-builder identity, and NavBharatAI Pro is what replaced it — and it keeps
 * every old transcript openable.
 */

import type { ViewType } from '../types';

export interface SessionSurface {
  isProSession: boolean;
  isSdaSession: boolean;
  targetTab: ViewType;
}

const CHAT_TABS = ['nbi_chat', 'nbi_pro_chat', 'sda_chat'];

/** A session saved before Vishwakarma was removed. Recognised so its transcript still opens. */
function isLegacyBuilderSession(agent: string, savedTab?: ViewType): boolean {
  return savedTab === ('asc_chat' as ViewType) || agent.startsWith('vishwakarma');
}

/**
 * Resolve the surface + target tab for a session. `savedTab` (from the session's persisted meta)
 * takes precedence when it is a known chat tab; otherwise the agent id drives the decision.
 */
export function resolveSessionSurface(agent: string, savedTab?: ViewType): SessionSurface {
  const isProAgent = agent === 'navbharatai-pro' || agent.includes('pro');

  // A legacy Vishwakarma session counts as a Pro session, which is what routes it to Pro's own
  // message state rather than the FREE chat's.
  const isProSession = savedTab === 'nbi_pro_chat' || isProAgent || isLegacyBuilderSession(agent, savedTab);
  const isSdaSession = savedTab === 'sda_chat' || agent === 'sda';

  const targetTab: ViewType =
    savedTab && CHAT_TABS.includes(savedTab)
      ? savedTab
      : isProSession ? 'nbi_pro_chat'
      : isSdaSession ? 'sda_chat'
      : 'nbi_chat';

  return { isProSession, isSdaSession, targetTab };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHOSE HISTORY IS THIS SESSION? (admin 2026-09-22: "navbharatai pro ki history sirf navbharatai
// pro me dikhe, navbharatai free ki sirf navbharatai free me … leakage to band karne ki bola tha")
//
// 🔴 THE DEFECT, AND IT IS ONE LINE REPEATED IN FOUR PLACES:
//
//     String(s.agent || s.current_agent || s.currentAgent || '')
//
// That reads the FIRST field that happens to be present and ignores every other one. A session
// carries its identity in up to five of them (`agent`, `current_agent`/`currentAgent`,
// `original_agent`/`originalAgent`) plus its tab and its document id — so overwriting ONE is enough
// to change what the session appears to be.
//
// And something does overwrite one. `useSessionManager.restoreSession` used to stamp
// `currentAgent: 'navbharatai'` on every restored non-v3 session, INCLUDING a NavBharatAI Pro
// builder session; App.tsx then syncs that to Firestore as `current_agent`; and the next load reads
// `agent: docData.current_agent || docData.original_agent`, so the session comes back calling itself
// `navbharatai`. From that moment it is a FREE session for ever — and it shows up in NavBharatAI
// Free's history, which is the leak that was reported.
//
// 🔒 READING EVERY FIELD IS THE FIX, not a longer keyword list. A session that says `agentv3` or
// `navbharatai-pro` in ANY of its agent fields is a Pro session, whatever a later writer did to one
// of them. That is what makes this resilient rather than merely correct today.
//
// ⚠️ WHAT WAS DELIBERATELY *NOT* WIDENED. The tab test still matches `engine_builder` and nothing
// else. `nbi_pro_chat` is tempting and would be a real regression: App.tsx's generic saver writes
// `tab: activeView`, so a FREE session that happened to autosave while the Pro tab was open would
// start classifying as Pro and VANISH from Free's history — trading the reported problem for its
// mirror image. `engine_builder` is written by AgentV3Panel alone, for v3 documents only.

/** Which surface's history a saved session belongs to. Exactly one, and Pro wins a tie. */
export type SessionOwner = 'pro' | 'doctor' | 'free';

/** Every field a session may carry its agent identity in — read together, never first-wins. */
const AGENT_FIELDS = ['agent', 'current_agent', 'currentAgent', 'original_agent', 'originalAgent'] as const;

const lower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

/** All of this session's agent ids, lowercased. Pure. */
function agentIdsOf(session: Record<string, unknown> | null | undefined): string[] {
  if (!session || typeof session !== 'object') return [];
  const out: string[] = [];
  for (const f of AGENT_FIELDS) {
    const v = lower((session as Record<string, unknown>)[f]);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Does this session belong to NavBharatAI Pro?
 *
 * The same three signals the code already used — a Pro/Vishwakarma/AgentV3 agent id, the
 * `engine_builder` tab, or a `v3_` document id — but asked of EVERY agent field rather than the
 * first one present. Pure.
 */
export function sessionIsPro(session: Record<string, unknown> | null | undefined): boolean {
  if (!session || typeof session !== 'object') return false;
  const ids = agentIdsOf(session);
  if (ids.some((a) => a.includes('pro') || a.includes('vishwakarma') || a.includes('agentv3'))) return true;
  const meta = (session as { meta?: { tab?: unknown } }).meta;
  if (lower((session as Record<string, unknown>).tab) === 'engine_builder' || lower(meta?.tab) === 'engine_builder') return true;
  return lower((session as Record<string, unknown>).id).startsWith('v3_');
}

/** Doctor AI. Pure. */
export function sessionIsDoctor(session: Record<string, unknown> | null | undefined): boolean {
  return agentIdsOf(session).some((a) => a.includes('sda') || a.includes('doctor'));
}

/**
 * The ONE answer both history lists ask, so they can never disagree about where a session belongs.
 *
 * Pro is tested FIRST and wins: it is the narrower, better-evidenced claim (a `v3_` id or an
 * `agentv3` agent is unambiguous), and the reported leak is Pro rows appearing in Free — so a tie
 * must resolve away from Free, never into it. Pure.
 */
export function sessionOwnerOf(session: Record<string, unknown> | null | undefined): SessionOwner {
  if (sessionIsPro(session)) return 'pro';
  if (sessionIsDoctor(session)) return 'doctor';
  return 'free';
}
