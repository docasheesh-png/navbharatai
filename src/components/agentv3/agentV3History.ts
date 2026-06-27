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
  const msgs = conv.messages ?? [];
  // Timestamp by TRANSCRIPT POSITION (idx+1), not by assistant-only counter, so restored agent
  // narration interleaves correctly with the restored USER messages (which use the same scheme).
  msgs.forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'assistant') return;
    const text = messageText(msg.content).trim();
    if (text) events.push({ type: 'narration', agent: 'architect', text, ts: idx + 1 });
  });
  if (conv.status === 'complete' || conv.status === 'stopped' || conv.status === 'error') {
    events.push({
      type: 'done',
      ok: conv.status === 'complete',
      summary: `Reloaded a previous build (${conv.status}).`,
      ts: msgs.length + 1,
    });
  }
  return events;
}

/**
 * The build prompt persisted in the transcript is AUGMENTED server-side (a leading "Language: …"
 * instruction, recalled-lesson blocks, attachment text, an "Approved plan:" suffix). Strip those so
 * the restored user bubble shows what the user actually typed, not the engine's internal wrapping.
 */
export function cleanRestoredUserPrompt(text: string): string {
  let t = typeof text === 'string' ? text : '';
  // The real prompt always sits AFTER the last "\n\n---\n\n" separator (lessons / attachment blocks).
  const sep = '\n\n---\n\n';
  const last = t.lastIndexOf(sep);
  if (last !== -1) t = t.slice(last + sep.length);
  // Drop a leading single-line "Language: …" instruction paragraph.
  t = t.replace(/^Language:[^\n]*\n\n/, '');
  // Drop a trailing "Approved plan: …" block appended after plan approval.
  t = t.replace(/\n\nApproved plan:[\s\S]*$/, '');
  return t.trim();
}

/**
 * Rebuild the user's OWN chat messages from a persisted conversation (the part conversationToEvents
 * deliberately omits). Returns them as user-role chat rows with transcript-position timestamps so the
 * UI can merge them with the restored agent narration in the right order. Tool-result "user" turns
 * (no visible text) are skipped — only real prompts are kept.
 */
export function conversationToUserMessages(conv: PersistedConversation): Array<{ role: 'user'; text: string; ts: number }> {
  const out: Array<{ role: 'user'; text: string; ts: number }> = [];
  const msgs = conv.messages ?? [];
  msgs.forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'user') return;
    const text = cleanRestoredUserPrompt(messageText(msg.content).trim());
    if (text) out.push({ role: 'user', text, ts: idx + 1 });
  });
  return out;
}
