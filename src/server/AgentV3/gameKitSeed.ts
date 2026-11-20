// THE GAME KIT IS LAID DOWN BY THE PLATFORM, NOT LEFT TO THE MODEL'S CHOICE.
//
// 🔴 ADMIN REPORT 2026-10-11, build 46e2d74b ("Create an racing game for Nokia c 2-01", Weak tier). Admin,
// verbatim: *"ek bahut dangerous issue … racing game me car ulti chal rahi hai"* — the player's car showed
// its HEADLIGHTS to the player, and pressing LEFT turned it RIGHT, "on every game built now".
//
// Both symptoms were one defect: the camera sat on the side the car's nose points to, and seen face-on the
// driver's left is the screen's right. The kit already had the correct path — `CameraRig.follow`,
// `ctx.follow`, `driveVehicle`, fixed 2026-10-05 — and this build never touched it: the full builder never
// called run_recipe and hand-wrote its own engine under src/lib/game/ (meta.ts, objects.ts, controls.ts,
// scene.ts…). Every protection that lives in the kit — the camera behind the vehicle, the steering signs,
// the non-zero starting speed, the fixed-timestep loop, the best score — is invisible to a game that
// bypasses it.
//
// 🔑 THE CLASS: a capability the platform ALREADY KNOWS a build needs was left to the weakest component's
// optional tool call. The route classified the request as a game (`analyzeRequirementGaps` → 'game') and
// used that fact for exactly one thing — skipping the fast lane, on the premise that "the full builder
// runs the game recipes" (FAST_LANE_SKIPPED_GAME). Nothing ever made that premise true, and nothing
// checked it afterwards. Whether a game got the kit depended on which model answered and how it read a
// 93,000-character prompt.
//
// 🧬 THE FIX: the platform runs the recipes itself, deterministically, before the first model call — the
// same way the golden scaffold is pre-seeded (routes/agentv3.ts) — and then tells the builder the kit is
// on disk and to build only the game on it. The model's choice is no longer on the path.
//
//   • WHICH RECIPES (`gameKitPlan`, PURE). Every game gets the runtime (loop, input, events, meta), the
//     effects layer and the melody layer. The 3D layer and the playable shell are added ONLY when the
//     request itself says the game is drawn in 3D (`gameKitWants3D`): it says "3D", or it is a racing,
//     driving, vehicle, open-world or village game. A board, card, puzzle or quiz game (the route's flat
//     list, `wantsSceneObjects`) never gets three.js (candy autopsy 7da1cdca: a match-3 got 24 unused 3D
//     files and `three` installed), and neither does a game the request leaves open — "rock paper
//     scissors", "flappy bird", "hangman" — whose builder adds the 3D recipes itself only if it needs them.
//     A game without the 3D layer gets the SOUND half of the effects layer only (`gameKitRecipeInput`):
//     the particle system is three.js, so the whole layer would install `three` into a 2D game.
//     ⚠️ CORRECTED 2026-10-11, in verification of this change: this note first said the three non-3D recipes "add no
//     dependency" (the effects layer adds `three` and `@types/three`), and the plan first took 3D from
//     `wantsSceneObjects` alone, which calls EVERY game that is not on the flat list a scene — so a
//     guess-the-number or rock-paper-scissors game was laid down with three.js and the 3D shell and told
//     "This is a 3D game". The flat list still always wins; 3D now needs a positive word.
//   • WHERE. Only for the stack the recipes are written and measured for: the React + Vite project.
//     A plain HTML site has no compiler to run them (autopsy f496c75b) and the shell is a React component,
//     so every other framework gets [] and keeps today's behaviour — the builder runs the recipes itself.
//   • HOW. The route runs each recipe through `ToolDispatcher.dispatch({ name: 'run_recipe' })`, so file
//     writing (never over an existing file), the missing-layer adder and the dependency install are
//     byte-for-byte what a model's own call does. Nothing here writes a file.
//   • WHEN NOT. Never on an edit, an import, a project-mode module, a pasted page, a golden-scaffold build,
//     or a workspace holding anything but our untouched starter — a user's files are never written over.
//     Kill switch: AGENTV3_GAME_KIT_SEED=off.
//
// PURE — no I/O. The route supplies the outcomes; this module plans the run and words the handoff.

import { ENDLESS_RACE_COURSE_RULE } from './endlessRaceCourse';
import { hardConstraintLines } from '../lib/megaRoadmap';
import { asksForBattleRoyale, buildGameContract, gameContractBlock, gameScopeContractEnabled, namedGameReference, type GameScopeContract } from './gameIntent';
import { largeWorldIntent } from './largeWorldIntent';
import { GAME_SHELL_MODULES } from '../lib/GameShellGenerator';
import { GAME_STARTERS } from '../lib/gameStarters';
import { athreeMapIntent } from '../lib/athreeMap/athreeMapIntent';
import { athreeMapEnabled } from '../lib/athreeMap/athreeMapLibrary';
import { kitTypeContract, KIT_CONTRACT_FILES } from '../lib/kitTypeContract';
import { namedNonSmartphone } from './deviceTarget';
import { analyzeRequirementGaps } from '../lib/RequirementGapAnalyzer';
import { gameLanguageForRequest, gameLanguageHandoff } from './gameLanguage';
import { wantsSceneObjects, heroObjectContract } from '../lib/heroObjectSpec';
import { world2dIntent } from './world2dIntent';
import { ACTION_VISIBLE_RULE } from './actionVisibility';

/** The recipes the seed may run, in the order the architect prompt lists them (runtime first, shell last). */
export type GameKitRecipe = 'generate_game_runtime' | 'generate_game_3d' | 'generate_game_vfx' | 'generate_melody' | 'generate_game_shell' | 'generate_world_2d'
  | 'generate_game_2d' | 'generate_board_games' | 'generate_athree_map';

/** 2D games that MOVE a body on screen — they get the 2D kit (sprites, platformer physics, camera, tilemap, particles). */
const MOVING_2D_GENRES: ReadonlySet<string> = new Set(['platformer', 'runner', 'shooter', 'arcade', 'fighting']);
/** Cricket is in the India games pack's rules engines, in English or Hindi. */
/** A match-3 request in its usual words (it reads as genre 'puzzle'). */
const MATCH3 = /\bmatch[-\s]?(?:3|three)\b|\bcandy\s*crush\b|\bbejewell?ed\b|\b(?:gems?|jewels?|candies|candy|tiles?)\b[^.!?\n]{0,40}\bmatch(?:ing)?\b|\bmatch(?:ing)?\b[^.!?\n]{0,40}\b(?:gems?|jewels?|candies|candy|tiles?)\b/i;
const CRICKET = /\bcricket\b|क्रिकेट/i;

/** `AGENTV3_GAME_KIT_SEED=off` restores the pre-2026-10-11 behaviour exactly (the model decides). */
export function gameKitSeedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_KIT_SEED ?? '').trim().toLowerCase() !== 'off';
}

/**
 * The stacks the kit is written for. `undefined` is the default scaffold (vite-react), exactly as
 * `frameworkScaffoldHint` reads it. Everything else — the static site, Vue, Svelte, Next and the
 * server-only templates — keeps the builder-driven path, because a recipe whose output does not compile
 * there is a broken app laid down by us.
 */
const KIT_FRAMEWORKS: ReadonlySet<string> = new Set(['vite-react']);

export function gameKitFrameworkSupported(framework: string | null | undefined): boolean {
  return KIT_FRAMEWORKS.has(String(framework ?? 'vite-react').trim() || 'vite-react');
}

/**
 * Which recipes the platform runs for this request, in order. [] when it is not a game, when the stack
 * cannot run the kit, or when nothing should be seeded. PURE.
 *
 * The domain is read here as well as at the route's gate, from the same classifier, so the plan can never
 * seed a to-do app even if a caller forgets the gate.
 */
export function gameKitPlan(prompt: string | null | undefined, framework?: string | null): GameKitRecipe[] {
  const text = String(prompt ?? '');
  if (!text.trim() || !gameKitFrameworkSupported(framework)) return [];
  let domain = '';
  try { domain = analyzeRequirementGaps(text).domain; } catch { return []; }
  if (domain !== 'game') return [];
  if (gameKitWants3D(text)) {
    // 🗺️ THE BIG MAP IS LAID DOWN BY THE PLATFORM TOO (failedbr #2478, 2026-11-20 — admin: "pubg/free fire/bgmi game … ek
    // bahut bada map bane … library me already maps hai, par use nahi kiye gaye"). The Athree map was only a line in the
    // system prompt ("run_recipe generate_athree_map"), so a weak builder never ran it and drew a 30×30 grid with five cubes;
    // a 2D game's big world was already seeded (generate_world_2d). The same reader the recipe itself uses decides, so the
    // seed can never lay a map under a game the recipe would refuse; it runs right after the 3D layer that installs three.js.
    const map: GameKitRecipe[] = athreeMapEnabled() && athreeMapIntent({ prompt: text, seedKey: 'seed-plan' }).use ? ['generate_athree_map'] : [];
    return ['generate_game_runtime', 'generate_game_3d', ...map, 'generate_game_vfx', 'generate_melody', 'generate_game_shell'];
  }
  // 🗺️ A 2D game whose user wants a big world (the wish, not one word: world2dIntent → largeWorldIntent, admin 2026-11-19)
  // gets the 2D world laid down by the platform too — the same reason the kit is seeded at all: a capability the
  // platform KNOWS a build needs is not left to the model's optional tool call.
  const flat: GameKitRecipe[] = ['generate_game_runtime', 'generate_game_vfx', 'generate_melody'];
  if (world2dIntent({ prompt: text, drawnIn3D: false }).use) flat.push('generate_world_2d');
  // 🎮 THE GENRE'S OWN KIT (game audit 2, 2026-11-20): failedbr #2435 ("super Mario Bros game banao") got only the loop,
  // sound and music and hand-wrote its platformer physics, renderer and touch buttons; #2470 (a Monopoly-style "business
  // game") got the real-time kit and no rules engine. The kits exist (generate_game_2d, generate_board_games) but were
  // only ever run if the model chose to — so the platform lays the genre's kit down itself, like the rest of the seed.
  let genre = 'unknown';
  try { genre = buildGameContract(text).genre; } catch { /* no genre: the shared kit only */ }
  if (MOVING_2D_GENRES.has(genre)) flat.push('generate_game_2d');
  // A match-3 is a 'puzzle' to the genre reader, and its rules engine lives in the same pack (2026-11-20).
  if (genre === 'board' || genre === 'card' || (genre === 'sports' && CRICKET.test(text)) || (genre === 'puzzle' && MATCH3.test(text))) flat.push('generate_board_games');
  return flat;
}

/**
 * 🎮 A GAME IS BUILT ON THE KIT, NOT SPLIT INTO PROJECT MODULES (failedbr #2279, 2026-11-20 — "GO CAR").
 *
 * A 40-part 3D racing spec read as LARGE and project-shaped, so Software Project Mode split it into 14 modules.
 * Module 1, "Core Gameplay Loop", owned no entry, so nothing could be played this round; and kit seeding runs only
 * when no module is in flight, so the platform laid down no game kit. The builder spent eight minutes writing its
 * own car physics and camera, found the kit's car and camera APIs at minute 9, rewrote them, and the user stopped
 * at 13 minutes with nothing to play. BlockWorld (50378049) and 8e124182 were the same split: the builder ignored
 * the module scope and wrote the whole game anyway.
 *
 * The kit IS a game's decomposition (loop, input, 3D, audio, shell), and the mega-app roadmap already narrows a
 * big game to a playable step 1 (with its own game-dimension check). So when the kit will be laid down for this
 * request, Project Mode stands down and the roadmap owns the build. One answer, read by the scope verdict, so the
 * roadmap, the solo-builder switch and the project planner cannot disagree. AGENTV3_GAME_PROJECT_MODE=on restores
 * the split. PURE.
 */
export function gameKitOwnsTheBuild(prompt: string | null | undefined, framework?: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.AGENTV3_GAME_PROJECT_MODE ?? '').trim().toLowerCase() === 'on') return false;
  if (!gameKitSeedEnabled(env)) return false;
  try { return gameKitPlan(prompt, framework).length > 0; } catch { return false; }
}

/** Says 3D in so many words — the same reading `wantsSceneObjects` gives "3d". */
const SAYS_3D = /\b(?:3\s*-?\s*d|three\s*-?\s*dimensional)\b/i;
/**
 * A kind of game that is drawn in 3D on this platform: a race, a drive, a world you move through. The
 * 2026-09-14 bike-racing report and build 46e2d74b are this kind. Precision-first on purpose: a game this
 * misses keeps the 2D-safe layers and its builder may still run the 3D recipes, exactly as before the seed
 * existed; a game this wrongly matches gets three.js laid down under it.
 * BR1966: glued GTA titles (gta5 / gtav / gta-5) match the same 3D kit as spaced "gta 5"; a bare
 * "gta" word-boundary misses them.
 */
const DRAWN_IN_3D = /\b(?:(?<!typing\s{1,3})rac(?:e|es|er|ers|ing)|driv(?:e|es|er|ers|ing)|gaa?di|open\s*-?\s*world|first\s*-?\s*person|third\s*-?\s*person|fps|gta(?:\s*[-_]?\s*[5v])?|minecraft|flight\s*-?\s*sim\w*|village|gaon|gaanv)\b/i;

/**
 * Does the REQUEST say this game is drawn in 3D? PURE.
 *
 * Never where the route's flat list says 2D (`wantsSceneObjects` false: a board, card, puzzle, quiz,
 * match-3 or snake game, or one that says 2D) — that list always wins, so the seed can never lay three.js
 * under a game the route calls flat. Beyond it, 3D needs a POSITIVE sign: the word, a racing / driving /
 * open-world / village game, or a land vehicle the hero-object catalogue recognises ("a car game").
 * `wantsSceneObjects` alone is not that sign: it calls every game NOT on the flat list a scene, so
 * "rock paper scissors", "guess the number", "hangman" and "flappy bird" all read as 3D there.
 */
export function gameKitWants3D(prompt: string | null | undefined): boolean {
  const text = String(prompt ?? '');
  if (!wantsSceneObjects(text)) return false;
  // A keypad phone the user named (Q-846) has no WebGL: never three.js under its game, whatever else it says.
  if (namedNonSmartphone(text)) return false;
  // A royale is drawn in 3D — the ONE royale reader (failedbr #2475: the private list here had no "bgmi").
  if (SAYS_3D.test(text) || DRAWN_IN_3D.test(text) || asksForBattleRoyale(text)) return true;
  try {
    return heroObjectContract(text).categories.some((c) => c === 'vehicle-land' || c === 'vehicle-water');
  } catch { return false; }
}

/**
 * Does this request get the route's 3D OBJECT DETAIL TIER and hero-object contract? ONE answer for the route
 * and the seed (build 46e2d74b's fixes, 2026-10-11): for a game it is the seed's own reading
 * (`gameKitWants3D`), so "rock paper scissors" is not told to build every object with the 3D layer while the
 * seed lays down a 2D kit; for anything else it is `wantsSceneObjects`, exactly as before. PURE.
 */
export function wantsSceneDetail(prompt: string | null | undefined): boolean {
  const text = String(prompt ?? '');
  let domain = '';
  try { domain = analyzeRequirementGaps(text).domain; } catch { domain = ''; }
  return domain === 'game' ? gameKitWants3D(text) : wantsSceneObjects(text);
}

/**
 * The input the seed passes to one recipe of `plan`, or undefined for the recipe's defaults. PURE.
 *
 * The effects layer's particle system imports `three`, and `run_recipe` installs every package a recipe's
 * files import — so the whole layer under a 2D game installs three.js and `@types/three` (the candy
 * autopsy's complaint, by another door). Without the 3D layer the seed takes its SOUND half only:
 * `audio.ts` and the `synth.ts` voices it needs, which import nothing. If the builder later adds the 3D
 * shell, the shell's missing-layer adder writes the particles it imports.
 */
export function gameKitRecipeInput(recipe: GameKitRecipe, plan: readonly GameKitRecipe[], request?: string | null): Record<string, unknown> | undefined {
  if (recipe === 'generate_game_vfx' && !plan.includes('generate_game_3d')) return { include: ['audio'] };
  // 🏁 THE RACE STARTER ONLY FOR A RACE (failedbr #2478, Q-3016): the shell shipped src/game/RacingRoadGame.tsx under EVERY
  // 3D game, so a BGMI request was handed a racing game ("seeded but not imported: RacingRoadGame") — a starter that steers
  // a weak builder toward the wrong genre. Without a request (a caller that cannot say), the whole shell, as before.
  if (recipe === 'generate_game_shell' && typeof request === 'string' && request.trim()) {
    let genre = 'unknown';
    try { genre = buildGameContract(request).genre; } catch { return undefined; }
    // Each genre starter only for its own genre: the runner starter is no more a BGMI's than the race starter is.
    return { include: GAME_SHELL_MODULES.filter((m) => { const starter = GAME_STARTERS.find((st) => st.module === m); return !starter || starter.genre === genre; }) };
  }
  return undefined;
}

/** One recipe's outcome, as the route's dispatch returned it. */
export interface GameKitSeedResult {
  recipe: string;
  ok: boolean;
  /** The tool result the model would have received had it called the recipe itself. */
  content: string;
}

/** How much of one recipe's own instructions the handoff carries. Bounded so a future recipe cannot flood the prompt. */
export const HANDOFF_RECIPE_CHARS = 6_000;

const WRITE_LINE = /^(?:Created|Updated|Unchanged)\s+(\S+)/;

/**
 * A recipe's tool result, made compact for the build prompt: the per-file "Created …" lines become one
 * "Wrote:" line, and the rest — the recipe's own instructions, the layer note and the install outcome —
 * is kept as the model would have read it. PURE.
 */
export function compactRecipeResult(content: string): string {
  const lines = String(content ?? '').split('\n');
  const wrote: string[] = [];
  const rest: string[] = [];
  for (const [i, line] of lines.entries()) {
    const m = WRITE_LINE.exec(line.trim());
    if (m) { wrote.push(m[1]); continue; }
    // The recipe's own header ("Wired the game runtime:") says nothing the block heading does not.
    if (i === 0 && /:\s*$/.test(line)) continue;
    rest.push(line);
  }
  const body = rest.join('\n').trim();
  const clipped = body.length > HANDOFF_RECIPE_CHARS ? `${body.slice(0, HANDOFF_RECIPE_CHARS)}\n…(cut — read the files themselves for the rest)` : body;
  return [wrote.length ? `Wrote: ${wrote.join(', ')}` : '', clipped].filter(Boolean).join('\n');
}

/**
 * The block prepended to the build prompt after the seed. It states only what is on disk: the recipes that
 * ran and what each wrote. A recipe that failed is named with the call that runs it, so the builder is
 * never told a file exists that does not. '' when nothing was laid down. PURE.
 *
 * `flat` is the route's own reading (`!wantsSceneObjects(prompt)`): a board, card, puzzle or quiz game is
 * told it is 2D ON PURPOSE; any other game laid down without the 3D layer is told the request did not say
 * 3D, and how to add the 3D recipes itself if the game truly needs them — never "this is 2D" as a fact the
 * platform does not have.
 */
/** The builder's instruction when the platform laid the Athree map down: build IN that world, with the recipe's own usage notes. PURE. */
export function athreeMapHandoff(recipeResult: string): string {
  const usage = String(recipeResult ?? '').trim().slice(0, 3000);
  return '🗺️ THE BIG MAP IS ALREADY IN src/game/athree/ — NavBharatAI\'s Athree world (streaming terrain, sea level, plants, safe'
    + ' spawn points, physics height data), laid down because this game needs a large world. Build the game IN it: put the'
    + ' player on its ground (its height function, never y = 0), use its spawn points for players, enemies and loot, and stream'
    + ' it around the player. NEVER replace it with a flat ground plane, a grid, a small arena or terrain of your own.'
    + (usage ? `\nHow to use it (from the recipe):\n${usage}` : '');
}

export function gameKitHandoffBlock(results: readonly GameKitSeedResult[], opts: { flat?: boolean; contract?: string; endlessRaceCourse?: boolean; request?: string } = {}): string {
  const done = results.filter((r) => r.ok);
  if (done.length === 0) return '';
  const failed = results.filter((r) => !r.ok);
  const has = (recipe: string): boolean => done.some((r) => r.recipe === recipe);
  // The PLAN was 3D (either 3D recipe was run, whatever its outcome) — never decided from successes alone,
  // or a failed shell would have the block call a game with the 3D layer on disk "2D, no 3D layer".
  const threeD = results.some((r) => r.recipe === 'generate_game_3d' || r.recipe === 'generate_game_shell');
  const vfx = done.find((r) => r.recipe === 'generate_game_vfx');
  const soundOnly = !!vfx && !/src\/game\/fx\/particles\.ts/.test(vfx.content);
  const twoD = [
    opts.flat
      ? 'This game is drawn in 2D on purpose — no 3D layer and no 3D shell were laid down.'
      : 'The request does not say this game is 3D, so no 3D layer and no 3D shell were laid down.',
    'Draw it with React (or one 2D canvas), driven by the fixed-timestep loop and the input in src/game/core/,'
      + ' and make every control a real button or pointer event so it plays by touch.',
    opts.flat
      ? ''
      : 'Only if the game truly needs a 3D world, run run_recipe({ name: "generate_game_3d" }) and then'
        + ' run_recipe({ name: "generate_game_shell" }) yourself before you use anything from them.',
    soundOnly
      ? 'The effects layer is SOUND ONLY here (src/game/fx/audio.ts and its synth.ts voices): its particle system'
        + ' is three.js and was left out on purpose, so draw visual effects with CSS or the 2D canvas and never'
        + ' import src/game/fx/particles or src/game/fx/feedback.'
      : '',
  ].filter(Boolean).join(' ');
  const head = [
    '[BUILD ON THE GAME KIT — IT IS ALREADY IN src/game] Before your first turn NavBharatAI ran these game',
    `recipes for this request: ${done.map((r) => r.recipe).join(', ')}. Their files are on disk NOW. Do NOT run`,
    threeD
      ? 'them again, and NEVER write a second game loop, input system, camera, meta/best-score store, particle'
        + '\nsystem or audio engine — import the ones in src/game (and src/audio). Build ONLY the game itself: its'
      : 'them again, and NEVER write a second game loop, input system, meta/best-score store or audio engine —'
        + '\nimport the ones in src/game (and src/audio). Build ONLY the game itself: its',
    'rules, levels, content and screens, in your own files under src/game/<your-game>/, wired into src/App.tsx.',
    threeD
      ? 'This is a 3D game.'
        + (has('generate_game_shell')
          ? ' Render it with <GameCanvas> from src/game/GameCanvas.tsx and put your game in its setup() and update().'
            + ' For a car, bike or ridden animal, call ctx.follow(vehicle) in setup() so the camera stays BEHIND it.'
            + (/src\/game\/LaneRunnerGame\.tsx/.test(done.find((r) => r.recipe === 'generate_game_shell')?.content ?? '')
              ? ' This is an ENDLESS RUNNER and its game is already on disk: render <LaneRunnerGame title="…" /> from src/game/LaneRunnerGame.tsx'
                + ' (lanes, obstacles, jump, slide, coins, swipes, start screen, game over) and make it the user\'s game through its props'
                + ' (colours, title, lanes, speed) or createLaneRunnerScene() — never hand-write the runner\'s rules, lanes or swipes.'
              : '')
          : ' For a car, bike or ridden animal, keep the camera BEHIND it, opposite its nose.')
        + (has('generate_game_3d')
          ? ' Move a vehicle with driveVehicle(...) and createVehicleState(...) from src/game/three/objects.ts (they'
            + ' own steering, starting speed and contact with the world), and build objects with the kit factories.'
            + ' For explorable interiors use createHouse({ enterable: true }) or createEnterableHouse(): open doorway, one/two storeys, stairs and hinged door. The shell wires E/mobile Use. Legacy createHouse() is solid scenery, not enterable. Supply NPC doorOccupants; custom loops must wire interactHouseDoor/updateHouseDoors. Do not swap this for a decorative downloaded mesh.'
            + ' Kit buildings, tree trunks and terrain are collidable automatically. Mark custom walls, stairs and'
            + ' platforms with markWorldCollider(mesh) from src/game/three/collision.ts. For custom movers,'
            + ' use sweepWorldCapsules with worldColliders before applying movement. Verify that walls and'
            + ' trunks block, low steps climb and roofs stop jumps.'
            + (/src\/game\/three\/city\.ts/.test(done.find((r) => r.recipe === 'generate_game_3d')?.content ?? '')
              ? ' For a city or a town, build it with createCity() from src/game/three/city.ts (streets, crossings, pavements,'
                + ' shops, apartments, offices, houses, parks; city.spawn, city.route, city.solidAt) — never hand-place a street grid.'
              : '')
          : '')
      : twoD,
    // A race whose course the request did not describe runs on the kit's endless track (endlessRaceCourse.ts):
    // said only when the 3D layer that holds createTrackStream is really on disk.
    has('generate_athree_map') ? athreeMapHandoff(done.find((r) => r.recipe === 'generate_athree_map')?.content ?? '') : '',
    opts.endlessRaceCourse && has('generate_game_3d') ? ENDLESS_RACE_COURSE_RULE : '',
    ACTION_VISIBLE_RULE,
    // The game's screens in the language the request asked for or was written in (the kit speaks 11 languages).
    has('generate_game_runtime') || has('generate_game_shell') ? gameLanguageHandoff(gameLanguageForRequest(opts.request)) : '',
    has('generate_game_2d')
      ? '🕹️ THE 2D GAME KIT IS ALREADY IN src/game/2d/: build the game ON it — Tilemap.fromRows(...) for the level,'
        + ' PlatformerController + createBody for the player (coyote time, jump buffer, no tunnelling — NEVER a hand-written'
        + ' jump or tile collision), Camera2D to follow, Animator for every character (idle / run / jump / hit), Parallax'
        + ' behind and Particles2D for dust, sparks and coins.'
      : '',
    has('generate_board_games')
      ? '🎲 THE INDIA GAMES PACK IS ALREADY IN src/game/board/: the rules come from it — Ludo, Snakes & Ladders, chess,'
        + ' carrom, cricket, match-3 and cards (Teen Patti, rummy) — never re-implement them. Draw the board, let the player tap a legal'
        + ' move, and announce what happened. Card games are points or pretend chips only, never real money.'
      : '',
    has('generate_world_2d')
      ? '🗺️ THE BIG 2D WORLD IS ALREADY IN src/game/world2d/: the user asked for a big map, so build the game ON it —'
        + ' createWorld2D(...) for the map (endless), createWorldRenderer(world).draw(ctx, player.x, player.y, w, h) every frame'
        + ' with the camera on the player, moveWithCollision(...) for every moving body, world.spawnPoint() for the start and'
        + ' drawMinimap(...) in a corner. NEVER draw a fixed-size background or confine the player to one screen.'
      : '',
    failed.length > 0
      ? `NOT laid down: ${failed.map((r) => r.recipe).join(', ')} — if the game needs ${failed.length === 1 ? 'it' : 'them'}, run`
        + ` ${failed.map((r) => `run_recipe({ name: "${r.recipe}" })`).join(' and ')} yourself before you use anything from ${failed.length === 1 ? 'it' : 'them'}.`
      : '',
    'What each recipe wrote, and how to use it (its own instructions):',
  ].filter(Boolean).join('\n');
  const sections = done.map((r) => `--- ${r.recipe} ---\n${compactRecipeResult(r.content)}`);
  // Game Engine Ultra Phase 1: the request's scope contract (gameIntent.ts), when the route supplies one.
  const contract = (opts.contract ?? '').trim();
  return `${head}\n\n${contract ? `${contract}\n\n` : ''}${sections.join('\n\n')}`;
}

/**
 * BR1977: `run_recipe` reports ok as `!r.is_error` even when it wrote nothing
 * (sandbox unavailable, a silent no-op). The route then recorded GAME_KIT_SEEDED
 * listing five recipes and 3 files, and told the builder the kit was on disk.
 * Six seconds later `src/game/core/events.ts` was missing. A claim is honest
 * only when at least as many files landed as recipes that said they succeeded
 * (a healthy 3D seed writes ~30). PURE.
 */
export function kitSeedClaimIsHonest(okRecipes: number, filesWritten: number): boolean {
  if (!Number.isFinite(okRecipes) || !Number.isFinite(filesWritten)) return false;
  if (okRecipes <= 0) return false;
  return filesWritten >= okRecipes;
}

/** Downgrade empty recipe "successes" in place so the handoff cannot say the kit is on disk. */
export function downgradeEmptyKitSeedSuccesses(results: GameKitSeedResult[], filesWritten: number): void {
  const reportedOk = results.filter((r) => r.ok).length;
  if (kitSeedClaimIsHonest(reportedOk, filesWritten)) return;
  for (const r of results) {
    if (r.ok) {
      r.ok = false;
      r.content = `reported success but only ${filesWritten} file(s) landed for ${reportedOk} recipe(s)`;
    }
  }
}

/** The admin line for GAME_KIT_SEEDED. PURE. */
export function gameKitSeededMessage(results: readonly GameKitSeedResult[], files: number, ms: number): string {
  const done = results.filter((r) => r.ok).map((r) => r.recipe);
  const failed = results.filter((r) => !r.ok).map((r) => r.recipe);
  const secs = Math.max(0, Math.round(ms / 100) / 10);
  return `Laid down the game kit before the first model call: ${done.join(', ')} (${files} file${files === 1 ? '' : 's'}, ${secs} s). `
    + 'The builder was told the kit is on disk and to build only the game on it.'
    + (failed.length ? ` Not laid down: ${failed.join(', ')} (the builder was told to run ${failed.length === 1 ? 'it' : 'them'} itself).` : '');
}

/**
 * HOW MANY FILES THE BUILDER PRODUCED: `written` minus every game-kit file still exactly as the seed
 * wrote it. PURE.
 *
 * 🔴 The engine's "did this build produce anything?" questions — the empty-build retry, "never charge for
 * a build that produced nothing", the claim audit, the render rescue — all counted `writtenFiles`. The seed
 * puts ~30 of OUR files there before the first model call (it must: that map is what the project is saved
 * from), so a builder that then wrote nothing would have skipped the retry and been billed for our kit.
 * A kit file the builder CHANGED is its work and counts. With nothing seeded this is `written.size`.
 */
export function builderWrittenCount(written: ReadonlyMap<string, string>, kitSeeded: ReadonlyMap<string, string>): number {
  if (kitSeeded.size === 0) return written.size;
  let n = 0;
  for (const [p, c] of written) if (kitSeeded.get(p) !== c) n++;
  return n;
}

/** L3 preparation is allowed only after this new-game seed actually installed its 3D recipe. */
export function gameKitCanPrepareAssets(results: readonly GameKitSeedResult[]): boolean {
  return results.some(result => result.recipe === 'generate_game_3d' && result.ok);
}

/** BR1954: the game request/API contract is a build prerequisite, not a reward for a fresh seed.
 * Pure snapshot handoff. No reads, writes, recipes, provider calls or continuation after Stop.
 * Module/import scopes remain independent; the seed's preservation/refresh gates are untouched.
 */
export function gameTurnHandoff(
  prompt: string,
  files: Readonly<Record<string, string>>,
  options: { writingRun: boolean; moduleTurn: boolean; importTurn: boolean; stopped: boolean },
  env: NodeJS.ProcessEnv = process.env,
): { contract: GameScopeContract | null; block: string } {
  if (!options.writingRun || options.moduleTurn || options.importTurn || options.stopped
    || analyzeRequirementGaps(prompt).domain !== 'game') return { contract: null, block: '' };
  const contract = gameScopeContractEnabled(env) ? buildGameContract(prompt) : null;
  // Only known producer paths; never dump arbitrary project files into the API block.
  const producers = Object.fromEntries(KIT_CONTRACT_FILES.filter((p) => typeof files[p] === 'string').map((p) => [p, files[p]]));
  const api = kitTypeContract(producers, 12_000);
  return { contract, block: [
    contract ? gameContractBlock(contract) : '',
    api ? '[GAME KIT API SNAPSHOT — saved start-of-turn source plus acknowledged seed/refresh writes; '
      + 'NOT a fresh sandbox read. If the compiler disagrees, read the current producer. '
      + 'Match the consumer to the library; never add a guessed API to make it fit.]\n' + api : '',
  ].filter(Boolean).join('\n\n') };
}

/** A milestone owns game preparation too. GTA in the later/full goal must not force a 3D shell
 * under a canvas-only first slice. Explicit dimensional/device constraints still come from the user.
 * No milestone => byte-identical original behavior. This changes no architecture or saved files.
 */
/**
 * WHAT GAME THIS IS, carried from the user's own request into every milestone turn (failedbr #2478, 2026-11-20).
 * "make a bgmi for me" became roadmap step 1, "Create a basic 3D scene … with a ground plane … first-person camera",
 * and every reader of the turn — the game contract, the kit seed, the map decision — read only that step: the
 * contract said genre "unknown", the named game was gone, and the big map was never laid down. Only the game's
 * IDENTITY travels (the named reference, the genre, a big-world wish) — never the request's later-milestone
 * features, so a step still builds only its own slice. PURE.
 */
export function gameIdentityLines(original: string): string[] {
  const out: string[] = [];
  const ref = namedGameReference(original);
  let genre = 'unknown';
  try { genre = buildGameContract(original).genre; } catch { /* identity lines are best-effort */ }
  if (ref) out.push(`The game the user named: ${ref.name} — build an ORIGINAL ${ref.genre} game in ${ref.dimension === '3d' ? '3D' : ref.dimension === '2d' ? '2D' : 'its usual view'}, ${ref.camera} camera, in the style of ${ref.name}.`);
  else if (genre !== 'unknown') out.push(`The user's game is a ${genre} game.`);
  if (asksForBattleRoyale(original) || largeWorldIntent(original).wants) out.push('The user\'s game needs a big map — a large open area to explore.');
  return out;
}

export function gameTurnRequest(original: string, milestone?: string | null): string {
  if (!milestone) return original;
  // 🔴 ONLY A GAME'S MILESTONE BELONGS TO A GAME (failedbr #2271, 2026-11-20 — "INDIAN MUSIC"). The line below was
  // added to EVERY roadmap milestone, so a music-streaming app's step 1 ("a Player screen with a real <audio>
  // element") read as a game: the platform laid down the game kit (loop, input, game sounds) and a game scope
  // contract for an app with no game in it. The original request decides whether the milestone is a game's; a
  // milestone that is a game on its own still reads as one through its own words.
  if (!requestIsGame(original)) return milestone;
  const explicit3D = SAYS_3D.test(original) && gameKitWants3D(original);
  const explicit2D = /\b(?:2\s*-?\s*d|two\s*-?\s*dimensional)\b/i.test(original);
  const phone = namedNonSmartphone(original);
  return [milestone, 'This milestone belongs to a game.', ...gameIdentityLines(original), ...hardConstraintLines(original),
    explicit2D ? 'User constraint: 2D game.' : explicit3D ? 'User constraint: 3D game.' : '',
    phone ? `User device constraint: ${phone.device}.` : ''].filter(Boolean).join('\n');
}

/** The original request is a game by the one domain reading the kit uses. Never throws. */
function requestIsGame(text: string): boolean {
  try { return analyzeRequirementGaps(String(text ?? '')).domain === 'game'; } catch { return false; }
}

/** Available capability, not a claim that a seed succeeded or that an AAA clone is possible. */
export function gamePlannerCapability(prompt: string, framework: string): string {
  return gameKitPlan(prompt, framework).length ? 'Game capability: this React workspace supports the existing fixed-timestep input/audio runtime and optional Three.js 3D shell, camera and vehicle recipes. Plan a limited original playable slice in the selected React architecture; do not claim that 3D itself is unavailable, or promise a full commercial-game copy.' : '';
}
