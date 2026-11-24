/**
 * 🎮 THE GAME PLAYTEST PHASE (S7 of the locked plan, 2026-11-24; Q-3237 option A — the build route's handler only shrinks).
 *
 * Moved out of src/server/routes/agentv3.ts unchanged in behaviour: the route says what it knows (the facts that decide
 * whether the game can be played, a way to play it, the files, the stores) and this plays the game in the sandbox's
 * browser, judges it, and records what it found. It returns what the route keeps (the proof the release gate and the
 * proof card read, and the measured defects the next turn reads); null means "this turn did not reach a game".
 *
 * Three ways in, each said, never silent (Q-913): played (scored, defects, rules, regression, scope); a canvas game that
 * could not be played (an open GAME_PLAYTEST_NOT_RUN warning — never a pass, autopsy 61279465); and a game drawn in the
 * page (quiz, card, board, puzzle), said as not played (BR1951). Evidence only: it never gates, charges or edits.
 */
import {
  domGameKind, domGameNotPlayedVerdict, isCanvasGameProject, gameDefectsMessage, gameScopeVerdict, missingKitLayerPaths, parsePlaytest,
  playtestDefects, playtestNotRunVerdict, playtestOutcome, playtestSkipReason, playtestVerdict, replayFromCode, withKitLayersFromDisk,
} from '../gamePlaytest';
import { scopeMatch, type GameScopeContract } from '../gameIntent';
import { gameGotWorse, gameMeasureFromIssues, gameUndoMessage, versionBeforeTurn } from '../gameRegression';
import { GAME_GEOMETRY_CODE, gameGeometryProbeEnabled, geometryFindings, geometryFindingsMessage } from '../gameGeometryProbe';
import { reportGameFixOutcome, reportGameFixUnverified, type GameFixPorts } from './gameFixVerdict';
import { reportRuleProbes } from './gameRuleProbes';

/** What decides whether the game can be played now. All true ⇒ played; otherwise the reason is said. */
export interface PlaytestFacts {
  enabled: boolean;
  buildOk: boolean;
  isCanvasGame: boolean;
  isImportTurn: boolean;
  aborted: boolean;
  hasRunCommand: boolean;
  hasPreviewUrl: boolean;
  awaitsShell: boolean;
  platformDone: boolean;
  timeLeft: boolean;
}

export type GameOutcome = 'passed' | 'failed' | 'not-run';
export interface GamePlayedFacts { defects: ReturnType<typeof playtestDefects>; scopeMissing: string[]; played: boolean }
export interface GamePlaytestResult {
  proof: { outcome: GameOutcome; score?: number | null; unplayed?: boolean };
  /** What the release gate reads (gateEvidence.game). */
  gate: GameOutcome;
  /** Measured defects for the next turn (gamePlayedRef), when the game was played. */
  played?: GamePlayedFacts;
}

export interface PlaytestIssue { phase: 'preview'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean; detail?: string }

export interface GamePlaytestPorts {
  facts: PlaytestFacts;
  /** The project as it stands after this turn's writes. */
  files: Record<string, string>;
  contract: GameScopeContract | null;
  /** Runs the playtest script in the sandbox (the route wraps the timeout); its stdout is parsed. */
  play: () => Promise<{ stdout: string }>;
  readFile: (path: string) => Promise<string | null | undefined>;
  record: (issue: PlaytestIssue) => void;
  /** The issues of the report from before this turn (for "did this turn make the game worse?"). */
  previousIssues: () => Promise<Parameters<typeof gameMeasureFromIssues>[0]>;
  /** Saved versions of this project, to offer a way back to the one before this turn. */
  versions: () => Promise<Parameters<typeof versionBeforeTurn>[0]>;
  turnStartedAt: number;
  fix: GameFixPorts;
}

function playable(f: PlaytestFacts): boolean {
  return f.enabled && f.buildOk && f.hasPreviewUrl && f.hasRunCommand && !f.isImportTurn && !f.aborted && !f.awaitsShell
    && !f.platformDone && f.isCanvasGame && f.timeLeft;
}

/** Play the game when it can be; otherwise say why. Never throws. */
export async function runGamePlaytestPhase(p: GamePlaytestPorts): Promise<GamePlaytestResult | null> {
  try {
    return playable(p.facts) ? await playIt(p) : notPlayed(p);
  } catch { return null; }
}

async function playIt(p: GamePlaytestPorts): Promise<GamePlaytestResult> {
  let out: GamePlaytestResult;
  try {
    const playRun = parsePlaytest((await p.play()).stdout);
    reportRuleProbes(playRun.rules, p.fix); // the user's named rules, proved by playing (gameRuleProbes.ts)
    const playedFiles = await withKitLayersFromDisk(p.files, p.readFile);
    const verdict = playtestVerdict(playRun, replayFromCode(playedFiles));
    p.record({ phase: 'preview', severity: verdict.severity, code: verdict.code, message: verdict.message, autoResolved: verdict.autoResolved });
    const proof: GamePlaytestResult['proof'] = { outcome: playtestOutcome(verdict.code), score: verdict.score?.overall ?? null };
    if (proof.outcome === 'not-run') proof.unplayed = true; // the runner's own "never played" answer
    // 🎮 The release gate reads the SAME answer: a canvas game is GREEN only when it was played (autopsy 61279465).
    out = { proof, gate: proof.outcome };
    // Game Engine Ultra Phase 2: structured defect codes for Phase 3 — evidence only.
    try {
      const measured = playtestDefects(playRun, verdict.score, missingKitLayerPaths(playedFiles), replayFromCode(playedFiles));
      out.played = { defects: measured, scopeMissing: p.contract ? scopeMatch(p.contract, playedFiles).missing : [], played: proof.outcome !== 'not-run' };
      const defectsMsg = gameDefectsMessage(measured);
      if (defectsMsg) p.record({ phase: 'preview', severity: 'info', code: 'GAME_DEFECTS', message: defectsMsg, autoResolved: true });
      // 🔎 The read-only geometry look (gameGeometryProbe.ts): an info line for the admin report, handed to the builder
      // as a builder-only note on the next turn. Never scored, never a gate, never shown to the user.
      if (gameGeometryProbeEnabled()) {
        const geometryMsg = geometryFindingsMessage(geometryFindings(playRun.geometry, playRun.models, playRun.heap));
        if (geometryMsg) p.record({ phase: 'preview', severity: 'info', code: GAME_GEOMETRY_CODE, message: geometryMsg, autoResolved: true });
      }
      // Too heavy for a budget phone: a real defect of the user's game, with a one-tap fix (buildFindingSuggestions).
      const heavy = measured.find((d) => d.code === 'GAME_DEFECT_TOO_HEAVY');
      if (heavy) p.record({ phase: 'preview', severity: 'warning', code: 'GAME_TOO_HEAVY', message: `Too heavy for budget phones: ${heavy.evidence}.`, autoResolved: false });
      // 🎮 DID THIS TURN MAKE THE GAME WORSE? Compared with the measure from before the turn; if so, the user is told in
      // plain words and offered a one-tap "Go back" to the saved version from just before it (the ❗️ list row (gameUndo.ts)
      // reads the version id from this finding's detail). Nothing is changed automatically.
      try {
        const before = gameMeasureFromIssues(await p.previousIssues());
        const after = { score: verdict.score?.overall ?? null, defects: measured.map((d) => d.code) };
        const worse = gameGotWorse(before, after);
        if (worse) {
          const versions = await p.versions().catch(() => []);
          const versionId = versionBeforeTurn(versions, p.turnStartedAt);
          if (versionId) p.record({ phase: 'preview', severity: 'warning', code: 'GAME_GOT_WORSE', message: gameUndoMessage(worse), detail: versionId, autoResolved: false });
        }
        reportGameFixOutcome(before, after, p.fix); // better / unchanged, said with both scores
      } catch { /* observation only — never in the way of the build */ }
    } catch { /* observation only */ }
    // Scope match (gameIntent.ts) — evidence only, never a gate or a charge.
    try {
      const scope = p.contract ? gameScopeVerdict(p.contract, playedFiles) : null;
      if (scope) p.record({ phase: 'preview', severity: scope.severity, code: scope.code, message: scope.message, autoResolved: scope.autoResolved });
    } catch { /* observation only */ }
  } catch (err) {
    // A playtest that timed out or crashed is a check that could not look — the same open warning the runner's own
    // "never played" answer gives, never an info line that reads as a pass.
    const notRun = playtestNotRunVerdict(`the playtest browser stopped: ${String((err as { message?: string })?.message ?? err).slice(0, 160)}`);
    try { p.record({ phase: 'preview', severity: notRun.severity, code: notRun.code, message: notRun.message, autoResolved: notRun.autoResolved }); } catch { /* best-effort */ }
    // 🔴 A playtest that could not finish is NOT a pass (autopsy 61279465: it timed out and the gate said GREEN).
    out = { proof: { outcome: 'not-run', score: null, unplayed: true }, gate: 'not-run' };
  }
  return out;
}

function notPlayed(p: GamePlaytestPorts): GamePlaytestResult | null {
  let out: GamePlaytestResult | null = null;
  // 🔴 THE THIRD WAY THIS CHECK IS REACHED, AND IT HAD NO SENTENCE (Q-913, autopsy 50378049). A canvas game the route
  // could not play used to be SILENTLY skipped. `playtestSkipReason` tells "could not look" from "not applicable": a
  // project with no canvas game, an import turn, a stopped or failed build and the kill switch stay silent.
  try {
    const why = playtestSkipReason(p.facts);
    if (why) {
      const notRun = playtestNotRunVerdict(why);
      p.record({ phase: 'preview', severity: notRun.severity, code: notRun.code, message: notRun.message, autoResolved: notRun.autoResolved });
      // a canvas game we could not play is not verified (playtestSkipReason is silent otherwise)
      out = { proof: { outcome: playtestOutcome(notRun.code), score: null, unplayed: true }, gate: 'not-run' };
      reportGameFixUnverified(p.fix); // a tapped fix whose game could not be played again is said as not known
    }
  } catch { /* an honest line is best-effort and must never touch a build */ }
  // Game Engine Ultra Phase 2: a quiz/card/board/puzzle game drawn in the page is SAID, never silent or scored.
  try {
    const f = p.facts;
    // the game's CODE decides here (no request hint), as it always has
    const domKind = f.enabled && f.buildOk && !f.isImportTurn && !f.aborted && !isCanvasGameProject(p.files) ? domGameKind(p.files, p.contract) : null;
    if (domKind) {
      const dom = domGameNotPlayedVerdict(domKind);
      p.record({ phase: 'preview', severity: dom.severity, code: dom.code, message: dom.message, autoResolved: dom.autoResolved });
      out = { proof: { outcome: playtestOutcome(dom.code), score: null }, gate: 'not-run' }; // BR1951: DOM controls clicked is not a game playthrough.
    }
  } catch { /* observation only */ }
  return out;
}
