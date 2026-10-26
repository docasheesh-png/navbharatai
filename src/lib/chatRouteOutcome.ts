/** A router's unavailable notice is not a completed AI answer, even when it contains text. */
export const CHAT_ROUTE_UNAVAILABLE = 'CHAT_ROUTE_UNAVAILABLE';

export function unavailableChatReply(reply?: string): {
  ok: false; code: typeof CHAT_ROUTE_UNAVAILABLE; reply: string;
} {
  return {
    ok: false,
    code: CHAT_ROUTE_UNAVAILABLE,
    reply: reply?.trim() ? reply : 'The AI service is temporarily unavailable. Please try again later.',
  };
}
