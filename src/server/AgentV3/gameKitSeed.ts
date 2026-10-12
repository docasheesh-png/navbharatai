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

import { namedNonSmartphone } from './deviceTarget';
import { analyzeRequirementGaps } from '../lib/RequirementGapAnalyzer';
import { wantsSceneObjects, heroObjectContract } from '../lib/heroObjectSpec';

/** The recipes the seed may run, in the order the architect prompt lists them (runtime first, shell last). */
export type GameKitRecipe = 'generate_game_runtime' | 'generate_game_3d' | 'generate_game_vfx' | 'generate_melody' | 'generate_game_shell';

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
  return gameKitWants3D(text)
    ? ['generate_game_runtime', 'generate_game_3d', 'generate_game_vfx', 'generate_melody', 'generate_game_shell']
    : ['generate_game_runtime', 'generate_game_vfx', 'generate_melody'];
}

/** Says 3D in so many words — the same reading `wantsSceneObjects` gives "3d". */
const SAYS_3D = /\b(?:3\s*-?\s*d|three\s*-?\s*dimensional)\b/i;
/**
 * A kind of game that is drawn in 3D on this platform: a race, a drive, a world you move through. The
 * 2026-09-14 bike-racing report and build 46e2d74b are this kind. Precision-first on purpose: a game this
 * misses keeps the 2D-safe layers and its builder may still run the 3D recipes, exactly as before the seed
 * existed; a game this wrongly matches gets three.js laid down under it.
 */
const DRAWN_IN_3D = /\b(?:(?<!typing\s{1,3})rac(?:e|es|er|ers|ing)|driv(?:e|es|er|ers|ing)|gaa?di|open\s*-?\s*world|first\s*-?\s*person|third\s*-?\s*person|fps|gta|minecraft|pubg|free\s*-?\s*fire|battle\s*-?\s*royale|flight\s*-?\s*sim\w*|village|gaon|gaanv)\b/i;

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
  if (SAYS_3D.test(text) || DRAWN_IN_3D.test(text)) return true;
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
export function gameKitRecipeInput(recipe: GameKitRecipe, plan: readonly GameKitRecipe[]): Record<string, unknown> | undefined {
  if (recipe === 'generate_game_vfx' && !plan.includes('generate_game_3d')) return { include: ['audio'] };
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

const WRITE_LINE = /^(?:Created|Updated|Unchanged|skipped existing)\s+(\S+)/;

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
export function gameKitHandoffBlock(results: readonly GameKitSeedResult[], opts: { flat?: boolean } = {}): string {
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
          : ' For a car, bike or ridden animal, keep the camera BEHIND it, opposite its nose.')
        + (has('generate_game_3d')
          ? ' Move a vehicle with driveVehicle(...) and createVehicleState(...) from src/game/three/objects.ts (they'
            + ' own the steering signs and the starting speed), and build every object with the builders in that file.'
          : '')
      : twoD,
    failed.length > 0
      ? `NOT laid down: ${failed.map((r) => r.recipe).join(', ')} — if the game needs ${failed.length === 1 ? 'it' : 'them'}, run`
        + ` ${failed.map((r) => `run_recipe({ name: "${r.recipe}" })`).join(' and ')} yourself before you use anything from ${failed.length === 1 ? 'it' : 'them'}.`
      : '',
    'What each recipe wrote, and how to use it (its own instructions):',
  ].filter(Boolean).join('\n');
  const sections = done.map((r) => `--- ${r.recipe} ---\n${compactRecipeResult(r.content)}`);
  return `${head}\n\n${sections.join('\n\n')}`;
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
