/** No headers or secrets are retained. null means a valid delay exceeds our proof bound. */
export function gatewayRetryAfterUntil(value: string | null | undefined, receivedAtMs: number): number | null | undefined {
  if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0 || typeof value !== 'string') return undefined;
  const text = value.trim(); if (!text) return undefined;
  if (text.length > 128) return null; // Never truncate an excessive delay into the default retry.
  let until: number;
  if (/^\d+(?:\.\d+)?$/.test(text)) until = receivedAtMs + Math.ceil(Number(text) * 1000);
  else {
    // HTTP-date, not permissive Date.parse interpretation of arbitrary numbers.
    if (!/^[A-Za-z]{3},?\s/.test(text)) return undefined;
    until = Date.parse(text); if (!Number.isFinite(until)) return undefined;
  }
  if (!Number.isSafeInteger(until) || until > receivedAtMs + 7 * 86_400_000) return null;
  return Math.max(receivedAtMs, until);
}
