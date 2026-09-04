import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { backendDeployOffer, DEPLOY_BACKEND_LABEL, type PublishRefusalCode } from '../src/lib/backendDeployOffer';
import { deployDecision, planDeployment } from '../src/server/AgentV3/deployPlan';

const REPO = { owner: 'asheesh', repo: 'my-app' };
const WS = 'ws-1';

describe('backendDeployOffer — the branch the publish refusal always assumed existed', () => {
  it('stays out of the way when publish was not refused', () => {
    expect(backendDeployOffer({ code: '' }).show).toBe(false);
    expect(backendDeployOffer({}).show).toBe(false);
    expect(backendDeployOffer({ code: 'something-new' }).show).toBe(false);
  });

  it('offers a real deploy when the app has a repo behind it', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: REPO, workspaceId: WS, keySource: 'user' });
    expect(o.show).toBe(true);
    expect(o.canDeploy).toBe(true);
    expect(o.repoPath).toBe('asheesh/my-app');
    expect(o.note).toBe('');
  });

  it('names the account when the deploy would run on OUR key, without removing the button', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: REPO, workspaceId: WS, keySource: 'server' });
    expect(o.canDeploy).toBe(true);
    expect(o.note).toMatch(/RENDER_API_KEY/);
  });

  it('never offers a press that could only fail — no repo means steps, not a button', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: null, githubConnected: false });
    expect(o.show).toBe(true);
    expect(o.canDeploy).toBe(false);
    expect(o.repoPath).toBe('');
    expect(o.steps.length).toBeGreaterThan(0);
    expect(o.cta).toBe('connect-github');
  });

  /**
   * ⚠️ REWRITTEN 2026-09-04, and this assertion WAS the bug it now guards against.
   *
   * It used to require `cta === 'none'` for a connected user — enforcing the very dead end the admin
   * screenshotted: the panel rendered numbered steps whose step 2 said *"push this app to a repo of
   * your own"*, and then offered **no control at all**, because every push in the product lived
   * inside the build route. The user had done everything asked of them and the screen had nothing.
   *
   * The property it was protecting is real and is kept in full — never re-offer *Connect GitHub* to
   * someone already connected. What changes is the conclusion drawn from it: the answer to "they are
   * connected" is the action that finishes the job, not the absence of one.
   */
  it('🔒 a connected user is offered the action that finishes the job, never a dead end', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: null, githubConnected: true });
    expect(o.cta).not.toBe('connect-github');   // the original property: no pointless re-connect
    expect(o.cta).toBe('push-to-github');       // and a real next step instead of silence
    expect(o.steps.length).toBeGreaterThan(0);
  });

  it('🔒 no path leaves steps with nothing to press — that is the whole failure class', () => {
    // Any state that shows prerequisites must also show the control for the FIRST one, or the user is
    // reading instructions they cannot act on.
    for (const githubConnected of [true, false]) {
      const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: null, githubConnected });
      expect(o.steps.length).toBeGreaterThan(0);
      expect(o.cta, `connected=${githubConnected} must offer an action`).not.toBe('none');
    }
  });

  it('the steps DESCRIBE the button beside them — instruction and control must match', () => {
    // The old steps told a connected user to "Connect GitHub", which they already had.
    const connected = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: null, githubConnected: true });
    expect(connected.steps.join(' ')).toContain('Put this app in my GitHub');
    expect(connected.steps.join(' ')).not.toContain('Connect GitHub');
    const notConnected = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: null, githubConnected: false });
    expect(notConnected.steps.join(' ')).toContain('Connect GitHub');
  });

  it('a half-formed repo is no repo — it would build a request that cannot match', () => {
    expect(backendDeployOffer({ code: 'backend-deploy-available', ownRepo: { owner: 'asheesh', repo: '  ' }, workspaceId: WS }).canDeploy).toBe(false);
    expect(backendDeployOffer({ code: 'backend-deploy-available', ownRepo: { owner: '', repo: 'my-app' }, workspaceId: WS }).canDeploy).toBe(false);
  });

  it('a repo with no workspace is still no request — the button is not offered', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: REPO, workspaceId: '' });
    expect(o.canDeploy).toBe(false);
    expect(o.steps.length).toBeGreaterThan(0);
  });

  it('with nothing able to deploy at all, the way in is the user own key', () => {
    const o = backendDeployOffer({ code: 'needs-server-hosting', ownRepo: REPO, workspaceId: WS });
    expect(o.show).toBe(true);
    expect(o.canDeploy).toBe(false);
    expect(o.cta).toBe('save-render-key');
    expect(o.steps.join(' ')).toMatch(/RENDER_API_KEY/);
  });

  it('EVERY refusing code is handled — a new one cannot ship with no way to act on it', () => {
    const codes: PublishRefusalCode[] = ['', 'needs-server-hosting', 'backend-deploy-available'];
    for (const code of codes) {
      const o = backendDeployOffer({ code, ownRepo: null });
      if (code === '') { expect(o.show).toBe(false); continue; }
      expect(o.show).toBe(true);
      // Shown and unable to deploy ⇒ it MUST say what happens next. That is the dead end this closes.
      if (!o.canDeploy) expect(o.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('the refusal and the control cannot drift apart', () => {
  const FULLSTACK = {
    'package.json': JSON.stringify({
      dependencies: { express: '^4.18.0', react: '^18.2.0' },
      scripts: { start: 'node server.js', build: 'vite build' },
    }),
  };

  it('the server names the button by the SAME words the button carries', () => {
    const plan = planDeployment(FULLSTACK);
    expect(plan.staticHostingSufficient).toBe(false);
    const decision = deployDecision(plan, {
      canDeploy: true,
      requirement: 'Render is configured — a real deploy can run.',
      splitAdvised: false,
      wholeAppNote: 'Your website and your server share one address.',
    });
    expect(decision.code).toBe('backend-deploy-available');
    // The bug: this sentence named a control that existed nowhere. Now it names the shared label,
    // so a rename on either side fails here instead of recreating the dead end.
    expect(decision.message).toContain(DEPLOY_BACKEND_LABEL);
  });

  it('every code deployDecision can emit is one backendDeployOffer knows', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'server', 'AgentV3', 'deployPlan.ts'), 'utf8');
    const declared = src.match(/code:\s*''\s*\|[^;]*/);
    expect(declared).toBeTruthy();
    const emitted = Array.from(new Set(
      Array.from(declared![0].matchAll(/'([a-z-]*)'/g)).map((m) => m[1]),
    ));
    expect(emitted).toContain('backend-deploy-available');
    for (const code of emitted) {
      const o = backendDeployOffer({ code, ownRepo: null });
      if (code === '') { expect(o.show).toBe(false); continue; }
      expect(o.show, `refusal code "${code}" has no offer branch`).toBe(true);
      expect(o.canDeploy || o.steps.length > 0, `refusal code "${code}" leaves the user with nothing to do`).toBe(true);
    }
  });
});

/**
 * THE PUSH ACTION ITSELF (admin 2026-09-04) — the capability the steps had always described.
 *
 * Every `pushAll` in the product lived inside the BUILD route, so the only way to get your app into
 * your own GitHub repo was to run a build while a token happened to be attached. This is that same
 * capability (`UserGitHubClient.ensureRepo` + `GitRepoSync.pushAll`) exposed as an action.
 */
describe('🔒 POST /api/agentv3/github/push-app — the missing control, wired for real', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/github/push-app'");
    return at === -1 ? '' : route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('exists, and is ownership-checked before it touches anything', () => {
    expect(handler).not.toBe('');
    expect(handler).toContain('assertWorkspaceOwner(req, workspaceId)');
  });

  it('🔒 uses the USER\'S token, so the repo is theirs and their own host can read it', () => {
    // The platform-org mirror is invisible to the user's Render account; a deploy from it could only
    // ever fail, which is why deployRepo excludes it and why this must be their own account.
    expect(handler).toContain('new UserGitHubClient(githubToken)');
    expect(handler).toContain('repoOwnedByUser: true');
    expect(handler).toContain('res.status(401)');   // no token ⇒ refuse, never a platform-org fallback
  });

  it('🔒 seeds the sandbox first — an idle sweep would otherwise push an EMPTY repo', () => {
    // After the idle sweep the sandbox comes back empty while the app sits safe in the durable store.
    // Pushing then would replace the user's code with nothing.
    const prepAt = handler.indexOf('prepareSandboxForBuild');
    const pushAt = handler.indexOf('sync.pushAll');
    expect(prepAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(prepAt);
  });

  it('🔒 pushes to the PERSISTED repo name — never a second repo beside the real one', () => {
    // The same rule the build path follows: a stored name is a fact, and re-deriving it after a
    // rename would create an empty twin and strand the app in the original.
    expect(handler).toContain('rec?.repoName');
    expect(handler).toContain('|| repoNameForProject(');
  });

  it('a push that did not happen is reported as a failure, never as success', () => {
    expect(handler).toContain('if (!pushed.pushed && !pushed.noChange)');
    expect(handler).toContain('res.status(502)');
  });

  it('remembers the repo, so the screen knows about it on every later visit', () => {
    // Without this the fact lives only in a transient build event, which is what made the panel ask
    // for a repo the user already had.
    expect(handler).toContain('repoOwner: login');
  });
});

describe('🔒 the client offers it, and the screen updates without waiting for a build', () => {
  const chooser = readFileSync(join(__dirname, '..', 'src/components/agentv3/HostingChooser.tsx'), 'utf8');
  const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

  it('the button is rendered for the push-to-github state', () => {
    expect(chooser).toContain("backendOffer.cta === 'push-to-github'");
    expect(chooser).toContain('Put this app in my GitHub');
    expect(chooser).toContain("authedFetch('/api/agentv3/github/push-app'");
  });

  it('🔒 a fresh push is reflected immediately — the build event is not waited for', () => {
    // The `repo` event that carries this fact only fires during a build, so without the override the
    // panel would keep asking for a repo the user had just created.
    expect(panel).toContain('if (pushedRepo) return pushedRepo;');
    expect(panel).toContain('onRepoPushed={(r) =>');
  });

  it('a failed push shows the server\'s own reason, and says the app is safe', () => {
    expect(chooser).toContain("data?.error || 'Could not save your app to GitHub. Your app is safe here — try again.'");
  });
});
