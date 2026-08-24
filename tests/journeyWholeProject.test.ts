import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { journeyCandidates, noJourneyReason, deriveJourneys } from '../src/server/AgentV3/journeyDerivation';

/**
 * TWO DEFECTS IN THE SAME CHECK, both found by reading the admin's build reports (2026-08-24).
 *
 * The journey check is the ONLY thing that proves a generated app really SAVES data rather than only
 * appearing to — type into the form, submit, RELOAD, is it still there. It reported
 * JOURNEY_NOT_DERIVED on four of five builds, so our strongest evidence almost never ran.
 *
 *  1. IT WAS ONLY EVER SHOWN THE FILES THIS BUILD WROTE. On an edit that touched two components,
 *     src/App.tsx is not among them, so the search found no page to start from and said "no page
 *     components were found" — a sentence about the APP, when the truth was about the SEARCH.
 *
 *  2. FOR A GAME, "no page" IS THE CORRECT ANSWER, and it was phrased as a deficiency. All four of
 *     the admin's benchmark builds were one Three.js racing game whose whole UI is a canvas in
 *     src/game.ts. No App.tsx, no pages/, no form — every one of those correct.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('the journey sees the whole project, not just this turn\'s writes', () => {
  it('an edit that touches one component still finds the app\'s page', () => {
    // The exact failure: a to-do app edited to tweak one item component. Judged on the writes alone
    // there is no page anywhere and the check silently declines.
    const written = { 'src/components/TodoItem.tsx': 'export const TodoItem = () => <li>x</li>;' };
    expect(journeyCandidates(written)).toHaveLength(0);

    const wholeProject = {
      'src/App.tsx': '<form><input name="title" /><button type="submit">Add</button></form>',
      'src/main.tsx': 'render(<App />)',
      ...written,
    };
    expect(journeyCandidates(wholeProject)).toContain('src/App.tsx');
    expect(deriveJourneys({ files: wholeProject, marker: 'nbai-test' }).length).toBeGreaterThan(0);
  });

  it('the route feeds it the durable snapshot with this turn\'s writes ON TOP', () => {
    // Order is the correctness condition: a file this build just changed must be judged by its NEW
    // content, while every file it did not touch is still there to be found.
    expect(route).toContain('const journeyFiles = { ...(projectFilesAtTurnStart ?? {}), ...Object.fromEntries(writtenFiles) };');
  });

  it('costs no extra I/O — it reuses the read the File Guardian already does', () => {
    // A second full store read on the critical path would trade one honest check for a slower build.
    expect(route).toContain('projectFilesAtTurnStart = saved;');
    expect(route).toContain('let projectFilesAtTurnStart: Record<string, string> | null = null;');
  });

  it('falls back to today\'s behaviour when that read did not happen', () => {
    // `?? {}` — a build whose guardian step was skipped or failed behaves exactly as it does now,
    // rather than throwing on a path whose whole contract is "evidence, never a gate".
    expect(route).toContain('...(projectFilesAtTurnStart ?? {})');
  });
});

describe('"no page found" no longer accuses an app that is simply not a form app', () => {
  const GAME = {
    'src/game.ts': 'const canvas = document.querySelector("canvas"); renderer.render(scene, camera);',
    'src/main.ts': 'import "./game";',
  };

  it('a canvas game is told there is nothing to prove, not that something is missing', () => {
    const reason = noJourneyReason(GAME);
    expect(reason).toContain('no data-entry surface');
    expect(reason).not.toContain('no page components');
  });

  it('an EMPTY map is not a game — absence of files is absence of evidence', () => {
    // The first version of this fix got exactly this wrong: {} trivially "has no data entry", so it
    // confidently described a project it knew nothing about. Caught by an existing test.
    expect(noJourneyReason({})).toContain('no page components');
  });

  it('a real page with no input keeps its own, more precise answer', () => {
    // "This app has no form" is better than "this app is a game" for a page that plainly exists.
    expect(noJourneyReason({ 'src/pages/A.tsx': '<div>hi</div>' })).toContain('no form');
  });

  it('a project that HAS data entry but no findable page still reports the search failure', () => {
    // The one case where "no page components were found" is the honest answer: there IS a form
    // somewhere, so the app is not a game — we just could not find where to start.
    const reason = noJourneyReason({ 'src/widgets/Thing.tsx': '<form><input name="a" /></form>' });
    expect(reason).toContain('no page components');
  });
});

/**
 * THE MISTAKE I MADE TWICE WHILE FIXING THIS, kept as tests because it is the module's own bug class
 * turned inward. "No data entry found" is an ABSENCE, and an absence is equally true of a canvas game,
 * of an empty file map, and of a project we happen to hold one utility file for. Concluding "this is a
 * game, a dashboard or a landing page" from an absence is a report confidently describing an app it has
 * no evidence about. Two existing tests caught it; these keep it caught.
 */
describe('the "nothing to prove" verdict needs positive evidence of a UI', () => {
  const said = (files: Record<string, string>) => noJourneyReason(files);

  it('a project of one utility file is not a game', () => {
    expect(said({ 'src/util.ts': 'export const x = 1;' })).toContain('no page components');
  });

  it('an empty map is not a game', () => {
    expect(said({})).toContain('no page components');
  });

  it.each([
    ['a canvas game', { 'src/game.ts': 'const c = document.querySelector("canvas"); renderer.render(scene, camera);' }],
    ['a Three.js scene', { 'src/scene.ts': 'const r = new THREE.WebGLRenderer(); r.render(s, c);' }],
    ['a 2D canvas app', { 'src/draw.ts': 'const ctx = el.getContext("2d"); ctx.fillRect(0,0,1,1);' }],
  ])('%s does draw something, and has nothing to save', (_label, files) => {
    expect(said(files)).toContain('no data-entry surface');
  });

  it('a drawing app that ALSO takes input is not "nothing to prove"', () => {
    // The verdict is the conjunction of both facts, not either one. A game with a name-entry form has
    // a real journey to run, and claiming otherwise would skip the only check that proves it saves.
    const files = {
      'src/game.ts': 'const c = document.querySelector("canvas"); renderer.render(s, cam);',
      'src/pages/Score.tsx': '<form><input name="player" /><button type="submit">Save</button></form>',
    };
    expect(said(files)).not.toContain('no data-entry surface');
  });
});
