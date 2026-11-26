// GAME MAKER — PHASE 1: THE GAME DESIGN DOCUMENT.
//
// The scope contract (gameIntent.ts) already records the genre, the view and the features the user
// NAMED. This document does not replace that contract and does not choose a different genre.
// It adds the three things the contract deliberately left out:
//   • a genre recipe (the systems a racing game, a chess game, a ludo game must actually run);
//   • an explicit declined / required / not-requested state, so a refusal is never built;
//   • an engine and a physics profile that follow the kit (2D stays on the 2D kit; cannon-es is 3D only).
//
// Nothing here writes a file, calls a model, or declares a game complete. Completion still requires
// a real playtest. A document is evidence of what was asked, not evidence that it was built. PURE.

import { withoutDeclinedSentences } from '../lib/RequirementGapAnalyzer';
import { wantsSceneObjects } from '../lib/heroObjectSpec';
import { physicsProfileSpec, physicsRuntimeFor } from './physicsProfiles';
import { GENRE_KITS, genreKitsFor } from '../lib/GameGenreKitsGenerator';
import {
  asksForBattleRoyale,
  asksForEnterableHouses,
  buildGameContract,
  codeMentionsFeature,
  declinedGameFeatures,
  scopeMatch,
  type GameCamera,
  type GameFeature,
  type GameGenre,
  type GameScopeContract,
} from './gameIntent';

export type RequirementState = 'required' | 'optional' | 'not-requested' | 'declined';
export type EngineKind = 'canvas-2d' | 'three-3d' | 'board' | 'dom';
export type PhysicsProfile =
  | 'platformer' | 'racing' | 'shooter' | 'fighting' | 'sports' | 'simulation' | 'open-world' | 'none';
/** 2D games never take cannon-es. Board and quiz games use their rules module, not a physics world. */
export type PhysicsRuntime = '2d-kit' | 'cannon-es' | 'rules' | 'none';
export type PlaytestAdapter =
  | 'canvas-2d' | 'three-3d' | 'dom' | 'board' | 'puzzle' | 'racing' | 'shooter' | 'fighting';

export interface NamedRequirement {
  id: string;
  state: RequirementState;
}

export interface GenreSystem {
  id: string;
  /** Declined when the request refuses that system by name. Otherwise required by the genre. */
  state: 'required' | 'declined';
}

export interface GameDesignDocument {
  scope: GameScopeContract;
  engine: EngineKind;
  physicsProfile: PhysicsProfile;
  physicsRuntime: PhysicsRuntime;
  camera: GameCamera;
  /** Which playtester is allowed to speak for this game. A button click is not a substitute. */
  playtestAdapter: PlaytestAdapter;
  /** Existing rules module the builder must call. Null when the genre has no dedicated module. */
  rulesModule: string | null;
  /** Genre kits whose rules the builder must call (GameGenreKitsGenerator.ts): fighting.ts, towerDefense.ts. */
  genreKits?: readonly string[];
  genreSystems: readonly GenreSystem[];
  /** On-screen controls for a phone. Required unless the request refuses touch. */
  mobileControls: readonly string[];
  mobileControlsState: 'required' | 'declined';
  requirements: readonly NamedRequirement[];
  /** Server multiplayer was asked for. Local turn-taking is not this. */
  multiplayerRequested: boolean;
  multiplayerLimitation: string | null;
}

export interface DesignCoverage {
  namedMissing: GameFeature[];
  /** A declined feature the code still implements. */
  forbiddenPresent: GameFeature[];
  systems: ReadonlyArray<{ id: string; status: 'present' | 'missing' | 'declined' }>;
  /** True only when a playtest passed AND nothing named is missing AND no declined feature was built. */
  canDeclareComplete: boolean;
  reason: string;
}

const EXTRA: ReadonlyArray<[string, RegExp]> = [
  ['weapons', /\b(weapons?|guns?|swords?)\b/i],
  ['collectibles', /\b(coins?|collectibles?|pickups?|diamonds?)\b/i],
  ['missions', /\b(missions?|quests?)\b/i],
  ['save-load', /\b(save(?:\s*\/\s*|\s+)load|save game|load game)\b/i],
  ['economy', /\b(shop|economy|currency)\b/i],
];

const ONLINE_WORDS = /\b(multi-?player|online play|pvp|co-?op)\b/i;

const SYSTEM_SIGNAL: Readonly<Record<string, RegExp>> = {
  steering: /\b(steer\w*|driveVehicle)\b/i,
  acceleration: /\b(throttl\w*|accelerat\w*|gasPedal|\bgas\b)/i,
  braking: /\bbrak\w*/i,
  track: /\b(track|circuit|road)\b/i,
  'lap-or-finish': /\b(lap|finish)/i,
  aim: /\b(aim|crosshair)\b/i,
  fire: /\b(fire|shoot)\b/i,
  reload: /\breload/i,
  projectile: /\b(projectile|bullet)\b/i,
  'hit-detection': /\b(hit|raycast)\b/i,
  loot: /\bloot\b/i,
  'shrinking-zone': /\b(zone|circle)\b/i,
  survival: /\b(alive|surviv)/i,
  'enemy-ai': /\b(enemy|bot)\b/i,
  'combos-or-attacks': /\b(combo|attack|punch|strike)\b/i,
  block: /\bblock/i,
  health: /\b(health|\bhp\b)/i,
  knockback: /\b(knockback|knockBack|impulse)\b/i,
  jump: /\bjump/i,
  gravity: /\bgravity\b/i,
  landing: /\b(land|grounded|onGround)\b/i,
  'player-movement': /\b(velocity|move)\b/i,
  'forward-motion': /\b(speed|forward)\b/i,
  'obstacle-collision': /\b(obstacle|collid)/i,
  'game-over': /\b(gameOver|game over)\b/i,
  'grid-movement': /\b(grid|cell)\b/i,
  growth: /\b(grow|length)\b/i,
  'self-collision': /\b(self|hitSelf|crash)\b/i,
  food: /\b(food|apple)\b/i,
  'legal-moves': /\b(legalMoves|chessMoves|movesFrom)\b/,
  'illegal-move-rejection': /\billegal\b/i,
  check: /\binCheck\b/,
  checkmate: /\b(checkmate|chessStatus)\b/i,
  draw: /\b(stalemate|draw)\b/i,
  dice: /\b(dice|roll)\b/i,
  'turn-sequence': /\b(turn|currentPlayer)\b/i,
  'token-movement': /\b(token|piece)\b/i,
  'safe-cells': /\b(safe|STAR_SQUARES)\b/,
  'winning-condition': /\b(win|winner)\b/i,
  'ball-physics': /\b(ball)\b/i,
  goals: /\bgoal/i,
  players: /\bplayer/i,
  'match-rules': /\b(match|score)\b/i,
  'valid-moves': /\b(valid|swapTiles|legal)\b/i,
  'win-condition': /\b(solved|win|status)\b/i,
  navigation: /\b(nav|waypoint)\b/i,
  vehicles: /\b(vehicle|driveVehicle)\b/i,
  interaction: /\b(interact|use)\b/i,
  'state-progression': /\b(progress|state)\b/i,
};

function mentionedOnlyAsDeclined(raw: string, re: RegExp): boolean {
  return re.test(raw) && !re.test(withoutDeclinedSentences(raw));
}

function engineFor(prompt: string, scope: GameScopeContract, drawnIn3D: boolean | undefined): EngineKind {
  if (scope.genre === 'board' || scope.genre === 'card') return 'board';
  if (scope.genre === 'quiz') return 'dom';
  if (!wantsSceneObjects(prompt)) return 'canvas-2d';
  if (drawnIn3D || scope.dimension === '3d') return 'three-3d';
  return 'canvas-2d';
}

function physicsFor(prompt: string, scope: GameScopeContract, engine: EngineKind): { profile: PhysicsProfile; runtime: PhysicsRuntime } {
  if (engine === 'board' || engine === 'dom' || scope.genre === 'puzzle' || scope.genre === 'quiz' || scope.genre === 'card' || scope.genre === 'snake') {
    return { profile: 'none', runtime: engine === 'board' || engine === 'dom' ? 'rules' : 'none' };
  }
  let profile: PhysicsProfile = 'none';
  if (scope.genre === 'platformer') profile = 'platformer';
  else if (scope.genre === 'racing') profile = 'racing';
  else if (scope.genre === 'shooter') profile = 'shooter';
  else if (scope.genre === 'fighting') profile = 'fighting';
  else if (scope.genre === 'sports') profile = 'sports';
  else if (scope.genre === 'simulator') profile = 'simulation';
  else if (scope.genre === 'rpg' || asksForEnterableHouses(prompt)) profile = 'open-world';
  if (profile === 'none') return { profile, runtime: 'none' };
  // A 2D game keeps the tested 2D movement. cannon-es is the 3D kit only — and that decision lives in
  // ONE place (`physicsRuntimeFor`), beside the numbers, so the two can never drift apart.
  return { profile, runtime: physicsRuntimeFor(profile, engine) };
}

function rulesModuleFor(prompt: string, genre: GameGenre): string | null {
  const t = prompt;
  if (/\bchess\b/i.test(t)) return 'src/game/board/chess.ts';
  if (/\bludo\b/i.test(t)) return 'src/game/board/ludo.ts';
  if (/\bcarrom\b/i.test(t)) return 'src/game/board/carrom.ts';
  if (/\b(snakes?\s+and\s+ladders?)\b/i.test(t)) return 'src/game/board/snakes.ts';
  if (/\b(football|soccer)\b/i.test(t)) return 'src/game/board/football.ts';
  if (/\bcricket\b/i.test(t)) return 'src/game/board/cricket.ts';
  if (genre === 'card' || /\b(teen\s?patti|rummy)\b/i.test(t)) return 'src/game/board/cards.ts';
  if (/\bmatch[- ]?3\b|\bcandy\s*crush\b/i.test(t)) return 'src/game/board/match3.ts';
  if (/\b(business|vyapaar|monopoly)\b/i.test(t)) return 'src/game/board/business.ts';
  return null;
}

function baseSystems(prompt: string, genre: GameGenre): string[] {
  const t = prompt;
  if (/\bchess\b/i.test(t)) return ['legal-moves', 'illegal-move-rejection', 'check', 'checkmate', 'draw'];
  if (/\bludo\b/i.test(t)) return ['dice', 'turn-sequence', 'token-movement', 'safe-cells', 'winning-condition'];
  if (/\b(football|soccer)\b/i.test(t)) return ['ball-physics', 'goals', 'players', 'match-rules'];
  const byGenre: Partial<Record<GameGenre, string[]>> = {
    racing: ['steering', 'acceleration', 'braking', 'track', 'lap-or-finish'],
    shooter: ['aim', 'fire', 'reload', 'projectile', 'hit-detection'],
    fighting: ['combos-or-attacks', 'block', 'health', 'knockback'],
    platformer: ['jump', 'gravity', 'landing', 'player-movement'],
    runner: ['forward-motion', 'obstacle-collision', 'game-over'],
    snake: ['grid-movement', 'growth', 'self-collision', 'food'],
    puzzle: ['valid-moves', 'win-condition'],
    sports: ['ball-physics', 'players', 'match-rules'],
    simulator: ['acceleration', 'braking', 'state-progression'],
    arcade: ['game-over'],
  };
  const systems = [...(byGenre[genre] ?? [])];
  if (asksForBattleRoyale(t)) systems.push('loot', 'shrinking-zone', 'survival', 'enemy-ai');
  if (asksForEnterableHouses(t)) systems.push('navigation', 'interaction');
  return systems;
}

const SYSTEM_WORD: Readonly<Record<string, RegExp>> = {
  braking: /\bbrak(e|es|ing)\b/i,
  reload: /\breload/i,
  block: /\bblock(?:ing)?\b/i,
  jump: /\bjump(?:ing)?\b/i,
  steering: /\bsteer(?:ing)?\b/i,
  acceleration: /\b(accelerat\w*|throttle)\b/i,
};

function genreSystemsFor(prompt: string, genre: GameGenre): GenreSystem[] {
  const seen = new Set<string>();
  const out: GenreSystem[] = [];
  for (const id of baseSystems(prompt, genre)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const word = SYSTEM_WORD[id];
    const declined = word ? mentionedOnlyAsDeclined(prompt, word) : false;
    out.push({ id, state: declined ? 'declined' : 'required' });
  }
  return out;
}

function adapterFor(engine: EngineKind, genre: GameGenre, prompt: string): PlaytestAdapter {
  if (genre === 'puzzle') return 'puzzle';
  if (engine === 'board') return 'board';
  if (engine === 'dom') return 'dom';
  if (genre === 'racing') return 'racing';
  if (genre === 'shooter' || asksForBattleRoyale(prompt)) return 'shooter';
  if (genre === 'fighting') return 'fighting';
  return engine === 'three-3d' ? 'three-3d' : 'canvas-2d';
}

const MOBILE: Partial<Record<GameGenre, readonly string[]>> = {
  racing: ['steering', 'accelerator', 'brake'],
  shooter: ['joystick', 'aim', 'fire', 'reload'],
  fighting: ['direction', 'attack', 'block'],
  platformer: ['direction', 'jump'],
  runner: ['lane-change', 'jump', 'slide'],
  sports: ['direction', 'action'],
  simulator: ['accelerator', 'brake'],
  snake: ['direction'],
  arcade: ['action'],
};

function requirementStates(prompt: string, scope: GameScopeContract): NamedRequirement[] {
  const declined = new Set(declinedGameFeatures(prompt));
  const required = new Set(scope.requiredFeatures);
  const features: NamedRequirement[] = (Object.keys({
    score: 1, levels: 1, lives: 1, timer: 1, enemies: 1, powerups: 1, leaderboard: 1,
    multiplayer: 1, sound: 1, restart: 1, pause: 1, health: 1, throttle: 1, braking: 1,
  }) as GameFeature[]).map((id) => ({
    id,
    state: declined.has(id) ? 'declined' : required.has(id) ? 'required' : 'not-requested',
  }));
  const kept = withoutDeclinedSentences(prompt);
  for (const [id, re] of EXTRA) {
    const state: RequirementState = re.test(prompt) && !re.test(kept) ? 'declined' : re.test(kept) ? 'required' : 'not-requested';
    features.push({ id, state });
  }
  return features;
}

function refusesTouch(prompt: string): boolean {
  return mentionedOnlyAsDeclined(prompt, /\b(touch|mobile|phone|joystick)\b/i)
    || /\b(desktop only|keyboard only|no touch)\b/i.test(prompt);
}

export function analyzeGameRequirements(
  prompt: string | null | undefined,
  opts: { drawnIn3D?: boolean } = {},
): GameDesignDocument {
  const text = String(prompt ?? '');
  const scope = buildGameContract(text);
  const rulesModule = rulesModuleFor(text, scope.genre);
  const engine: EngineKind = rulesModule ? 'board' : engineFor(text, scope, opts.drawnIn3D);
  const physics = rulesModule
    ? { profile: (scope.genre === 'sports' ? 'sports' : 'none') as PhysicsProfile, runtime: 'rules' as const }
    : physicsFor(text, scope, engine);
  const genreSystems = genreSystemsFor(text, scope.genre);
  const dropped = new Set(genreSystems.filter((s) => s.state === 'declined').map((s) => s.id));
  const mobileWord: Record<string, string> = { brake: 'braking', accelerator: 'acceleration', jump: 'jump', block: 'block', reload: 'reload' };
  const mobileControls = (MOBILE[scope.genre] ?? ['action', 'pause']).filter((name) => !dropped.has(mobileWord[name] ?? name));
  const online = ONLINE_WORDS.test(withoutDeclinedSentences(text));
  const declinedOnline = mentionedOnlyAsDeclined(text, ONLINE_WORDS);
  return {
    scope,
    engine,
    physicsProfile: physics.profile,
    physicsRuntime: physics.runtime,
    camera: scope.camera ?? 'unspecified',
    playtestAdapter: adapterFor(engine, scope.genre, text),
    rulesModule,
    genreKits: genreKitsFor(text, scope.genre).map((k) => GENRE_KITS[k].path),
    genreSystems,
    mobileControls,
    mobileControlsState: refusesTouch(text) ? 'declined' : 'required',
    requirements: requirementStates(text, scope),
    multiplayerRequested: online && !declinedOnline,
    multiplayerLimitation: online && !declinedOnline
      ? 'Online multiplayer needs a server-authoritative session. Local extra players are not multiplayer, and this document does not claim one exists.'
      : null,
  };
}

/** Lines added after the scope contract. Empty when the request names no game. PURE. */
/** The profile's measured numbers, for a game that actually gets a physics world. PURE. */
function physicsNumbersLine(doc: GameDesignDocument): string {
  if (doc.physicsRuntime !== '2d-kit' && doc.physicsRuntime !== 'cannon-es') return '';
  const spec = physicsProfileSpec(doc.physicsProfile);
  return `Physics numbers (use these, do not invent them): gravity ${spec.gravity} m/s², friction ${spec.friction}, `
    + `restitution ${spec.restitution}, fixed step ${spec.fixedDt.toFixed(5)} s.`;
}

export function gameDesignBlock(doc: GameDesignDocument): string {
  const s = doc.scope;
  const named = s.genre !== 'unknown' || s.requiredFeatures.length > 0 || !!s.vehicle || !!s.reference || doc.genreSystems.length > 0 || doc.rulesModule;
  if (!named) return '';
  const requiredSystems = doc.genreSystems.filter((g) => g.state === 'required').map((g) => g.id);
  const declinedSystems = doc.genreSystems.filter((g) => g.state === 'declined').map((g) => g.id);
  const declinedFeatures = doc.requirements.filter((r) => r.state === 'declined').map((r) => r.id);
  const refused = [...new Set([...declinedSystems, ...declinedFeatures])];
  const lines = [
    '[GAME DESIGN — genre recipe on top of the scope contract. A compile is not a pass.]',
    `Engine: ${doc.engine}. Physics profile: ${doc.physicsProfile} via ${doc.physicsRuntime}. `
      + (doc.physicsRuntime === '2d-kit' ? 'Do not put cannon-es on this 2D game.' : doc.physicsRuntime === 'cannon-es' ? 'Use the kit cannon-es world. Do not add a second physics engine.' : 'Do not invent a physics world for this rules game.'),
    // A profile NAME leaves the builder to invent gravity, and an invented gravity is the moon-jump
    // and the sliding car. The measured numbers go in the handoff so there is nothing left to guess.
    physicsNumbersLine(doc),
    doc.rulesModule ? `Rules already exist in ${doc.rulesModule} — call that module. Do not reimplement them.` : '',
    ...(doc.genreKits ?? []).map((path) => `The genre's rules already exist in ${path} — call that module. Do not reimplement them.`),
    requiredSystems.length ? `Genre systems that must really work: ${requiredSystems.join(', ')}.` : '',
    declinedSystems.length || declinedFeatures.length
      ? `Declined — do not build: ${refused.join(', ')}.`
      : '',
    `Playtest adapter: ${doc.playtestAdapter}. Do not call the game complete from a button click or a green build.`,
    doc.mobileControlsState === 'required'
      ? `Phone controls required: ${doc.mobileControls.join(', ')}.`
      : 'The request refuses touch controls.',
    doc.multiplayerLimitation ?? '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Evidence check. Never treats an unrun playtest as a pass. PURE. */
export function designCoverage(
  doc: GameDesignDocument,
  files: Record<string, string>,
  evidence: { playtestPassed?: boolean; multiplayerVerified?: boolean } = {},
): DesignCoverage {
  const match = scopeMatch(doc.scope, files);
  const declined = new Set(doc.requirements.filter((r) => r.state === 'declined').map((r) => r.id));
  const namedMissing = match.missing.filter((f) => !declined.has(f));
  const forbiddenPresent = [...declined].filter((id): id is GameFeature => (
    id === 'score' || id === 'levels' || id === 'lives' || id === 'timer' || id === 'enemies' || id === 'powerups'
    || id === 'leaderboard' || id === 'multiplayer' || id === 'sound' || id === 'restart' || id === 'pause'
    || id === 'health' || id === 'throttle' || id === 'braking'
  ) && codeMentionsFeature(id, files));
  const code = Object.values(files || {}).filter((v) => typeof v === 'string').join('\n');
  const systems = doc.genreSystems.map((g) => {
    if (g.state === 'declined') return { id: g.id, status: 'declined' as const };
    const re = SYSTEM_SIGNAL[g.id];
    if (!re) return { id: g.id, status: 'missing' as const };
    return { id: g.id, status: re.test(code) ? 'present' as const : 'missing' as const };
  });
  const systemsMissing = systems.filter((s) => s.status === 'missing');
  const reasons: string[] = [];
  if (evidence.playtestPassed !== true) reasons.push('playtest not verified');
  if (namedMissing.length) reasons.push(`named features missing: ${namedMissing.join(', ')}`);
  if (systemsMissing.length) reasons.push(`genre systems missing: ${systemsMissing.map((s) => s.id).join(', ')}`);
  if (forbiddenPresent.length) reasons.push(`declined features present: ${forbiddenPresent.join(', ')}`);
  if (doc.multiplayerRequested && evidence.multiplayerVerified !== true) reasons.push('multiplayer not verified');
  return {
    namedMissing,
    forbiddenPresent,
    systems,
    canDeclareComplete: reasons.length === 0,
    reason: reasons.length ? reasons.join('; ') : 'playtest passed and the named requirements are present',
  };
}
