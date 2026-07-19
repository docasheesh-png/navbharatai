import axios from 'axios';
import type { Express, Request, Response } from 'express';
import { sendSafeError } from '../lib/httpError';

// Production redirect URI is hardcoded per the original code's explicit directive.
const GITHUB_REDIRECT_URI = 'https://navbharatai.com/api/github/callback';
const GITHUB_SCOPE = 'repo workflow read:user user:email';

// Origins the OAuth flow may hand the (repo+workflow scope) token back to. The token must
// NEVER be redirected to an attacker-controlled origin supplied via the OAuth `state` param.
const ALLOWED_RETURN_ORIGINS = new Set<string>([
  'https://navbharatai.com',
  'https://www.navbharatai.com',
  'https://navbharatai.web.app',
  'https://navbharatai.firebaseapp.com',
  ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
]);

/** Returns the URL only if its origin is allow-listed; otherwise null (blocks open-redirect token exfil). */
function safeReturnUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('http')) return null;
  try {
    return ALLOWED_RETURN_ORIGINS.has(new URL(raw).origin) ? raw : null;
  } catch {
    return null;
  }
}

/** Encode a value as a safe JS string literal for embedding inside an inline <script>. */
function jsLiteral(s: string): string {
  return JSON.stringify(String(s ?? ''));
}

/** Escape a value for an HTML text context. */
function htmlEscape(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * The EXACT origin the OAuth popup may `postMessage` the GitHub token back to — never '*'.
 * A wildcard target lets any page that opened the popup (`window.opener`) read the token.
 * `returnUrl` is either allow-listed (`safeReturnUrl`) or the hardcoded platform fallback, so its
 * origin is always the legitimate NavBharatAI origin the opener is expected to be on. Any malformed
 * value falls back to the canonical production origin (never a wildcard).
 */
export function oauthTargetOrigin(returnUrl: string | null | undefined): string {
  try {
    return new URL(returnUrl || 'https://navbharatai.com').origin;
  } catch {
    return 'https://navbharatai.com';
  }
}

/**
 * GitHub OAuth routes (authorize URL, redirect, token-exchange callback, user
 * profile) extracted from the server.ts monolith (Phase 1). Self-contained —
 * uses only env (GITHUB_CLIENT_ID/SECRET) and axios. Behavior unchanged.
 */
export function registerGithubAuthRoutes(app: Express): void {
  app.get('/api/auth/github/url', (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'GitHub Client ID not configured' });

    const state = (req.query.state as string) || '';
    const redirectUri = GITHUB_REDIRECT_URI;
    const scope = GITHUB_SCOPE;

    // Safely generate using URL() API to prevent malformed slashes or parameter encoding
    const githubUrl = new URL('https://github.com/login/oauth/authorize');
    githubUrl.searchParams.set('client_id', clientId);
    githubUrl.searchParams.set('redirect_uri', redirectUri);
    githubUrl.searchParams.set('scope', scope);
    githubUrl.searchParams.set('state', state);

    console.log('[GITHUB_AUTH_URL] Safe URL construction succeeded:', githubUrl.toString());

    res.json({
      url: githubUrl.toString(),
      clientId: clientId,
      redirectUri: redirectUri,
      scope: scope,
      state: state
    });
  });

  app.get('/api/auth/github', (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'GitHub Client ID not configured' });

    // Support state for returning to the original page
    const state = (req.query.state as string) || '';
    const redirectUri = GITHUB_REDIRECT_URI;
    const scope = GITHUB_SCOPE;

    // Safely generate using URL() API to prevent malformed redirect strings
    const githubUrl = new URL('https://github.com/login/oauth/authorize');
    githubUrl.searchParams.set('client_id', clientId);
    githubUrl.searchParams.set('redirect_uri', redirectUri);
    githubUrl.searchParams.set('scope', scope);
    githubUrl.searchParams.set('state', state);

    console.log(`[GITHUB_AUTH] Redirecting to: ${githubUrl.toString()}`);
    res.redirect(githubUrl.toString());
  });

  app.get(['/api/auth/github/callback', '/auth/github', '/api/github/callback'], async (req: Request, res: Response) => {
    const { code, state } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = GITHUB_REDIRECT_URI;

    if (!code) return res.status(400).json({ error: 'No code provided' });

    try {
      console.log(`[GITHUB_AUTH_CALLBACK] Fetching access token from GitHub. Redirect URI: ${redirectUri}`);
      const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      }, {
        headers: { Accept: 'application/json' }
      });

      const { access_token, error, error_description } = response.data;
      if (error) throw new Error(error_description || error);

      // Only honour an allow-listed return URL — a crafted `state=https://evil.com` must not
      // be able to exfiltrate the token via redirect.
      const returnUrl = safeReturnUrl(state as string);

      if (returnUrl) {
        // Full redirect flow: token in fragment (fragment is safer for tokens), URL-encoded.
        return res.redirect(`${returnUrl}#gh_token=${encodeURIComponent(access_token)}`);
      }

      // Popup flow with dual local storage sync + opener postMessage
      res.send(`
        <html>
          <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
              <div style="margin-bottom:20px;">
                <svg height="48" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="48" style="fill:#ffffff;margin:0 auto;">
                  <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.35 3.12.88.01.47.01.84.01.93 0 .22-.17.47-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
              </div>
              <h2 style="color:#58a6ff;margin-top:0;margin-bottom:8px;font-size:22px;font-weight:600;">GitHub Authentication Successful!</h2>
              <p style="font-size:14px;color:#8b949e;margin-bottom:24px;line-height:1.5;">Your account was successfully connected to navBharatAI. Closing window and redirecting to work...</p>

              <div style="width:24px;height:24px;border:3px solid #58a6ff;border-top-color:transparent;border-radius:50%;animation:spin 1.2s linear infinite;margin:0 auto 24px auto;"></div>

              <button id="close-btn" onclick="handleReturnToApp()" style="background:#238636;color:white;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;width:100%;transition:background-color 0.2s;box-shadow:0 4px 12px rgba(35,134,54,0.3);">
                Return to navBharatAI
              </button>
            </div>

            <style>
              @keyframes spin { to { transform: rotate(360deg); } }
              #close-btn:hover { background-color: #2ea043; }
            </style>

            <script>
              const token = ${jsLiteral(access_token)};
              const returnUrl = ${jsLiteral(returnUrl || "https://navbharatai.com/")};
              // Post the (repo+workflow scope) token ONLY to this exact trusted origin, never '*'
              // (a wildcard target would let any page that opened this popup read the token).
              const targetOrigin = ${jsLiteral(oauthTargetOrigin(returnUrl))};

              function handleReturnToApp() {
                try {
                  localStorage.setItem('gh_token', token);
                  localStorage.setItem('gh_token_signal', token);
                } catch(e) {
                  console.error('Local storage write failure:', e);
                }

                try {
                  if (window.opener) {
                    window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: token }, targetOrigin);
                  }
                } catch(e) {
                  console.error('PostMessage handshake failure:', e);
                }

                window.close();

                // Fallback: if window.close() fails, redirect current window
                setTimeout(() => {
                  window.location.href = returnUrl + '#gh_token=' + token;
                }, 100);
              }

              // Auto-run connection sync and closure
              try {
                localStorage.setItem('gh_token', token);
                localStorage.setItem('gh_token_signal', token);

                if (window.opener) {
                  window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: token }, targetOrigin);
                  setTimeout(() => {
                    window.close();
                  }, 1200);
                } else {
                  // Direct tab fallback
                  setTimeout(() => {
                    window.location.href = returnUrl + '#gh_token=' + token;
                  }, 1200);
                }
              } catch(e) {
                console.error('Handshake execution failure:', e);
                // Fallback direct redirection
                setTimeout(() => {
                  window.location.href = returnUrl + '#gh_token=' + token;
                }, 1000);
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error('GitHub Auth Error:', err.message);
      res.send(`
        <html>
          <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
              <div style="margin-bottom:20px;">
                <svg height="48" viewBox="0 0 16 16" width="48" style="fill:#f85149;margin:0 auto;">
                  <path d="M6.457 1.047c.659-1.233 2.427-1.233 3.086 0l6.03 11.296c.614 1.15-.216 2.543-1.514 2.543H1.94c-1.298 0-2.128-1.393-1.514-2.543l6.03-11.296zm1.42 8.44a1 1 0 102 0v-3a1 1 0 00-2 0v3zM8 12.5a1 1 0 100-2 1 1 0 000 2z"></path>
                </svg>
              </div>
              <h2 style="color:#f85149;margin-top:0;margin-bottom:8px;font-size:22px;font-weight:600;">GitHub Connection Failed</h2>
              <p style="font-size:14px;color:#8b949e;margin-bottom:24px;line-height:1.5;word-break:break-word;">Error: ${htmlEscape(err.message)}</p>

              <button onclick="window.close()" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;width:100%;transition:background-color 0.2s;">
                Close Window
              </button>
            </div>

            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'GITHUB_AUTH_ERROR', error: ${jsLiteral(err.message)} }, '*');
                }
              } catch(e) {}
            </script>
          </body>
        </html>
      `);
    }
  });

  app.get('/api/github/user', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const response = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${token}` }
      });
      res.json(response.data);
    } catch (err: any) {
      sendSafeError(res, err.response?.status || 500, 'Could not load your GitHub profile.', err, 'github user');
    }
  });

  app.get('/api/github/repos', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const response = await axios.get('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: { Authorization: `token ${token}` }
      });
      res.json(response.data);
    } catch (err: any) {
      sendSafeError(res, err.response?.status || 500, 'Could not load your GitHub repositories.', err, 'github repos');
    }
  });
}
