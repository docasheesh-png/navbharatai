import { describe, it, expect } from 'vitest';
import { planDeployment, staticHostingRefusal, deployDecision } from '../src/server/AgentV3/deployPlan';

/**
 * "SABHI APPS KO WELCOME KARE, KISI BHI FORMAT ME" (admin 2026-08-23).
 *
 * The failure that started it: an Express app was published, uploaded to a static CDN, and reported as
 * PUBLISHED — and the user's domain served "Page Not Found — there was no index.html". Nothing errored;
 * they just got a broken site and no reason.
 *
 * The first step to welcoming every format is being able to TELL them apart. These tests pin the
 * classification and, most importantly, the direction it errs in.
 */

const pkg = (o: unknown) => JSON.stringify(o);

describe('planDeployment — what shape is this app', () => {
  it('a plain HTML site is static and ships as-is', () => {
    const p = planDeployment({ 'index.html': '<h1>hi</h1>', 'style.css': 'body{}' });
    expect(p.shape).toBe('static');
    expect(p.staticHostingSufficient).toBe(true);
    expect(p.frontend?.buildCommand).toBe('');
  });

  it('a Vite app is an SPA that must be BUILT, and its dist is what ships', () => {
    const p = planDeployment({ 'package.json': pkg({ devDependencies: { vite: '^5' }, scripts: { build: 'vite build' } }) });
    expect(p.shape).toBe('spa');
    expect(p.staticHostingSufficient).toBe(true);
    expect(p.frontend).toMatchObject({ buildCommand: 'vite build', outputDir: 'dist' });
  });

  it('🔒 an Express app is a SERVER — static hosting can never deliver it', () => {
    // THE REPORTED BUG. This is the app that got uploaded to a CDN and served Page Not Found.
    const p = planDeployment({ 'package.json': pkg({ dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }) });
    expect(p.shape).toBe('node-server');
    expect(p.staticHostingSufficient).toBe(false);
    expect(p.backend).toMatchObject({ runtime: 'node', framework: 'Express', startCommand: 'node server.js' });
  });

  it('a Flask app is recognised from its imports, not only from requirements.txt', () => {
    // An app that vendors its dependencies has no requirements file, and is still a server.
    const p = planDeployment({ 'app.py': 'from flask import Flask\napp = Flask(__name__)' });
    expect(p.shape).toBe('python-server');
    expect(p.backend?.framework).toBe('Flask');
    expect(p.staticHostingSufficient).toBe(false);
  });

  it('FastAPI in requirements.txt counts too', () => {
    expect(planDeployment({ 'requirements.txt': 'fastapi==0.110\nuvicorn' }).shape).toBe('python-server');
  });

  it('🔒 React + Express is FULLSTACK — two deployables, not one', () => {
    // The case competitors stop at. Shipping the whole thing to either target alone is broken or
    // needlessly slow; the frontend belongs on a CDN and the API on a Node host.
    const p = planDeployment({
      'package.json': pkg({ dependencies: { express: '^4', react: '^18' }, devDependencies: { vite: '^5' }, scripts: { build: 'vite build', start: 'node server.js' } }),
    });
    expect(p.shape).toBe('fullstack');
    expect(p.frontend).toMatchObject({ outputDir: 'dist' });
    expect(p.backend).toMatchObject({ framework: 'Express' });
    expect(p.staticHostingSufficient).toBe(false);
    expect(p.summary).toContain('two halves');
  });

  it('🔒 THE SAFE DEFAULT: anything unrecognised publishes exactly as before', () => {
    // The direction this errs in is the whole safety argument. A classifier that guessed "probably a
    // backend" would start REFUSING working static sites — turning a diagnostic into an outage.
    for (const files of [{}, { 'readme.md': 'hello' }, { 'package.json': 'not json' }, { 'package.json': pkg({ dependencies: { lodash: '^4' } }) }]) {
      const p = planDeployment(files as Record<string, string>);
      expect(p.staticHostingSufficient).toBe(true);
    }
    expect(planDeployment(null as never).staticHostingSufficient).toBe(true);
  });

  it('a react app with NO server is still just a website', () => {
    const p = planDeployment({ 'package.json': pkg({ dependencies: { react: '^18' }, devDependencies: { vite: '^5' } }), 'index.html': '<div id=root>' });
    expect(p.shape).toBe('spa');
    expect(p.backend).toBeNull();
  });
});

describe('staticHostingRefusal — a refusal must carry a next step', () => {
  it('says nothing at all when publishing is fine', () => {
    expect(staticHostingRefusal(planDeployment({ 'index.html': '<p>' }))).toBe('');
  });

  /**
   * ⚠️ REWRITTEN 2026-09-05 — this assertion WAS the falsehood, and the test below it had already
   * named the problem without noticing that this one enforced it.
   *
   * It required the message to say "Backend hosting is coming". That was true of the publish path when
   * written and has been FALSE of the product for weeks: NavBharatAI deploys backends on the user's
   * own account, and now hosts Python as well as Node. `deployDecision` was added to keep that
   * sentence away from users — and covered only the branch where a key IS available, leaving this one
   * teaching every user without a key that a feature they already have does not exist.
   *
   * The properties worth keeping are kept in full: name the framework, and never blame the user. What
   * replaces the false claim is the ONE fact that unlocks the feature — which the panel beside this
   * message was already showing, so the screen used to contradict itself.
   */
  it('names the framework and the way forward, without blaming the user', () => {
    const msg = staticHostingRefusal(planDeployment({ 'package.json': pkg({ dependencies: { express: '^4' } }) }));
    expect(msg).toContain('Express');
    expect(msg).toContain('RENDER_API_KEY');
    expect(msg).toContain('your own account');
    // 🔒 The claim that has to stay dead: it says a feature we HAVE does not exist.
    expect(msg).not.toContain('coming to NavBharatAI');
    // The user did nothing wrong by bringing a backend, and the message must not imply they did.
    expect(msg).not.toMatch(/invalid|unsupported|error|wrong|cannot publish this/i);
  });

  it('🔒 no refusal anywhere may claim backend hosting is still coming', () => {
    // One place said it, one place was fixed, and the third kept saying it for weeks. So the check is
    // over EVERY shape rather than the one that was reported.
    for (const files of [
      { 'package.json': pkg({ dependencies: { express: '^4' } }) },
      { 'package.json': pkg({ dependencies: { fastify: '^4' } }) },
      { 'package.json': pkg({ dependencies: { express: '^4' }, devDependencies: { vite: '^5' } }) },
      { 'requirements.txt': 'flask\n', 'app.py': 'from flask import Flask' },
    ]) {
      expect(staticHostingRefusal(planDeployment(files)), Object.keys(files)[0]).not.toContain('is coming');
    }
  });

  it('🔒 reassures that nothing was published — so a refusal is not a half-broken site', () => {
    const msg = staticHostingRefusal(planDeployment({ 'package.json': pkg({ dependencies: { fastify: '^4' } }) }));
    expect(msg).toContain('Nothing has been published');
  });

  it('fullstack explains why the website half alone would look broken', () => {
    const msg = staticHostingRefusal(planDeployment({
      'package.json': pkg({ dependencies: { express: '^4' }, devDependencies: { vite: '^5' } }),
    }));
    expect(msg).toContain('cannot reach its');
  });
});

describe('deployDecision — a refusal becomes an offer when we can really help', () => {
  const express = planDeployment({ 'package.json': JSON.stringify({ dependencies: { express: '^4' } }) });
  const fullstack = planDeployment({
    'package.json': JSON.stringify({ dependencies: { express: '^4' }, devDependencies: { vite: '^5' } }),
  });
  const site = planDeployment({ 'index.html': '<p>' });
  const USER_KEY = 'Deploying to YOUR own Render account, using the key you saved in Settings → Secrets & API Keys.';

  it('a website just publishes — no message, no interruption', () => {
    const d = deployDecision(site, { canDeploy: false, requirement: 'irrelevant' });
    expect(d).toEqual({ proceed: true, message: '', code: '' });
  });

  it('🔒 with a real backend path available, it OFFERS instead of refusing', () => {
    // The inaccuracy this corrects: staticHostingRefusal says "backend hosting is coming to
    // NavBharatAI", which was true of the publish path and NOT of the product — renderDeploy has been
    // a real, wired deploy for weeks. Teaching users that something they already have does not exist
    // is the same class of dishonesty as claiming something works when it does not.
    const d = deployDecision(express, { canDeploy: true, requirement: USER_KEY });
    expect(d.code).toBe('backend-deploy-available');
    expect(d.message).toContain('Deploy backend');
    expect(d.message).not.toContain('coming to NavBharatAI');
  });

  it('🔒 reproduces the whose-account line VERBATIM — it names who gets the bill', () => {
    // Paraphrasing this is not a style choice: it is the one fact a user must not have reworded at
    // them, because it decides whose card is charged.
    const d = deployDecision(express, { canDeploy: true, requirement: USER_KEY });
    expect(d.message).toContain(USER_KEY);
  });

  it('with NO backend path available, it still refuses honestly and publishes nothing', () => {
    const d = deployDecision(express, { canDeploy: false, requirement: 'Save your own RENDER_API_KEY…' });
    expect(d.proceed).toBe(false);
    expect(d.code).toBe('needs-server-hosting');
    expect(d.message).toContain('Nothing has been published');
  });

  it('fullstack is told the ORDER: server first, then the website that talks to it', () => {
    const d = deployDecision(fullstack, { canDeploy: true, requirement: USER_KEY });
    expect(d.message).toContain('server first');
    expect(d.message).toContain('reach it');
    expect(d.proceed).toBe(false);
  });

  it('🔒 never proceeds with a static publish when a server is required', () => {
    // The whole point: no combination of inputs may produce a "Page Not Found" site again.
    for (const cap of [true, false]) {
      for (const plan of [express, fullstack]) {
        expect(deployDecision(plan, { canDeploy: cap, requirement: 'x' }).proceed).toBe(false);
      }
    }
  });
});

describe('deployDecision — splitting is an optimisation, not a requirement', () => {
  const fullstack = planDeployment({
    'package.json': JSON.stringify({ dependencies: { express: '^4' }, devDependencies: { vite: '^5' } }),
  });
  const cap = { canDeploy: true, requirement: 'Deploying to YOUR own Render account.' };

  it('🔒 an app with relative /api calls is told to ship WHOLE, not split', () => {
    // Splitting this app gives a site whose every button fails silently — worse than not splitting,
    // and far harder to diagnose than a page that plainly does not load.
    const d = deployDecision(fullstack, { ...cap, splitAdvised: false, wholeAppNote: 'They belong together.' });
    expect(d.message).toContain('whole app');
    expect(d.message).toContain('together, exactly as it works now');
    expect(d.message).not.toContain('server first');
  });

  it('an app built to be split still gets the split instructions', () => {
    const d = deployDecision(fullstack, { ...cap, splitAdvised: true });
    expect(d.message).toContain('server first');
  });

  it('no verdict formed ⇒ the previous wording stands, unchanged', () => {
    expect(deployDecision(fullstack, cap).message).toContain('server first');
  });

  it('🔒 whichever advice is given, a static publish still never proceeds', () => {
    for (const s of [true, false, undefined]) {
      expect(deployDecision(fullstack, { ...cap, splitAdvised: s }).proceed).toBe(false);
    }
  });
});

/**
 * A DEV DEPENDENCY IS NOT A SERVER (admin report 2026-08-25: "yeh publish to navbharat ai ho hi nahi
 * raha").
 *
 * The rule read `dependencies` and `devDependencies` as one set, so a frontend-only app that merely
 * carried `express` as a DEV dependency — which our own builder scaffolds, and which
 * `npm ci --omit=dev` does not even install in production — was classified as having a server half and
 * REFUSED at publish. The user was told their website could not go on website hosting.
 *
 * The asymmetry with the Python side was the tell: Python was always established from a manifest OR a
 * real import in a real file, while Node came down to package.json alone. These tests pin the rule now
 * being the same on both sides — and pin that it still errs toward DETECTING a server, never away.
 */
describe('planDeployment — a server framework must actually be a server', () => {
  it('express in devDependencies alone does NOT make a frontend app a full-stack one', () => {
    const p = planDeployment({
      'package.json': pkg({
        dependencies: { react: '^18' },
        devDependencies: { vite: '^5', express: '^4' },
        scripts: { build: 'vite build' },
      }),
      'src/App.tsx': 'export default function App() { return <h1>hi</h1>; }',
    });
    expect(p.shape).toBe('spa');
    expect(p.staticHostingSufficient).toBe(true);
    expect(p.backend).toBeNull();
  });

  it('express in dependencies IS a server — the case the refusal was built for', () => {
    const p = planDeployment({
      'package.json': pkg({
        dependencies: { express: '^4', react: '^18' },
        devDependencies: { vite: '^5' },
        scripts: { build: 'vite build', start: 'node server.js' },
      }),
    });
    expect(p.shape).toBe('fullstack');
    expect(p.staticHostingSufficient).toBe(false);
    expect(p.backend).toMatchObject({ runtime: 'node', framework: 'Express', startCommand: 'node server.js' });
  });

  it('a dev-only express that the app really IMPORTS is still a server', () => {
    const p = planDeployment({
      'package.json': pkg({ devDependencies: { vite: '^5', express: '^4' }, scripts: { build: 'vite build' } }),
      'server.js': "const express = require('express');\nexpress().listen(3000);",
    });
    expect(p.shape).toBe('fullstack');
    expect(p.staticHostingSufficient).toBe(false);
  });

  it('an UNDECLARED server is detected too — strictly more than the old rule saw', () => {
    const p = planDeployment({
      'package.json': pkg({ dependencies: {} }),
      'api/index.mjs': "import fastify from 'fastify';\nfastify().listen({ port: 3000 });",
    });
    expect(p.shape).toBe('node-server');
    expect(p.staticHostingSufficient).toBe(false);
    expect(p.backend?.framework).toBe('Fastify');
  });

  it('middleware FOR somebody else server is not a server', () => {
    const p = planDeployment({
      'package.json': pkg({ dependencies: { 'express-rate-limit': '^7', react: '^18' }, devDependencies: { vite: '^5' } }),
      'src/main.tsx': "import rateLimit from 'express-rate-limit';",
    });
    expect(p.backend).toBeNull();
    expect(p.staticHostingSufficient).toBe(true);
  });

  it('merely NAMING express in prose or a variable is not importing it', () => {
    const p = planDeployment({
      'package.json': pkg({ devDependencies: { vite: '^5', express: '^4' } }),
      'src/notes.ts': "// we used to use express here\nconst express = 'not the package';",
    });
    expect(p.backend).toBeNull();
    expect(p.staticHostingSufficient).toBe(true);
  });

  it('the Python side is unchanged — a manifest marker still proves a server', () => {
    const p = planDeployment({ 'requirements.txt': 'flask==3.0.0' });
    expect(p.shape).toBe('python-server');
    expect(p.staticHostingSufficient).toBe(false);
  });
});
