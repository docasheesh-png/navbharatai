/** Shared ordinary-chat timing contract. App Builder does not import these limits. */
export const CHAT_SERVER_DEADLINE_MS = 240_000;
/** Leave room for the terminal event and confirmed answer-credit settlement. */
export const CHAT_CLIENT_DEADLINE_MS = CHAT_SERVER_DEADLINE_MS + 15_000;
/** Pre-answer grace per eligible FreeChain attempt, not permission to retry visible output. */
export const CHAT_FIRST_CONTENT_MS = 15_000;
export const CHAT_PROVIDER_ATTEMPT_MS = 90_000;
