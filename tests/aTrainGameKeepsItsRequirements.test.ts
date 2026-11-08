// A TRAIN SIMULATOR IS NOT "genre: unknown", AND A GAME NOBODY PLAYED IS NOT GREEN (autopsy 61279465,
// 2026-11-04 — the 3D train simulator).
//
// Two defects from one report, each a class:
//   1. THE CONTRACT LOST THE REQUEST. "Create a 3D train simulator with a realistic train, railway tracks,
//      trees, buildings and mountains. Use compatible free external 3D assets, not primitive placeholders.
//      Make the game playable with mobile controls." was recorded as {genre: unknown, requiredFeatures: []}.
//      No genre named a simulator, and the contract had no field for the vehicle, the camera, the world or
//      the assets — so nothing after planning could hold the build to them.
//   2. THE GATE IGNORED THE PLAYTEST. It timed out after 80 s ("the game was never played"), and the release
//      gate still said GREEN — "pressing its controls in a real browser held up" — because one button,
//      "Start Simulation", had been pressed. The gate had no input for the playtest at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGameContract, gameContractBlock, scopeMatch } from '../src/server/AgentV3/gameIntent';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { platformChecksProof } from '../src/server/AgentV3/buildProofCard';

const REPORT_PROMPT = 'Create a 3D train simulator with a realistic train, railway tracks, trees, buildings and mountains. Use compatible free external 3D assets, not primitive placeholders. Make the game playable with mobile controls.';

describe('🚆 the reported prompt, read into a contract that keeps every requirement', () => {
  const c = buildGameContract(REPORT_PROMPT);
  it('genre, vehicle, camera, world, assets and controls — none lost', () => {
    expect(c.genre).toBe('simulator');
    expect(c.dimension).toBe('3d');
    expect(c.vehicle).toBe('train');
    expect(c.camera).toBe('third-person');
    expect(c.subjects).toEqual(['train', 'railway track', 'tree', 'building', 'mountain']);
    expect(c.externalAssets).toBe(true);
    expect(c.controls).toContain('touch');
    expect(c.requiredFeatures).toEqual(expect.arrayContaining(['throttle', 'braking']));
  });
  it('the builder is told all of it, including the chase camera that sizes itself to the train', () => {
    const block = gameContractBlock(c);
    expect(block).toContain('Genre: simulator');
    expect(block).toContain('The player drives: a train');
    expect(block).toMatch(/CameraRig\(\{ kind: 'chase' \}\)/);
    expect(block).toMatch(/never hand it a fixed offset/);
    expect(block).toContain('train, railway track, tree, building, mountain');
    expect(block).toMatch(/real 3D models, not primitive placeholders/);
  });
  it('after the build, a train that cannot brake is a named gap — the kit driver counts as both', () => {
    expect(scopeMatch(c, { 'src/game/train/Train.ts': 'speed += accel * dt;' }).missing).toEqual(['braking']);
    expect(scopeMatch(c, { 'src/game/train/Train.ts': 'state = driveVehicle(train, state, axis, dt);' }).missing).toEqual([]);
  });
});

describe('the new fields do not over-read other requests', () => {
  it.each([
    ['Train your dog to fetch — a 2D puzzle game', null],
    ['make a car racing game', 'car'],
    ['bus simulator in india with a city', 'bus'],
    ['flight simulator with a plane', 'aircraft'],
    ['a snake game with score', null],
  ])('%s → vehicle %s', (prompt, vehicle) => {
    expect(buildGameContract(prompt).vehicle ?? null).toBe(vehicle);
  });
  it('a plane is throttled, not braked; a quiz implies neither', () => {
    expect(buildGameContract('flight simulator with a plane').requiredFeatures).toEqual(['throttle']);
    expect(buildGameContract('a quiz game with score').requiredFeatures).toEqual(['score']);
  });
  it('"racing simulator" stays racing — the race is what the game is', () => {
    expect(buildGameContract('a car racing simulator').genre).toBe('racing');
  });
});

// The evidence the reported build actually had (RELEASE_GATE: "Proven: the app came up and rendered; the
// project typechecks; the app's own test suite passes; pressing 1 of its controls … broke nothing").
const REPORTED: RuntimeEvidence = {
  buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'none-derivable', typecheck: 'passed', tests: 'passed',
  noPageRoutes: true, explore: 'passed', explorePresses: 1,
};
const CLEAN = { blockers: 0, highSeverity: 0, warnings: 0 };

describe('🎮 the release gate: a canvas game is GREEN only when it was PLAYED', () => {
  it('THE REPORTED BUILD: the playtest never ran → NOT green, and the headline says NOT VERIFIED', () => {
    const g = releaseGate({ ...REPORTED, game: 'not-run' }, CLEAN);
    expect(g.state).toBe('yellow');
    expect(g.headline).toMatch(/never played in a browser, so whether it is playable is NOT VERIFIED/);
    expect(g.unproven.join(' ')).toMatch(/never played in a real browser/);
  });
  it('the playtest found problems → yellow, the game NOT VERIFIED as playable', () => {
    const g = releaseGate({ ...REPORTED, game: 'failed' }, CLEAN);
    expect(g.state).toBe('yellow');
    expect(g.headline).toMatch(/NOT VERIFIED as playable/);
  });
  it('the game was played and answered → green, and it says it was played', () => {
    const g = releaseGate({ ...REPORTED, game: 'passed' }, CLEAN);
    expect(g.state).toBe('green');
    expect(g.headline).toMatch(/the game was played in a real browser/);
  });
  it('a played game still cannot outrank a real failure or an unfinished build', () => {
    expect(releaseGate({ ...REPORTED, game: 'passed', gameIncomplete: 'braking is missing' }, CLEAN).state).toBe('red');
    expect(releaseGate({ ...REPORTED, game: 'passed', buildOk: false }, CLEAN).state).toBe('red');
  });
  it('an app that is not a canvas game is judged exactly as before', () => {
    expect(releaseGate(REPORTED, CLEAN).state).toBe('green');
  });
});

describe('the user is told the truth too: an unplayed game is "not verified yet" on the proof card', () => {
  it('a playtest that could not finish is its own line, and the card is not "all good"', () => {
    const card = platformChecksProof({ preview: 'passed', pages: 'not-run', typecheck: 'passed', tests: 'passed', phone: 'passed', game: { outcome: 'not-run', score: null, unplayed: true } }, { browserAlreadySaid: false });
    expect(card.ok).toBe(false);
    expect(card.headline).toMatch(/the game itself is not verified yet/);
    expect(card.steps.join(' ')).toMatch(/could not finish playing your game/);
  });
  it('a non-game app keeps its card as it was', () => {
    const card = platformChecksProof({ preview: 'passed', pages: 'not-run', typecheck: 'passed', tests: 'passed', phone: 'passed', game: { outcome: 'not-run' } }, { browserAlreadySaid: false });
    expect(card.ok).toBe(true);
  });
});

describe('🔒 the route feeds the playtest into the gate on EVERY way the playtest ends', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('played, timed out / crashed, could not be reached, DOM-only, and re-played after a repair', () => {
    expect(route).toMatch(/gameProof = \{ outcome: playtestOutcome\(verdict\.code\)[^\n]*\n[^\n]*unplayed = true[^\n]*\n[\s\S]{0,200}gateEvidence\.game = gameProof\.outcome;/);
    expect(route.match(/gateEvidence\.game = 'not-run';/g)?.length).toBe(3);
    expect(route).toMatch(/if \(domKind\) \{[\s\S]{0,500}gateEvidence\.game = 'not-run';/);
    expect(route).toMatch(/if \(gamePlayed\.defects\.length === 0\) gateEvidence\.game = 'passed';/);
  });
});

import { auditSummaryClaims, claimCorrection } from '../src/server/AgentV3/claimAudit';
describe('the model may not call an unplayed game "complete and working" (Q-2336)', () => {
  // The reported build's own first line, verbatim.
  const SUMMARY = "The 3D train simulator game is complete and working properly. Here's what I've built:\n\n## 3D Train Simulator Game";
  const base = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };
  it('THE REPORTED SUMMARY: the playtest never finished → contradicted, and the user is told so', () => {
    const c = auditSummaryClaims(SUMMARY, { ...base, gamePlayed: 'not-run' });
    expect(c.map((x) => x.kind)).toContain('game-claimed-playable');
    expect(claimCorrection(c)).toMatch(/whether it is playable is NOT VERIFIED/);
  });
  it('played and passed → the claim stands; not a canvas game → not judged', () => {
    expect(auditSummaryClaims(SUMMARY, { ...base, gamePlayed: 'passed' }).map((x) => x.kind)).not.toContain('game-claimed-playable');
    expect(auditSummaryClaims(SUMMARY, base).map((x) => x.kind)).not.toContain('game-claimed-playable');
  });
  it('a description is not a verdict', () => {
    expect(auditSummaryClaims('The game has a start screen with the controls explained.', { ...base, gamePlayed: 'not-run' })).toEqual([]);
  });
  it('🔒 the route hands the gate\'s game answer to the audit', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('gamePlayed: gateEvidence.game,');
  });
});
