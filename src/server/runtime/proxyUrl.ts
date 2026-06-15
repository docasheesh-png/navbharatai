/**
 * Phase 3 — Pure helper for the server-container preview reverse proxy.
 * Maps an inbound `/preview-app/:sessionId/<rest>?<query>` request to the
 * internal dev-server URL `<origin>/<rest>?<query>`. Kept pure for unit tests.
 */
export function buildProxyUrl(origin: string, restPath: string, originalUrl: string): string {
  const base = origin.replace(/\/+$/, '');
  const path = (restPath || '').replace(/^\/+/, '');
  const qIdx = originalUrl.indexOf('?');
  const query = qIdx >= 0 ? originalUrl.slice(qIdx) : '';
  return `${base}/${path}${query}`;
}
