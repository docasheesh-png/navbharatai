// AgentV3 (Vargen 3.0) — rebuild a persisted build's chat history on reload (D7, option (a)).
//
// When the user reopens v3.0 after a refresh/reconnect, the backend ConversationStore (D7)
// returns the persisted build transcript. This pure module turns that transcript into the wire
// events needed to RE-DISPLAY the chat — only the architect narration (assistant text); the
// generated files come back via the existing git/restore path, not from the transcript (the
// admin-chosen "chat + git-restore" approach). Replaying these events through the existing,
// tested agentV3Reducer rebuilds the narration feed + workspaceId with no new reducer logic.

import type { AgentV3WireEvent } from './agentV3Types';

/** The shape returned by GET /api/agentv3/conversations/:id (mirror of the server record). */
export interface PersistedConversation {
  id: string;
  workspaceId: string;
  title: string;
  status: 'running' | 'complete' | 'stopped' | 'error';
  messages: unknown[];
  billedUsd?: number;
  updatedAt?: number;
}

/** Extract the visible text from a Claude message's `content` (a string or a block array). */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Rebuild the wire events that re-display a persisted build's chat history. Emits a `workspace`
 * event (so History → restore works), one `narration` line per assistant turn, and — for a build
 * that already finished — a `done` event so the UI is not stuck showing "building". A build whose
 * status is still `running` is left open (no `done`) so the user can Resume it.
 */
export function conversationToEvents(conv: PersistedConversation): AgentV3WireEvent[] {
  const events: AgentV3WireEvent[] = [];
  if (conv.workspaceId) events.push({ type: 'workspace', workspaceId: conv.workspaceId, ts: 0 });
  let ts = 1;
  for (const m of conv.messages ?? []) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'assistant') continue;
    const text = messageText(msg.content).trim();
    if (text) events.push({ type: 'narration', agent: 'architect', text, ts: ts++ });
  }
  if (conv.status === 'complete' || conv.status === 'stopped' || conv.status === 'error') {
    events.push({
      type: 'done',
      ok: conv.status === 'complete',
      summary: `Reloaded a previous build (${conv.status}).`,
      ts: ts++,
    });
  }
  return events;
}
