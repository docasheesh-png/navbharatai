import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { backendDeployOffer, shouldAutoDeployBackend, DEPLOY_BACKEND_LABEL } from '../src/lib/backendDeployOffer';

/**
 * ADMIN 2026-10-17: *"website connect, databse connect, backend connect ko simple banao"*.
 *
 * Counted in the user's own steps before anything was written:
 *
 *   database connect — 1 tap.
 *   website connect  — domain → 3 DNS records → Check.
 *   backend connect  — **press Publish → be REFUSED** → the card appears → connect GitHub → push a
 *                      repo → save a key → Deploy.
 *
 * The third began with a failure, and the condition was exact: the card's only input was a refusal
 * code, and that code exists only after a 422. The app's own files always said it had a server half.
 *
 * ⚠️ AND THE OBVIOUS FIX WOULD HAVE SPENT THE USER'S MONEY. Seeding the panel's `publishRefusalCode`
 * from a status read fires `shouldAutoDeployBackend`, which watches the TRANSITION into that code
 * precisely so that "reacting to the code merely BEING set" cannot deploy because somebody reopened a
 * panel — in their own Render account, on their own bill. Half of this file exists to keep those two
 * inputs apart forever.
 */
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const REPO = { owner: 'asheesh', repo: 'shop' };

describe('the server-half card appears WITHOUT a failed publish', () => {
  it('the fact alone shows it, with a live button when a deploy could already run', () => {
    const offer = backendDeployOffer({
      code: '',                                   // nothing was pressed, nothing was refused
      serverHalf: { canDeploy: true },
      ownRepo: REPO, githubConnected: true, keySource: 'user', workspaceId: 'w1',
    });
    expect(offer.show).toBe(true);
    expect(offer.canDeploy).toBe(true);
    expect(offer.repoPath).toBe('asheesh/shop');
  });

  it('the fact alone shows the PREREQUISITES when a deploy could not run yet', () => {
    const offer = backendDeployOffer({
      code: '', serverHalf: { canDeploy: false }, ownRepo: null, githubConnected: false, workspaceId: 'w1',
    });
    expect(offer.show).toBe(true);
    expect(offer.canDeploy).toBe(false);
    expect(offer.steps.length, 'never a wall with no way through it').toBeGreaterThan(0);
    expect(offer.cta).toBe('save-render-key');
  });

  it('a user who has pressed nothing is not told to press it "again"', () => {
    const offer = backendDeployOffer({ code: '', serverHalf: { canDeploy: false }, workspaceId: 'w1' });
    expect(offer.steps.join(' ')).toContain('Come back here and press Publish.');
    expect(offer.steps.join(' ')).not.toContain('press Publish again');
  });

  it('an ordinary static app still sees nothing at all', () => {
    expect(backendDeployOffer({ code: '', serverHalf: null, workspaceId: 'w1' }).show).toBe(false);
    expect(backendDeployOffer({ code: '', workspaceId: 'w1' }).show).toBe(false);
  });

  it('a REAL refusal still wins — it is fresher and more specific', () => {
    // The server refused for having no backend host at all; the status fact said a deploy could run.
    // The refusal is what just happened, so its words are the ones that must stand.
    const offer = backendDeployOffer({
      code: 'needs-server-hosting',
      serverHalf: { canDeploy: true },
      ownRepo: REPO, githubConnected: true, keySource: 'user', workspaceId: 'w1',
    });
    expect(offer.canDeploy).toBe(false);
    expect(offer.cta).toBe('save-render-key');
  });

  it('the button keeps the one label the server names it by', () => {
    expect(DEPLOY_BACKEND_LABEL).toBe('Deploy backend');
  });
});

/**
 * 🔴 THE MONEY GUARD. Everything below is about one thing: opening a panel must never start a deploy
 * in someone's own hosting account.
 */
describe('🔒 the fact shows a CARD — only a fresh refusal may auto-deploy', () => {
  it('the fact is not an input of shouldAutoDeployBackend at all', () => {
    // Its inputs are the two codes plus two booleans. There is deliberately no way to hand it the
    // shape fact, so no future edit can make the fact trigger a deploy through this function.
    expect(shouldAutoDeployBackend({ code: '', previousCode: '', canDeploy: true, busy: false })).toBe(false);
    // A standing refusal is not a transition — this is the rule that already protected a reopened panel.
    expect(shouldAutoDeployBackend({
      code: 'backend-deploy-available', previousCode: 'backend-deploy-available', canDeploy: true, busy: false,
    })).toBe(false);
    // And a genuine fresh refusal still deploys, exactly as before this change.
    expect(shouldAutoDeployBackend({
      code: 'backend-deploy-available', previousCode: '', canDeploy: true, busy: false,
    })).toBe(true);
  });

  it('the panel keeps the fact OUT of publishRefusal', () => {
    const panel = stripCodeComments(src('src/components/agentv3/AgentV3Panel.tsx'));
    expect(panel).toContain('serverHalf={publishState?.serverHalf ?? null}');
    // The one line that would cause the deploy: setting the refusal state from the status read.
    expect(panel, 'merging the two would make reopening a panel look like a fresh refusal')
      .not.toMatch(/setPublishRefusal\([^)]*serverHalf/);
  });

  it("the chooser's auto-deploy effect still watches ONLY the refusal code", () => {
    const code = stripCodeComments(src('src/components/agentv3/HostingChooser.tsx'));
    const at = code.indexOf('shouldAutoDeployBackend({');
    expect(at).toBeGreaterThan(-1);
    const effect = code.slice(at, code.indexOf('}, [', at) + 40);
    expect(effect).toContain('code, previousCode');
    expect(effect, 'a dependency on the fact would fire this on a panel open').toContain('}, [publishRefusalCode]);');
    expect(effect).not.toContain('serverHalf');
  });

  it('the chooser passes the fact to the offer, and as the FALLBACK after a real refusal', () => {
    const code = stripCodeComments(src('src/components/agentv3/HostingChooser.tsx'));
    const at = code.indexOf('backendDeployOffer({');
    const call = code.slice(at, code.indexOf('});', at));
    expect(call).toContain('code: publishRefusalCode');
    expect(call).toContain('serverHalf: serverHalf ?? null');
    expect(call, 'before any refusal the status read knows whose key it would be').toContain('serverHalf?.keySource');
  });
});

describe('🔒 the endpoint reports the fact and never a credential', () => {
  const route = () => {
    const whole = src('src/server/routes/agentv3.ts');
    const at = whole.indexOf("app.get('/api/agentv3/publish-state'");
    expect(at).toBeGreaterThan(-1);
    return stripCodeComments(whole.slice(at, whole.indexOf("app.post('/api/agentv3/unpublish'", at)));
  };

  it('it answers with the staged read, not with its own copy of the planner', () => {
    const seg = route();
    expect(seg).toContain('readServerHalf({');
    expect(seg).toContain('SHAPE_MANIFESTS');
    expect(seg).not.toContain('planDeployment(');
  });

  it('only hasServerHalf / shape / canDeploy / keySource cross the wire', () => {
    const seg = route();
    expect(seg).toContain('hasServerHalf: true');
    expect(seg).toContain("keySource: key?.source ?? null");
    // The key itself must never be serialised. `resolveRenderKey` returns `{ key, source }`, and only
    // `source` is read — a credential in a status body would reach every tab the user has open.
    expect(seg, 'a status body must never carry a key').not.toMatch(/key:\s*key\.key|renderKey|key\.key/);
  });

  it('the extra fact can never fail the endpoint it was added to', () => {
    const seg = route();
    const at = seg.indexOf('readServerHalf({');
    const after = seg.slice(at);
    expect(after, 'best-effort by construction — a status read answers what it always answered')
      .toMatch(/catch \{/);
  });

  it('the fact is only computed when there is something to say', () => {
    // `serverHalf` is omitted entirely for an ordinary app, so no client renders a card from a
    // present-but-false object, and an older client sees exactly the body it saw before.
    expect(route()).toContain('...(serverHalf ? { serverHalf } : {})');
  });
});
