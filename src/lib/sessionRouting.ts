/**
 * Session-surface routing — pure logic extracted from App.tsx's restore flow.
 *
 * Given a session's agent id and its optionally-saved tab, decides which chat
 * surface (Free / Pro / Vishwakarma/ASC / Doctor) the session belongs to and
 * which tab to open. Each surface owns separate message state, so routing a
 * restored session to the wrong one loses its history.
 */

import type { ViewType } from '../types';

export interface SessionSurface {
  isProSession: boolean;
  isAscSession: boolean;
  isSdaSession: boolean;
  targetTab: ViewType;
}

const CHAT_TABS = ['nbi_chat', 'nbi_pro_chat', 'asc_chat', 'sda_chat'];

/**
 * Resolve the surface + target tab for a session. `savedTab` (from the
 * session's persisted meta) takes precedence when it is a known chat tab;
 * otherwise the agent id drives the decision.
 */
export function resolveSessionSurface(agent: string, savedTab?: ViewType): SessionSurface {
  const isProAgent = agent === 'navbharatai-pro' || agent.includes('pro');
  const isVishwakarmaAgent = agent.startsWith('vishwakarma');

  const isProSession = savedTab === 'nbi_pro_chat' || isProAgent;
  const isAscSession = savedTab === 'asc_chat' || isVishwakarmaAgent;
  const isSdaSession = savedTab === 'sda_chat' || agent === 'sda';

  const targetTab: ViewType =
    savedTab && CHAT_TABS.includes(savedTab)
      ? savedTab
      : isAscSession ? 'asc_chat'
      : isProSession ? 'nbi_pro_chat'
      : isSdaSession ? 'sda_chat'
      : 'nbi_chat';

  return { isProSession, isAscSession, isSdaSession, targetTab };
}
