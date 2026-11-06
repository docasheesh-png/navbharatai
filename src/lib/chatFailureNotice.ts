/**
 * Trust-building chat failure notices (admin 2026-10-30). A failed reply must tell the user WHY in plain
 * words — never a vague "trouble reaching the AI" and never blame NavBharatAI's quality.
 *   - daily free limit / guest limit  → please login / come back tomorrow (server text wins)
 *   - wallet empty                     → insufficient balance, recharge (server text wins)
 *   - too fast                         → wait a minute
 *   - session expired                  → please login again
 *   - device offline                   → check your internet
 *   - any provider / 5xx / unknown     → high server load, try again shortly
 * PURE: no provider name, key, model or raw error ever reaches the user.
 */
export type ChatFailureReason = 'DAILY_LIMIT' | 'INSUFFICIENT_BALANCE' | 'RATE_LIMIT' | 'SESSION_EXPIRED' | 'OFFLINE' | 'HIGH_LOAD' | 'PRIVACY_POLICY';

/** Server codes whose own reply text is already user-safe and specific. */
export const USER_FACING_CHAT_CODES: Record<string, ChatFailureReason> = {
  CHAT_PRIVACY_BLOCKED: 'PRIVACY_POLICY',
  FREE_ANSWER_DAILY_LIMIT: 'DAILY_LIMIT',
  GUEST_DAILY_LIMIT: 'DAILY_LIMIT',
  WALLET_INSUFFICIENT: 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  FREE_ANSWER_RATE_LIMIT: 'RATE_LIMIT',
  FREE_ANSWER_ATTEMPT_LIMIT: 'RATE_LIMIT',
};

export const CHAT_FAILURE_TEXT: Record<ChatFailureReason, string> = {
  PRIVACY_POLICY: 'Chat is paused because this conversation is not approved under the current privacy policy.',
  DAILY_LIMIT: "Today's free messages are used up. Please login to continue (or come back after 12:00 AM IST).",
  INSUFFICIENT_BALANCE: 'Insufficient balance. Please recharge your wallet to continue chatting.',
  RATE_LIMIT: 'You are sending messages too quickly. Please wait a minute and try again.',
  SESSION_EXPIRED: 'Your session has expired. Please login again.',
  OFFLINE: 'Your internet connection seems to be off. Please check it and try again.',
  HIGH_LOAD: 'High server load right now. Please try again after some time.',
};

export function chatFailureReason(input: { status?: number; code?: unknown; offline?: boolean; networkError?: boolean }): ChatFailureReason {
  const code = typeof input.code === 'string' ? input.code : '';
  if (code && USER_FACING_CHAT_CODES[code]) return USER_FACING_CHAT_CODES[code];
  if (input.status === 402) return 'INSUFFICIENT_BALANCE';
  if (input.status === 429) return 'RATE_LIMIT';
  if (input.status === 401) return 'SESSION_EXPIRED';
  if (input.offline === true || (input.networkError === true && input.offline !== false)) return input.offline === true ? 'OFFLINE' : 'HIGH_LOAD';
  return 'HIGH_LOAD';
}

/** The text to show: a specific server reply for user-facing codes, otherwise our fixed notice. */
export function chatFailureNotice(input: { status?: number; code?: unknown; serverText?: unknown; offline?: boolean; networkError?: boolean }): { reason: ChatFailureReason; text: string } {
  const reason = chatFailureReason(input);
  const code = typeof input.code === 'string' ? input.code : '';
  const server = typeof input.serverText === 'string' ? input.serverText.trim() : '';
  const trusted = !!code && !!USER_FACING_CHAT_CODES[code] && server.length > 0;
  return { reason, text: trusted ? server.slice(0, 2000) : CHAT_FAILURE_TEXT[reason] };
}

export function browserOffline(): boolean {
  try { return typeof navigator !== 'undefined' && navigator.onLine === false; } catch { return false; }
}
