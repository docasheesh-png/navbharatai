/** OAuth 2.1 authorization-code + S256 PKCE for the private, read-only MCP resource.
 * No remote metadata fetching, cookies, process-local sessions or stored plaintext secrets.
 * The injected Firestore boundary also makes the complete flow testable without production data.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Firestore } from './serverDb';

export const REPORT_ORIGIN = 'https://navbharatai.com';
export const REPORT_RESOURCE = `${REPORT_ORIGIN}/api/v1/failedbr/mcp`;
export const REPORT_ISSUER = `${REPORT_ORIGIN}/api/v1/failedbr/oauth`;
export const REPORT_SCOPE = 'failed-reports:read';
export const REPORT_RESOURCE_METADATA = `${REPORT_ORIGIN}/.well-known/oauth-protected-resource/api/v1/failedbr/mcp`;
const CLIENTS = 'admin_failed_report_oauth_clients';
const REQUESTS = 'admin_failed_report_oauth_requests';
const ACCESS = 'admin_failed_report_access';
const DAY = 86_400_000;
const random = () => randomBytes(32).toString('base64url');
export const oauthHash = (s: string): string => createHash('sha256').update(s).digest('hex');
const equal = (a: unknown, b: string): boolean => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class ReportOAuthError extends Error {
  error: string;
  status: number;
  constructor(error: string, message: string, status = 400) { super(message); this.error = error; this.status = status; }
}
const fail = (error = 'invalid_request', message = 'Invalid OAuth request.'): never => { throw new ReportOAuthError(error, message); };
function field(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value;
}
function resource(value: unknown): void {
  if (value !== undefined && value !== REPORT_RESOURCE) fail('invalid_target', 'This authorization is only for the failed-report MCP resource.');
}
export function validReportRedirect(value: unknown): string {
  const raw = field(value, 512);
  let u: URL;
  try { u = new URL(raw); } catch { return fail('invalid_redirect_uri', 'Use an absolute HTTPS redirect URL.'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) || u.username || u.password || u.hash) return fail('invalid_redirect_uri', 'Use HTTPS (HTTP is allowed only for loopback clients), without credentials or fragments.');
  return raw; // Exact registered string, never a prefix or wildcard match.
}
function redirectTo(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
export function reportOAuthService(getDb: () => Firestore | null, owner: () => string, now = Date.now) {
  const db = () => { const d = getDb(); if (!d) throw new Error('OAuth storage unavailable.'); return d; };
  // Transactional caps prevent public registration/authorization from becoming unbounded storage.
  async function boundedCreate(collection: string, id: string, data: Record<string, unknown>, cap = 100) {
    const d = db();
    await d.runTransaction(async tx => {
      const rows = await tx.get(d.collection(collection).limit(cap + 1));
      const expired = rows.docs.filter(x => Number(x.data().expiresAt) <= now());
      if (rows.size - expired.length >= cap) throw new ReportOAuthError('temporarily_unavailable', 'Connection capacity reached. Revoke old connections or retry later.', 503);
      for (const row of expired) tx.delete(row.ref);
      tx.create(d.collection(collection).doc(id), data);
    });
  }
  async function register(body: Record<string, unknown>) {
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 5) fail('invalid_client_metadata', 'Register one to five redirect URLs.');
    const redirect_uris = (body.redirect_uris as unknown[]).map(validReportRedirect);
    const client_name = body.client_name === undefined ? 'AI report client' : field(body.client_name, 60);
    const method = body.token_endpoint_auth_method ?? 'client_secret_post';
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(String(method))) fail('invalid_client_metadata', 'Unsupported token authentication method.');
    if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || body.grant_types.some(x => !['authorization_code', 'refresh_token'].includes(x)))) fail('invalid_client_metadata');
    if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.some(x => x !== 'code'))) fail('invalid_client_metadata');
    if (body.scope !== undefined && body.scope !== REPORT_SCOPE) fail('invalid_scope');
    const client_id = random(); const secret = method === 'none' ? undefined : random();
    const createdAt = now(); const expiresAt = createdAt + 30 * DAY;
    await boundedCreate(CLIENTS, client_id, { client_id, client_name, redirect_uris, method, secretHash: secret ? oauthHash(secret) : null, expiresAt });
    return { client_id, ...(secret ? { client_secret: secret, client_secret_expires_at: Math.floor(expiresAt / 1000) } : {}), client_id_issued_at: Math.floor(createdAt / 1000), client_name, redirect_uris, token_endpoint_auth_method: method, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: REPORT_SCOPE };
  }
  async function client(id: unknown) {
    const cid = field(id, 100); if (!/^[A-Za-z0-9_-]{43}$/.test(cid)) return fail('invalid_client');
    const c = (await db().collection(CLIENTS).doc(cid).get()).data();
    if (!c || c.expiresAt <= now()) return fail('invalid_client', 'Client registration expired. Reconnect the AI client.');
    return c;
  }
  async function authorize(query: Record<string, unknown>) {
    const c = await client(query.client_id);
    const uri = field(query.redirect_uri, 512);
    if (!c.redirect_uris.includes(uri)) fail('invalid_request', 'Redirect URL is not registered.');
    // Invalid requests stay on our origin; never redirect an unvalidated request to an attacker.
    if (query.response_type !== 'code') fail('unsupported_response_type');
    if (query.scope !== undefined && query.scope !== REPORT_SCOPE) fail('invalid_scope');
    if (query.code_challenge_method !== 'S256' || typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge)) fail('invalid_request', 'S256 PKCE is required.');
    resource(query.resource);
    const state = query.state === undefined ? '' : field(query.state, 1024);
    const id = oauthHash(random());
    await boundedCreate(REQUESTS, id, { clientId: c.client_id, clientName: c.client_name, redirectUri: uri, challenge: query.code_challenge, state, status: 'pending', expiresAt: now() + 10 * 60_000 });
    return `${REPORT_ORIGIN}/failedbr?oauth_request=${id}`;
  }
  async function pending(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return fail();
    const r = (await db().collection(REQUESTS).doc(id).get()).data();
    if (!r || r.status !== 'pending' || r.expiresAt <= now()) return fail('invalid_request', 'Authorization expired or was already handled. Start again from the AI client.');
    return { clientName: String(r.clientName), redirectUri: String(r.redirectUri), scope: REPORT_SCOPE };
  }
  async function decide(id: string, approve: boolean) {
    if (!/^[a-f0-9]{64}$/.test(id)) return fail();
    const d = db(); const ref = d.collection(REQUESTS).doc(id); const secret = random();
    return d.runTransaction(async tx => {
      const r = (await tx.get(ref)).data();
      if (!r || r.status !== 'pending' || r.expiresAt <= now()) return fail('invalid_request', 'Authorization expired or was already handled.');
      if (!approve) { tx.delete(ref); return redirectTo(r.redirectUri, { error: 'access_denied', ...(r.state ? { state: r.state } : {}) }); }
      const code = `nbfcode_${id}.${secret}`;
      tx.update(ref, { status: 'approved', owner: owner(), codeHash: oauthHash(code), expiresAt: now() + 120_000 });
      return redirectTo(r.redirectUri, { code, ...(r.state ? { state: r.state } : {}) });
    });
  }
  async function authenticate(body: Record<string, unknown>, authorization?: string) {
    let id = body.client_id; let secret = body.client_secret; let method = secret === undefined ? 'none' : 'client_secret_post';
    if (authorization) {
      if (!authorization.startsWith('Basic ') || secret !== undefined) return fail('invalid_client');
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); const colon = decoded.indexOf(':');
      if (colon < 0) return fail('invalid_client');
      try { const basicId = decodeURIComponent(decoded.slice(0, colon)); if (id !== undefined && id !== basicId) return fail('invalid_client'); id = basicId; secret = decodeURIComponent(decoded.slice(colon + 1)); } catch { return fail('invalid_client'); }
      method = 'client_secret_basic';
    }
    const c = await client(id);
    if (c.method !== method || (method !== 'none' && !equal(c.secretHash, oauthHash(field(secret, 100))))) return fail('invalid_client');
    return c;
  }
  function tokens(id: string) {
    const access = `nbfo_${id}.${random()}`; const refresh = `nbfrt_${id}.${random()}`;
    return { access, refresh, accessHash: oauthHash(access), refreshHash: oauthHash(refresh) };
  }
  const response = (t: ReturnType<typeof tokens>, seconds: number) => ({ access_token: t.access, refresh_token: t.refresh, token_type: 'Bearer', expires_in: seconds, scope: REPORT_SCOPE });
  async function token(body: Record<string, unknown>, authorization?: string) {
    resource(body.resource);
    const c = await authenticate(body, authorization); const d = db();
    if (body.grant_type === 'authorization_code') {
      const code = field(body.code, 200); const match = /^nbfcode_([a-f0-9]{64})\.[A-Za-z0-9_-]{43}$/.exec(code);
      if (!match) return fail('invalid_grant');
      const verifier = field(body.code_verifier, 128);
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return fail('invalid_grant');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const id = oauthHash(random()); const t = tokens(id);
      await d.runTransaction(async tx => {
        const ref = d.collection(REQUESTS).doc(match[1]); const r = (await tx.get(ref)).data();
        const registry = await tx.get(d.collection(ACCESS).limit(100));
        if (!r || r.status !== 'approved' || r.expiresAt <= now() || r.owner !== owner() || r.clientId !== c.client_id || r.redirectUri !== body.redirect_uri || !equal(r.codeHash, oauthHash(code)) || !equal(r.challenge, challenge)) return fail('invalid_grant');
        if (registry.size >= 100) return fail('temporarily_unavailable', 'Revoke an old connection on /failedbr before connecting another client.');
        tx.delete(ref);
        tx.create(d.collection(ACCESS).doc(id), { id, label: `OAuth: ${String(c.client_name).slice(0, 53)}`, owner: owner(), scope: REPORT_SCOPE, clientId: c.client_id, resource: REPORT_RESOURCE, createdAt: now(), expiresAt: now() + 30 * DAY, accessExpiresAt: now() + 3_600_000, accessHash: t.accessHash, refreshHash: t.refreshHash });
      });
      return response(t, 3600);
    }
    if (body.grant_type === 'refresh_token') {
      if (body.scope !== undefined && body.scope !== REPORT_SCOPE) fail('invalid_scope');
      const raw = field(body.refresh_token, 200); const match = /^nbfrt_([a-f0-9]{64})\.[A-Za-z0-9_-]{43}$/.exec(raw);
      if (!match) return fail('invalid_grant');
      const t = tokens(match[1]);
      const seconds = await d.runTransaction(async tx => {
        const ref = d.collection(ACCESS).doc(match[1]); const g = (await tx.get(ref)).data();
        if (!g || g.owner !== owner() || g.clientId !== c.client_id || g.resource !== REPORT_RESOURCE || g.scope !== REPORT_SCOPE || g.expiresAt <= now() || !equal(g.refreshHash, oauthHash(raw))) return fail('invalid_grant');
        const ttl = Math.min(3600, Math.floor((g.expiresAt - now()) / 1000));
        if (ttl <= 0) return fail('invalid_grant');
        tx.update(ref, { accessHash: t.accessHash, refreshHash: t.refreshHash, accessExpiresAt: now() + ttl * 1000 });
        return ttl;
      });
      return response(t, seconds);
    }
    return fail('unsupported_grant_type');
  }
  async function tokenOk(header: unknown) {
    if (typeof header !== 'string') return false;
    const match = /^Bearer (nbfo_([a-f0-9]{64})\.[A-Za-z0-9_-]{43})$/.exec(header);
    if (!match) return false;
    const g = (await db().collection(ACCESS).doc(match[2]).get()).data();
    return !!g && g.owner === owner() && g.scope === REPORT_SCOPE && g.resource === REPORT_RESOURCE && g.expiresAt > now() && g.accessExpiresAt > now() && equal(g.accessHash, oauthHash(match[1]));
  }
  async function revoke(body: Record<string, unknown>, authorization?: string) {
    const c = await authenticate(body, authorization); const raw = field(body.token, 200);
    const match = /^(?:nbfo_|nbfrt_)([a-f0-9]{64})\.[A-Za-z0-9_-]{43}$/.exec(raw);
    if (!match) return;
    const d = db();
    await d.runTransaction(async tx => {
      const ref = d.collection(ACCESS).doc(match[1]); const g = (await tx.get(ref)).data();
      if (g && g.clientId === c.client_id && (equal(g.accessHash, oauthHash(raw)) || equal(g.refreshHash, oauthHash(raw)))) tx.delete(ref);
    });
  }
  return { register, authorize, pending, decide, token, tokenOk, revoke };
}
