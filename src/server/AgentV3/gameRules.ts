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

/** A rule as data for the kit's rules engine (src/game/core/rules.ts reads src/game/gameRules.ts). */
export interface GameRuleData { when: 'ENEMY_DIED' | 'ITEM_COLLECTED' | 'PLAYER_DIED' | 'SCORE_CHANGED'; then: { addScore?: number; gameOver?: boolean; nextLevelEvery?: number } }

/**
 * The rules the kit runs by itself, as data. A rule here is applied by the engine, so the builder only has to make the
 * game EMIT the event. enemy-hit-health-down has no data form: it is the wiring of a touch to damage(), which is the
 * game's own code.
 */
export const RULE_DATA: Readonly<Partial<Record<GameRuleId, GameRuleData>>> = {
  'enemy-dies-score-up': { when: 'ENEMY_DIED', then: { addScore: 10 } },
  'pickup-score-up': { when: 'ITEM_COLLECTED', then: { addScore: 5 } },
  'no-health-game-over': { when: 'PLAYER_DIED', then: { gameOver: true } },
  'score-level-up': { when: 'SCORE_CHANGED', then: { nextLevelEvery: 100 } },
};

/** The data rules for these contract rules, in order. PURE. */
export function gameRuleData(rules: readonly GameRule[]): GameRuleData[] {
  return rules.map((r) => RULE_DATA[r.id]).filter((d): d is GameRuleData => !!d).map((d) => ({ when: d.when, then: { ...d.then } }));
}

/** Said in each data rule's build line: the engine applies it, the game only emits the event. */
export const RULES_FILE_NOTE = 'src/game/gameRules.ts, when it exists, already applies this rule through src/game/core/rules.ts — the game only emits the event; never add a second listener for it (it would count twice), change the number in that file instead';

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
    howToBuild: `give each enemy a Health from src/game/systems/combat.ts (it emits ENEMY_DIED exactly once); ${RULES_FILE_NOTE}. Without that file, add events.on('ENEMY_DIED', () => addScore(10)) with addScore from src/game/core/state.ts` },
  { id: 'pickup-score-up', test: (s) => PICKUP.test(s) && SCORE.test(s) && RISE.test(s) && !ENEMY.test(s),
    said: 'collecting a pickup raises the score',
    howToBuild: `on the overlap of the player and a pickup, remove the pickup and emit ITEM_COLLECTED on events from src/game/core/events.ts; ${RULES_FILE_NOTE}. Without that file, call addScore from src/game/core/state.ts there too` },
  { id: 'enemy-hit-health-down', test: (s) => ENEMY.test(s) && TOUCH.test(s) && HEALTH.test(s) && FALL.test(s),
    said: 'an enemy that reaches the player takes away health or a life',
    howToBuild: 'give the player a Health from src/game/systems/combat.ts with invulnerable frames and diedEvent "PLAYER_DIED", and call its damage() when an enemy touches the player' },
  { id: 'no-health-game-over', test: (s) => HEALTH.test(s) && ZERO.test(s) && GAME_OVER.test(s),
    said: 'when health or lives run out, the game is over',
    howToBuild: `damagePlayer from src/game/core/state.ts emits PLAYER_DIED when health runs out; ${RULES_FILE_NOTE}. Without that file, set the status to 'gameover' with setStatus on PLAYER_DIED. Either way, show a play-again screen` },
  { id: 'score-level-up', test: (s) => SCORE.test(s) && LEVEL.test(s) && RISE.test(s),
    said: 'reaching a score moves the player to the next level',
    howToBuild: `${RULES_FILE_NOTE}; it moves state.level up every 100 points and emits LEVEL_UP. Make the next level harder on LEVEL_UP. Without that file, advance the level on SCORE_CHANGED yourself` },
];

/** The cause → effect rules the user stated, one per kind, in request order. PURE. */
export function gameRulesFrom(text: string | null | undefined): GameRule[] {
  const found = new Map<GameRuleId, GameRule>();
  for (const s of sentences(String(text ?? ''))) {
    for (const r of RULES) if (!found.has(r.id) && r.test(s)) found.set(r.id, { id: r.id, said: r.said, howToBuild: r.howToBuild });
  }
  return [...found.values()];
}

/** Combat rules as data, read by the kit's Health (src/game/systems/combat.ts). */
export interface GameCombatData { enemyHitsToKill?: number; playerHitsToKill?: number; bleed?: { seconds: number; perSecond: number } }

const NUM_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };
const HITS = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|chaa?r|paa?nch|chhe|saat|aath|nau|das)\s*(?:shots?|hits?|bullets?|goli(?:yon|yo)?|vaar|baar|punch(?:es)?|maar)\b/i;
const DIES = /\b(kill\w*|die\w*|dead|mar(?:e|na|ega|ta|ne|o)?|maro|khatam)\b|मर|ख़त्म|खत्म/i;
const PLAYER = /\b(player|me|mujhe|main|mera|hero|i\b)\b/i;
const BLEED = /\b(bleed\w*|blood\w*|khoon|khun)\b|खून|ख़ून/i;

/**
 * The combat rules a request states: "enemy 5 goli me mare" → enemyHitsToKill 5; "player 3 hit me mare" → playerHitsToKill
 * 3; "enemy ko bleeding karwao" → a 3 s bleed. Precision first: a number counts only next to a hit word in a sentence that
 * also names dying. PURE.
 */
export function gameCombatFrom(text: string | null | undefined): GameCombatData {
  const out: GameCombatData = {};
  for (const s of sentences(String(text ?? ''))) {
    const m = s.match(HITS);
    if (m && DIES.test(s)) {
      const raw = m[1].toLowerCase();
      const n = /^\d+$/.test(raw) ? Number(raw) : NUM_WORDS[raw.replace('chaar', 'char').replace('paanch', 'panch')] ?? NUM_WORDS[raw];
      if (n && n >= 1 && n <= 1000) {
        if (PLAYER.test(s) && !ENEMY.test(s)) { if (!out.playerHitsToKill) out.playerHitsToKill = n; }
        else if (!out.enemyHitsToKill) out.enemyHitsToKill = n;
      }
    }
    if (BLEED.test(s) && !out.bleed) out.bleed = { seconds: 3, perSecond: 8 };
  }
  return out;
}

/** The contract lines for the combat rules, or [] — said to the builder so it uses Health and calls tick(). PURE. */
export function gameCombatLines(c: GameCombatData): string[] {
  const lines: string[] = [];
  if (c.enemyHitsToKill) lines.push(`- an enemy dies on hit ${c.enemyHitsToKill}: give every enemy a Health from src/game/systems/combat.ts — the kit reads COMBAT in src/game/gameRules.ts and makes each hit 1/${c.enemyHitsToKill} of its health, whatever the weapon`);
  if (c.playerHitsToKill) lines.push(`- the player dies on hit ${c.playerHitsToKill}: give the player a Health with diedEvent "PLAYER_DIED"; the kit applies COMBAT.playerHitsToKill`);
  if (c.bleed) lines.push('- a hit enemy bleeds (blood, and health lost for a few seconds): the kit applies COMBAT.bleed — call each Health\'s tick(delta) every step, or the bleeding never runs');
  return lines;
}

/** Does this request need the kit's combat layer (health, damage, enemies, weapons)? PURE. */
export function wantsCombatKit(text: string | null | undefined, genre: string, features: readonly string[]): boolean {
  if (genre === 'shooter' || genre === 'fighting') return true;
  // Police / an ambulance come through systems/dispatch.ts (audit Part I): without the systems kit they could only be a sentence.
  if (features.includes('enemies') || features.includes('health') || features.includes('police')) return true;
  const c = gameCombatFrom(text);
  if (c.enemyHitsToKill || c.playerHitsToKill || c.bleed) return true;
  return gameRulesFrom(text).some((r) => r.id === 'enemy-dies-score-up' || r.id === 'enemy-hit-health-down');
}

/** The contract lines for the rules: each must happen in play, built with the kit's API. '' when none. PURE. */
export function gameRulesBlock(rules: readonly GameRule[]): string {
  if (!rules.length) return '';
  return ['Rules the user named — each must really HAPPEN when the game is played, not only be described:',
    ...rules.map((r) => `- ${r.said}: ${r.howToBuild}.`)].join('\n');
}
