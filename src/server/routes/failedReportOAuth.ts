import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { adminUsername, requireAdmin } from '../lib/adminAuth';
import { getServerDb } from '../lib/serverDb';
import { audit } from '../lib/audit';
import { routeParam } from '../lib/expressCompat';
import { reportOAuthService, ReportOAuthError, normalizeReportScope, REPORT_ORIGIN, REPORT_ISSUER, REPORT_RESOURCE, REPORT_RESOURCE_METADATA, REPORT_SCOPE, REPORT_SCOPES } from '../lib/failedReportOAuth';

export const failedReportOAuth = reportOAuthService(getServerDb, adminUsername);
export const reportOAuthChallenge = `Bearer resource_metadata="${REPORT_RESOURCE_METADATA}", scope="${REPORT_SCOPE}"`;

export function registerFailedReportOAuthRoutes(app: Express): void {
  const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    try { await fn(req, res, next); }
    catch (err) {
      if (err instanceof ReportOAuthError) res.status(err.status).json({ error: err.error, error_description: err.message });
      else res.status(503).json({ error: 'temporarily_unavailable', error_description: 'OAuth storage unavailable. Please retry later.' });
    }
  };
  const resourceMetadata = wrap((_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ resource: REPORT_RESOURCE, authorization_servers: [REPORT_ISSUER], scopes_supported: REPORT_SCOPES, bearer_methods_supported: ['header'], resource_name: 'NavBharat private failed build reports and autopsy metadata' });
  });
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/failedbr/mcp', '/.well-known/oauth-protected-resource/api/failedbr/mcp']) app.get(path, resourceMetadata);
  const serverMetadata = wrap((_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ issuer: REPORT_ISSUER, authorization_endpoint: `${REPORT_ISSUER}/authorize`, token_endpoint: `${REPORT_ISSUER}/token`, registration_endpoint: `${REPORT_ISSUER}/register`, revocation_endpoint: `${REPORT_ISSUER}/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], code_challenge_methods_supported: ['S256'], scopes_supported: REPORT_SCOPES });
  });
  // RFC 8414 discovery and the fallback paths used by older MCP clients.
  for (const path of ['/.well-known/oauth-authorization-server/api/v1/failedbr/oauth', '/.well-known/oauth-authorization-server', '/api/failedbr/oauth/.well-known/oauth-authorization-server', '/api/failedbr/oauth/.well-known/openid-configuration']) app.get(path, serverMetadata);
  const publicLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const registrationLimit = rateLimit({ windowMs: 3_600_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  // The OAuth form bodies (token, revoke) are parsed by the shared formBodyParser with their own
  // 16 KB / 20-field limits — see SMALL_BODY_ROUTES in src/server/lib/requestBodyLimits.ts.
  app.use('/api/failedbr/oauth', publicLimit);
  app.post('/api/failedbr/oauth/register', registrationLimit, wrap(async (req, res) => {
    if (!req.is('application/json')) { res.status(415).json({ error: 'invalid_request' }); return; }
    res.status(201).json(await failedReportOAuth.register(req.body ?? {}));
  }));
  app.get('/api/failedbr/oauth/authorize', wrap(async (req, res) => { res.redirect(303, await failedReportOAuth.authorize(req.query)); }));
  app.post('/api/failedbr/oauth/token', wrap(async (req, res) => { res.json(await failedReportOAuth.token(req.body ?? {}, req.headers.authorization)); }));
  app.post('/api/failedbr/oauth/revoke', wrap(async (req, res) => { await failedReportOAuth.revoke(req.body ?? {}, req.headers.authorization); res.status(200).end(); }));
  app.get('/api/admin/failedbr/oauth/request/:id', requireAdmin, wrap(async (req, res) => {
    res.json(await failedReportOAuth.pending(routeParam(req.params.id)));
  }));
  app.post('/api/admin/failedbr/oauth/request/:id', requireAdmin, wrap(async (req, res) => {
    if (req.headers.origin && ![REPORT_ORIGIN, 'https://www.navbharatai.com'].includes(req.headers.origin)) { res.status(403).json({ error: 'invalid_request' }); return; }
    if (typeof req.body?.approve !== 'boolean') { res.status(400).json({ error: 'invalid_request' }); return; }
    const id = routeParam(req.params.id);
    const redirect = req.body.scope === undefined
      ? await failedReportOAuth.decide(id, req.body.approve)
      : await failedReportOAuth.decide(id, req.body.approve, req.body.scope);
    audit('ADMIN_FAILED_REPORT_OAUTH_CONSENT', { admin: adminUsername(), requestId: id, approved: req.body.approve, scope: req.body.approve ? normalizeReportScope(req.body.scope) : null });
    res.json({ redirect });
  }));
}
