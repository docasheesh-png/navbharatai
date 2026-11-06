/** Only local messages reach the screen: upstream errors may echo credentials or prompts. */
export function mitrifyBotError(status: number, payload: unknown): string {
  const code = payload && typeof payload === 'object' && 'code' in payload ? payload.code : undefined;
  const messages: Record<string, string> = {
    MITRIFY_CONFIGURATION: 'Mitrify server configuration is missing, invalid, or was rejected. Check the server key binding and gateway URL.',
    MITRIFY_BOT_FORBIDDEN: 'This session is not authorized for Mitrify. Sign in again with the selected verified account.',
    MITRIFY_BOT_DISABLED: 'Mitrify is disabled on the server.',
    MITRIFY_BAD_REQUEST: 'Mitrify rejected the request. Check that the configured model alias is supported by the gateway.',
    MITRIFY_INVALID_RESPONSE: 'Mitrify returned an unreadable or empty reply. Check the gateway endpoint and response format.',
    MITRIFY_NETWORK: 'The server could not reach Mitrify. Check gateway availability and the server connection.',
    MITRIFY_CANCELLED: 'The request was cancelled or its time limit expired.',
    MITRIFY_QUEUE_FULL: 'Mitrify request capacity is full. Try again later.',
    MITRIFY_QUEUE_TIMEOUT: 'The request expired while waiting for capacity. Try again later.',
  };
  const known = typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : undefined;
  const http = Number.isInteger(status) && status >= 400 && status <= 599 ? ` (HTTP ${status})` : '';
  const message = known ?? (status === 429 ? 'The request was rate limited. Try again later.'
    : status === 503 ? 'The service is temporarily unavailable. Try again later.' : 'Mitrify could not complete the reply.');
  return `${message}${http} No other provider was used.`;
}
