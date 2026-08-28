// useGitHubConnect — the GitHub OAuth connect / disconnect / fetch slice, lifted out of the App.tsx
// God component (P3.1, behavior-preserving). Owns connectGitHub (start the OAuth handshake + redirect),
// disconnectGitHub (clear the local GitHub connection), fetchGitHubUser (load the authed user then its
// repos), and fetchUserRepos. Code moved BYTE-IDENTICAL — pure relocation, zero logic change. Deps are
// injected; App.tsx destructures the SAME identifiers back, so every JSX/effect caller is unchanged.

import { clearGithubConnection } from '../lib/githubTokenStore';
export interface GitHubConnectDeps {
  activeView: any;
  currentSessionId: string;
  setGithubRedirectingMessage: (v: any) => void;
  setGithubDebugData: (v: any) => void;
  setIsGHSyncing: (v: any) => void;
  setGithubUser: (v: any) => void;
  setRepositories: (v: any) => void;
  setGithubToken: (v: any) => void;
  addLog: (message: string, level?: any) => void;
}

export function useGitHubConnect(deps: GitHubConnectDeps) {
  const {
    activeView, currentSessionId,
    setGithubRedirectingMessage, setGithubDebugData, setIsGHSyncing, setGithubUser, setRepositories,
    setGithubToken, addLog,
  } = deps;

  const connectGitHub = async () => {
    // Save current view state before starting GitHub OAuth
    const returnPath = {
      activeView: activeView,
      currentSessionId: currentSessionId,
      timestamp: Date.now()
    };
    localStorage.setItem('github_oauth_return_state', JSON.stringify(returnPath));
    // Save the specific IDE panel to activate on mount
    localStorage.setItem('github_oauth_return_active_screen', 'git');

    // NATIVE (Capacitor) app: OAuth must open in an IN-APP browser and return via the app's custom URL
    // scheme, or the user is stranded on the website in an external browser (the reported bug). On the
    // web everything below is byte-for-byte unchanged.
    let isNative = false;
    try {
      const { Capacitor } = await import('@capacitor/core');
      isNative = Capacitor.isNativePlatform?.() === true;
    } catch { /* web — not native */ }

    // Pass the current URL as state so the server knows where to return the user. On native we send a
    // fixed sentinel instead, which tells the server callback to redirect the token back into the app
    // via its own custom scheme (see githubAuth.ts NATIVE_OAUTH_STATE).
    const state = isNative ? 'nbai-native' : window.location.href.split('#')[0];
    
    // ALWAYS HARDCODE THE SECURE PRODUCTION REDIRECT URI PER USER DIRECTIVE
    const redirectUri = "https://navbharatai.com/api/github/callback";

    setGithubRedirectingMessage('Opening GitHub authorization popup... Please wait or verify your browser popup block settings.');
    
    try {
      addLog('Initiating secure GitHub OAuth handshake...', 'info');
      
      const reqUrl = new URL(`${window.location.origin}/api/auth/github/url`);
      reqUrl.searchParams.set('redirect_uri', redirectUri);
      reqUrl.searchParams.set('state', state);

      // ASK FOR A TICKET, NOT THE TOKEN (security audit finding 1, HIGH). On native the OAuth result
      // comes back through `com.navbharat.ai://…`, and a custom URI scheme is claimable by any
      // installed app — while this token carries `repo workflow`, i.e. full read/write on all of the
      // user's private repositories. With this query AND a verified Firebase identity, the server
      // returns an encrypted, uid-bound ticket instead, which only this user can redeem.
      //
      // Both halves are sent together and the server needs both. If either is missing it falls back to
      // exactly today's behaviour, which is what keeps already-installed apps working: they run from
      // assets baked into their APK and cannot be changed by a server deploy.
      let authHeader: Record<string, string> = {};
      if (isNative) {
        reqUrl.searchParams.set('handoff', 'ticket');
        try {
          const { authJsonHeaders } = await import('../lib/authHeaders');
          authHeader = await authJsonHeaders();
        } catch {
          // No session to prove yet. The server will notice and issue the legacy state; sign-in still
          // works, just without the upgrade. Failing the whole flow here would be far worse.
        }
      }

      const response = await fetch(reqUrl.toString(), { headers: authHeader });
      
      if (!response.ok) {
        throw new Error('Failed to retrieve GitHub Authorization parameters from server context.');
      }
      
      const data = await response.json();
      if (!data.url) {
        throw new Error('Oauth URL parameters returned from server are invalid.');
      }

      // Safe URL construction using native browser URL constructor instead of string-concats
      const githubUrl = new URL(data.url);
      if (data.clientId) githubUrl.searchParams.set('client_id', data.clientId);
      githubUrl.searchParams.set('redirect_uri', redirectUri);
      if (data.scope) githubUrl.searchParams.set('scope', data.scope);
      if (data.state) githubUrl.searchParams.set('state', data.state);

      const finalOAuthUrl = githubUrl.toString();

      // Populate diagnosis details for in-app floating overlay popup debug representation
      setGithubDebugData({
        oauthUrl: finalOAuthUrl,
        redirectUri: redirectUri,
        currentDomain: window.location.origin,
        callbackUrl: redirectUri
      });

      addLog('Redirecting to GitHub for secure authentication...', 'info');
      setGithubRedirectingMessage('Opening GitHub… Please wait.');

      if (isNative) {
        // In-app browser (Custom Tab / SFSafariViewController). The app stays underneath; on success the
        // callback deep-links back via com.navbharat.ai://github-callback, which App.tsx's appUrlOpen
        // listener catches (it stores the token and closes this browser). No page navigation, so the app
        // is never replaced by the website.
        try {
          const { Browser } = await import('@capacitor/browser');
          await Browser.open({ url: finalOAuthUrl, presentationStyle: 'popover' });
        } catch (e: any) {
          addLog(`Could not open the in-app browser: ${e?.message || e}`, 'error');
          setGithubRedirectingMessage('Could not open GitHub. Please try again.');
        }
        return;
      }

      setTimeout(() => {
        try {
          if (window.self !== window.top) {
            window.top.location.href = finalOAuthUrl;
          } else {
            window.location.href = finalOAuthUrl;
          }
        } catch (e) {
          window.location.href = finalOAuthUrl;
        }
      }, 600);
    } catch (err: any) {
      addLog(`Failed to initiate GitHub OAuth: ${err.message}`, 'error');
      setGithubRedirectingMessage(`Authentication Flow Failed: ${err.message}`);
    }
  };

  const disconnectGitHub = () => {
    setGithubToken(null);
    setGithubUser(null);
    setRepositories([]);
    clearGithubConnection(); // gh_token + gh_token_signal + gh_owner_uid
    addLog('GitHub account disconnected.', 'info');
  };

  const fetchGitHubUser = async (token: string) => {
    setIsGHSyncing(true);
    try {
      const response = await fetch('/api/github/user', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch user');
      const user = await response.json();
      setGithubUser(user);
      fetchUserRepos(token);
    } catch (err: any) {
      addLog(`GitHub user fetch failed: ${err.message}`, 'error');
      if (err.message.includes('401')) disconnectGitHub();
    } finally {
      setIsGHSyncing(false);
    }
  };

  const fetchUserRepos = async (token: string) => {
    setIsGHSyncing(true);
    try {
      const response = await fetch('/api/github/repos', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch repos');
      const repos = await response.json();
      setRepositories(repos);
    } catch (err: any) {
      addLog(`Failed to load repositories: ${err.message}`, 'error');
    } finally {
      setIsGHSyncing(false);
    }
  };
  return { connectGitHub, disconnectGitHub, fetchGitHubUser, fetchUserRepos };
}
