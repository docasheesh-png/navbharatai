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
