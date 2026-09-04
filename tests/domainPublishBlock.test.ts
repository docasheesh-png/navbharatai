import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { planDeployment, domainPublishBlockNote } from '../src/server/AgentV3/deployPlan';
import { connectStage } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * NEVER SEND SOMEONE AT A BUTTON THAT CANNOT WORK (admin 2026-08-24).
 *
 * A connected domain whose site has no release makes the connect screen say, correctly, "Connected —
 * one last step: press Publish." For an app with no website half that instruction can only be refused:
 * the publish route will not upload a running server to a static CDN. The screen said press Publish,
 * the button refused, the screen said it again — the same shape as the three-day "waiting for DNS"
 * over a conflict that could never clear.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const pkg = (o: unknown) => JSON.stringify(o);

describe('domainPublishBlockNote — only when the refusal is CERTAIN', () => {
  it('an ordinary website says nothing at all', () => {
    expect(domainPublishBlockNote(planDeployment({ 'index.html': '<h1>hi</h1>' }))).toBe('');
    expect(domainPublishBlockNote(planDeployment({
      'package.json': pkg({ devDependencies: { vite: '^5' }, scripts: { build: 'vite build' } }),
    }))).toBe('');
  });

  it('a bare server app says so, and names the next step', () => {
    const note = domainPublishBlockNote(planDeployment({
      'package.json': pkg({ dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }),
    }));
    expect(note).not.toBe('');
    expect(note.toLowerCase()).toContain('deploy the server part first');
  });

  it('a Python server too', () => {
    expect(domainPublishBlockNote(planDeployment({ 'requirements.txt': 'fastapi==0.110\nuvicorn' }))).not.toBe('');
  });

  it('🔒 FULLSTACK IS SILENT — it is not always refused, and a wrong "do not press" is worse', () => {
    // With a backend host configured and splittable wiring, the publish route really does deploy the
    // server, bake its address in and publish the website half. Telling that user the button will do
    // nothing would stop a working feature with a confident, false instruction.
    const fullstack = planDeployment({
      'package.json': pkg({ dependencies: { express: '^4', react: '^18' }, devDependencies: { vite: '^5' } }),
    });
    expect(fullstack.staticHostingSufficient).toBe(false);   // the publish route still decides
    expect(domainPublishBlockNote(fullstack)).toBe('');      // but this screen does not pre-judge it
  });

  it('🔒 SILENT ON DOUBT — an unreadable workspace must not accuse a publishable app', () => {
    // The status route passes whatever it could read; {} is what an unreadable one yields.
    expect(domainPublishBlockNote(planDeployment({}))).toBe('');
  });

  /**
   * THE mitrify.com LOOP (admin 2026-09-04: *"yeh error abhi bhi aa rahi hai — 1 month se aap isko
   * fix kar rahe ho"*, with the site serving Firebase's "Site Not Found" while the connect screen
   * read `ownership: active · host: active · SSL: active` and "one last step: press Publish").
   *
   * A fullstack app is publishable ONLY through the publish route's `wiredToBackend` path, which
   * requires `strategy === 'split'`. When the app's own code says ship WHOLE, the refusal is as
   * certain as it is for a bare server — and silence there is what kept sending the admin at a
   * button that answered 422 every single time.
   */
  describe('fullstack — silent when unsure, honest when certain', () => {
    const fullstack = planDeployment({
      'package.json': pkg({ dependencies: { express: '^4', react: '^18' }, devDependencies: { vite: '^5' } }),
    });

    it('🔒 SHIP-WHOLE is stated — the publish route has no path that can publish it', () => {
      const note = domainPublishBlockNote(fullstack, { splitAdvised: false });
      expect(note).not.toBe('');
      expect(note).toContain('will not put anything on your domain');
      expect(note.toLowerCase()).toContain('server');
    });

    it('SPLITTABLE stays silent — that publish genuinely works, and must not be discouraged', () => {
      expect(domainPublishBlockNote(fullstack, { splitAdvised: true })).toBe('');
    });

    it('🔒 NO VERDICT stays silent — only a real `false` may speak', () => {
      // Undefined is what an unreadable workspace yields. Guessing here would tell users with
      // perfectly publishable apps not to publish them — a worse failure than the loop it fixes.
      expect(domainPublishBlockNote(fullstack, {})).toBe('');
      expect(domainPublishBlockNote(fullstack, { splitAdvised: undefined })).toBe('');
      expect(domainPublishBlockNote(fullstack)).toBe('');
    });

    it('a plain static app is never touched by any of this', () => {
      const staticApp = planDeployment({ 'index.html': '<h1>hi</h1>' });
      expect(domainPublishBlockNote(staticApp, { splitAdvised: false })).toBe('');
    });
  });
});

describe('connectStage — the screen stops repeating an impossible instruction', () => {
  const active = { active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE' };

  it('without a block, an unpublished domain still says press Publish', () => {
    const s = connectStage({ ...active, serving: { state: 'nothing_published', note: 'x' } });
    expect(s.action).toBe('publish');
  });

  it('🔒 with a block, it says the TRUE next step and offers no Publish action', () => {
    const s = connectStage({
      ...active,
      serving: { state: 'nothing_published', note: 'x' },
      publishBlocked: 'Your app is a Express server that has to keep running…',
    });
    expect(s.action).toBe('none');
    expect(s.tone).toBe('warn');
    expect(s.note).toContain('Express server');
    expect(s.headline).not.toContain('press Publish');
  });

  it('the block wins over the serving branch — it is the more specific fact about the same state', () => {
    // Both describe "nothing is on your domain"; only one of them says what will actually fix it.
    const s = connectStage({ ...active, serving: { state: 'error', note: 'y' }, publishBlocked: 'server app' });
    expect(s.action).toBe('none');
    expect(s.note).toBe('server app');
  });

  it('a serving domain is unaffected, and an empty block is not a block', () => {
    expect(connectStage({ ...active, serving: { state: 'serving', note: '' }, publishBlocked: '' }).headline)
      .toContain('Live!');
    expect(connectStage({ ...active, serving: { state: 'serving', note: '' }, publishBlocked: null }).action)
      .toBe('none');
  });
});

describe('🔒 the wiring, end to end', () => {
  it('the status route asks ONLY when it is about to say "press Publish"', () => {
    // Four document reads on every poll for a question nobody asked is how a correct feature becomes
    // too expensive to keep.
    const route = src('src/server/routes/nbaiDomains.ts');
    // ⚠️ The anchor moved 2026-09-04: the gate is now every NON-SERVING state, because `error` and
    // `unknown` also tell the user to press Publish. See the widened-gate block below.
    expect(route).toContain("if (serving && serving.state !== 'serving') {");
    expect(route).toContain('loadWorkspaceFilesByPath');
    expect(route).toContain('domainPublishBlockNote(plan, { splitAdvised })');
    expect(route).toContain('...(publishBlocked ? { publishBlocked } : {})');
  });

  /**
   * ⚠️ REWRITTEN 2026-09-04, and NOT to make a failing test pass.
   *
   * This used to assert `not.toContain('loadWorkspaceFiles(workspaceId as string)')` — "read the
   * manifests by path, NEVER the whole workspace". That absolute is what pinned this route to a
   * verdict formed on the manifests alone, which is exactly the defect the publish route had already
   * fixed on 2026-08-25 and this one had not: `planDeployment`'s file-based half (does the source
   * actually IMPORT a server framework) can never fire when only four manifests are handed to it. So
   * the two halves of one product could disagree about one app — publish refusing it as a server
   * while this screen said "one last step: press Publish".
   *
   * The guarantee the assertion was PROTECTING is real and is kept: the ordinary static app must not
   * pay a whole-workspace read on every status poll. That is a statement about WHERE the read lives,
   * not about whether it may exist — so it is now asserted as such, which is strictly stronger than
   * the blanket ban it replaces.
   */
  it('🔒 the whole-workspace read happens ONLY for an app already judged non-static', () => {
    const route = src('src/server/routes/nbaiDomains.ts');
    const blockAt = route.indexOf("if (serving && serving.state !== 'serving') {");
    const block = route.slice(blockAt, route.indexOf('res.json({ ...status', blockAt));
    const guardAt = block.indexOf('if (!plan.staticHostingSufficient) {');
    const readAt = block.indexOf('loadWorkspaceFiles(workspaceId as string)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(guardAt); // inside the escalation, never on the hot path
    // And the cheap by-path read still runs first, for every app.
    expect(block.indexOf('loadWorkspaceFilesByPath')).toBeLessThan(guardAt);
  });

  it('the screen hides the button it knows cannot work', () => {
    const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');
    expect(screen).toContain('{result.active && onPublish && !result.publishBlocked && (() => {');
  });
});

/**
 * THE SECOND SCREENSHOT, SAME APP, SAME HOUR (admin 2026-09-04: *"ye screenshot bhi same app ke hai"*).
 *
 * It caught two things the first fix did not, and one of them was a hole in that very fix.
 */
describe('🔒 the block fires in EVERY state that says "press Publish"', () => {
  it('the status route gates on NOT-SERVING, never on one state name', () => {
    // THE HOLE. The gate was `state === 'nothing_published'`, because that is where the screen says
    // "one last step: press Publish". But `error` says "Publishing again usually fixes this", and
    // `unknown` says "If it shows an error page, press Publish once" — which is exactly what the
    // admin's screenshot showed. So the fix written to end this loop did not fire in the state they
    // were looking at. The right gate was never a state name: it is "is this screen about to say
    // press Publish?", and every non-serving state does.
    const route = src('src/server/routes/nbaiDomains.ts');
    expect(route).toContain("if (serving && serving.state !== 'serving') {");
    expect(route).not.toContain("if (serving?.state === 'nothing_published') {");
  });

  it('a SERVING domain still asks nothing — the cost guarantee is unchanged', () => {
    const route = src('src/server/routes/nbaiDomains.ts');
    const at = route.indexOf("if (serving && serving.state !== 'serving') {");
    const block = route.slice(at, route.indexOf('res.json({ ...status', at));
    expect(block).toContain('loadWorkspaceFilesByPath');
  });

  it('the client already checks the block BEFORE every serving branch', () => {
    // Confirms the widened server gate actually reaches the user: the client's publishBlocked branch
    // must come first, or the `unknown` branch would answer before it.
    const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');
    const blockAt = screen.indexOf('if (s.publishBlocked) {');
    const nothingAt = screen.indexOf("if (s.serving?.state === 'nothing_published') {");
    const unknownAt = screen.indexOf("if (s.serving?.state !== 'serving') {");
    expect(blockAt).toBeGreaterThan(-1);
    expect(blockAt).toBeLessThan(nothingAt);
    expect(blockAt).toBeLessThan(unknownAt);
  });
});

describe('🔒 one screen must not contradict itself about the same deploy', () => {
  it('a key WITHOUT a repo no longer claims a deploy can run', async () => {
    const { renderRequirement } = await import('../src/server/AgentV3/renderDeploy');
    const env = { RENDER_API_KEY: 'rnd_x' } as NodeJS.ProcessEnv;
    const note = renderRequirement(env, null, false);
    expect(note).not.toContain('a real deploy can run');
    expect(note).toContain('GitHub repository');
  });

  it('a key WITH a repo still says what it always said', async () => {
    const { renderRequirement } = await import('../src/server/AgentV3/renderDeploy');
    const env = { RENDER_API_KEY: 'rnd_x' } as NodeJS.ProcessEnv;
    expect(renderRequirement(env, null, true)).toContain('a real deploy can run');
    // Undefined = the caller does not know; the wording must not change for it.
    expect(renderRequirement(env, null)).toContain('a real deploy can run');
  });

  it('🔒 NO key is still the key message — a missing repo must not hide a missing key', async () => {
    const { renderRequirement } = await import('../src/server/AgentV3/renderDeploy');
    const note = renderRequirement({} as NodeJS.ProcessEnv, null, false);
    expect(note).toContain('RENDER_API_KEY');
  });

  it('the publish route and the panel read the SAME fact, so they cannot drift', () => {
    const route = src('src/server/routes/agentv3.ts');
    const panel = src('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('hasRepo: !!deployRepo');
    expect(route).toContain('renderRequirement(process.env, vault, hasRepo)');
  });
});
