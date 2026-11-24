/**
 * 🎲 ANY RULE THE USER IMAGINES, MADE AS DATA (admin 2026-11-24: "navbharatai api call se user ki sabhi ulti sidhi
 * imagination ko real banaye").
 *
 * The rules the kit reads by itself (src/game/core/rules.ts and the Health in src/game/systems/combat.ts) have a small,
 * checked vocabulary: when an event happens (an enemy dies, an item is collected, the player is hurt or dies, the score
 * changes), add to the score, end the round or move to the next level; and how many hits kill an enemy or the player, and
 * how a hit enemy bleeds. A request in any words — "har 3 zombie marne par level badhe", "boss 20 goli me mare", "dushman
 * ko khoon nikle" — is turned into that vocabulary by ONE model call, validated by the same rules the kit applies, and
 * written to src/game/rules/<name>.ts, which the kit reads by itself. A request the vocabulary cannot hold is refused
 * honestly with what it can hold, so the builder writes that part as code. The same free model path as generate_stand_in.
 */
import { cleanCombatData, cleanGameRules, gameRulesFileText, type CombatRuleData, type GameRuleData } from '../../lib/GameRuntimeGenerator';
import { firstJson } from './composeAction';

export type RuleAsk = (prompt: string) => Promise<{ text: string } | null>;

const SHAPE = '{"name":"zombie-level","rules":[{"when":"ENEMY_DIED","then":{"addScore":10}},{"when":"SCORE_CHANGED","then":{"nextLevelEvery":30}}],"combat":{"enemyHitsToKill":5,"playerHitsToKill":3,"bleed":{"seconds":3,"perSecond":8}}}';

/** The vocabulary, said once — the prompt and the refusal both use it. */
export const RULE_VOCABULARY = 'when: ENEMY_DIED, ITEM_COLLECTED, PLAYER_DIED, PLAYER_DAMAGED or SCORE_CHANGED; then: addScore (points), gameOver (true) or nextLevelEvery (points); combat: enemyHitsToKill, playerHitsToKill, bleed { seconds, perSecond }';

/** The one prompt. PURE. */
export function rulePrompt(request: string): string {
  return [
    'Turn ONE game rule into JSON. No prose, no code.',
    `Shape: ${SHAPE}`,
    `Use only: ${RULE_VOCABULARY}. Leave out what the rule does not say; omit "rules" or "combat" when empty.`,
    'If the rule cannot be said with these, answer {"name":"none"}.',
    `Rule: ${String(request).slice(0, 240)}`,
  ].join('\n');
}

export type ComposedRule =
  | { kind: 'made'; name: string; rules: GameRuleData[]; combat: CombatRuleData; path: string; source: string; fromModel: boolean }
  | { kind: 'refused'; reason: string };

const slug = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** The supplied plan, else one model call. Never throws. */
export async function composeRule(request: string, ask: RuleAsk, supplied?: string, nameHint?: string): Promise<ComposedRule> {
  const text = String(request ?? '').trim();
  if (!text && !supplied) return { kind: 'refused', reason: 'Say the rule in a sentence (for example "the boss dies after 20 shots").' };
  let raw: unknown = null;
  let fromModel = false;
  if (supplied) raw = firstJson(supplied);
  else {
    const reply = await ask(rulePrompt(text)).catch(() => null);
    if (!reply) return { kind: 'refused', reason: 'The rule could not be designed right now (no model answered). Pass rule_json yourself in the same shape, or write the rule as code.' };
    raw = firstJson(reply.text);
    fromModel = true;
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as { name?: unknown; rules?: unknown; combat?: unknown };
  const rules = cleanGameRules(r.rules);
  const combat = cleanCombatData(r.combat);
  if (!rules.length && !Object.keys(combat).length) {
    return { kind: 'refused', reason: `This rule is not one the kit can run as data (it runs only: ${RULE_VOCABULARY}). Write this rule as code in the game instead; nothing was written.` };
  }
  const name = slug(typeof r.name === 'string' && r.name !== 'none' ? r.name : '') || slug(nameHint ?? '') || slug(text) || 'rule';
  return {
    kind: 'made', name, rules, combat, fromModel,
    path: `src/game/rules/${name}.ts`,
    source: gameRulesFileText(rules, combat, '../core/rules').replace(
      'written by NavBharatAI from your request.',
      `written by NavBharatAI from your request ("${text.slice(0, 120).replace(/[\r\n"]+/g, ' ')}").`,
    ),
  };
}
