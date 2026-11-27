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
//
// 👕 THE ENEMIES' LOOK FROM THE GAME LIBRARY (build #2565, 2026-11-27: "@model:q7-ranger-man ko enemy bot"). A pick the user
// gave the enemies (libraryPicks.ts, role 'enemy') becomes ENEMIES.model — the subject the model is saved under in the game —
// and every enemy is dressed in it with the kit's own Entities.dress: the kit body stays until the model has loaded, and a
// model the game has not saved leaves the kit body, said in the console, never an invisible enemy.

import { libraryPicksIn } from './libraryPicks';

export const ENEMIES_FEATURE_PATH = 'src/game/features/enemies.ts';
export const FEATURES_INDEX_PATH = 'src/game/features/index.ts';

export interface EnemyRequest {
  count: number;
  ai: 'melee' | 'ranged' | 'flanker';
  health: number;
  damage: number;
  /** What the user called them: 'enemy', 'zombie', 'villain', 'bot' … (their kind). */
  kind: string;
  /** The library model they wear: its subject in the game, and its library id. Absent: the kit body. */
  model?: { subject: string; id: string };
}

const SUBJECT_RE = /^[\w -]{1,80}$/;
const LIBRARY_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,160}$/i;

/** The words that name enemies in a request (also read by libraryMention.ts to tell a pick meant for the enemies). */
export const ENEMY_WORDS = /\b(?:enem(?:y|ies)|dushman\w*|dushmn|villa(?:in|n)s?|villen\w*|vilan|bad\s*guys?|baddies|goons?|gunde?|gunda|badmash\w*|thugs?|bots?|zombies?|monsters?|rakshas\w*|demons?|attackers?|robots?\s+(?:jo|that|who))\b|दुश्मन|विलेन|ज़ॉम्बी|जॉम्बी|राक्षस|गुंडे|गुंडा/i;
const ADD_OR_HAVE = /\b(?:karo|kar\s*do|kardo|badhao|banao|bana|banaiye|daalo|dalo|add|lao|chahiye|chaahiye|spawn|put|make|create|bhejo|aaye|aayen|aa\s*jaye|hon|ho|hai|hain|with|wale|wala|jo|jisme|jaha|where|that|who|kill|maaro|maro|lado|fight|attack)\b|बनाओ|डालो|चाहिए|आएं|हों/i;
const NOT_WANTED = /\b(?:no|without|bina|nahi|nahin|mat|remove|hatao|hata\s*do|delete)\b[^.!?\n]{0,24}\b(?:enem(?:y|ies)|dushman|villa(?:in|n)|bots?|zombies?)\b|\b(?:enem(?:y|ies)|dushman|villa(?:in|n)|bots?|zombies?)\b[^.!?\n]{0,16}\b(?:nahi|nahin|mat|hatao|remove|delete)\b/i;
const NUMBER_WORDS: Record<string, number> = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5, chhe: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, bees: 20, twenty: 20 };

/** The enemies a request asks for, or null when it asks for none (or refuses them). PURE. */
// subjectOf turns a library id into the subject it is saved under. It is PASSED IN (the AgentV3 callers pass
// librarySubjectOf): a kit generator must not import the library catalogue, which drags the server's dependency tree into
// the kit-history bundle (#4618 CI). Without it, a pick is not resolved and the request falls back to its words.
export function enemyRequestFrom(prompt: string | null | undefined, subjectOf: (id: string) => string | null = () => null): EnemyRequest | null {
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
  // The look the user picked for them in the Game library, when the library holds it (an unknown id keeps the kit body).
  const pick = libraryPicksIn(text).find((p) => p.role === 'enemy');
  const subject = pick ? subjectOf(pick.id) : null;
  return { count, ai: ranged ? 'ranged' : flanker ? 'flanker' : 'melee', health, damage, kind, ...(pick && subject ? { model: { subject, id: pick.id } } : {}) };
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
  const m = v.model && typeof v.model === 'object' && !Array.isArray(v.model) ? v.model as Record<string, unknown> : null;
  const model = m && typeof m.subject === 'string' && SUBJECT_RE.test(m.subject) && typeof m.id === 'string' && LIBRARY_ID_RE.test(m.id) ? { subject: m.subject, id: m.id } : null;
  return {
    count: num(v.count, 1, 40, 6),
    ai: v.ai === 'ranged' || v.ai === 'flanker' ? v.ai : 'melee',
    health: num(v.health, 1, 1000, 60),
    damage: num(v.damage, 1, 100, 10),
    kind,
    ...(model ? { model } : {}),
  };
}

/** The feature file for those enemies (the user's file from then on). PURE. */
export function enemyFeatureSource(req: EnemyRequest): string {
  const shirt = req.kind === 'zombie' ? '0x5f7a4a' : req.kind === 'villain' ? '0x2b2b2b' : req.kind === 'bot' ? '0x7a8a99' : '0x8c2f2f';
  return [
    "// THIS GAME'S ENEMIES — written by NavBharatAI from the user's request. To change them, change ENEMIES below (how many at",
    '// once, how they fight, how tough). The kit\'s Entities (src/game/systems/entities.ts) spawns them around the hero on the',
    '// ground, walks them, fights, hurts the player, falls and removes them; a new wave comes when one is cleared.',
    "import * as THREE from 'three';",
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
    "  /** The library model they wear (its name in this game, e.g. 'ranger'), or null for the kit body. The game must have saved it",
    "   *  (add_library_models); one it has not saved leaves the kit body, and the console says so. */",
    `  model: ${req.model ? `'${req.model.subject.replace(/'/g, '')}'` : 'null'} as string | null,`,
    '};',
    '',
    'interface WornModel { root: THREE.Object3D; source?: string; update(dt: number): void; dispose?(): void; play?(role: string, fade?: number): boolean }',
    'type LibraryModels = { loadRequestedAsset?: (subject: string, fallback: () => WornModel) => Promise<WornModel> };',
    'interface Worn { entity: Entity; model: WornModel; at: THREE.Vector3; clip: string }',
    'interface EnemiesState { entities: Entities; wave: number; waitFor: number; worn: Worn[]; spawnWave(): Entity[] }',
    '',
    "/** The game's saved library models, when it has any. A game without the file has none — never a broken build. */",
    'function libraryModels(): Promise<LibraryModels | null> {',
    '  try {',
    "    const found = import.meta.glob('../three/assetModels.ts') as Record<string, () => Promise<LibraryModels>>;",
    '    const load = Object.values(found)[0];',
    '    return load ? load().catch(() => null) : Promise.resolve(null);',
    '  } catch { return Promise.resolve(null); }',
    '}',
    '',
    "/** Dress one enemy in ENEMIES.model with the kit's Entities.dress: the kit body stays until the model is there. */",
    'function wear(state: EnemiesState, entity: Entity): void {',
    '  const subject = ENEMIES.model;',
    '  if (!subject) return;',
    "  const none = (): WornModel => ({ root: new THREE.Group(), source: 'procedural', update() { /* nothing to move */ } });",
    '  const model = libraryModels().then((mod) => (mod?.loadRequestedAsset ? mod.loadRequestedAsset(subject, none) : null)).then((handle) => {',
    "    if (!handle || handle.source !== 'model') { handle?.dispose?.(); throw new Error('\"' + subject + '\" is not one of the models this game saved; add it from the game library'); }",
    "    state.worn.push({ entity, model: handle, at: entity.object.position.clone(), clip: '' });",
    '    return handle.root;',
    '  });',
    '  void state.entities.dress(entity, model);',
    '}',
    '',
    '/** Each worn model plays its own clips: walk while it moves, idle while it stands, die when it falls. */',
    'function animateWorn(state: EnemiesState, delta: number): void {',
    '  for (let i = state.worn.length - 1; i >= 0; i--) {',
    '    const w = state.worn[i];',
    '    if (!w.entity.object.parent) { w.model.dispose?.(); state.worn.splice(i, 1); continue; }',
    '    const moving = w.entity.object.position.distanceToSquared(w.at) > 1e-4;',
    '    w.at.copy(w.entity.object.position);',
    "    const clip = !w.entity.alive ? 'die' : moving ? 'walk' : 'idle';",
    '    if (clip !== w.clip) { w.clip = clip; w.model.play?.(clip); }',
    '    w.model.update(delta);',
    '  }',
    '}',
    '',
    'export default defineFeature<OpenWorld>({',
    "  id: 'enemies',",
    `  about: ['enemy', 'enemies', 'dushman', 'villain', 'villen', 'bot', 'bots', 'zombie', 'gunde', ${JSON.stringify(req.kind)}],`,
    '  setup(ctx, world): EnemiesState {',
    '    const entities = new Entities({ scene: ctx.scene, player: ctx.player, onStep: ctx.onStep }, { onAttack: (_e, amount) => damagePlayer(amount) });',
    '    const state: EnemiesState = {',
    '      entities, wave: 0, waitFor: 0, worn: [],',
    '      spawnWave() {',
    '        state.wave++;',
    '        const made = entities.spawnAround(ENEMIES.count, { kind: ENEMIES.kind, hostile: true, ai: ENEMIES.ai, health: ENEMIES.health, damage: ENEMIES.damage, body: { shirt: ENEMIES.shirt } }, { near: ENEMIES.near, far: ENEMIES.far });',
    '        // Each one moves with the big map\'s floating origin (world.place keeps it where it stands, on the ground).',
    '        for (const e of made) {',
    '          const origin = world.map.chunks?.origin ?? { x: 0, z: 0 };',
    '          world.place(e.object, e.object.position.x + origin.x, e.object.position.z + origin.z);',
    '          wear(state, e);',
    '        }',
    '        return made;',
    '      },',
    '    };',
    '    state.spawnWave();',
    '    return state;',
    '  },',
    '  update(_ctx, _world, delta, api) {',
    "    const s = api.get<EnemiesState>('enemies');",
    '    if (s) animateWorn(s, delta);',
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
    + ' A change the user asks for ("10 enemy", "zyada mushkil", "gun wale dushman", "waves band karo") is a change to the ENEMIES numbers at the top of that file.'
    + enemyModelHandoff(req);
}

/**
 * What the builder is told about the enemies' library look: they wear ENEMIES.model, and the game must hold that model.
 * '' when the user picked none. PURE.
 */
export function enemyModelHandoff(req: Pick<EnemyRequest, 'model'>): string {
  if (!req.model) return '';
  return ` 👕 THE ENEMIES WEAR THE LIBRARY MODEL THE USER PICKED (library id "${req.model.id}"): ENEMIES.model = '${req.model.subject}' in ${ENEMIES_FEATURE_PATH}, and each one is dressed in it by the kit's Entities.dress.`
    + ` If '${req.model.subject}' is not yet among this game's saved models (src/game/three/assetModels.ts), call add_library_models({ models: [{ id: "${req.model.id}" }] }) once — never draw a replacement by hand.`;
}
