/**
 * 🧍 THE MOVES A PLAYER CHARACTER CAN HAVE, AND HOW A MODEL'S OWN CLIP IS FOUND FOR EACH (admin 2026-11-22: "Use as my
 * character" must work for every game). ONE table, read by two places that must never disagree:
 *   - the game kit's src/game/play/playerBody.ts (GamePlayerBodyGenerator.ts emits this table into it), which plays the
 *     user's model's own clip for each move and says on screen which move the model lacks;
 *   - the server, which tells the builder — before the game runs — which moves a library or attached model has, so the
 *     user hears it in plain words instead of discovering a boxer that cannot punch.
 * The kit carries its own copy of clipForMove (kit files are plain TypeScript with no import from the server); the census
 * in tests/theUsersCharacterJoinsEveryGame.test.ts runs both over the same clip names and fails if they ever drift. PURE.
 */

export const PLAYER_MOVES = ['idle', 'walk', 'run', 'jump', 'land', 'punch', 'kick', 'block', 'hit', 'die', 'fire', 'swing', 'throw', 'use', 'slide'] as const;
export type PlayerMoveName = typeof PLAYER_MOVES[number];

/** The words a clip name carries for each move, most specific first. Matched per word of the name (camelCase split). */
export const PLAYER_MOVE_WORDS: Readonly<Record<PlayerMoveName, readonly string[]>> = Object.freeze({
  idle: ['idle', 'stand', 'breath'],
  walk: ['walk'],
  run: ['run', 'sprint', 'jog'],
  jump: ['jump'],
  land: ['land'],
  punch: ['punch', 'jab', 'hook', 'uppercut', 'strike'],
  kick: ['kick'],
  block: ['block', 'guard', 'defend', 'parry'],
  hit: ['hit', 'hurt', 'damage', 'react', 'flinch'],
  die: ['death', 'die', 'dying', 'dead', 'knockout', 'ko'],
  fire: ['shoot', 'fire'],
  swing: ['swing', 'slash', 'sword', 'melee', 'attack', 'chop'],
  throw: ['throw'],
  use: ['interact', 'use', 'pickup', 'pick', 'gather'],
  slide: ['slide', 'roll', 'crouch', 'duck'],
});

/** "CharacterArmature|Punch_Right" → ['character', 'armature', 'punch', 'right']. */
export function clipWords(name: string): string[] {
  return String(name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/**
 * The model's own clip for a move, or null when it has none. `chosen` (PLAYER.moves[move]) wins when the model has it.
 * The shortest matching name wins ("Run" over "Run_Back"); a word of three letters or more also matches as a prefix
 * ("Running", "Punching").
 */
export function clipForMove(names: readonly string[], move: PlayerMoveName, chosen?: string): string | null {
  if (chosen && names.includes(chosen)) return chosen;
  const ranked = [...names].sort((a, b) => clipWords(a).length - clipWords(b).length);
  for (const word of PLAYER_MOVE_WORDS[move] ?? []) {
    const hit = ranked.find((n) => clipWords(n).some((w) => w === word || (word.length >= 3 && w.startsWith(word))));
    if (hit) return hit;
  }
  return null;
}

/** Which moves a set of clip names covers, and which it does not. 'land' is a settle pose, never reported missing. */
export function playerMovesOf(names: readonly string[]): { has: Array<{ move: PlayerMoveName; clip: string }>; lacks: PlayerMoveName[] } {
  const has: Array<{ move: PlayerMoveName; clip: string }> = [];
  const lacks: PlayerMoveName[] = [];
  for (const move of PLAYER_MOVES) {
    const clip = clipForMove(names, move);
    if (clip) has.push({ move, clip });
    else if (move !== 'land') lacks.push(move);
  }
  return { has, lacks };
}

/** One plain line for the builder: what the character can do, and what it cannot (so the user is told). PURE. */
export function playerMovesLine(has: readonly string[], lacks: readonly string[]): string {
  if (!has.length) return 'it has NO animations of its own, so it moves without walking or posing — tell the user that plainly';
  return `its own moves: ${has.join(', ')}`
    + (lacks.length ? `; it has NO ${lacks.join(', ')} — those moves are not animated (the game says so on screen), so tell the user which moves their character lacks` : '');
}
