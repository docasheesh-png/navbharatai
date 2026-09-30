// A GAME THAT ONLY A KEYBOARD CAN PLAY IS NOT PLAYABLE ON THE DEVICE MOST USERS HOLD.
//
// Admin 2026-09-30, verbatim: "mobile friendly game/app bane — mobile first!!!!!!". Autopsy 6a55d939
// ("Build a app like god of war") shipped a game driven by WASD + mouse: on a phone it rendered and could
// not be played at all. The recipe shell now DRAWS touch controls (`GameShellGenerator` TOUCH_CONTROLS),
// which covers every game built on the recipes. This covers the rest — a single-file HTML game, a
// canvas game the model wrote itself, or a recipe game where the model added its own keyboard handler
// for an action that has no on-screen button.
//
// Said WHILE THE FILE IS OPEN (a write-time note), once per build: a keyboard-driven game loop in a file
// that handles no touch or pointer input at all. Precision first — all three signals must be in the same
// file: something that runs a game (a render loop, a canvas or WebGL context, three.js), keyboard control
// keys, and no touch/pointer handling. A form with a keyboard shortcut, or an animation, is not a game.
// PURE.

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|html?|vue|svelte)$/i;
const GAME_SIGNAL = /requestAnimationFrame|getContext\(\s*['"](?:2d|webgl2?)['"]|from\s+['"]three['"]|new\s+THREE\.|\bPhaser\b|<canvas\b/;
const KEYBOARD_CONTROL = /['"](?:ArrowUp|ArrowDown|ArrowLeft|ArrowRight|KeyW|KeyA|KeyS|KeyD|Space)['"]|\bkeyCode\s*===?\s*(?:32|37|38|39|40)\b|\.key\s*===?\s*['"](?:w|a|s|d|\s)['"]/;
const KEY_LISTENER = /keydown|onKeyDown|KeyboardEvent/;
const TOUCH_SIGNAL = /touchstart|touchmove|ontouchstart|onTouchStart|pointerdown|onPointerDown|pointerType|setVirtualButton|setAnalogueMove|TouchControls|nipplejs/i;

/** A keyboard-driven game loop that handles no touch input at all. PURE. */
export function isKeyboardOnlyGame(path: string, content: string): boolean {
  if (!CODE_FILE.test(path || '') || typeof content !== 'string') return false;
  return GAME_SIGNAL.test(content) && KEY_LISTENER.test(content) && KEYBOARD_CONTROL.test(content) && !TOUCH_SIGNAL.test(content);
}

export function touchGameNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_TOUCH_GAME_NOTE ?? '').trim().toLowerCase() !== 'off';
}

/** The note, naming the file. PURE. */
export function touchPlayableNote(path: string): string {
  return `\n\n📱 MOBILE FIRST — ${path} drives the game from the KEYBOARD only, and most players hold a phone, where it cannot be played. `
    + 'Before this game is done, every control needs an on-screen touch equivalent, shown only on a touch screen '
    + '(`@media (pointer: coarse)` or `matchMedia`): a joystick or D-pad bottom-left, action buttons bottom-right (at least 56px, '
    + 'thumb-spaced, inside `env(safe-area-inset-*)`), a visible Pause button, multi-touch so moving and acting work together, '
    + 'and `touch-action: none` on the playfield. If this project uses the game shell (src/game/Game.ts), it already draws '
    + 'them — add any new action to `touchControls: { buttons: [...] }` instead of listening for a key only.';
}
