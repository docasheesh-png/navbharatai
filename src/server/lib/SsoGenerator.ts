// T2.7 (roadmap 2026-07-19) — Single Sign-On (OIDC) generator (Tier-2, enterprise).
//
// The audit's Enterprise ❌ included "SSO". This emits a real OpenID Connect login (works with any OIDC
// provider — Google, Okta, Auth0, Azure AD, Keycloak, …) built on the standard `openid-client` library:
//   • server/lib/sso.ts — lazy provider discovery from the issuer URL + an authorization-URL builder,
//   • server/routes/sso.routes.ts — /auth/sso/login (redirect, with state+nonce) and /auth/sso/callback
//     (code → token exchange → verified claims → app session).
// Bring-Your-Own credentials (OIDC_ISSUER / CLIENT_ID / CLIENT_SECRET / REDIRECT_URI) — pasted into .env,
// NEVER stored. PURE builder → the caller writes the files. Real, complete code — no stubs.

export interface SsoConfig {
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const LIB = `import { Issuer, generators, type Client } from 'openid-client';

// Lazily discover the OIDC provider from its issuer URL and build a client. Works with any compliant
// provider (Google / Okta / Auth0 / Azure AD / Keycloak). Bring-Your-Own credentials via env.
let cached: Client | null = null;

export async function getSsoClient(): Promise<Client> {
  if (cached) return cached;
  const issuer = await Issuer.discover(process.env.OIDC_ISSUER as string);
  cached = new issuer.Client({
    client_id: process.env.OIDC_CLIENT_ID as string,
    client_secret: process.env.OIDC_CLIENT_SECRET as string,
    redirect_uris: [process.env.OIDC_REDIRECT_URI as string],
    response_types: ['code'],
  });
  return cached;
}

export { generators };
`;

const ROUTES = `import { Router, type Request } from 'express';
import { getSsoClient, generators } from '../lib/sso';

// Requires a session (express-session or equivalent) so the CSRF state + replay-guard nonce survive the
// round-trip to the provider. Mount: app.use('/auth/sso', ssoRouter).
type SessionReq = Request & { session: Record<string, unknown> };

const router = Router();

router.get('/login', async (req, res, next) => {
  try {
    const client = await getSsoClient();
    const state = generators.state();
    const nonce = generators.nonce();
    (req as SessionReq).session.sso = { state, nonce };
    res.redirect(client.authorizationUrl({ scope: 'openid email profile', state, nonce }));
  } catch (e) { next(e); }
});

router.get('/callback', async (req, res, next) => {
  try {
    const client = await getSsoClient();
    const params = client.callbackParams(req);
    const saved = ((req as SessionReq).session.sso ?? {}) as { state?: string; nonce?: string };
    const tokenSet = await client.callback(process.env.OIDC_REDIRECT_URI as string, params, {
      state: saved.state,
      nonce: saved.nonce,
    });
    const claims = tokenSet.claims(); // verified: signature, issuer, audience, expiry, nonce
    (req as SessionReq).session.user = { id: claims.sub, email: claims.email, name: claims.name };
    delete (req as SessionReq).session.sso;
    res.redirect('/');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  (req as SessionReq).session.user = undefined;
  res.json({ ok: true });
});

export default router;
`;

/** Generate a real OIDC SSO integration (any provider). Pure — returns the files. Never throws. */
export function generateSsoIntegration(): SsoConfig {
  return {
    files: {
      'server/lib/sso.ts': LIB,
      'server/routes/sso.routes.ts': ROUTES,
      [ENV_EXAMPLE]: 'OIDC_ISSUER=\nOIDC_CLIENT_ID=\nOIDC_CLIENT_SECRET=\nOIDC_REDIRECT_URI=\n',
    },
    envKeys: ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'],
    dependencies: [
      { name: 'openid-client', version: '^5' },
      { name: 'express-session', version: '^1' },
    ],
    instructions:
      'Wired OpenID Connect SSO (works with Google / Okta / Auth0 / Azure AD / Keycloak). In .env set ' +
      'OIDC_ISSUER (the provider\'s issuer URL), OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI ' +
      '(= your app + /auth/sso/callback) — NavBharatAI never stores them. Enable a session ' +
      '(app.use(session({...}))) and mount the routes: app.use(\'/auth/sso\', ssoRouter). Send users to ' +
      '/auth/sso/login; after login req.session.user has { id, email, name }. Register the redirect URI in ' +
      'the provider console.',
  };
}
