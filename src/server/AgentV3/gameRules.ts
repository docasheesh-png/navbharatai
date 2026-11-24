/**
 * 🎮 THE RULES THE USER NAMED, KEPT AS RULES (admin 2026-11-24: "user kahta hai enemy add karo, jisko kill karne se score
 * bade, par navbharatai yeh nahi kar pata hai … hame game factory banna hai").
 *
 * The scope contract (gameIntent.ts) read a request as a list of FEATURES: `enemies`, `score`. The RELATION between them,
 * "killing an enemy raises the score", was dropped, so nothing told the builder to wire the one to the other and nothing
 * could check it later. A game is its rules. This reads the cause → effect pairs a user states and hands each one to the
 * builder with the kit's own API for it (src/game/systems/combat.ts emits ENEMY_DIED; src/game/core/state.ts has
 * addScore / damagePlayer), so a rule is built once, the same way, in every game.
 *
 * Precision first: a rule is read only when ONE sentence names both its cause and its effect. A sentence that names only
 * one of them is a feature, which the contract already carries. English, Hinglish and Hindi. PURE.
 */

export type GameRuleId = 'enemy-dies-score-up' | 'pickup-score-up' | 'enemy-hit-health-down' | 'no-health-game-over' | 'score-level-up';

export interface GameRule { id: GameRuleId; said: string; howToBuild: string }

const KILL = /\b(kill(?:s|ed|ing)?|destroy(?:s|ed|ing)?|defeat(?:s|ed|ing)?|shoot(?:s|ing)?|maar(?:o|na|ne|ke|a|e)?|mar(?:o|ne|ke)|khatam)\b|मार/i;
const ENEMY = /\b(enem(?:y|ies)|zombies?|monsters?|aliens?|boss(?:es)?|dushman|villains?|robots?)\b|दुश्मन|ज़ॉम्बी/i;
const SCORE = /\b(scores?|points?|ank)\b|स्कोर|अंक/i;
const RISE = /\b(increas\w*|go(?:es)? up|rais\w*|add\w*|gain\w*|badh\w*|bad(?:e|ega|ta)|mil\w*|\+\s*\d+)\b|बढ़|मिल/i;
const PICKUP = /\b(collect\w*|pick(?:s|ed|ing)? up|coins?|gems?|stars?|sikk[ae]|utha\w*)\b|सिक्क|इकट्ठ/i;
const TOUCH = /\b(touch\w*|hit(?:s|ting)?|attack\w*|bite\w*|chhu\w*|lag(?:e|ta|ne)|takra\w*)\b|छू|टकरा/i;
const HEALTH = /\b(health|hp|li(?:fe|ves)|jaan)\b|जान|हेल्थ/i;
const FALL = /\b(decreas\w*|go(?:es)? down|los[es]|drop\w*|reduc\w*|kam|ghat\w*)\b|कम|घट/i;
const ZERO = /\b(zero|0|ends?|over|khatam|runs? out|empty)\b|ख़त्म|खत्म/i;
const GAME_OVER = /\b(game ?over|lose|loses|lost|haar\w*|out)\b|हार/i;
const LEVEL = /\b(next level|level up|levels?)\b|लेवल/i;

/** The sentences of a request: split on . ! ? । and newlines. */
function sentences(text: string): string[] {
  return String(text ?? '').split(/[.!?।\n]+/).map((s) => s.trim()).filter(Boolean);
}

const RULES: ReadonlyArray<{ id: GameRuleId; test: (s: string) => boolean; said: string; howToBuild: string }> = [
  { id: 'enemy-dies-score-up', test: (s) => KILL.test(s) && ENEMY.test(s) && SCORE.test(s) && RISE.test(s),
    said: 'when an enemy is killed, the score goes up',
    howToBuild: "give each enemy a Health from src/game/systems/combat.ts (it emits ENEMY_DIED exactly once) and add events.on('ENEMY_DIED', () => addScore(10)) with addScore from src/game/core/state.ts" },
  { id: 'pickup-score-up', test: (s) => PICKUP.test(s) && SCORE.test(s) && RISE.test(s) && !ENEMY.test(s),
    said: 'collecting a pickup raises the score',
    howToBuild: 'on the overlap of the player and a pickup, remove the pickup and call addScore from src/game/core/state.ts' },
  { id: 'enemy-hit-health-down', test: (s) => ENEMY.test(s) && TOUCH.test(s) && HEALTH.test(s) && FALL.test(s),
    said: 'an enemy that reaches the player takes away health or a life',
    howToBuild: 'give the player a Health from src/game/systems/combat.ts with invulnerable frames and diedEvent "PLAYER_DIED", and call its damage() when an enemy touches the player' },
  { id: 'no-health-game-over', test: (s) => HEALTH.test(s) && ZERO.test(s) && GAME_OVER.test(s),
    said: 'when health or lives run out, the game is over',
    howToBuild: "on PLAYER_DIED (or lives reaching 0) set the game status to 'gameover' through src/game/core/state.ts, and show a play-again screen" },
  { id: 'score-level-up', test: (s) => SCORE.test(s) && LEVEL.test(s) && RISE.test(s),
    said: 'reaching a score moves the player to the next level',
    howToBuild: "on SCORE_CHANGED, advance the level when the score passes the level's target, and make the next level harder" },
];

/** The cause → effect rules the user stated, one per kind, in request order. PURE. */
export function gameRulesFrom(text: string | null | undefined): GameRule[] {
  const found = new Map<GameRuleId, GameRule>();
  for (const s of sentences(String(text ?? ''))) {
    for (const r of RULES) if (!found.has(r.id) && r.test(s)) found.set(r.id, { id: r.id, said: r.said, howToBuild: r.howToBuild });
  }
  return [...found.values()];
}

/** Does this request need the kit's combat layer (health, damage, enemies, weapons)? PURE. */
export function wantsCombatKit(text: string | null | undefined, genre: string, features: readonly string[]): boolean {
  if (genre === 'shooter' || genre === 'fighting') return true;
  if (features.includes('enemies') || features.includes('health')) return true;
  return gameRulesFrom(text).some((r) => r.id === 'enemy-dies-score-up' || r.id === 'enemy-hit-health-down');
}

/** The contract lines for the rules: each must happen in play, built with the kit's API. '' when none. PURE. */
export function gameRulesBlock(rules: readonly GameRule[]): string {
  if (!rules.length) return '';
  return ['Rules the user named — each must really HAPPEN when the game is played, not only be described:',
    ...rules.map((r) => `- ${r.said}: ${r.howToBuild}.`)].join('\n');
}
