// BR1968 (report 83e46df16a…, 2026-11-08) — "Make a game game was type of super market simulator make a game"
//
// A short, broken-English request for a supermarket-simulator-type game. APP_SCOPE
// correctly read it as an ordinary one-shot (not a famous clone). The game kit
// laid down the 2D layers (runtime, vfx, melody; "3D assets not prepared") because
// the prompt never said 3D, first-person, or a DRAWN_IN_3D title. The builder
// shipped a DOM supermarket UI with a "Start Game" button: the click explorer
// pressed it and it responded; there was no canvas, so the canvas playtest did
// not run.
//
// On 2026-11-08 that skip was silent (no GAME_PLAYTEST_NOT_RUN, no
// CLAIM_UNSUPPORTED) because:
//   - domGameKind only named quiz/card/board/puzzle, so genre=simulator returned
//     null (BR1951's `if (g && g !== 'unknown') return 'action'` landed the next
//     day in #4123 / 4f39a6c98);
//   - gateEvidence.game was therefore never set, and the journeyOutcome ternary
//     plus the "fully functional" detector landed later still (BR1956 / #4128).
// Today's code already discloses a DOM action game as GAME_PLAYTEST_NOT_RUN
// (info) and contradicts "ready to play" / "fully functional" when those
// measurements are passed in. This file locks that honest path and the
// readings that must not regress. It does not widen playtest to DOM controls
// (Q-2634) and does not escalate "supermarket simulator" to a famous 3D clone
// (Q-2639, sibling of Q-2635).
//
// No production classifier or delivery-path change ships in this PR.

import { describe, it, expect } from 'vitest';
import { analyzeAppScope, scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { fastLaneSkipsGame } from '../src/server/AgentV3/fastLaneRung';
import { gameKitPlan, gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { realismIntent } from '../src/server/lib/realismIntent';
import {
  isCanvasGameProject,
  domGameKind,
  domGameNotPlayedVerdict,
  playtestSkipReason,
  startLabelRank,
} from '../src/server/AgentV3/gamePlaytest';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { deriveJourneys, noJourneyReason } from '../src/server/AgentV3/journeyDerivation';

export const BR1968_PROMPT = 'Make a game game was type of super market simulator make a game';

/** The model's end-of-build recap (report.summary). Not the short "Here's what I built" card. */
export const BR1968_SUMMARY = `Great! The app is working well. Let me summarize what I've built:

## Supermarket Simulator Game - Complete!

I've successfully built a fully functional supermarket simulator game with all the features you requested:

The game is now ready to play! Simply click the "Start Game" button to begin managing your supermarket.`;

const DOM_SUPERMARKET = {
  'src/game/core/loop.ts': 'export function GameLoop(){ requestAnimationFrame(() => {}); }',
  'src/game/core/state.ts': 'export interface BaseGameState { status: string }',
  'src/game/supermarket/state.ts': 'export const supermarketState = { money: 500, day: 1, reputation: 80 };',
  'src/game/supermarket/logic.ts': 'export function tick(s: { day: number }){ s.day += 1; return s; }',
  'src/game/supermarket/GameUI.tsx':
    'export default function GameUI(){ return <div><button>Start Game</button><div>Restock shelves</div></div>; }',
  'src/App.tsx': 'export default function App(){ return <div><button>Start Game</button></div>; }',
};

const TWO_D_KIT = ['generate_game_runtime', 'generate_game_vfx', 'generate_melody'] as const;

describe('BR1968: a supermarket-simulator-type game stays an ordinary 2D DOM game', () => {
  it("this report's prompt is an ordinary one-shot game, not a famous clone", () => {
    const scope = analyzeAppScope(BR1968_PROMPT);
    expect(scope.decision).toBe('direct');
    expect(scope.size).toBe('small');
    expect(scope.famousApp).toBeNull();
    expect(scope.signals.some((s) => /no mega-signal — treated as an ordinary one-shot app/.test(s))).toBe(true);
    expect(scopeVerdict(BR1968_PROMPT, { complex: true }).large).toBe(false);
    expect(analyzeRequirementGaps(BR1968_PROMPT).domain).toBe('game');
    expect(fastLaneSkipsGame(analyzeRequirementGaps(BR1968_PROMPT).domain)).toBe(true);
  });

  it('does not prepare the 3D kit: genre is simulator, dimension unspecified, realism lite', () => {
    expect(gameKitWants3D(BR1968_PROMPT)).toBe(false);
    expect(gameKitPlan(BR1968_PROMPT)).toEqual([...TWO_D_KIT]);
    const contract = buildGameContract(BR1968_PROMPT);
    expect(contract.genre).toBe('simulator');
    expect(contract.dimension).toBe('unspecified');
    expect(contract.requiredFeatures).toEqual([]);
    expect(realismIntent(BR1968_PROMPT).tier).toBe('lite');
    // The spaced and glued wording of the same genre request stay on the 2D kit too.
    expect(gameKitWants3D('Make a supermarket simulator game')).toBe(false);
    expect(gameKitPlan('Make a supermarket simulator game')).toEqual([...TWO_D_KIT]);
    expect(buildGameContract('Make a supermarket simulator game').genre).toBe('simulator');
    // A bare title is still not a famous-app clone (Q-2639: escalating that is queued).
    expect(analyzeAppScope('Supermarket Simulator').famousApp).toBeNull();
    expect(analyzeAppScope('Supermarket Simulator').decision).toBe('direct');
  });

  it('a DOM supermarket with Start Game is an unplayed action game, not a silent skip', () => {
    const contract = buildGameContract(BR1968_PROMPT);
    expect(isCanvasGameProject(DOM_SUPERMARKET)).toBe(false);
    expect(domGameKind(DOM_SUPERMARKET, contract)).toBe('action');
    const verdict = domGameNotPlayedVerdict('action');
    expect(verdict.code).toBe('GAME_PLAYTEST_NOT_RUN');
    expect(verdict.severity).toBe('info');
    expect(verdict.autoResolved).toBe(true);
    expect(verdict.score).toBeNull();
    expect(verdict.message).toMatch(/drawn in the page, not on a game canvas/);
    // The canvas-path skip reason stays silent for a non-canvas project (not-applicable).
    // The DOM path above is what must speak; Q-913 must not be re-opened as a nag here.
    expect(playtestSkipReason({
      enabled: true,
      buildOk: true,
      isCanvasGame: false,
      isImportTurn: false,
      aborted: false,
      hasRunCommand: true,
      hasPreviewUrl: true,
      awaitsShell: false,
      timeLeft: true,
    })).toBeNull();
    expect(startLabelRank('Start Game')).toBe(2);
    expect(deriveJourneys({ files: DOM_SUPERMARKET, routes: ['/'], marker: 'nbai-x' })).toEqual([]);
    expect(noJourneyReason(DOM_SUPERMARKET)).toMatch(/no form/i);
  });

  it("this report's ready-to-play recap is contradicted once playtest/journey are told as not-run", () => {
    const kinds = (facts: Parameters<typeof auditSummaryClaims>[1]) =>
      auditSummaryClaims(BR1968_SUMMARY, facts).map((c) => c.kind);
    expect(kinds({
      consoleCaptured: true,
      previewVerified: true,
      filesWritten: 20,
      buildWasRequested: true,
      sourceIsWholeApp: true,
      sourceText: Object.values(DOM_SUPERMARKET).join('\n'),
      gamePlayed: 'not-run',
      journeyOutcome: 'not-run',
    })).toEqual(['game-claimed-playable', 'functionality-unverified']);
    // Historical auditor silence: omitted measurements must not become accusations.
    expect(kinds({
      consoleCaptured: true,
      previewVerified: true,
      filesWritten: 20,
      buildWasRequested: true,
      sourceIsWholeApp: true,
      sourceText: Object.values(DOM_SUPERMARKET).join('\n'),
    })).toEqual([]);
  });
});

describe('BR1968 neighbours: supermarket-the-business and already-3D titles must not move', () => {
  it('a supermarket billing or inventory app is not a game and gets no game kit', () => {
    expect(analyzeRequirementGaps('supermarket billing POS app').domain).not.toBe('game');
    expect(gameKitPlan('supermarket billing POS app')).toEqual([]);
    expect(buildGameContract('supermarket billing POS app').genre).toBe('unknown');
    expect(analyzeRequirementGaps('supermarket inventory management app').domain).not.toBe('game');
    expect(gameKitPlan('supermarket inventory management app')).toEqual([]);
    expect(gameKitWants3D('supermarket billing POS app')).toBe(false);
  });

  it('titles that already take the 3D kit still do (gta5, explicit 3D train sim, BR1951 runner DOM)', () => {
    const gta = 'gta5 wala game';
    expect(analyzeAppScope(gta).famousApp).toBe('GTA');
    expect(analyzeAppScope(gta).size).toBe('large');
    expect(gameKitWants3D(gta)).toBe(true);
    expect(gameKitPlan(gta)).toContain('generate_game_3d');
    expect(gameKitWants3D('Create a 3D train simulator with a realistic train')).toBe(true);
    expect(buildGameContract('Create a 3D train simulator with a realistic train').dimension).toBe('3d');
    // BR1951's original runner lock: a non-canvas runner is still named, not omitted.
    const runner = buildGameContract('Make a runner game');
    expect(domGameKind({ 'src/Game.tsx': 'export default () => <div>Jump</div>' }, runner)).toBe('action');
  });
});
