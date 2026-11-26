// ENEMIES IN ONE STEP (admin 2026-11-26: "user kahe, enemy/bot/villen banao … abhi enemy bot nahi ban rahe hai. aap is ko
// 5-7 bar edit kar chuke bhi bhi game me enemy nahi aa rahe hai").
//
// 🔎 THE ROOT. The kit had every part of an enemy — Entities (spawn, verified; AI; walking capsule; Health; death; push
// apart), spawnAround (a ring around the player), the playtest's MISSING_ENEMIES proof — and NOTHING put them in a game.
// Each "enemy banao" asked the builder to assemble them by hand in the open world's features, and a weak builder got it
// wrong each time: the wrong import, the wrong host, spawned at a fixed centre far from the hero, never ticked.
//
// THE FIX. The platform writes the feature itself, at the start of the turn, from the user's words: how many, how they fight
// (melee / ranged / flanker), how tough, what they are called — src/game/features/enemies.ts, listed in the game's
// features, with any kit file it imports that the project lacks. Data at the top of the file is the user's to change
// ("10 enemy karo", "zyada mushkil"), and the builder is told the enemies are already in. PURE (strings in, strings out).

export const ENEMIES_FEATURE_PATH = 'src/game/features/enemies.ts';
export const FEATURES_INDEX_PATH = 'src/game/features/index.ts';

export interface EnemyRequest {
  count: number;
  ai: 'melee' | 'ranged' | 'flanker';
  health: number;
  damage: number;
  /** What the user called them: 'enemy', 'zombie', 'villain', 'bot' … (their kind). */
  kind: string;
}

const ENEMY_WORDS = /\b(?:enem(?:y|ies)|dushman\w*|dushmn|villa(?:in|n)s?|villen\w*|vilan|bad\s*guys?|baddies|goons?|gunde?|gunda|badmash\w*|thugs?|bots?|zombies?|monsters?|rakshas\w*|demons?|attackers?|robots?\s+(?:jo|that|who))\b|दुश्मन|विलेन|ज़ॉम्बी|जॉम्बी|राक्षस|गुंडे|गुंडा/i;
const ADD_OR_HAVE = /\b(?:karo|kar\s*do|kardo|badhao|banao|bana|banaiye|daalo|dalo|add|lao|chahiye|chaahiye|spawn|put|make|create|bhejo|aaye|aayen|aa\s*jaye|hon|ho|hai|hain|with|wale|wala|jo|jisme|jaha|where|that|who|kill|maaro|maro|lado|fight|attack)\b|बनाओ|डालो|चाहिए|आएं|हों/i;
const NOT_WANTED = /\b(?:no|without|bina|nahi|nahin|mat|remove|hatao|hata\s*do|delete)\b[^.!?\n]{0,24}\b(?:enem(?:y|ies)|dushman|villa(?:in|n)|bots?|zombies?)\b|\b(?:enem(?:y|ies)|dushman|villa(?:in|n)|bots?|zombies?)\b[^.!?\n]{0,16}\b(?:nahi|nahin|mat|hatao|remove|delete)\b/i;
const NUMBER_WORDS: Record<string, number> = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5, chhe: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, bees: 20, twenty: 20 };

/** The enemies a request asks for, or null when it asks for none (or refuses them). PURE. */
export function enemyRequestFrom(prompt: string | null | undefined): EnemyRequest | null {
  const text = String(prompt ?? '');
  if (!ENEMY_WORDS.test(text) || NOT_WANTED.test(text)) return null;
  // "a zombie movie on the TV" is not a request: the words must come with a wish or a game verb.
  if (!ADD_OR_HAVE.test(text)) return null;
  const m = ENEMY_WORDS.exec(text)!;
  const word = m[0].toLowerCase();
  const kind = /zomb|ज़ॉम्बी|जॉम्बी/.test(word) ? 'zombie' : /villa|villen|vilan|विलेन/.test(word) ? 'villain' : /\bbots?\b/.test(word) ? 'bot' : /goon|gunde|gunda|thug|badmash|गुंड/.test(word) ? 'goon' : /monster|demon|raksh|राक्षस/.test(word) ? 'monster' : 'enemy';
  const before = text.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
  const digit = /(\d{1,3})\s*$/.exec(before);
  const worded = /([a-z]+)\s*$/.exec(before);
  let count = digit ? Number(digit[1]) : worded && NUMBER_WORDS[worded[1]] ? NUMBER_WORDS[worded[1]] : /\b(?:bahut|bohot|many|lots?\s+of|saare|sare|bhaut)\b/i.test(text) ? 12 : 6;
  count = Math.max(1, Math.min(40, count));
  const ranged = /\b(?:gun|guns|bandook\w*|banduk\w*|shoot\w*|goli|ranged|sniper|archer|teer)\b/i.test(text);
  const flanker = /\b(?:flank\w*|ghere|gher\s*le|surround\w*|chaaron\s+taraf)\b/i.test(text);
  const hard = /\b(?:hard|mushkil|strong|taakatwar|takatwar|powerful|boss|khatarnak|dangerous)\b/i.test(text);
  const easy = /\b(?:easy|aasan|asaan|weak|kamzor)\b/i.test(text);
  const health = kind === 'zombie' ? 80 : hard ? 120 : easy ? 35 : 60;
  const damage = hard ? 16 : easy ? 5 : kind === 'zombie' ? 12 : 10;
  return { count, ai: ranged ? 'ranged' : flanker ? 'flanker' : 'melee', health, damage, kind };
}

/**
 * An enemy request handed in as tool input (the model may have edited it), checked and bounded — or null. PURE. Never
 * throws: a field out of range or of the wrong type is replaced by the default, an unknown fighting style is 'melee'.
 */
export function enemyRequestOf(value: unknown): EnemyRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  const kind = typeof v.kind === 'string' && /^[a-z][a-z -]{0,23}$/i.test(v.kind) ? v.kind.toLowerCase() : 'enemy';
  return {
    count: num(v.count, 1, 40, 6),
    ai: v.ai === 'ranged' || v.ai === 'flanker' ? v.ai : 'melee',
    health: num(v.health, 1, 1000, 60),
    damage: num(v.damage, 1, 100, 10),
    kind,
  };
}

/** The feature file for those enemies (the user's file from then on). PURE. */
export function enemyFeatureSource(req: EnemyRequest): string {
  const shirt = req.kind === 'zombie' ? '0x5f7a4a' : req.kind === 'villain' ? '0x2b2b2b' : req.kind === 'bot' ? '0x7a8a99' : '0x8c2f2f';
  return [
    "// THIS GAME'S ENEMIES — written by NavBharatAI from the user's request. To change them, change ENEMIES below (how many at",
    '// once, how they fight, how tough). The kit\'s Entities (src/game/systems/entities.ts) spawns them around the hero on the',
    '// ground, walks them, fights, hurts the player, falls and removes them; a new wave comes when one is cleared.',
    "import { defineFeature } from '../play/features';",
    "import { Entities, type Entity } from '../systems/entities';",
    "import type { OpenWorld } from '../play/openWorld';",
    "import { damagePlayer } from '../core/state';",
    '',
    'export const ENEMIES = {',
    `  kind: ${JSON.stringify(req.kind)},`,
    `  /** How many at once. */`,
    `  count: ${req.count},`,
    `  /** 'melee' walks up and hits; 'ranged' keeps its distance; 'flanker' comes round the side. */`,
    `  ai: ${JSON.stringify(req.ai)} as 'melee' | 'ranged' | 'flanker',`,
    `  health: ${req.health},`,
    `  /** Damage of one hit on the player. */`,
    `  damage: ${req.damage},`,
    '  /** A new wave when every one is down (false: only the first). */',
    '  waves: true,',
    '  /** Seconds between waves. */',
    '  waveGap: 4,',
    '  /** How far from the hero they appear, in metres. */',
    '  near: 16,',
    '  far: 38,',
    `  shirt: ${shirt},`,
    '};',
    '',
    'interface EnemiesState { entities: Entities; wave: number; waitFor: number; spawnWave(): Entity[] }',
    '',
    'export default defineFeature<OpenWorld>({',
    "  id: 'enemies',",
    `  about: ['enemy', 'enemies', 'dushman', 'villain', 'villen', 'bot', 'bots', 'zombie', 'gunde', ${JSON.stringify(req.kind)}],`,
    '  setup(ctx, world): EnemiesState {',
    '    const entities = new Entities({ scene: ctx.scene, player: ctx.player, onStep: ctx.onStep }, { onAttack: (_e, amount) => damagePlayer(amount) });',
    '    const state: EnemiesState = {',
    '      entities, wave: 0, waitFor: 0,',
    '      spawnWave() {',
    '        state.wave++;',
    '        const made = entities.spawnAround(ENEMIES.count, { kind: ENEMIES.kind, hostile: true, ai: ENEMIES.ai, health: ENEMIES.health, damage: ENEMIES.damage, body: { shirt: ENEMIES.shirt } }, { near: ENEMIES.near, far: ENEMIES.far });',
    '        // Each one moves with the big map\'s floating origin (world.place keeps it where it stands, on the ground).',
    '        for (const e of made) {',
    '          const origin = world.map.chunks?.origin ?? { x: 0, z: 0 };',
    '          world.place(e.object, e.object.position.x + origin.x, e.object.position.z + origin.z);',
    '        }',
    '        return made;',
    '      },',
    '    };',
    '    state.spawnWave();',
    '    return state;',
    '  },',
    '  update(_ctx, _world, delta, api) {',
    "    const s = api.get<EnemiesState>('enemies');",
    '    if (!s || !ENEMIES.waves) return;',
    '    if (s.entities.alive(ENEMIES.kind).length > 0) { s.waitFor = ENEMIES.waveGap; return; }',
    '    s.waitFor -= delta;',
    '    if (s.waitFor <= 0) { s.spawnWave(); s.waitFor = ENEMIES.waveGap; }',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * The game's features list with one more entry (its import and its place in FEATURES), or null when it is already listed
 * or the list is not in the kit's shape (then nothing is written on a guess). PURE.
 */
export function featuresIndexWith(index: string, name: string): string | null {
  const src = String(index ?? '');
  const importLine = `import ${name} from './${name}';`;
  if (src.includes(importLine)) return null;
  const list = /export const FEATURES: GameFeature<OpenWorld>\[\] = \[([\s\S]*?)\];/.exec(src);
  if (!list) return null;
  const body = list[1].replace(/\s+$/, '');
  const entry = body.trim() ? `${body}\n  ${name},\n` : `\n  ${name},\n`;
  const withList = src.slice(0, list.index) + `export const FEATURES: GameFeature<OpenWorld>[] = [${entry}];` + src.slice(list.index + list[0].length);
  // The import goes after the last import line.
  const lines = withList.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (/^import\s/.test(l)) last = i; });
  lines.splice(last + 1, 0, importLine);
  return lines.join('\n');
}

/** What the builder is told when the platform put the enemies in. PURE. */
export function enemiesAddedHandoff(req: EnemyRequest, added: string[]): string {
  return `👾 THE ENEMIES ARE ALREADY IN THE GAME: NavBharatAI wrote ${ENEMIES_FEATURE_PATH} (${req.count} ${req.kind}${req.count === 1 ? '' : 's'}, ${req.ai}, health ${req.health}, damage ${req.damage}, a new wave when one is cleared) and listed it in ${FEATURES_INDEX_PATH}`
    + (added.length ? `, with the kit files it needs (${added.join(', ')})` : '')
    + '. They spawn around the hero on the ground, chase and hit the player, and fall and disappear when killed. Do NOT write another enemy system, spawner or AI beside it.'
    + ' A change the user asks for ("10 enemy", "zyada mushkil", "gun wale dushman", "waves band karo") is a change to the ENEMIES numbers at the top of that file.';
}
