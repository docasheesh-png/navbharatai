// AgentV3 — UNSEND transcript math (Slice 2).
//
// "Unsend" lets a user take back the LAST message they sent: the engine stops any in-flight build for
// that message and then FORGETS it everywhere it was recorded — the durable transcript (the provider's
// replayed memory) AND the workspace episodic memory. This module holds the ONE pure decision the
// transcript purge depends on: given the verbatim Claude-API transcript, how many head messages to KEEP
// so that the last real user prompt and everything the model produced after it are dropped.
//
// PURE + deterministic + no I/O, so the boundary math is unit-testable independently of the route and
// of either ConversationStore backend (in-memory + Firestore both call truncateMessages with this count).

/**
 * The transcript is stored as Claude-API-shaped {role, content} turns. In that format a `role: 'user'`
 * message is NOT always a human prompt — every TOOL RESULT the engine feeds back is also delivered in a
 * `user` turn (content = an array of `{type:'tool_result', ...}` blocks). So a genuine typed prompt is a
 * `user` turn that carries NO tool_result block: either a plain string, or a multimodal array of
 * text/image blocks. This discriminator is what lets unsend target the message the human actually sent,
 * never an internal tool round-trip that happens to wear the `user` role.
 */
export function isUserPromptMessage(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false;
  const msg = m as { role?: unknown; content?: unknown };
  if (msg.role !== 'user') return false;
  const content = msg.content;
  if (typeof content === 'string') return true; // a plain typed prompt
  if (Array.isArray(content)) {
    // A real prompt's blocks are text/image; a tool round-trip's blocks include a tool_result.
    return !content.some(
      (b) => b && typeof b === 'object' && (b as { type?: unknown }).type === 'tool_result',
    );
  }
  // Unknown content shape (never produced by the engine) — treat as NOT a prompt so unsend can't
  // accidentally truncate at a turn it doesn't understand.
  return false;
}

/**
 * How many head messages to KEEP so an unsend drops the last real user prompt and every message after it
 * (the model's whole response to that prompt). Returns the index of the last user-prompt message — i.e.
 * everything from that index onward is removed. When the transcript contains no user prompt at all there
 * is nothing to unsend, so it returns the full length (keep everything — a no-op truncate).
 */
export function unsendKeepCount(messages: readonly unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserPromptMessage(messages[i])) return i;
  }
  return messages.length;
}
