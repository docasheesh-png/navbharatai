import { describe, it, expect } from 'vitest';
import { planDeployment, staticHostingRefusal } from '../src/server/AgentV3/deployPlan';

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

  it('names the framework and what is missing, without blaming the user', () => {
    const msg = staticHostingRefusal(planDeployment({ 'package.json': pkg({ dependencies: { express: '^4' } }) }));
    expect(msg).toContain('Express');
    expect(msg).toContain('Backend hosting is coming');
    // The user did nothing wrong by bringing a backend, and the message must not imply they did.
    expect(msg).not.toMatch(/invalid|unsupported|error|wrong|cannot publish this/i);
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
