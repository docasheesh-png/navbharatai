import { createHash } from 'node:crypto';
import { TEST_CHAT_MAX_OUTPUT_TOKENS, TEST_CHAT_SYNTHETIC_OUTPUT_TOKENS, TEST_CHAT_SYNTHETIC_PROMPT, type TestChatAction } from '../../lib/testChatBot';
/** One server-owned derivation for preparation, signature binding and dispatch. A caller cannot choose data class or generation limits. */
export function testChatPayload(action: TestChatAction) {
  const synthetic = action.messages.length === 1 && action.messages[0].role === 'user' && action.messages[0].content === TEST_CHAT_SYNTHETIC_PROMPT;
  return { synthetic, privateTurn: !synthetic, healthTurn: !synthetic,
    body: { messages: action.messages, max_tokens: synthetic ? TEST_CHAT_SYNTHETIC_OUTPUT_TOKENS : TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false as const } };
}
export const testChatUid = (actor: string) => `admin-test-chat:${createHash('sha256').update(actor).digest('hex')}`;
export const testChatRequestId = (action: TestChatAction) => `test-chat:${action.provider}:${action.requestId}`;
