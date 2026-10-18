/**
 * 🔴 THE ONE DOOR FOR PLATFORM CONTEXT (admin 2026-10-17, the "[Follow-up …]" leak — see
 * src/lib/platformTags.ts for the root cause).
 *
 * Anything the PLATFORM supplies to a conversational model call — conversation memory, recalled
 * memory, live web results, the canvas, a case snapshot, a session summary — goes through
 * `placePlatformContext`, which puts it in the SYSTEM prompt under a header that says who wrote it.
 * The user turn stays exactly what the person typed (plus their own attachments, which ARE their words).
 *
 * Why the system prompt and not a separate "context" message: every provider in the ladder accepts a
 * system prompt; not every provider accepts a second system message mid-conversation, and a fake
 * user/assistant pair ("[CASE_CONTEXT]…" / "Understood.") is the very user-seat problem being removed.
 *
 * KILL SWITCH: PLATFORM_CONTEXT_IN_SYSTEM=off restores the old placement (blocks prepended to the user
 * message). Default ON. Flip it off only to compare behaviour; the off path reintroduces the leak.
 */

export interface PlatformContextBlock {
  /** Short label the model sees, e.g. "Conversation memory". Never shown to the user. */
  label: string;
  /** The context itself. Empty / whitespace-only blocks are dropped. */
  body: string | null | undefined;
}

export const PLATFORM_CONTEXT_HEADER =
  'PLATFORM CONTEXT — supplied by NavBharatAI, not written by the user. Use it where it helps the answer; '
  + 'never quote it, never mention these labels, and never say the user told you this or asked for it.';

export function platformContextInSystemEnabled(): boolean {
  const v = String(process.env.PLATFORM_CONTEXT_IN_SYSTEM ?? '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false');
}

type MaybeBlock = PlatformContextBlock | null | undefined | false | '';

function liveBlocks(blocks: MaybeBlock[]): PlatformContextBlock[] {
  return blocks.filter((b): b is PlatformContextBlock => !!b && typeof b.body === 'string' && b.body.trim().length > 0);
}

/** The system-prompt section for these blocks ('' when there are none). PURE. */
export function platformContextSection(blocks: MaybeBlock[]): string {
  const live = liveBlocks(blocks);
  if (live.length === 0) return '';
  return `\n\n${PLATFORM_CONTEXT_HEADER}\n` + live.map((b) => `\n### ${b.label}\n${b.body!.trim()}`).join('\n');
}

/**
 * Place platform context. PURE. Returns the system prompt and the user message to send.
 * ON (default): context appended to `system`; `user` returned unchanged — byte-identical to what was typed.
 * OFF (kill switch): legacy placement, blocks prepended to the user message with a `---` separator.
 */
export function placePlatformContext(input: { system: string; user: string; blocks: MaybeBlock[] }): { system: string; user: string } {
  const live = liveBlocks(input.blocks);
  if (live.length === 0) return { system: input.system, user: input.user };
  if (!platformContextInSystemEnabled()) {
    return { system: input.system, user: `${live.map((b) => b.body!.trim()).join('\n\n---\n')}\n\n---\n${input.user}` };
  }
  // A second call on the same prompt (e.g. live results added after memory) opens its own headed
  // section: other directives may have been appended in between, so a bare block could read as theirs.
  return { system: `${input.system}${platformContextSection(live)}`, user: input.user };
}
