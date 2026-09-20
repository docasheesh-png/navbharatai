// DOES THE MODEL'S THINKING GO TO THE USER'S CHAT? — one answer, read by every emit site.
//
// 🔴 WHY (admin, 2026-09-20, with two screenshots of a phone screen filled top to bottom with grey
// italic text): *"light/gray reply — bakwaas, yeh nahi chahiye!"*. What filled it was the model's own
// reasoning: *"The user asked to verify and finish, not start over. I need to read the full App.tsx…"*
// — a private working note, streamed verbatim to somebody who asked for a billing app.
//
// 🔑 IT WAS NOT MERELY LONG, IT WAS STRUCTURALLY UNFOLDABLE, and that is the part worth remembering.
// `FoldableMessage` collapses any reply over 700 characters — but it is skipped entirely while a line
// is still `streaming`, and a thinking line NEVER stops streaming: the reducer finalizes a line on the
// `narration` event, and `narration` carries only `kind: 'text'`. So the one guard that existed could
// not reach this channel by construction, however long the text grew.
//
// ⚠️ WHAT THIS DOES NOT TOUCH, because the reasoning is easy to get backwards: this switch governs
// whether reasoning is SHOWN, never whether it is GENERATED. Turning generation off is not ours to
// decide — Anthropic adaptive thinking is already off (`AgentV3Panel` pins `thinking = false`), the
// lead rung `glm-4.7-flashx` is already sent `thinking: disabled`, and the rungs below it
// (`kimi-k2.7-code`, `glm-5.3`) reason unconditionally and expose no switch at all: GLM's own error
// says so in words — *"This model always engages in thinking and cannot be disabled"* (glmThinking.ts).
// So the tokens are spent either way; the only question this file answers is who has to read them.
//
// 🔒 AND IT CANNOT RE-OPEN THE BLANK-SCREEN AUTOPSY (2b0a3ed5), which is the one real objection to
// removing a channel that fills silence. That silence is covered by a DIFFERENT mechanism — the
// elapsed-clock heartbeat (`startWorkingHeartbeat` → `workingLine`), which emits a narration line with
// a stable id while a long provider call is in flight, and is untouched here. Tool events and text
// deltas also keep flowing. Verified against the code, not assumed: the heartbeat is set up eight
// lines below the thinking emit this switch gates.

import { parseEnvFlag } from '../lib/envFlag';

/**
 * Should the reasoning channel be streamed to the chat surface? PURE.
 *
 * DEFAULT OFF. `AGENTV3_STREAM_THINKING=on` restores the pre-2026-09-20 behaviour exactly, with no
 * deploy — which is the only reason it is a flag rather than a deletion: this text has been on screen
 * for a long time, and an admin who wants it back should not have to wait for a build.
 *
 * ⚠️ An unreadable value means OFF, never ON. Somebody who wanted it on would type `on`; a value that
 * is present and unparseable can never have meant "show the user more" (the same reasoning
 * `parseRolloutPercent` uses for a malformed percentage).
 */
export function streamThinkingToChat(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_STREAM_THINKING) === true;
}
