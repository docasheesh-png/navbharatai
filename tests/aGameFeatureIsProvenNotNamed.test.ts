/**
 * 🎮 A NAMED FEATURE IS PRESENT ONLY ON EVIDENCE THAT RAN, AND EVERY GAME BUILD CARRIES FOUR PROOFS
 * (external Game Maker audit, 2026-11-25 — Q-3360…Q-3363).
 *
 * The class: the build report counted a requested feature as built because the SOURCE CONTAINED A WORD — "traffic",
 * "swim", "door" in a hand-written game, or a kit call in a file nothing loads. A word is not a feature. Present now means
 * a kit call in a file the running game reaches, or a played action whose state change was observed; anything the code
 * only names is "not verified". And the report says what the game was built from, what it looked like, what was played,
 * and how long and how fast it ran in the sandbox — never called a phone, never a judgement of its graphics.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGameContract, scopeMatch, type GameFeature } from '../src/server/AgentV3/gameIntent';
import { gameEntryFiles, reachableGameFiles } from '../src/server/AgentV3/gameCodeReach';
import { gameFeatureEvidence, gameProof, gameProofIssue, playedActions, playedFeatureEvidence } from '../src/server/AgentV3/gameProof';
import {
  PLAYS_WELL, PROOF_PICTURES, gamePlaytestConfig, gamePlaytestModule, gameScopeVerdict, type PlaytestRun,
} from '../src/server/AgentV3/gamePlaytest';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';

const KIT = 'src/game/three/surfaces.ts';
const kitGame = (world: string, extra: Record<string, string> = {}) => ({
  'index.html': '<div id="root"></div><script type="module" src="/src/main.ts"></script>',
  'src/main.ts': "import { startWorld } from './game/World';\nstartWorld();",
  'src/game/World.ts': world,
  [KIT]: 'export function setWater() {}',
  ...extra,
});

describe('a word in the source is never a feature (the audit\'s exact case)', () => {
  it('🔴 a hand-written game that only SAYS traffic, swimming and a door: not verified — never present, never missing', () => {
    const c = buildGameContract('a 3D city game with traffic, swimming and enterable houses');
    expect(c.requiredFeatures).toEqual(expect.arrayContaining(['traffic', 'swimming', 'enterableHouses']));
    const handWritten = {
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'src/main.ts': 'const traffic = []; function swimming() {} const doorOpen = false; console.log(traffic, swimming, doorOpen);',
    };
    const m = scopeMatch(c, handWritten);
    for (const f of ['traffic', 'swimming', 'enterableHouses'] as GameFeature[]) {
      expect(m.present).not.toContain(f);
      expect(m.notVerified).toContain(f);
      expect(m.missing).not.toContain(f); // a name is not proof it is absent — the done signal and repair are unchanged
    }
    const v = gameScopeVerdict(c, handWritten, gameFeatureEvidence(c, handWritten, null))!;
    expect(v.code).toBe('GAME_SCOPE_GAP');
    expect(v.message).toMatch(/Not verified — the code names swimming, enterableHouses, traffic, but no kit call/);
    expect(v.message).not.toMatch(/in the game's code: /);
  });

  it('score, levels and the rest: a variable called score is not a score that works', () => {
    const c = buildGameContract('a game with score and levels and a leaderboard');
    const files = { 'src/App.tsx': 'let score = 0; let level = 1;' };
    const m = scopeMatch(c, files);
    expect(m.present).toEqual([]);
    expect(m.notVerified).toEqual(['score', 'levels']);
    expect(m.missing).toEqual(['leaderboard']);
  });
});

describe('a kit call counts only in a file the running game reaches', () => {
  const c = buildGameContract('a 3D city game with traffic');
  it('✅ called from the code the entry loads → present, with where', () => {
    const m = scopeMatch(c, kitGame('export function startWorld() { createCityTraffic(city); }'));
    expect(m.present).toEqual(['traffic']);
    expect(m.evidence?.traffic).toBe('kit call createCityTraffic( in src/game/World.ts');
  });
  it('🔴 the same call in a file nothing imports → not verified', () => {
    const m = scopeMatch(c, kitGame('export function startWorld() {}', { 'src/game/Unused.ts': 'export function x() { createCityTraffic(city); }' }));
    expect(m.present).toEqual([]);
    expect(m.notVerified).toEqual(['traffic']);
    expect(m.missing).toEqual([]);
  });
  it('🔴 named in an import list but never called → not verified', () => {
    const m = scopeMatch(c, kitGame("import { createCityTraffic } from './three/citytraffic';\nexport function startWorld() {}"));
    expect(m.present).toEqual([]);
    expect(m.notVerified).toEqual(['traffic']);
  });
  it('🔴 a commented-out import loads nothing', () => {
    const files = kitGame('export function startWorld() {}', {
      'src/main.ts': "// import './game/Traffic';\nimport { startWorld } from './game/World';\nstartWorld();",
      'src/game/Traffic.ts': 'createCityTraffic(city);',
    });
    expect(scopeMatch(c, files).notVerified).toEqual(['traffic']);
  });
});

describe('reachableGameFiles', () => {
  it('follows index.html, relative, @/ and dynamic imports; packages are not the game', () => {
    const files = {
      'index.html': '<script type="module" src="/src/main.tsx"></script>',
      'src/main.tsx': "import React from 'react';\nimport App from '@/App';\n",
      'src/App.tsx': "export default function App() { import('./game/rules'); }\nexport * from './game/index';",
      'src/game/rules.ts': '',
      'src/game/index.ts': "import './world.js';",
      'src/game/world.ts': '',
      'src/game/orphan.ts': '',
    };
    expect(gameEntryFiles(files)).toEqual(['src/main.tsx']);
    expect([...reachableGameFiles(files)!].sort()).toEqual(['src/App.tsx', 'src/game/index.ts', 'src/game/rules.ts', 'src/game/world.ts', 'src/main.tsx']);
  });
  it('no entry → null (unknown), so no kit call is proven by reach', () => {
    expect(reachableGameFiles({ 'src/x.ts': '' })).toBeNull();
    const c = buildGameContract('a 3D city game with traffic');
    const m = scopeMatch(c, { [KIT]: '', 'src/game/World.ts': 'createCityTraffic(city);' });
    expect(m.notVerified).toEqual(['traffic']);
  });
});

const PLAYED: PlaytestRun = {
  ok: true, started: 'Start', idle: 0.1, fps: 24, longFrames: 2, webgl: 'SwiftShader',
  moves: [{ label: 'up / W', change: 4.2 }, { label: 'left / A', change: 0.05 }],
  scene: { moved: 3.4, follows: true, ahead: -0.9, looks: 0.9 } as PlaytestRun['scene'],
  kitScoreStart: 0, kitScoreEnd: 30, sounds: 3,
  progression: { start: { score: 0, level: 1 }, end: { score: 30, level: 2 }, ms: 9000, advanced: true },
  touch: 2.5, touchIdle: 0.1,
  restartCheck: { ended: 'gameover', pressed: 'Play again', after: 'playing' },
  rules: [{ id: 'enemy-dies-score-up', verdict: 'held', why: 'score 0 to 10 after an enemy died' }],
  proofShots: [
    { view: 'start', id: 'aaaaaaaaaaaa', w: 480, h: 270, bytes: 21000, path: '/tmp/nbai-playtest-proof/start-aaaaaaaaaaaa.jpg', colors: 300, edges: 0.1 },
    { view: 'moved', id: 'bbbbbbbbbbbb', w: 480, h: 270, bytes: 22000, path: '/tmp/nbai-playtest-proof/moved-bbbbbbbbbbbb.jpg' },
  ],
  proofNotes: { far: 'not taken: the game draws no three.js scene, so there is no camera to pull back' },
  proofStartMoved: 12.5,
};

describe('a played action whose state change was observed proves a feature', () => {
  it('score, levels, sound, restart and the accelerator — each with what changed', () => {
    const e = playedFeatureEvidence(PLAYED);
    expect(e.score).toBe('played: the score went 0 → 30');
    expect(e.levels).toBe('played: the level went 1 → 2');
    expect(e.sound).toMatch(/^played: 3 sound/);
    expect(e.restart).toMatch(/"Play again" started a new one/);
    expect(e.throttle).toMatch(/vehicle moved 3.4 m/);
  });
  it('nothing observed → nothing proven (a run that did not play proves nothing)', () => {
    expect(playedFeatureEvidence({ ok: false })).toEqual({});
    expect(playedFeatureEvidence({ ok: true, kitScoreStart: 5, kitScoreEnd: 5, sounds: 0 })).toEqual({});
  });
  it('the played half turns a not-verified feature into a proven one, and the verdict says how', () => {
    const c = buildGameContract('a game with score, sound and a leaderboard');
    const files = { 'src/App.tsx': 'let score = 0; const audio = new AudioContext();' };
    const m = gameFeatureEvidence(c, files, PLAYED);
    expect(m.present).toEqual(['score', 'sound']);
    expect(m.notVerified).toBeUndefined();
    expect(m.missing).toEqual(['leaderboard']);
    const v = gameScopeVerdict(c, files, m)!;
    expect(v.code).toBe('GAME_SCOPE_GAP');
    expect(v.message).toMatch(/score \(played: the score went 0 → 30\)/);
    const ok = buildGameContract('a game with score and sound');
    expect(gameScopeVerdict(ok, files, gameFeatureEvidence(ok, files, PLAYED))!.code).toBe('GAME_SCOPE_OK');
    expect(gameScopeVerdict(ok, files, gameFeatureEvidence(ok, files, null))!.code).toBe('GAME_SCOPE_GAP');
  });
});

describe('GAME_PROOF — the four proofs', () => {
  const c = buildGameContract('a 3D racing game with score and sound');
  it('(a) contract (b) pictures + what was not taken (c) actions (d) sandbox run, never a phone', () => {
    const proof = gameProof({ contract: c, run: PLAYED, ranMs: 61_234, files: { 'src/game/World.ts': 'createAtmosphere({ scene });' } });
    expect(proof.contract).toMatch(/genre racing · view 3d .*named features: score, sound/);
    expect(proof.looks.taken.map((t) => t.view)).toEqual(['start', 'moved']);
    expect(proof.looks.notTaken).toEqual([
      { view: 'far', why: 'not taken: the game draws no three.js scene, so there is no camera to pull back' },
      { view: 'day and night', why: expect.stringMatching(/keeps a day-night clock, but the clock is not reachable/) },
    ]);
    expect(proof.actions.map((a) => [a.action, a.passed])).toEqual([
      ['press "Start"', true], ['hold up / W', true], ['hold left / A', false], ['play a round (9 s)', true],
      ['thumb drag and tap on a phone', true], ['end the round, then press Play again', true], ['rule enemy-dies-score-up', true],
    ]);
    expect(proof.actions[1].observed).toMatch(/the vehicle moved 3.4 m/);
    expect(proof.run).toMatchObject({ ranMs: 61234, fps: 24, longFrames: 2 });
    expect(proof.run.renderer).toMatch(/^SwiftShader — the build sandbox's software renderer — NOT a real phone/);
    const issue = gameProofIssue(proof);
    expect(issue.code).toBe('GAME_PROOF');
    expect(issue.message).toMatch(/\(a\) Built from: .*\(b\) What it looked like: start 480×270 .*\(c\) Played: .*\(d\) Ran: the playtest ran 61.2 s of its 90 s budget, 24 fps/);
    expect(issue.message).toMatch(/not a judgement of how realistic its graphics are/);
    expect(JSON.parse(issue.detail)).toEqual(proof);
  });
  it('a game that was not played still gets the section — every played proof said as not taken, with why', () => {
    const proof = gameProof({ contract: c, run: null, ranMs: null, files: {}, notPlayedWhy: 'the playtest browser stopped: timed out' });
    expect(proof.actions).toEqual([]);
    expect(proof.looks.taken).toEqual([]);
    expect(proof.looks.notTaken.slice(0, 3).every((n) => n.why === 'not taken: the playtest browser stopped: timed out')).toBe(true);
    expect(proof.looks.notTaken[3]).toEqual({ view: 'day and night', why: 'not taken: the game has no day-night clock' });
    expect(gameProofIssue(proof).message).toMatch(/\(c\) Played: none — the game was not played\. \(d\) Ran: the playtest did not run, frame rate not measured/);
  });
  it('the playtest script takes the pictures in the sandbox, bounded, and a far view only through a one-draw pull-back', () => {
    const cfg = gamePlaytestConfig('http://x', null, [], {});
    expect(cfg.proof).toEqual(PROOF_PICTURES);
    const mod = gamePlaytestModule(cfg, "import { chromium } from 'playwright';");
    expect(mod).toContain("const proofStart = await proofPicture(page, b, 'start');");
    expect(mod).toContain("const proofMoved = await proofPicture(page, movedPng, 'moved');");
    expect(mod).toContain("const proofFar = await proofPicture(page, farPng, 'far');");
    // the far view never moves the game's own camera: restored in a finally, perspective cameras drawing a scene only
    expect(mod).toMatch(/camera\.isPerspectiveCamera[\s\S]{0,700}finally \{\s*camera\.matrixWorld\.copy\(saved\)/);
    // the late pictures stand down before the budget runs out, and say so
    expect(mod).toContain('not taken: too little of the playtest budget was left');
    // stdout carries the description, never the image
    expect(mod).toContain('const { png, ...rest } = p;');
  });
});

describe('the playtest score is never presented as a graphics verdict', () => {
  it('the words', () => {
    expect(PLAYS_WELL).toBe('Plays well');
    const src = readFileSync('src/server/AgentV3/gamePlaytest.ts', 'utf8');
    expect(src).toContain('Game Quality Score ${score.overall}/100 for playability, not graphics (');
    expect(src).not.toMatch(/`A good game — /);
    expect(src).toContain("visual: 'Picture detail'");
    const card = readFileSync('src/server/AgentV3/buildProofCard.ts', 'utf8');
    expect(card).toContain('/100 for playability (not a rating of its graphics).');
  });
});

describe('the release gate says which named features nothing proved', () => {
  it('green stays green, and names them', () => {
    const played: RuntimeEvidence = {
      buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'none-derivable', typecheck: 'passed', tests: 'passed',
      noPageRoutes: true, explore: 'passed', explorePresses: 1, game: 'passed',
    };
    const clean = { blockers: 0, highSeverity: 0, warnings: 0 };
    const g = releaseGate({ ...played, gameFeaturesUnverified: ['traffic', 'swimming'] }, clean);
    expect(g.state).toBe('green');
    expect(g.unproven.join(' ')).toMatch(/named feature\(s\) traffic, swimming were NOT VERIFIED/);
    expect(g.headline).toMatch(/camera answered\. Not verified: traffic, swimming\.$/);
    // nothing unverified → exactly the old sentence
    expect(releaseGate(played, clean).headline).toBe('Shippable — it runs, and the game was played in a real browser: its controls, movement and camera answered.');
    // only a played game carries it
    expect(releaseGate({ ...played, game: undefined, gameFeaturesUnverified: ['traffic'] }, clean).unproven.join(' ')).not.toMatch(/traffic/);
  });
  it('the phase hands them to the route, and the route to the gate', () => {
    const phase = readFileSync('src/server/AgentV3/buildPhases/gamePlaytestPhase.ts', 'utf8');
    expect(phase).toContain('if (evidence?.notVerified?.length) out.featuresUnverified = [...evidence.notVerified];');
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('if (played.featuresUnverified) gateEvidence.gameFeaturesUnverified = played.featuresUnverified;');
  });
});
