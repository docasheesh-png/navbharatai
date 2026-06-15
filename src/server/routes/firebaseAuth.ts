import type { Express, Request, Response } from 'express';

/**
 * Firebase "DevOps link" consent + callback flow extracted from the server.ts
 * monolith (Phase 1). Self-contained (HTML responses only). Behavior unchanged.
 *
 * NOTE: this is a MOCK flow in the original code (it fabricates a token + mock
 * service-account JSON). Flagged for Phase 5 real-integration work.
 */
export function registerFirebaseAuthRoutes(app: Express): void {
  app.get('/api/auth/firebase', (req: Request, res: Response) => {
    const state = (req.query.state as string) || '';
    res.redirect(`/api/auth/firebase/consent?state=${encodeURIComponent(state)}`);
  });

  app.get('/api/auth/firebase/consent', (req: Request, res: Response) => {
    const state = (req.query.state as string) || '';
    const projects = [
      { id: 'navbharat-sandbox-7729', name: 'navBharat Sandbox (Default)' },
      { id: 'navbharat-saas-enterprise', name: 'navBharat SaaS Enterprise (Production)' },
      { id: 'navbharat-ecom-99a3', name: 'navBharat E-Commerce Portal' },
      { id: 'firebase-custom-build', name: 'Custom Firebase Target' }
    ];

    res.send(`
      <html>
        <head>
          <title>Authorize Firebase DevOps Pipeline - navBharatAI</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
          <style>
            body {
              background: #0d1117;
              color: #c9d1d9;
              font-family: 'Outfit', -apple-system, system-ui, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              box-sizing: border-box;
            }
            .card {
              background: #161b22;
              border: 1px solid #30363d;
              border-radius: 16px;
              padding: 32px;
              max-width: 480px;
              width: 100%;
              box-shadow: 0 12px 40px rgba(0,0,0,0.5);
              text-align: center;
            }
            h2 {
              color: #ffca28;
              margin-top: 0;
              font-size: 20px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 1px;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            }
            p.desc {
              font-size: 13px;
              color: #8b949e;
              margin-bottom: 24px;
              line-height: 1.6;
            }
            .auth-logos {
              display: flex;
              justify-content: center;
              align-items: center;
              gap: 16px;
              margin-bottom: 24px;
            }
            .logo-wrap {
              width: 38px;
              height: 38px;
              border-radius: 10px;
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid #30363d;
              display: flex;
              justify-content: center;
              align-items: center;
            }
            .badge-item {
              font-size: 10px;
              font-weight: 800;
              background: rgba(255, 202, 40, 0.1);
              color: #ffca28;
              border: 1px solid rgba(255, 202, 40, 0.2);
              padding: 4px 8px;
              border-radius: 6px;
              display: inline-block;
              margin-bottom: 16px;
            }
            .form-group {
              text-align: left;
              margin-bottom: 20px;
            }
            label {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              color: #8b949e;
              display: block;
              margin-bottom: 8px;
            }
            select, input {
              width: 100%;
              background: #0d1117;
              border: 1px solid #30363d;
              border-radius: 8px;
              padding: 10px 12px;
              color: white;
              font-size: 12px;
              font-weight: 600;
              outline: none;
              box-sizing: border-box;
            }
            select:focus, input:focus {
              border-color: #58a6ff;
            }
            .btn-primary {
              background: #ffca28;
              color: #121212;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              cursor: pointer;
              font-size: 13px;
              font-weight: 800;
              width: 100%;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              transition: all 0.2s;
              box-shadow: 0 4px 12px rgba(255, 202, 40, 0.2);
            }
            .btn-primary:hover {
              background: #ffd54f;
              transform: translateY(-1px);
              box-shadow: 0 6px 16px rgba(255, 202, 40, 0.3);
            }
            .footer-text {
              font-size: 10px;
              color: #484f58;
              margin-top: 16px;
              display: block;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="auth-logos">
              <div class="logo-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3.89 19.4L11.55 3.32C11.74 2.92 12.26 2.92 12.45 3.32L20.11 19.4C20.31 19.82 19.92 20.3 19.45 20.19L12.23 18.52C12.08 18.48 11.92 18.48 11.77 18.52L4.55 20.19C4.08 20.3 3.69 19.82 3.89 19.4Z" fill="#FFCA28"/>
                  <path d="M12.00 3.00C11.85 3.00 11.70 3.10 11.64 3.25L4.05 19.22C3.89 19.55 4.15 19.95 4.52 19.87L11.71 18.23C11.90 18.19 12.10 18.19 12.29 18.23L19.48 19.87C19.85 19.95 20.11 19.55 19.95 19.22L12.36 3.25C12.30 3.10 12.15 3.00 12.00 3.00Z" fill="#F57C00"/>
                </svg>
              </div>
              <div style="font-weight: 800; font-size: 18px; color: #8b949e;">&times;</div>
              <div class="logo-wrap" style="border-color: #58a6ff;">
                <span style="font-size: 13px; font-weight: 900; color: #58a6ff; font-family: monospace;">nB</span>
              </div>
            </div>

            <h2>Firebase DevOps Link</h2>
            <div class="badge-item">Secure Google Cloud Link</div>

            <p class="desc">Link your Firebase Project, obtain high-security deploy keys, and configure automated hosting updates safely in one-click.</p>

            <form action="/api/auth/firebase/callback" method="GET">
              <input type="hidden" name="state" value="${state}" />

              <div class="form-group">
                <label>Select Deployment Project</label>
                <select name="projectId" id="proj-selector" onchange="toggleCustomInput(this.value)">
                  ${projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
              </div>

              <div id="custom-field" class="form-group" style="display:none;">
                <label>Enter Custom Project ID</label>
                <input type="text" name="customProjectId" id="custom-id-input" placeholder="e.g. my-app-prod-391" />
              </div>

              <div class="form-group">
                <label>Developer Identity (Email)</label>
                <input type="email" name="email" value="firebase-admin@navbharat.com" required />
              </div>

              <button type="submit" class="btn-primary">
                Authorize & Bind Project
              </button>
            </form>

            <span class="footer-text">Security keys are encrypted and stored in local workspace environments.</span>
          </div>

          <script>
            function toggleCustomInput(val) {
              const cf = document.getElementById('custom-field');
              const input = document.getElementById('custom-id-input');
              if (val === 'firebase-custom-build') {
                cf.style.display = 'block';
                input.required = true;
              } else {
                cf.style.display = 'none';
                input.required = false;
              }
            }
          </script>
        </body>
      </html>
    `);
  });

  app.get('/api/auth/firebase/callback', (req: Request, res: Response) => {
    const { projectId, customProjectId, email, state } = req.query;
    const returnUrl = (state as string)?.startsWith('http') ? (state as string) : null;

    // Check for "Firebase callback failed"
    if (!projectId && !customProjectId) {
      const errorMsg = 'No Firebase Project ID or customized selection received during callback handshake.';
      const solutionMsg = 'Ensure you pick or specify a valid project ID on the Consent dialog screen and tap Authorize.';

      console.log('❌=== [FIREBASE CALLBACK FAILURE DEBUG] ===');
      console.log('❌ Error: Missing project details.');
      console.log('==========================================');

      return res.status(400).send(`
        <html>
          <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#161b22;border:1px solid #f8514940;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
              <h2 style="color:#f85149;margin-top:0;margin-bottom:8px;font-size:20px;font-weight:700;">Firebase Callback Failed</h2>
              <p style="font-size:13px;color:#8b949e;margin-bottom:24px;line-height:1.5;">${errorMsg}</p>
              <button onclick="window.close()" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:600;width:100%;">Close Window</button>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({
                  type: 'FIREBASE_AUTH_ERROR',
                  errorType: 'Firebase Callback Failed',
                  error: '${errorMsg}',
                  suggestions: '${solutionMsg}'
                }, '*');
              }
            </script>
          </body>
        </html>
      `);
    }

    const finalProjectId = projectId === 'firebase-custom-build' ? (customProjectId as string) : (projectId as string);
    const generatedToken = "1//0SB" + Math.random().toString(36).substring(2, 10).toUpperCase() + "_" + Math.random().toString(36).substring(2, 15);

    // Create random mock Service Account JSON
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      project_id: finalProjectId,
      private_key_id: "pk_" + Math.random().toString(16).substring(2, 14),
      private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDhv69v...\\n-----END PRIVATE KEY-----\\n",
      client_email: "firebase-adminsdk-q0p29@" + finalProjectId + ".iam.gserviceaccount.com"
    }, null, 2);

    const userObj = {
      name: "navBharat Firebase Operator",
      email: email || "firebase-admin@navbharat.com",
      projectId: finalProjectId,
      token: generatedToken,
      serviceAccount: serviceAccountJson,
      connectedAt: new Date().toLocaleString()
    };

    const userString = JSON.stringify(userObj);

    // Write to server logs
    console.log('✅=== [FIREBASE OAUTH CALLBACK DEBUG] ===');
    console.log('✅ Auth success payload:', userObj);
    console.log('✅ Generated token:', generatedToken);
    console.log('✅ Current origin:', req.headers.host);
    console.log('=========================================');

    res.send(`
      <html>
        <head>
          <title>Authentication Successful - Firebase DevOps Pipeline</title>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            #close-btn:hover { background-color: #d89b00; }
          </style>
        </head>
        <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
          <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
            <div style="margin-bottom:20px;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin: 0 auto;">
                <path d="M3.89 19.4L11.55 3.32C11.74 2.92 12.26 2.92 12.45 3.32L20.11 19.4C20.31 19.82 19.92 20.3 19.45 20.19L12.23 18.52C12.08 18.48 11.92 18.48 11.77 18.52L4.55 20.19C4.08 20.3 3.69 19.82 3.89 19.4Z" fill="#FFCA28"/>
              </svg>
            </div>
            <h2 style="color:#ffca28;margin-top:0;margin-bottom:8px;font-size:22px;font-weight:600;">Firebase Linked!</h2>
            <p style="font-size:14px;color:#8b949e;margin-bottom:24px;line-height:1.5;">Your Firebase project was bound to your DevOps Sandbox environment. Redirecting back...</p>

            <div style="width:24px;height:24px;border:3px solid #ffca28;border-top-color:transparent;border-radius:50%;animation:spin 1.2s linear infinite;margin:0 auto 24px auto;"></div>

            <button id="close-btn" onclick="handleReturnToApp()" style="background:#ffca28;color:#121212;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;width:100%;transition:all 0.2s;box-shadow:0 4px 12px rgba(255,202,40,0.3);text-transform:uppercase;letter-spacing:0.5px;">
              Return to navBharatAI
            </button>
          </div>

          <script>
            const token = '${generatedToken}';
            const userString = \`${userString}\`;
            const returnUrl = '${returnUrl || "https://navbharatai.com/"}';

            function handleReturnToApp() {
              try {
                localStorage.setItem('fb_token', token);
                localStorage.setItem('firebase_token', token);
                localStorage.setItem('firebase_token_signal', token);
                localStorage.setItem('fb_user', userString);
                localStorage.setItem('firebase_user', userString);
                localStorage.setItem('firebase_user_signal', userString);
                localStorage.setItem('v_deploy_platform', 'firebase');
              } catch(e) {
                console.error('Local storage write failure:', e);
              }

              try {
                if (window.opener) {
                  window.opener.postMessage({
                    type: 'FIREBASE_AUTH_SUCCESS',
                    token: token,
                    user: JSON.parse(userString)
                  }, '*');
                }
              } catch(e) {
                console.error('PostMessage handshake failure:', e);
              }

              window.close();

              // Fallback redirect
              setTimeout(() => {
                window.location.href = returnUrl + '#fb_token=' + token + '&fb_user=' + encodeURIComponent(userString) + '&firebase_token=' + token + '&firebase_email=' + encodeURIComponent("${email || ''}");
              }, 100);
            }

            // Auto-run connection sync and closure
            try {
              localStorage.setItem('fb_token', token);
              localStorage.setItem('firebase_token', token);
              localStorage.setItem('firebase_token_signal', token);
              localStorage.setItem('fb_user', userString);
              localStorage.setItem('firebase_user', userString);
              localStorage.setItem('firebase_user_signal', userString);
              localStorage.setItem('v_deploy_platform', 'firebase');

              if (window.opener) {
                window.opener.postMessage({
                  type: 'FIREBASE_AUTH_SUCCESS',
                  token: token,
                  user: JSON.parse(userString)
                }, '*');
                setTimeout(() => {
                  window.close();
                }, 1200);
              } else {
                setTimeout(() => {
                  window.location.href = returnUrl + '#fb_token=' + token + '&fb_user=' + encodeURIComponent(userString) + '&firebase_token=' + token + '&firebase_email=' + encodeURIComponent("${email || ''}");
                }, 1200);
              }
            } catch(e) {
              console.error('Handshake execution failure:', e);
            }
          </script>
        </body>
      </html>
    `);
  });
}
