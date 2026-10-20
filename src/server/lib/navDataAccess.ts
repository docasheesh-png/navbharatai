import { createHmac, timingSafeEqual } from 'node:crypto';

/** A private player's bearer capability. Never store it in a bake, URL, cache or log. */
export const NAVDATA_TOKEN_TTL_MS = 60 * 60 * 1000;
export const NAVDATA_TOKEN_HEADER = 'X-NavData-Token';
type PrivateApp = { id: string; visibility: string; passwordHash?: string; passwordSalt?: string };

function signature(app: PrivateApp, expires: string): string {
  // Password changes revoke all outstanding capabilities, across all instances. The password
  // verifier stays server-side; the token reveals neither the verifier nor the plaintext.
  return createHmac('sha256', app.passwordHash!)
    .update(JSON.stringify(['navdata-v1', app.id, app.passwordSalt, expires])).digest('hex');
}

/** Call only AFTER the open route has verified the password. Public apps need no capability. */
export function mintNavDataToken(app: PrivateApp, now = Date.now()): string | null {
  if (app.visibility !== 'private') return null;
  if (!app.passwordHash || !app.passwordSalt) throw new Error('Private app credentials are unavailable.');
  const expires = String(now + NAVDATA_TOKEN_TTL_MS);
  return `${expires}.${signature(app, expires)}`;
}

export function canAccessNavData(app: PrivateApp, token: unknown, now = Date.now()): boolean {
  if (app.visibility !== 'private') return true;
  if (!app.passwordHash || !app.passwordSalt || typeof token !== 'string' || token.length > 100) return false;
  const match = /^(\d{1,16})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + NAVDATA_TOKEN_TTL_MS + 30_000) return false;
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(app, match[1]), 'hex'));
}

/** Added per authorized response, never to the shared compiled-player cache. */
export function withNavDataAccess(html: string, app: PrivateApp, now = Date.now()): string {
  const token = mintNavDataToken(app, now);
  const tag = `<script>window.__NBAI_NAVDATA_TOKEN=${JSON.stringify(token)};</script>`;
  return html.includes('<body>') ? html.replace('<body>', `<body>${tag}`) : tag + html;
}
