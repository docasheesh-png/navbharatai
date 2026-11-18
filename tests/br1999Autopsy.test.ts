/**
 * BR1999 autopsy: a free Weak gun game ("Muje gun game banana he") succeeded GREEN, but its RELEASE_GATE
 * line read "… (it keeps its progress in a database write in src/game/GameManager.js), and its settings
 * (not a defect)". Two defects in one sentence:
 *
 * F1: the gate cut the journey derivation's own sentence at a fixed 200 characters, mid-sentence, and then
 *     added "(not a defect)". The game sentence is about 330 characters, so every game hit it. Class: a
 *     consumer caps a sentence its producer writes, and the cap is shorter than the producer's sentences.
 *     Sibling in the same function: the unreachable-journey reason (160, same blind slice).
 * F2: the game sentence said "its settings controls (a sound switch, a speed slider)", which reads as a
 *     fact about this game. The gun game had neither.
 * Locked (already closed on main after this build ran): the empty-workspace kit claim (BR1958/BR1977), and
 * "a database write" for a game whose loop calls `.update()` (BR1955). All fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clipReason, JOURNEY_NONE_WHY_MAX, JOURNEY_UNREACHABLE_WHY_MAX, releaseGate, type RuntimeEvidence,
} from '../src/server/AgentV3/releaseGate';
import {
  gameNoJourneyReason, savedWithoutFormReason, savedStateEvidence, noJourneyReason,
  LOOKUP_ONLY_REASON, NO_DATA_ENTRY_REASON,
} from '../src/server/AgentV3/journeyDerivation';
import { downgradeEmptyKitSeedSuccesses, gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';

const ROOT = join(__dirname, '..');
const NO_FINDINGS = { blockers: 0, highSeverity: 0, warnings: 0 };
const LONG_PATH = 'src/features/very-long-feature-folder-name/components/GameManagerController.jsx';

// The delivered tree's shape: a JS canvas shooter whose manager saves its best score in localStorage and
// whose loop calls `.update()` on its entities.
const GUN_GAME: Record<string, string> = {
  'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  'src/main.jsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')).render(<App />);\n",
  'src/App.jsx': "import React, { useEffect, useRef } from 'react';\nimport { GameManager } from './game/GameManager';\nexport default function App() {\n  const ref = useRef(null);\n  useEffect(() => { const g = new GameManager(ref.current); g.start(); return () => g.stop(); }, []);\n  return <canvas ref={ref} width={800} height={600} />;\n}\n",
  'src/game/GameManager.js': [
    'export class GameManager {',
    "  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.enemies = []; this.best = Number(localStorage.getItem('gunGameBest') || 0); }",
    '  start() { const tick = () => { this.update(); this.draw(); this.raf = requestAnimationFrame(tick); }; tick(); }',
    '  stop() { cancelAnimationFrame(this.raf); }',
    '  update() { for (const e of this.enemies) e.update(); }',
    "  draw() { this.ctx.fillRect(0, 0, 10, 10); }",
    "  gameOver(score) { if (score > this.best) { this.best = score; localStorage.setItem('gunGameBest', String(score)); } }",
    '}',
  ].join('\n'),
};

const gateWith = (ev: Partial<RuntimeEvidence>) => releaseGate({
  buildOk: true, preview: 'passed', pages: 'not-run', typecheck: 'not-run', tests: 'not-run',
  testSuiteIsOurStarter: true, noPageRoutes: true, ...ev,
} as RuntimeEvidence, NO_FINDINGS);

describe('F1 the gate keeps the derivation\'s reason whole', () => {
  it('🔴 the report shape: the game sentence reaches the gate whole, never "and its settings  (not a defect)"', () => {
    const why = noJourneyReason(GUN_GAME);
    expect(why).toMatch(/^this is a game/);
    expect(why.length).toBeGreaterThan(200); // the old cap cut exactly this sentence
    const v = gateWith({ journeys: 'none-derivable', journeyNoneWhy: why });
    const line = v.unproven.find((u) => u.startsWith('this is a game'));
    expect(line).toBe(`${why} (not a defect)`);
    expect(v.unproven.join(' ')).not.toMatch(/and its settings\s+\(not a defect\)/);
  });

  it('census: every sentence noJourneyReason can return fits the cap, even with a long path', () => {
    const saved = { path: LONG_PATH, what: 'a browser database' };
    const sentences = [
      gameNoJourneyReason(saved), gameNoJourneyReason(null), savedWithoutFormReason(saved),
      LOOKUP_ONLY_REASON, NO_DATA_ENTRY_REASON,
      // The inline "takes input, but no page reaches that form" branch, at its longest realistic size.
      `this app takes input (a change handler in ${LONG_PATH}), but no page reaches that form and its file `
        + 'name gives no control to open it with — screens switched without a router are reached only by pressing a control named after them',
    ];
    for (const s of sentences) expect(s.length, s).toBeLessThanOrEqual(JOURNEY_NONE_WHY_MAX);
  });

  it('🔒 source guard: no blind fixed slice of a reason is left in the gate', () => {
    const src = readFileSync(join(ROOT, 'src/server/AgentV3/releaseGate.ts'), 'utf8');
    expect(src).not.toMatch(/Why \?\? ''\)\.trim\(\)\.replace\(\/\\s\+\/g, ' '\)\.slice\(0,/);
    expect(src).toMatch(/clipReason\(ev\.journeyNoneWhy, JOURNEY_NONE_WHY_MAX\)/);
    expect(src).toMatch(/clipReason\(ev\.journeyUnreachableWhy, JOURNEY_UNREACHABLE_WHY_MAX\)/);
  });

  it('sibling: an over-long unreachable reason is cut at a clause and marked, never mid-word', () => {
    const note = `the form opened, ${'the submit button stayed disabled after every field was filled, '.repeat(5)}and nothing changed`;
    const v = gateWith({ journeys: 'unreachable', journeyUnreachableWhy: note });
    const line = v.unproven.find((u) => u.startsWith('a user journey was derived but could not be reached ('))!;
    const inner = line.slice(line.indexOf('(') + 1, -1);
    expect(inner.length).toBeLessThanOrEqual(JOURNEY_UNREACHABLE_WHY_MAX);
    expect(inner.endsWith('…')).toBe(true);
    expect(inner).not.toMatch(/,…$/);
  });
});

describe('clipReason', () => {
  it('leaves text that fits alone, and only normalizes whitespace', () => {
    expect(clipReason('  a  short\n reason ', 50)).toBe('a short reason');
    expect(clipReason(undefined, 50)).toBe('');
  });
  it('cuts at the last clause, then the last word, and never inside an open parenthesis', () => {
    expect(clipReason('first clause here, second clause that is much too long to keep', 30)).toBe('first clause here…');
    expect(clipReason('onewordthatislongerthanthecap and more', 20).endsWith('…')).toBe(true);
    const r = clipReason('it keeps its progress (in browser storage in a very long path name here) and more', 40);
    expect(r).toBe('it keeps its progress…');
    expect(r.length).toBeLessThanOrEqual(40);
  });
  it('mutation guard: the cap is never shorter than the game sentence', () => {
    expect(JOURNEY_NONE_WHY_MAX).toBeGreaterThan(gameNoJourneyReason({ path: LONG_PATH, what: 'browser storage' }).length);
  });
});

describe('F2 the game sentence names settings as examples, not as facts about this game', () => {
  it('🔴 no "its settings controls (a sound switch, a speed slider)"', () => {
    const s = gameNoJourneyReason(null);
    expect(s).not.toMatch(/its settings controls/);
    expect(s).toMatch(/settings such as a sound switch or a speed slider are not data/);
  });
});

describe('locked closures (merged after this build ran)', () => {
  it('BR1955: a game loop\'s .update() is not "a database write"; its localStorage best score is browser storage', () => {
    expect(savedStateEvidence(GUN_GAME)).toEqual({ path: 'src/game/GameManager.js', what: 'browser storage' });
    expect(noJourneyReason(GUN_GAME)).toMatch(/in browser storage in src\/game\/GameManager\.js/);
    expect(noJourneyReason(GUN_GAME)).not.toMatch(/a database write/);
  });

  it('BR1977: three "ok" recipes that wrote 0 files are not a seeded kit, so the builder is never told it is on disk', () => {
    const results = ['generate_game_runtime', 'generate_game_vfx', 'generate_melody']
      .map((recipe) => ({ recipe, ok: true, content: 'ok' }));
    downgradeEmptyKitSeedSuccesses(results, 0);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(gameKitHandoffBlock(results)).not.toMatch(/on disk NOW/);
  });
});
