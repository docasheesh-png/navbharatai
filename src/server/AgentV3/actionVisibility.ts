// EVERY ACTION IS SEEN, NOT ONLY COMPUTED (admin 2026-11-19).
//
// Admin, verbatim: *"game me attack, ya dript kya koi bhi action … woh action to ho jata hai, par action hota hua dikhata
// nahi hai, kabhi kabhi action bhi nahi hota hai … pubg jaisa game … 'fire' button press kiya goli chalne lagi par
// character goli chalate huye dikha nahi, character same position me khada raha … jo button banaye woh pura banaye …
// sirf ek game fix nahi karna hai, navbharatai ko pura sikhana hai"*.
//
// 🔑 ROOT CAUSES (all in the kit, not in one game): the kit's humanoid had no action pose at all (walk, tuck, aim only);
// the shell's player body was private, so game code could not pose it; a gun's recoil was a camera number and a sword
// swing an event plus a sound; a press during a hit-stop freeze was wiped unseen; a quick tap could miss a gun polled
// with isDown; 'fire' / 'shoot' had no key and no button; and nothing told the builder an action must be visible.
//
// 🧬 THE FIX, IN LAYERS THAT CANNOT DRIFT:
//   1. The kit does it by default: Humanoid.act(...) poses, played by the shell for every action button (actionPoses)
//      and from WEAPON_FIRED / MELEE_SWING / PLAYER_JUMPED / PLAYER_DAMAGED; drift with body lean and tyre smoke.
//   2. ACTION_VISIBLE_RULE (below) — one rule text in the architect prompt and the game kit handoff.
//   3. A check on the code the builder writes: a game that reads an action button for a body of its OWN and never
//      plays a pose on it gets a repair note while the file is open, and a readiness warning at the end.
// PURE: no I/O.

/** The one rule every surface quotes. */
export const ACTION_VISIBLE_RULE = [
  '🎬 EVERY ACTION BUTTON IS SEEN, NOT ONLY COMPUTED: when the player presses Fire, Attack, Jump, Kick, Throw, Use or',
  'Drift, the player\'s body visibly does it at that moment, and the press always works (never only a bullet appearing',
  'while the character stands still). 3D: the shell\'s player body already plays a recoil when a Weapon fires, a sweep',
  'when a MeleeWeapon swings, a punch for any other attack, a launch on a jump, a squash on landing and a flinch when hit;',
  'map other actions with actionPoses ({ kick: \'kick\', throw: \'throw\' }) or call ctx.hero.act(\'kick\'). A body of your own',
  '(playerBody, your own createHumanoid, a Forge person, a loaded model) is NOT posed by the shell: call its act(...) /',
  'play(...) on the same frame as the action. Poll a gun with input.isDown(\'attack\') || input.wasPressed(\'attack\') so a',
  'quick tap fires. A car drifts with driveVehicle (Space / the Drift button) and leans and smokes by itself.',
  '2D: show the action on the sprite the same frame — a swing arc or a lunge, a muzzle flash and a recoil nudge, a squash',
  'and stretch on a jump, a flash on a hit — never only a number changing.',
].join(' ');

/** Action names a game reads that are a VISIBLE body action (movement and menus are not). */
const BODY_ACTIONS = ['attack', 'fire', 'shoot', 'punch', 'strike', 'melee', 'slash', 'kick', 'throw', 'swing', 'jump'];
const READS_ACTION = new RegExp(String.raw`\b(?:isDown|wasPressed|wasReleased)\s*\(\s*['"](` + BODY_ACTIONS.join('|') + String.raw`)['"]\s*\)`, 'g');

export interface ActionPoseHalves {
  /** Body actions this file reads from the input. */
  reads: string[];
  /** The file plays a pose or an animation (act / play / a mixer clip / a hand-written joint rotation on an action). */
  poses: boolean;
  /** The file gives the player a body of its own (so the shell does not pose it). */
  ownBody: boolean;
}

const SOURCE = /^src\/.+\.(?:t|j)sx?$/i;
const TEST_FILE = /\.(?:test|spec)\.[tj]sx?$/i;
/** Generated kit files define these calls; only the game's own files are read. */
const KIT_FILE = /^src\/game\/(?:three|core|fx|ui|play|athree|forge|world2d|generatedObjects)\/|^src\/game\/(?:Game|GameCanvas|RacingRoadGame)\.tsx?$|^src\/audio\//i;
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A source file of the game's OWN (not a test, not a kit file) — the only files worth reading for this check. */
export function isGameOwnSource(path: string): boolean {
  const p = String(path ?? '').replace(/^\.?\//, '');
  return SOURCE.test(p) && !TEST_FILE.test(p) && !KIT_FILE.test(p) && !p.includes('node_modules');
}

/** One file's contribution. A file that is not the game's own source contributes nothing. */
export function actionPoseHalves(path: string, content: string): ActionPoseHalves {
  const p = String(path ?? '').replace(/^\.?\//, '');
  if (!isGameOwnSource(p)) return { reads: [], poses: false, ownBody: false };
  const src = stripComments(String(content ?? ''));
  const reads = [...new Set([...src.matchAll(READS_ACTION)].map((m) => m[1]))].sort();
  return {
    reads,
    poses: /\.act\s*\(\s*['"]|\.play\s*\(\s*['"]|\bclipAction\s*\(|\bplayAction\s*\(|\bactionPoses\s*:/.test(src),
    ownBody: /\bplayerBody\s*:\s*(?!false\b)[A-Za-z_$(]|\bcreateHumanoid\s*\(|\bcreatePerson\s*\(|\bloadGameAsset\s*\(/.test(src),
  };
}

export interface ActionPoseFinding { files: string[]; actions: string[] }

/**
 * A game whose OWN body reads a body action and never poses anything, across every file written so far; null when
 * fine. The shell's default body is posed by the kit, so a game that uses it is never flagged.
 */
export function actionPoseFinding(index: ReadonlyMap<string, ActionPoseHalves>): ActionPoseFinding | null {
  const all = [...index.entries()];
  if (!all.some(([, h]) => h.ownBody) || all.some(([, h]) => h.poses)) return null;
  const readers = all.filter(([, h]) => h.reads.length > 0);
  if (readers.length === 0) return null;
  return { files: readers.map(([p]) => p).sort(), actions: [...new Set(readers.flatMap(([, h]) => h.reads))].sort() };
}

/** The repair note (write time) and the readiness warning (build end) for that finding. */
export function actionPoseNote(f: ActionPoseFinding): string {
  return `\n\n🎬 THE PLAYER'S ACTIONS ARE NOT SEEN: ${f.files.join(', ')} read${f.files.length === 1 ? 's' : ''} `
    + `${f.actions.map((a) => `'${a}'`).join(', ')} for a body of the game's own, and nothing plays a pose on it — so the `
    + `shot or the jump happens while the character stands still. ${ACTION_VISIBLE_RULE}`;
}

export function actionPoseWarning(f: ActionPoseFinding): string {
  return `ACTIONS NOT VISIBLE: ${f.files.join(', ')} read ${f.actions.join(', ')} for the game's own player body, which never plays `
    + 'an action pose. Call body.act(\'fire\' | \'swing\' | \'punch\' | \'jump\' | \'kick\' | …) (or play the model\'s clip) on the same frame as the action, '
    + 'or use the shell\'s default body, which poses every button by itself.';
}
