import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import {
  serverHalfFromPlan, serverHalfFromFiles, readServerHalf, stageTwoNeeded, SHAPE_MANIFESTS,
} from '../src/server/AgentV3/appServerHalf';
import { planDeployment } from '../src/server/AgentV3/deployPlan';

/**
 * ADMIN 2026-10-17: *"website connect, databse connect, backend connect ko simple banao"*.
 *
 * Measured first, in the user's own steps: database connect is 1 tap; website connect is domain →
 * records → check; **backend connect began with a FAILURE** — press Publish, be refused, and only
 * then does the card appear. The condition behind that is tiny and exact: the card was gated on a
 * refusal code, and a refusal code only exists after a 422.
 *
 * This module is the fact that removes the condition, and it also closes a second class: *"needs a
 * server"* had THREE definitions in the repo (two staged reads and one single-stage `!!plan.backend`).
 */
const EXPRESS_PKG = JSON.stringify({ dependencies: { express: '^4' } });
const VITE_PKG = JSON.stringify({ dependencies: { react: '^18', vite: '^5' }, scripts: { build: 'vite build' } });

describe('serverHalfFromPlan — ONE definition of "this app needs a server"', () => {
  /**
   * 🔒 THE EQUIVALENCE THAT LET THREE DEFINITIONS LOOK THE SAME. The repo asked this question two
   * ways: `!plan.staticHostingSufficient` (publish, domain status) and `!!plan.backend` (the
   * build-completion row). They agree for every shape the planner can return — so unifying them
   * changed no behaviour — and this pin fails the moment a NEW shape makes them disagree, which is
   * the only way the three could silently split again.
   */
  it('`!staticHostingSufficient` and `backend !== null` agree on every shape the planner returns', () => {
    const cases: Array<Record<string, string>> = [
      {},                                                              // unknown / unreadable
      { 'package.json': VITE_PKG, 'index.html': '<div id=root>' },     // spa
      { 'index.html': '<h1>hi' },                                      // static
      { 'package.json': EXPRESS_PKG, 'server.js': "require('express')()" },        // node-server
      { 'package.json': EXPRESS_PKG, 'server.js': "require('express')()", 'index.html': '<div id=root>' }, // fullstack
      { 'requirements.txt': 'flask', 'app.py': 'from flask import Flask' },        // python-server
    ];
    for (const files of cases) {
      const plan = planDeployment(files);
      expect(plan.staticHostingSufficient === false, `shape ${plan.shape}`).toBe(plan.backend !== null);
      expect(serverHalfFromPlan(plan), `shape ${plan.shape}`).toBe(plan.backend !== null);
    }
  });

  it('a missing plan is not a server half — silence on doubt, never a claim', () => {
    expect(serverHalfFromPlan(null)).toBe(false);
    expect(serverHalfFromPlan(undefined)).toBe(false);
    expect(serverHalfFromFiles(null)).toBe(false);
    expect(serverHalfFromFiles({})).toBe(false);
  });

  it('a real server is one, a website is not', () => {
    expect(serverHalfFromFiles({ 'package.json': EXPRESS_PKG, 'server.js': "require('express')()" })).toBe(true);
    expect(serverHalfFromFiles({ 'package.json': VITE_PKG, 'index.html': '<div id=root>' })).toBe(false);
  });
});

describe('readServerHalf — two stages, and the second one is a correctness fix', () => {
  it('an ordinary static app never pays for the full read', async () => {
    let fullCalls = 0;
    const r = await readServerHalf({
      // A Vite manifest classifies as `spa` on the spot — the ordinary app, concluded at stage 1.
      manifests: async () => ({ 'package.json': VITE_PKG }),
      full: async () => { fullCalls += 1; return {}; },
    });
    expect(r.hasServerHalf).toBe(false);
    expect(fullCalls, 'stage 2 must not run for an app stage 1 already cleared').toBe(0);
    expect(r.files).toBeNull();
  });

  /**
   * 🔴 THE BUG THIS MODULE WAS WRITTEN AROUND — Q-707, ALIVE AGAIN THROUGH THE GATE, MEASURED.
   *
   * Both existing staged readers ran stage 2 only `if (!plan.staticHostingSufficient)`. For a server
   * visible ONLY in the source, stage 1 cannot suspect anything — measured on `main`:
   *
   *   manifests only → shape 'unknown', staticHostingSufficient TRUE   (so stage 2 never ran)
   *   real files     → shape 'node-server', staticHostingSufficient FALSE
   *
   * which is Q-707 exactly: *"published as a STATIC SITE, with its API dead and the user told it
   * worked"*. `coreHttpServer.test.ts` proves the detector on full files; nothing proved the publish
   * path ever hands it any.
   */
  it('THE Q-707 HOLE: a server only its SOURCE reveals is still found', async () => {
    const r = await readServerHalf({
      manifests: async () => ({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }) }),
      full: async () => ({ 'server.js': "const http = require('node:http');\nhttp.createServer((q, s) => s.end('hi')).listen(3000);" }),
    });
    expect(r.files, 'stage 1 did not CONCLUDE, so the real files must be read').not.toBeNull();
    expect(r.hasServerHalf).toBe(true);
    expect(r.plan.shape).toBe('node-server');
  });

  it('the gate itself: only a POSITIVE static classification ends the read', () => {
    const spa = planDeployment({ 'package.json': VITE_PKG, 'index.html': '<div id=root>' });
    const plain = planDeployment({ 'index.html': '<h1>hi' });
    const unknown = planDeployment({ 'package.json': '{}' });
    const server = planDeployment({ 'package.json': EXPRESS_PKG });
    expect(spa.shape).toBe('spa');
    expect(stageTwoNeeded(spa), 'an spa is concluded — no full read').toBe(false);
    expect(plain.shape).toBe('static');
    expect(stageTwoNeeded(plain), 'plain static is concluded too').toBe(false);
    expect(unknown.shape, 'measured: a manifest with no framework classifies as unknown').toBe('unknown');
    expect(stageTwoNeeded(unknown), '"unknown" is NOT a conclusion — this is the hole').toBe(true);
    expect(stageTwoNeeded(server), 'a suspected server is confirmed on the real files').toBe(true);
    expect(stageTwoNeeded(null)).toBe(true);
  });

  it('an app carrying a server dependency but no server file is corrected by the real files', async () => {
    // The other direction, and the reason stage 2 can never be dropped: a positive manifest hit that
    // the source does not back up must not refuse a perfectly publishable website.
    const r = await readServerHalf({
      manifests: async () => ({ 'package.json': JSON.stringify({ devDependencies: { express: '^4' }, dependencies: { vite: '^5' }, scripts: { build: 'vite build' } }) }),
      full: async () => ({ 'index.html': '<div id=root>' }),
    });
    expect(r.hasServerHalf, 'express as a DEV dependency is not a server').toBe(false);
  });

  it('a real server survives the second stage', async () => {
    const r = await readServerHalf({
      manifests: async () => ({ 'package.json': EXPRESS_PKG }),
      full: async () => ({ 'server.js': "const e = require('express')(); e.listen(3000)" }),
    });
    expect(r.hasServerHalf).toBe(true);
    expect(r.plan.shape).toBe('node-server');
  });

  it('the MANIFESTS win over the full read — they are the fresher copy of the same file', async () => {
    // The sandbox (or durable) manifest is read mid-build; the full copy can lag behind it.
    const r = await readServerHalf({
      manifests: async () => ({ 'package.json': VITE_PKG }),
      full: async () => ({ 'package.json': EXPRESS_PKG, 'index.html': '<div id=root>' }),
    });
    // Stage 1 cleared it on the fresh manifest, so stage 2 never ran and the stale one cannot win.
    expect(r.hasServerHalf).toBe(false);
  });

  it('NEVER THROWS, and an unreadable workspace says exactly what it said before', async () => {
    const r = await readServerHalf({
      manifests: async () => { throw new Error('store down'); },
      full: async () => { throw new Error('store down'); },
    });
    expect(r.hasServerHalf).toBe(false);
    expect(r.plan.staticHostingSufficient).toBe(true);
    const r2 = await readServerHalf({
      manifests: async () => ({ 'package.json': EXPRESS_PKG }),
      full: async () => { throw new Error('store down'); },
    });
    // Stage 2 failed, so the verdict stands on the manifests — a read we could make, not a guess.
    expect(r2.hasServerHalf).toBe(true);
  });

  it('the four manifests are the cheap pass, named once', () => {
    expect([...SHAPE_MANIFESTS]).toEqual(['package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile']);
  });
});

/**
 * THE CENSUS — and it is a per-file RATCHET, not a list of exempt files, because the file-level
 * version let a real miss through within an hour of being written.
 *
 * 🔴 WHAT IT MISSED. The first version allowed `routes/agentv3.ts` wholesale, "the publish decision".
 * That file ALSO held the third definition — the build-completion row's
 * `!!planDeployment(appFiles).backend` — which this change claims to have unified. The claim was
 * false when it was written, and the census could not say so, because an exempt file is exempt
 * everywhere inside it. A count per file fails on a NEW occurrence even in a file that is allowed to
 * have some.
 *
 * Counts are of the raw fields with comments stripped: `staticHostingSufficient`, and
 * `planDeployment(...).backend` read as a value. Reading `.backend?.runtime` (node vs python) is a
 * DIFFERENT question and is counted but allowed where it lives — the number is what holds the line.
 *
 * To change a count you have to say why in this table, which is the whole point.
 */
describe('🔒 no new inline definition of "needs a server"', () => {
  const EXPECTED = new Map<string, { n: number; why: string }>([
    // Measured, not guessed (a first guess of 4 counted the docblocks, which are stripped).
    ['src/server/AgentV3/appServerHalf.ts', { n: 1, why: 'the ONE definition — serverHalfFromPlan reads the field' }],
    ['src/server/AgentV3/deployPlan.ts', { n: 11, why: 'the planner that SETS the field, and the publish decision that branches on it' }],
    ['src/server/routes/agentv3.ts', { n: 1, why: 'one `.backend?.runtime` read — which runtime, not whether there is a server' }],
    ['src/server/routes/nbaiDomains.ts', { n: 0, why: 'migrated to readServerHalf' }],
    ['src/server/lib/frameworkCapability.ts', { n: 0, why: 'reads `.shape`, never the server-half fields' }],
  ]);

  const countIn = (code: string): number =>
    (code.match(/staticHostingSufficient/g) || []).length
    + (code.match(/planDeployment\([^)]*\)\s*\.backend/g) || []).length;

  it('every file is at its stated count — a new one anywhere fails this', () => {
    const root = resolve(__dirname, '..');
    const found = new Map<string, number>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const n = countIn(stripCodeComments(readFileSync(full, 'utf8')));
        if (n > 0) found.set(full.slice(root.length + 1), n);
      }
    };
    walk(resolve(root, 'src'));

    const over: string[] = [];
    for (const [file, n] of found) {
      const allowed = EXPECTED.get(file);
      if (!allowed) { over.push(`${file}: ${n} (NEW FILE — use serverHalfFromPlan / serverHalfFromFiles)`); continue; }
      if (n > allowed.n) over.push(`${file}: ${n} > ${allowed.n} (${allowed.why})`);
    }
    expect(over, 'three definitions is how they drifted; ask serverHalfFromPlan instead').toEqual([]);

    // And the ratchet only moves DOWN: a file that stopped needing them must lower its number here,
    // or the count stops meaning anything.
    const stale = [...EXPECTED].filter(([f, a]) => (found.get(f) ?? 0) < a.n).map(([f, a]) => `${f}: ${found.get(f) ?? 0} < ${a.n}`);
    expect(stale, 'lower the expected count in this table').toEqual([]);
  });

  it('the build-completion row uses the shared definition — the one the first census missed', () => {
    const route = stripCodeComments(readFileSync(resolve(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8'));
    expect(route).toContain('const needsServer = serverHalfFromFiles(appFiles);');
  });
});
