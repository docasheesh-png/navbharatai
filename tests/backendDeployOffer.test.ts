import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { backendDeployOffer, DEPLOY_BACKEND_LABEL, type PublishRefusalCode } from '../src/lib/backendDeployOffer';
import { deployDecision, planDeployment } from '../src/server/AgentV3/deployPlan';

const REPO = { owner: 'asheesh', repo: 'my-app' };

describe('backendDeployOffer — the branch the publish refusal always assumed existed', () => {
  it('stays out of the way when publish was not refused', () => {
    expect(backendDeployOffer({ code: '' }).show).toBe(false);
    expect(backendDeployOffer({}).show).toBe(false);
    expect(backendDeployOffer({ code: 'something-new' }).show).toBe(false);
  });

  it('offers a real deploy when the app has a repo behind it', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: REPO, keySource: 'user' });
    expect(o.show).toBe(true);
    expect(o.canDeploy).toBe(true);
    expect(o.repoPath).toBe('asheesh/my-app');
    expect(o.note).toBe('');
  });

  it('names the account when the deploy would run on OUR key, without removing the button', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: REPO, keySource: 'server' });
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

  it('does not re-offer GitHub to someone already connected', () => {
    const o = backendDeployOffer({ code: 'backend-deploy-available', ownRepo: null, githubConnected: true });
    expect(o.cta).toBe('none');
    expect(o.steps.length).toBeGreaterThan(0);
  });

  it('a half-formed repo is no repo — it would build a request that cannot match', () => {
    expect(backendDeployOffer({ code: 'backend-deploy-available', ownRepo: { owner: 'asheesh', repo: '  ' } }).canDeploy).toBe(false);
    expect(backendDeployOffer({ code: 'backend-deploy-available', ownRepo: { owner: '', repo: 'my-app' } }).canDeploy).toBe(false);
  });

  it('with nothing able to deploy at all, the way in is the user own key', () => {
    const o = backendDeployOffer({ code: 'needs-server-hosting', ownRepo: REPO });
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
