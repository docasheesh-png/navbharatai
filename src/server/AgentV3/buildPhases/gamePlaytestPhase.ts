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
import { asksForEnemies, scopeMatch, type GameScopeContract } from '../gameIntent';
import { gameGotWorse, gameMeasureFromIssues, gameUndoMessage, versionBeforeTurn } from '../gameRegression';
import { GAME_GEOMETRY_CODE, gameGeometryProbeEnabled, geometryFindings, geometryFindingsMessage } from '../gameGeometryProbe';
import { GAME_PLACEHOLDER_CODE, PLACEHOLDERS_CLEARED_MESSAGE, combinePlaceholderFindings, gamePlaceholderProbeEnabled, missingModelFindings, pagePlaceholderFindings, placeholderFindingsMessage, type PlaceholderFinding } from '../gamePlaceholderProbe';
import {
  PLACEHOLDER_REPAIR_TOKEN_CAP, placeholderRepairEligible, placeholderRepairEnabled, placeholderRepairMs, placeholderRepairRecord, runPlaceholderRepair,
  type PlaceholderMeasure, type PlaceholderRepairOutcome,
} from '../gamePlaceholderRepair';
import { gameBackupCleanupCommand, gameBackupCommand, gameRestoreCommand, parseGameBackup, parseGameRestore } from '../gameWorkspaceBackup';
import { reportGameFixOutcome, reportGameFixUnverified, type GameFixPorts } from './gameFixVerdict';
import { reportRuleProbes, reportFeaturesOff } from './gameRuleProbes';
import { gameFeatureEvidence, gameProof, gameProofIssue } from '../gameProof';
import type { KeepResult } from '../gameProofPictures';
import type { ProofShot } from '../gamePlaytest';

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
  /**
   * Named features the code only NAMES — no kit call the game reaches, no played action proved them (gameProof.ts). The
   * release gate says them as unproven (external Game Maker audit, 2026-11-25). Absent when none or not played.
   */
  featuresUnverified?: string[];
  /** What the placeholder look found on this play (gamePlaceholderProbe.ts); absent when it did not look. */
  placeholders?: PlaceholderFinding[];
}

export interface PlaytestIssue { phase: 'preview'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean; detail?: string }

export interface GamePlaytestPorts {
  facts: PlaytestFacts;
  /** The project as it stands after this turn's writes. */
  files: Record<string, string>;
  contract: GameScopeContract | null;
  /** This turn's request — an edit turn has no contract, but may still ask for enemies (BR2532). */
  request?: string;
  /** Runs the playtest script in the sandbox (the route wraps the timeout); its stdout is parsed. */
  play: () => Promise<{ stdout: string }>;
  readFile: (path: string) => Promise<string | null | undefined>;
  /** Every file in the workspace (binary models included), for the placeholder look's missing-model check. Optional. */
  listFiles?: () => Promise<string[]>;
  record: (issue: PlaytestIssue) => void;
  /** The issues of the report from before this turn (for "did this turn make the game worse?"). */
  previousIssues: () => Promise<Parameters<typeof gameMeasureFromIssues>[0]>;
  /** Saved versions of this project, to offer a way back to the one before this turn. */
  versions: () => Promise<Parameters<typeof versionBeforeTurn>[0]>;
  turnStartedAt: number;
  fix: GameFixPorts;
  /**
   * Q-3363: copies the pictures the playtest took into the private store for the admin report (gameProofPictures.ts).
   * Optional: absent, GAME_PROOF says the pictures stay in the sandbox, as before.
   */
  keepPictures?: (shots: ProofShot[]) => Promise<KeepResult | null>;
}

/** The workspace's file list, or [] when it fails or takes longer than `ms` (the timer is always cleared). */
async function listWithin(list: () => Promise<string[]>, ms: number): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([list(), new Promise<string[]>((r) => { timer = setTimeout(() => r([]), ms); })]);
  } catch { return []; } finally { if (timer) clearTimeout(timer); }
}

function playable(f: PlaytestFacts): boolean {
  return f.enabled && f.buildOk && f.hasPreviewUrl && f.hasRunCommand && !f.isImportTurn && !f.aborted && !f.awaitsShell
    && !f.platformDone && f.isCanvasGame && f.timeLeft;
}

/**
 * Play the game when it can be; otherwise say why. Never throws. `keep.ports` receives the ports the game was played with,
 * so a kept repair's replay plays it exactly the same way (replayGamePlaytest).
 */
export async function runGamePlaytestPhase(p: GamePlaytestPorts, keep?: { ports?: GamePlaytestPorts }): Promise<GamePlaytestResult | null> {
  try {
    if (keep) keep.ports = p;
    return playable(p.facts) ? await playIt(p) : notPlayed(p);
  } catch { return null; }
}

async function playIt(p: GamePlaytestPorts): Promise<GamePlaytestResult> {
  let out: GamePlaytestResult;
  try {
    const playStartedAt = Date.now();
    const playRun = parsePlaytest((await p.play()).stdout);
    reportRuleProbes(playRun.rules, p.fix); // the user's named rules, proved by playing (gameRuleProbes.ts)
    reportFeaturesOff(playRun.featuresOff, p.fix); // a feature the game switched off (it threw) — with its reason
    const ranMs = Date.now() - playStartedAt; // GAME_PROOF (d): the playtest's own wall time in the sandbox
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
      // 🧸 The placeholder look (gamePlaceholderProbe.ts): a stand-in where the real thing should be — a model that is not
      // there, a texture that failed, a frozen character, a player under water, a blank map, controls nobody can see. One
      // info line for the admin; the next game turn hands it to the builder to repair, and that turn's playtest looks again.
      if (gamePlaceholderProbeEnabled()) {
        // Bounded: a slow listing must never hold the build — after 5 s the file check says nothing.
        const present = p.listFiles ? await listWithin(p.listFiles, 5000) : [];
        const fromFiles = missingModelFindings(playedFiles, present);
        // Enemies are looked for only when the request asked for them (report #2519: asked for, built, never on screen) —
        // the contract, or this turn's own words when an edit turn has no contract (BR2532).
        const fromPage = pagePlaceholderFindings(playRun.placeholderStart, playRun.placeholderEnd, playRun.controlsOff, { enemies: !!p.contract?.requiredFeatures.includes('enemies') || asksForEnemies(p.request) });
        const placeholders = combinePlaceholderFindings(fromFiles, fromPage);
        out.placeholders = placeholders;
        const placeholderMsg = placeholderFindingsMessage(placeholders);
        if (placeholderMsg) p.record({ phase: 'preview', severity: 'info', code: GAME_PLACEHOLDER_CODE, message: placeholderMsg, autoResolved: true });
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
    // Scope match (gameIntent.ts) with the played half (gameProof.ts): a named feature is proven only by a kit call the game
    // reaches or a played action whose change was observed; one the code only names is said as NOT VERIFIED. Evidence only.
    try {
      const evidence = p.contract ? gameFeatureEvidence(p.contract, playedFiles, playRun) : null;
      const scope = p.contract ? gameScopeVerdict(p.contract, playedFiles, evidence) : null;
      if (scope) p.record({ phase: 'preview', severity: scope.severity, code: scope.code, message: scope.message, autoResolved: scope.autoResolved });
      if (evidence?.notVerified?.length) out.featuresUnverified = [...evidence.notVerified];
    } catch { /* observation only */ }
    recordProof(p, playRun, ranMs, undefined, await keptPictures(p, playRun));
  } catch (err) {
    // A playtest that timed out or crashed is a check that could not look — the same open warning the runner's own
    // "never played" answer gives, never an info line that reads as a pass.
    const notRun = playtestNotRunVerdict(`the playtest browser stopped: ${String((err as { message?: string })?.message ?? err).slice(0, 160)}`);
    try { p.record({ phase: 'preview', severity: notRun.severity, code: notRun.code, message: notRun.message, autoResolved: notRun.autoResolved }); } catch { /* best-effort */ }
    // 🔴 A playtest that could not finish is NOT a pass (autopsy 61279465: it timed out and the gate said GREEN).
    out = { proof: { outcome: 'not-run', score: null, unplayed: true }, gate: 'not-run' };
    recordProof(p, null, null, `the playtest browser stopped: ${String((err as { message?: string })?.message ?? err).slice(0, 120)}`);
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
      recordProof(p, null, null, why);
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
      recordProof(p, null, null, `this ${domKind} game is drawn in the page, and the canvas playtest does not play page games`);
    }
  } catch { /* observation only */ }
  return out;
}

/** Q-3363: the pictures a played run took, kept privately for the admin. null when none or no keeper. Never throws. */
async function keptPictures(p: GamePlaytestPorts, run: ReturnType<typeof parsePlaytest>): Promise<KeepResult | null> {
  if (!p.keepPictures || !run?.ok) return null;
  const shots = (run.proofShots ?? []).filter((s): s is ProofShot => !!s && !('error' in s) && typeof (s as ProofShot).id === 'string');
  if (shots.length === 0) return null;
  try { return await p.keepPictures(shots); } catch { return null; }
}

/**
 * 🎮 GAME_PROOF — the four proofs of every game build the playtest reached (gameProof.ts): the contract, what it looked
 * like, what was played, and how long and how fast it ran in the sandbox (never called a phone). A game that was not
 * played still gets the section, with every played proof said as not taken and why. Evidence only; never throws.
 */
function recordProof(p: GamePlaytestPorts, run: ReturnType<typeof parsePlaytest> | null, ranMs: number | null, notPlayedWhy?: string, kept?: KeepResult | null): void {
  try {
    const issue = gameProofIssue(gameProof({ contract: p.contract, run, ranMs, files: p.files, notPlayedWhy, kept }));
    p.record({ phase: 'preview', severity: issue.severity, code: issue.code, message: issue.message, autoResolved: issue.autoResolved, detail: issue.detail });
  } catch { /* observation only */ }
}

// ── THE REPLAY, AND THE ONE BOUNDED PLACEHOLDER REPAIR (Q-3374 + Q-3365) ─────────────────────────────────────────────────

/** The prefix of every line a KEPT repair's replay adds to the report, so the two plays are never confused. */
export const REPLAY_PREFIX = 'Replay after the kept placeholder repair: ';

/**
 * 🎮 PLAY THE GAME AGAIN — the same play, judge and proof as the first (playIt), on the files as they are now (Q-3365).
 * Its report lines are HELD, not recorded: they describe a game that may yet be put back. The caller flushes them only
 * when the change is kept, so a kept repair re-records GAME_PROOF and the unverified-feature list, and a discarded one
 * leaves no line about a game that no longer exists. Nothing is said to the user from a replay. Never throws.
 */
export async function replayGamePlaytest(p: GamePlaytestPorts, files: Record<string, string>): Promise<{ result: GamePlaytestResult; issues: PlaytestIssue[] }> {
  const issues: PlaytestIssue[] = [];
  const hold = (issue: PlaytestIssue): void => { issues.push(issue); };
  const result = await playIt({
    ...p,
    files,
    record: hold,
    fix: { ...p.fix, record: hold, say: () => { /* a replay never narrates */ } },
  });
  return { result, issues };
}

/** What a play measured, read from the phase's own result. PURE. */
export function playMeasure(r: GamePlaytestResult): PlaceholderMeasure {
  return {
    placeholders: r.placeholders ?? [],
    defects: (r.played?.defects ?? []).map((d) => d.code),
    score: typeof r.proof.score === 'number' ? r.proof.score : null,
    scopeMissing: r.played?.scopeMissing ?? [],
    played: r.proof.outcome !== 'not-run',
  };
}

export interface GamePlaceholderRepairPorts {
  /** The first play of this turn — its ports and what it found — or null when the game was not played. */
  first: { ports: GamePlaytestPorts; result: GamePlaytestResult } | null;
  /** The route's facts that allow a repair now (not stopped, a preview, a command runner). */
  canRun: boolean;
  headroomMs: number;
  userPrompt: string;
  buildSignal: AbortSignal;
  /** The project as it stands now (turn-start files plus this turn's captured writes). */
  filesNow: () => Record<string, string>;
  /** The build's captured writes (the route's `writtenFiles`): read for what the repair wrote, put back when undone. */
  captured: Map<string, string>;
  /** May the platform pay for this repair on this build (the free tier's daily allowance)? */
  allowed: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Run a shell command in the project (the backup and the restore). */
  runCommand: (command: string) => Promise<{ stdout?: string }>;
  /** Run the one pass (file tools only, platform-paid, inside this repair's billing phase). Resolves true when finished. */
  repair: (prompt: string, ctl: { signal: AbortSignal; onTokens: (tokens: number) => void }) => Promise<boolean>;
  /** Save files to the project's durable store / forget paths there (after a keep or an undo). */
  persist: (files: Record<string, string>) => Promise<unknown>;
  forget: (paths: string[]) => Promise<unknown>;
  resolveOnRecheck: (code: string) => void;
  record: (issue: PlaytestIssue) => void;
  /** A unique id for this build's backup. */
  backupId: string;
}

/**
 * 🧸🔧 ONE BOUNDED IN-BUILD REPAIR when the placeholder look found ONLY a missing model and/or an empty map
 * (gamePlaceholderRepair.ts). Returns the REPLAY's result when the repair was kept — the route applies it exactly as it
 * applies the first play (proof, gate, unverified features, measured defects) — and null otherwise. Every outcome is
 * one GAME_PLACEHOLDER_REPAIR line in the report. Never throws.
 */
export async function runGamePlaceholderRepairPhase(r: GamePlaceholderRepairPorts): Promise<GamePlaytestResult | null> {
  try {
    const first = r.first;
    const findings = first?.result.placeholders ?? [];
    if (!first || findings.length === 0) return null; // nothing was found ⇒ nothing to say
    const say = (o: PlaceholderRepairOutcome<unknown>): void => { try { r.record({ phase: 'preview', ...placeholderRepairRecord(o) }); } catch { /* best-effort */ } };
    const skip = (reason: string): null => {
      say({ attempted: false, kept: false, state: 'skipped', reason, kinds: [...new Set(findings.map((f) => f.kind))], before: findings.length, after: null, touched: [], timedOut: false, tokenCapped: false, repairMs: 0 });
      return null;
    };
    if (!placeholderRepairEnabled()) return skip('switched off (AGENTV3_GAME_PLACEHOLDER_REPAIR=off)');
    if (!placeholderRepairEligible(findings)) return skip('the look found more than a missing model and/or an empty map, and only those two are repaired in the build');
    if (!r.canRun || first.result.proof.outcome === 'not-run') return skip('the game could not be played again in this build');
    const repairMs = placeholderRepairMs(r.headroomMs);
    if (repairMs <= 0) return skip('not enough build time left for a repair, its replay and a way back');
    const allowed = await r.allowed().catch(() => ({ ok: false as const, reason: 'the repair allowance could not be read' }));
    if (!allowed.ok) return skip(allowed.reason);

    const before = new Map(r.captured);
    let digest = '';
    let tokens = 0;
    let capped = false;
    let held: PlaytestIssue[] = [];
    const outcome = await runPlaceholderRepair<GamePlaytestResult>({
      findings, before: playMeasure(first.result), userPrompt: r.userPrompt, repairMs, buildSignal: r.buildSignal, tokenCapped: () => capped,
    }, {
      backup: async () => {
        const b = parseGameBackup((await r.runCommand(gameBackupCommand(r.backupId))).stdout);
        if (b.ok) digest = b.digest;
        return b;
      },
      repair: (prompt, ctl) => r.repair(prompt, {
        signal: ctl.signal,
        onTokens: (n) => {
          tokens += Number.isFinite(n) && n > 0 ? n : 0;
          if (!capped && tokens >= PLACEHOLDER_REPAIR_TOKEN_CAP) { capped = true; ctl.stop(); }
        },
      }),
      touched: () => [...new Set([...r.captured.keys(), ...before.keys()])].filter((p) => r.captured.get(p) !== before.get(p)),
      replay: async () => {
        const again = await replayGamePlaytest(first.ports, r.filesNow());
        held = again.issues;
        return { measure: playMeasure(again.result), result: again.result };
      },
      restore: async () => {
        // Checked against the BACKUP's own fingerprint, never against a value the restore reports about itself.
        const restored = parseGameRestore((await r.runCommand(gameRestoreCommand(r.backupId))).stdout, digest);
        if (restored.ok) await putCapturedBack(r, first.ports, before);
        return restored;
      },
      cleanup: async () => { await r.runCommand(gameBackupCleanupCommand(r.backupId)); },
    });
    say(outcome);
    if (!outcome.kept || !outcome.result) return null;
    for (const issue of held) {
      try { r.record(issue.code === GAME_PLACEHOLDER_CODE ? issue : { ...issue, message: `${REPLAY_PREFIX}${issue.message}` }); } catch { /* best-effort */ }
    }
    // None left: said as the LAST placeholder line, so the next turn's builder is not sent after stand-ins that are gone.
    if (!outcome.result.placeholders?.length) {
      try { r.record({ phase: 'preview', severity: 'info', code: GAME_PLACEHOLDER_CODE, message: PLACEHOLDERS_CLEARED_MESSAGE, autoResolved: true }); } catch { /* best-effort */ }
    }
    if (outcome.result.proof.outcome === 'passed') { try { r.resolveOnRecheck('GAME_PLAYTEST_ISSUES'); } catch { /* best-effort */ } }
    try { await r.persist(Object.fromEntries(r.captured)); } catch { /* the end-of-build save carries them too */ }
    return outcome.result;
  } catch { return null; }
}

/**
 * After a VERIFIED restore: the build's captured writes are exactly what they were before the repair (so the end-of-build
 * save cannot re-persist what was put back), and the durable store gets each file the repair wrote back as the restored
 * sandbox holds it, or forgets one the repair created.
 */
async function putCapturedBack(r: GamePlaceholderRepairPorts, play: GamePlaytestPorts, before: ReadonlyMap<string, string>): Promise<void> {
  const touched = [...new Set([...r.captured.keys(), ...before.keys()])].filter((p) => r.captured.get(p) !== before.get(p));
  r.captured.clear();
  for (const [path, text] of before) r.captured.set(path, text);
  const put: Record<string, string> = {};
  const gone: string[] = [];
  for (const path of touched) {
    let text: string | null | undefined;
    try { text = await play.readFile(path); } catch { text = null; }
    if (typeof text === 'string') put[path] = text;
    else gone.push(path);
  }
  if (Object.keys(put).length) await r.persist(put).catch(() => undefined);
  if (gone.length) await r.forget(gone).catch(() => undefined);
}
