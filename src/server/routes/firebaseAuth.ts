import type { Express, Request, Response } from 'express';

/**
 * Firebase "DevOps link" consent + callback flow.
 *
 * The previous implementation was a MOCK: it showed fake Firebase project names
 * and fabricated a service-account JSON — users would complete the flow and
 * receive credentials that don't work with real Firebase APIs.
 *
 * Replaced with an honest "not yet available" page that explains the status
 * and gives real instructions. Real OAuth requires GCP IAM integration (Phase 6).
 */
export function registerFirebaseAuthRoutes(app: Express): void {
  const notAvailablePage = (message: string) => `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Firebase Integration — NavBharatAI</title>
        <style>
          body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, system-ui, sans-serif;
            display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 32px;
            max-width: 440px; width: 100%; text-align: center; }
          h2 { color: #f0883e; margin-top: 0; font-size: 18px; }
          p { color: #8b949e; font-size: 14px; line-height: 1.6; }
          code { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 2px 6px;
            font-family: monospace; font-size: 12px; color: #a5f3fc; }
          .close-btn { margin-top: 24px; padding: 10px 24px; background: #21262d; border: 1px solid #30363d;
            border-radius: 8px; color: #c9d1d9; cursor: pointer; font-size: 14px; }
          .close-btn:hover { background: #30363d; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="font-size:36px;margin-bottom:12px">🔥</div>
          <h2>Firebase Integration — Coming Soon</h2>
          <p>${message}</p>
          <p>To deploy to Firebase Hosting right now, use the Firebase CLI:</p>
          <p><code>npm install -g firebase-tools</code><br/>
             <code>firebase login &amp;&amp; firebase deploy --only hosting</code></p>
          <button class="close-btn" onclick="window.close()">Close</button>
        </div>
        <script>
          // Notify opener that auth was not completed (not an error — feature not available)
          try {
            if (window.opener) {
              window.opener.postMessage({ type: 'FIREBASE_AUTH_CANCELLED', reason: 'not_available' }, '*');
            }
          } catch (e) { /* cross-origin — ignore */ }
        </script>
      </body>
    </html>
  `;

  app.get('/api/auth/firebase', (_req: Request, res: Response) => {
    res.send(notAvailablePage('Firebase DevOps integration via OAuth is not yet available.'));
  });

  app.get('/api/auth/firebase/consent', (_req: Request, res: Response) => {
    res.send(notAvailablePage('Firebase DevOps integration via OAuth is not yet available.'));
  });

  app.get('/api/auth/firebase/callback', (_req: Request, res: Response) => {
    res.send(notAvailablePage('Firebase OAuth callback — integration not yet available.'));
  });

  app.post('/api/auth/firebase/connect', (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Firebase DevOps integration not yet implemented. Use Firebase CLI to deploy.' });
  });
}
