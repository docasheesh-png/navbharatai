// THE GROWTH GUARD — "add one thing" can never rewrite the things already there (admin 2026-11-21: "'baaki files ko mat
// chhuo' abhi nirdesh hai, kamzor AI kabhi-kabhi ise tod sakta hai … isko ROCKSOLID karo").
//
// 🔑 WHY A RULE IN THE PROMPT WAS NOT ENOUGH. GAME_FEATURES_RULE / GAME_WORLD_RULE tell the builder that a game grows by
// one new feature file and one line, and that the other features, the places already on the map, src/App.tsx and the kit
// are not touched for a request that does not name them. That is an instruction to a model, and a weak model breaks
// instructions. 🧬 THE CLASS: an invariant of the user's project that only a prompt defends.
//
// TWO LOCKS, both deterministic, both from the same PURE verdict below:
//   1. AT THE WRITE (ToolDispatcher): write_file / edit_file / delete of a protected file the request does not name is
//      refused with the reason and what to do instead, so the builder corrects course in the same turn.
//   2. AT THE END OF THE TURN (routes/agentv3.ts): whatever the door — a shell command, a script, a tool that has no guard —
//      every protected file is compared with its content at the start of the turn; a change the request did not ask for
//      is PUT BACK (a dropped feature or place is re-listed, keeping what the turn legitimately added), and the report and
//      the user are told. This lock does not depend on the builder at all.
//
// What "the request names it" means is decided here, in one place, from the user's own words: the feature's or place's id
// (its words), a request about everything ("sab", "poora game"), or a repair ("fix", "theek karo") for edits; removing a
// thing always needs a removal word AND its name. Kill switch: AGENTV3_GROWTH_GUARD=off.
import { recipeFilePool } from '../lib/gameRecipeLayers';
import { PART_NAMES_FILE, partKnowledge, requestMeans, kitPartVocabulary, kitPartOwnName, type PartKnowledge } from './partMeaning';

export const FEATURES_INDEX = 'src/game/features/index.ts';
export const WORLD_FILE = 'src/game/world.ts';
export const APP_FILE = 'src/App.tsx';
const FEATURE_FILE = /^src\/game\/features\/[^/]+\.tsx?$/;

export function growthGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GROWTH_GUARD ?? '').trim().toLowerCase() !== 'off';
}

/** A project is under the guard once it has a features list or a map file of its own. PURE. */
export function growsByLists(filesAtTurnStart: Readonly<Record<string, string>> | null | undefined): boolean {
  return !!filesAtTurnStart && (typeof filesAtTurnStart[FEATURES_INDEX] === 'string' || typeof filesAtTurnStart[WORLD_FILE] === 'string');
}

const norm = (s: string): string => String(s ?? '').normalize('NFKC').toLowerCase();
const words = (s: string): string[] => norm(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
/** 'missionDelivery' / 'mission-delivery' / 'old_town' → ['mission', 'delivery'] / ['old', 'town']. */
export function nameTokens(id: string): string[] {
  return String(id ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}
const GENERIC = new Set(['game', 'feature', 'features', 'index', 'main', 'new', 'the', 'and', 'for', 'city', 'town', 'village', 'world', 'map', 'system', 'manager', 'controller']);

/**
 * What the guard knows about the game's parts this turn — set once from the project as it was when the turn began
 * (partMeaning.ts: each part's id, its own `about` list, the user's own words for it, and words that mean the same).
 */
export type PartsKnown = ReadonlyMap<string, PartKnowledge>;
export function partsKnown(filesAtTurnStart: Readonly<Record<string, string>> | null | undefined): PartsKnown {
  return filesAtTurnStart ? partKnowledge(filesAtTurnStart) : new Map();
}
/** Is the request about this part — by its name, or by what the user MEANS (partMeaning.requestMeans)? PURE. */
export function requestIsAbout(request: string, id: string, known?: PartsKnown): boolean {
  if (requestNames(request, id)) return true;
  const mine = known?.get(id);
  const vocabulary = mine ? mine.vocabulary : [id.replace(/([a-z0-9])([A-Z])/g, '$1 $2')];
  const others = known ? [...known].filter(([other]) => other !== id).map(([, k]) => k.vocabulary) : [];
  return requestMeans(request, vocabulary, others);
}

/** Does the request talk about this thing? Its id's own words (not the generic ones every game has) appear in the request. PURE. */
export function requestNames(request: string, id: string): boolean {
  const req = words(request);
  const tokens = nameTokens(id);
  const telling = tokens.filter((t) => !GENERIC.has(t));
  const use = telling.length ? telling : tokens;
  if (!use.length) return false;
  return use.some((t) => req.some((w) => w === t || (w.length >= 4 && (w.startsWith(t) || t.startsWith(w)))));
}

const ABOUT_EVERYTHING = /\b(?:all|every|everything|whole|entire|overall|sab|sabhi|saare|sare|saari|sari|poora|poori|pura|puri|har)\b/i;
const REPAIR = /\b(?:fix|fixes|fixed|bug|bugs|error|errors|broken|crash\w*|not\s+working|doesn'?t\s+work|theek|thik|sahi\s+kar\w*|nahi\s+chal\w*|kaam\s+nahi|kharab)\b/i;
const REMOVAL = /\b(?:remove|removes|removed|delete|deletes|deleted|drop|hata\w*|nikal\w*|mita\w*|band\s+kar\w*|khatam\s+kar\w*)\b/i;

/**
 * 🔓 WHEN A CHANGE REALLY IS NEEDED (admin 2026-11-21: "agar file ka badalna sach me zaruri hua to? user ko kuch aur
 * chahiye?"). The guard never decides FOR the user that a working part may be changed — and never leaves them stuck:
 * the turn ends by naming what it would have needed to change (growthAskNote), and the user opens it in their own words —
 * by naming the part ("police bhi badlo"), or by saying the builder may change whatever it needs ("jo zaroori ho badal
 * do", "allow"). That is a decision the user makes knowingly, once, for that turn.
 */
const PERMIT = /\b(?:allow|allowed|permit|permission|go\s+ahead|ijaz+at|anumati|badal(?:ne)?\s+do|badal\s+sakte|chhed\s+sakte|jo\s+(?:bhi\s+)?zar+oo?ri|zar+oo?rat\s+ho\s+to|whatever\s+(?:is\s+)?need\w*|as\s+needed|if\s+needed)\b/i;
/**
 * 🔓 A FREE HAND, IN THE USER'S OWN WORDS (admin 2026-11-22: "user koi bhi game banaye kuch bhi edit/update karwa sake").
 * "jo chahe badlo", "jaisa theek lage waisa karo", "apne hisaab se", "change whatever you want", "feel free" hand the
 * builder the choice of WHAT to change — PERMIT only knew "allow" and "jo zaroori ho". Before 2026-11-22 these opened
 * nothing (or, for "theek lage", only by the accident that "theek" is also a repair word). A free hand opens EDITS
 * everywhere, the kit included; it never opens a removal (that still takes a removal word and a name, or a whole-game
 * replacement below). What to change is still the builder's to ask when the request says nothing (GAME_NO_GUESS_RULE).
 */
const FREE_HAND = /(?:\bjo\s+(?:bhi\s+)?(?:chahe|chaho|chahiye\s+wo|marzi|man\s+kare|theek\s+lage|thik\s+lage|sahi\s+lage|accha\s+lage|achha\s+lage|acha\s+lage)\b|\bjaisa\s+(?:bhi\s+|aapko\s+|tumhe\s+)?(?:chahe|chaho|theek|thik|sahi|accha|achha|acha)\b|\bapne\s+(?:hisaab|hisab|man|tareeke|tarike)\s+se\b|\bkuch\s+bhi\s+(?:badal|change|edit|kar)\w*|\bfree\s+hand\b|\bfeel\s+free\b|\b(?:change|edit|do|modify)\s+(?:whatever|anything)\b|\bwhatever\s+you\s+(?:want|like|think|feel)\b|\banything\s+you\s+(?:want|like)\b|\bup\s+to\s+you\b|\byour\s+(?:choice|call)\b)/i;

/**
 * 🔄 THE WHOLE GAME (OR THE WHOLE MAP) REPLACED — "poora game badal do, ab racing game banao", "sab kuch hata ke naya game
 * banao", "redo the whole game from scratch", "poora world badal do". Before 2026-11-22 a removal needed a removal word AND
 * the name of every part, so a request to replace the whole game had every old feature, place and the old mount PUT BACK
 * at the end of the turn: the one request that is about everything was the one the guard never let through. A whole-scope
 * word + a replace verb, or "from scratch", is that request; anything less (a "sab" about a quantity — "sab cars ko lal
 * karo") is not. PURE.
 */
const WHOLE = String.raw`(?:poora|poori|pura|puri|pure|poore|saara|sara|saari|sari|whole|entire|complete|full)`;
const REPLACE_VERB = String.raw`(?:badal\w*|change\w*|replace\w*|redo|rewrite\w*|remake|rebuild|dobara\s+bana\w*|phir\s+se\s+bana\w*|hata\w*|remove\w*|delete\w*|scrap\w*)`;
/** The scope noun must be the OBJECT of the verb, never a possessive ("poore game KA colour badlo" changes a colour). */
const NOT_POSSESSED = String.raw`(?!\s*'s\b|\s+(?:ka|ki|ke|me|mein|main|par|pe|of|for|in)\b)`;
const FROM_SCRATCH = /\b(?:from\s+scratch|scratch\s+se|start\s+over|shuru\s+se\s+(?:bana|likh)\w*|naye\s+sire\s+se)\b/i;
/**
 * A follow-up that changes the KIND of game ("make this a platformer", "genre badal do"). It is a whole-game
 * replacement: the starter, the mount and the old parts may all change. A request that only uses a genre word
 * as a detail ("add a racing car", "make it faster") is not one.
 */
const GENRE_NAME = String.raw`platformer|shooter|racer|racing|puzzle|runner|arcade|rpg|strategy|simulator|fighting|quiz|board|card|sports|snake`;
const GENRE_SWAP = new RegExp(String.raw`\b(?:make|turn|convert)\s+(?:it|this|the game)\s+(?:into\s+)?(?:a|an)\s+(?:different\s+)?(?:${GENRE_NAME})\b|\b(?:change|switch)\s+(?:the\s+)?genre\b|\bgenre\s+(?:ko\s+)?(?:badal|change|switch)\w*|\b(?:ise|isko|isey)\s+(?:ek\s+)?(?:${GENRE_NAME})\s+(?:game\s+)?bana\s*do\b|\b(?:different|another|dusra|doosra)\s+genre\b`, 'i');
export function changesGenre(request: string): boolean {
  return GENRE_SWAP.test(String(request ?? ''));
}
const EVERYTHING_REPLACED = /\b(?:sab\s+kuch|sabkuch|har\s+cheez|har\s+chiz|everything)\s+(?:ko\s+)?(?:badal\w*|change\w*|replace\w*|hata\w*|remove\w*|delete\w*|redo|rewrite\w*)\b|\b(?:change|replace|redo|rewrite|remove|delete)\s+everything\b(?!\s+(?:about|in|of)\b)/i;
const NEW_GAME_INSTEAD = /\b(?:naya|nayi|new|dusra|doosra|another|different)\s+(?:\w+\s+){0,2}(?:game|khel)\b[\s\S]{0,40}?\b(?:ki\s+jagah|instead)\b|\b(?:purana|old)\s+(?:wala\s+)?(?:game|khel)\s+(?:\w+\s+)?(?:hata\w*|remove\w*|delete\w*|band)\b/i;
function wholeScopeReplaced(request: string, scope: string): boolean {
  const hindi = new RegExp(String.raw`\b${WHOLE}\s+(?:ka\s+(?:poora|pura)\s+)?${scope}\b${NOT_POSSESSED}\s+(?:\w+\s+){0,2}?(?:ko\s+)?${REPLACE_VERB}\b`, 'i');
  const english = new RegExp(String.raw`\b${REPLACE_VERB}\s+(?:the\s+|my\s+|this\s+)?${WHOLE}\s+${scope}\b${NOT_POSSESSED}`, 'i');
  return hindi.test(request) || english.test(request);
}
/** Does the request replace the WHOLE game — its features, its map and the way it starts? PURE. */
export function replacesWholeGame(request: string): boolean {
  const r = String(request ?? '');
  return FROM_SCRATCH.test(r) || EVERYTHING_REPLACED.test(r) || NEW_GAME_INSTEAD.test(r) || changesGenre(r) || wholeScopeReplaced(r, String.raw`(?:game|project|app|khel)`);
}
/** Does the request replace the WHOLE map (every place on it)? A whole game replaced replaces its map too. PURE. */
export function replacesWholeMap(request: string): boolean {
  return replacesWholeGame(request) || wholeScopeReplaced(String(request ?? ''), String.raw`(?:world|map|duniya|duniyan|naksha|zameen|jameen)`);
}

/** May this turn EDIT an existing feature / place? PURE. */
export function mayEdit(request: string, id: string, known?: PartsKnown): boolean {
  return requestIsAbout(request, id, known) || ABOUT_EVERYTHING.test(request) || REPAIR.test(request) || PERMIT.test(request) || FREE_HAND.test(request);
}
/** May this turn REMOVE it? When the user asks to remove it by name or meaning, or replaces the whole game. PURE. */
export function mayRemove(request: string, id: string, known?: PartsKnown): boolean {
  return (REMOVAL.test(request) && requestIsAbout(request, id, known)) || replacesWholeGame(request);
}
/** May this turn remove a PLACE of the map? As a feature, or when the whole map is replaced. PURE. */
export function mayRemovePlace(request: string, id: string): boolean {
  return mayRemove(request, id) || replacesWholeMap(request);
}

/**
 * 🔓 THE KIT IS THE USER'S TOO, WHEN THEY ASK (admin 2026-11-22). Before, a kit file was refused for EVERY request — "apna
 * camera chahiye", "joystick bada karo", "traffic kam karo" were refused at the write and put back at the end of the turn,
 * and the user was told "the game engine itself is never edited". The kit files of a game are copies in that game's own
 * project (an edited one is never overwritten by a kit refresh: gameRecipeLayers.ts keeps "somebody's code"), so changing
 * one changes that game only. A kit part opens when the request is about it (partMeaning.kitPartVocabulary: its name, or
 * what it does), on a free hand or an explicit permission, or when the whole game is replaced. It stays shut for a request
 * that does not touch it — a repair ("fix karo") or "sab" alone never opens the engine under every feature. PURE.
 */
export function mayEditKit(request: string, path: string): boolean {
  return requestMeans(request, kitPartVocabulary(path)) || PERMIT.test(request) || FREE_HAND.test(request) || replacesWholeGame(request);
}
/** May this turn DELETE a kit file? Only when the request removes that part by name, or replaces the whole game. PURE. */
export function mayRemoveKit(request: string, path: string): boolean {
  return (REMOVAL.test(request) && requestMeans(request, kitPartVocabulary(path))) || replacesWholeGame(request);
}

/**
 * 🔓 THE WAY THE GAME STARTS (src/App.tsx's <OpenWorldGame … />) may stop being the open world only when the user asks for
 * that: the whole game replaced, or the open world / big map itself removed or swapped for their own ("OpenWorldGame hata
 * do, apna 2D game likho", "map hatao", "mera khud ka world banao"). Before 2026-11-22 the mount was put back whatever the
 * request said. PURE.
 */
const MOUNT = String.raw`(?:open\s*world(?:\s*game)?|openworldgame|big\s+map|bada\s+map|map|world|duniya|naksha|engine)`;
const UNMOUNT = [
  // "map hata do", "OpenWorldGame ko hatao", "open world band karo"
  new RegExp(String.raw`\b${MOUNT}\s+(?:ko\s+|bhi\s+|wala\s+)?(?:hata\w*|nikal\w*|band\s+kar\w*|remove\w*|delete\w*)`, 'i'),
  // "remove the open world", "delete the map"
  new RegExp(String.raw`\b(?:remove|delete|drop|replace)\s+(?:the\s+|this\s+)?(?:big\s+)?${MOUNT}\b`, 'i'),
  // "apna khud ka world", "my own world / engine", "custom map", "map ki jagah …", "instead of the open world"
  new RegExp(String.raw`\b(?:apna|apni|khud\s+ka|khud\s+ki|my\s+own|our\s+own|custom)\s+(?:khud\s+ka\s+)?${MOUNT}\b${NOT_POSSESSED}`, 'i'),
  new RegExp(String.raw`\b${MOUNT}\s+ki\s+jagah\b|\binstead\s+of\s+(?:the\s+)?(?:big\s+)?${MOUNT}\b`, 'i'),
];
export function mayUnmount(request: string): boolean {
  const r = String(request ?? '');
  return replacesWholeGame(r) || UNMOUNT.some((re) => re.test(r));
}

const featureIdOf = (path: string): string => (path.split('/').pop() || '').replace(/\.tsx?$/, '');

// ── the features list ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface FeatureList { imports: Array<{ name: string; line: string }>; listed: string[] }
/** The imports and the identifiers listed in FEATURES. null when the file is not in the shape the platform wrote. PURE. */
export function parseFeatureList(source: string): FeatureList | null {
  const text = String(source ?? '');
  const m = /export\s+const\s+FEATURES\b[^=]*=\s*\[([\s\S]*?)\]\s*;?/.exec(text);
  if (!m) return null;
  const listed = m[1].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  const imports: FeatureList['imports'] = [];
  for (const line of text.split(/\r?\n/)) {
    const im = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/[^'"]+['"]\s*;?\s*$/.exec(line);
    if (im) imports.push({ name: im[1], line: line.trim() });
  }
  return { imports, listed };
}

/** The features list with every entry `before` had and the request did not ask to remove put back. null = nothing to repair. PURE. */
export function repairFeatureList(before: string, after: string | null, request: string, known?: PartsKnown): string | null {
  const b = parseFeatureList(before);
  if (!b) return null;                               // not our shape before the turn: not ours to judge
  const a = after === null ? null : parseFeatureList(after);
  if (!a) return before;                             // deleted, or no longer a list: the list as it was
  const missing = b.listed.filter((name) => !a.listed.includes(name) && !mayRemove(request, name, known));
  if (missing.length === 0) return null;
  let out = after as string;
  for (const name of missing) {
    const imp = b.imports.find((i) => i.name === name);
    if (imp && !a.imports.some((i) => i.name === name)) {
      const lastImport = [...out.matchAll(/^\s*import\s[^\n]*$/gm)].pop();
      const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
      out = `${out.slice(0, at)}${at ? '\n' : ''}${imp.line}${at ? '' : '\n'}${out.slice(at)}`;
    }
  }
  out = out.replace(/(export\s+const\s+FEATURES\b[^=]*=\s*\[)([\s\S]*?)(\]\s*;?)/, (_all, open: string, body: string, close: string) => {
    const kept = body.replace(/\s+$/, '');
    const sep = kept.trim() === '' || /,\s*$/.test(kept) ? '' : ',';
    return `${open}${kept}${sep}\n${missing.map((n) => `  ${n},`).join('\n')}\n${close}`;
  });
  return out;
}

// ── the map's places ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RegionEntry { id: string; text: string }
/** Each `{ id: '…', … }` entry of WORLD.regions, with its exact text. null when there is no regions list. PURE. */
export function parseRegions(source: string): RegionEntry[] | null {
  const text = String(source ?? '');
  const start = /\bregions\s*:\s*\[/.exec(text);
  if (!start) return null;
  const out: RegionEntry[] = [];
  let depth = 0, entryAt = -1;
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) entryAt = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && entryAt >= 0) {
        const entry = text.slice(entryAt, i + 1);
        const id = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(entry);
        if (id) out.push({ id: id[1], text: entry });
        entryAt = -1;
      }
    } else if (ch === ']' && depth === 0) return out;
  }
  return null;                                         // unbalanced: not a list we can read
}

/** The map file with every place `before` had and the request did not ask to remove put back. null = nothing to repair. PURE. */
export function repairWorld(before: string, after: string | null, request: string): string | null {
  const b = parseRegions(before);
  if (!b) return null;
  const a = after === null ? null : parseRegions(after);
  if (!a) return before;
  const missing = b.filter((r) => !a.some((x) => x.id === r.id) && !mayRemovePlace(request, r.id));
  if (missing.length === 0) return null;
  return (after as string).replace(/(\bregions\s*:\s*\[)/, (_all, open: string) => `${open}\n${missing.map((r) => `    ${r.text},`).join('\n')}`);
}

// ── the mount ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const MOUNT_PARTS = ['<OpenWorldGame', 'features={FEATURES}', 'world={WORLD}', 'player={PLAYER}'] as const;
/** The game's own player (look, or a library character). Changed freely; never deleted — the mount reads it. */
export const PLAYER_FILE = 'src/game/player.ts';
/** The parts of the platform's mount that `before` had and `after` lost. PURE. */
export function lostMount(before: string, after: string | null): string[] {
  if (!before.includes('<OpenWorldGame')) return [];
  return MOUNT_PARTS.filter((part) => before.includes(part) && !(after ?? '').includes(part));
}

let kitPaths: Set<string> | null = null;
/** A file the game kit owns (written by a recipe). */
export function isKitFile(path: string): boolean {
  if (!kitPaths) kitPaths = new Set(recipeFilePool().keys());
  return kitPaths.has(path);
}

export interface GrowthVerdict { allow: boolean; reason?: string; restore?: string }

/**
 * THE ONE VERDICT, for one file: may it be `after` at the end of this turn, given what it was at the start?
 * `after === null` means deleted. `platformWrote` is what the PLATFORM itself wrote there this turn (a kit refresh, a
 * recipe) — never a violation. When not allowed, `restore` is the content to put there. PURE.
 */
export function growthVerdict(input: { path: string; before: string | undefined; after: string | null; request: string; platformWrote?: string | null; known?: PartsKnown }): GrowthVerdict {
  const { path, before, after, request, known } = input;
  if (typeof before !== 'string') return { allow: true };            // new this turn: adding is how a game grows
  if (after === before) return { allow: true };
  if (input.platformWrote != null && after === input.platformWrote) return { allow: true };

  if (path === FEATURES_INDEX) {
    const fixed = repairFeatureList(before, after, request, known);
    return fixed === null ? { allow: true } : { allow: false, restore: fixed, reason: 'the features list lost a feature the request did not ask to remove' };
  }
  if (path === WORLD_FILE) {
    const fixed = repairWorld(before, after, request);
    return fixed === null ? { allow: true } : { allow: false, restore: fixed, reason: 'the map lost a place the request did not ask to remove' };
  }
  // The platform's own record of what the user called each part: only the platform writes it.
  if (path === PART_NAMES_FILE) return { allow: false, restore: before, reason: 'the record of what the user calls each part is kept by the platform' };
  if (path === PLAYER_FILE && after === null) return { allow: false, restore: before, reason: 'src/game/player.ts was deleted; the game reads its player character from it (set model: null for the default person instead)' };
  if (path === APP_FILE) {
    const lost = lostMount(before, after);
    // The user asked for the open world to go (or for a whole new game): the mount is theirs to change.
    return lost.length === 0 || (after !== null && mayUnmount(request)) ? { allow: true } : { allow: false, restore: before, reason: `src/App.tsx no longer mounts the game as it did (${lost.join(', ')})` };
  }
  if (FEATURE_FILE.test(path)) {
    const id = featureIdOf(path);
    if (after === null) return mayRemove(request, id, known) ? { allow: true } : { allow: false, restore: before, reason: `the feature "${id}" was deleted, and the request did not ask to remove it` };
    return mayEdit(request, id, known) ? { allow: true } : { allow: false, restore: before, reason: `the feature "${id}" was rewritten, and the request is not about it` };
  }
  if (isKitFile(path)) {
    // The kit's own current version is the platform's write whoever carried it (a recipe run again, a layer brought up to date).
    if (after !== null && recipeFilePool().get(path)?.content === after) return { allow: true };
    // 🔓 The user asked for THIS part of the kit to change ("apna camera chahiye", "joystick bada karo") or gave a free hand:
    // this game's own copy of it is theirs (an edited kit file is never overwritten by a kit refresh).
    if (after === null ? mayRemoveKit(request, path) : mayEditKit(request, path)) return { allow: true };
    // Otherwise the kit is the engine under every feature: a request that does not touch it never changes it.
    return { allow: false, restore: before, reason: 'a game-kit file was changed, and the request is not about that part of the game' };
  }
  return { allow: true };
}

/** The files of a project the guard watches. PURE. */
export function growthProtectedPaths(filesAtTurnStart: Readonly<Record<string, string>>): string[] {
  if (!growsByLists(filesAtTurnStart)) return [];
  return Object.keys(filesAtTurnStart).filter((p) => p === FEATURES_INDEX || p === WORLD_FILE || p === PLAYER_FILE || p === APP_FILE || p === PART_NAMES_FILE || FEATURE_FILE.test(p) || isKitFile(p));
}

export interface GrowthRestore { path: string; restore: string; reason: string }
/** Lock 2: everything to put back at the end of a turn. PURE. */
export function growthRestores(input: {
  filesAtTurnStart: Readonly<Record<string, string>>;
  now: Readonly<Record<string, string | null>>;
  request: string;
  platformWrote?: ReadonlyMap<string, string>;
}): GrowthRestore[] {
  const out: GrowthRestore[] = [];
  const known = partsKnown(input.filesAtTurnStart);
  for (const path of growthProtectedPaths(input.filesAtTurnStart)) {
    if (!(path in input.now)) continue;                               // not read: never judged on a guess
    const v = growthVerdict({ path, before: input.filesAtTurnStart[path], after: input.now[path], request: input.request, platformWrote: input.platformWrote?.get(path) ?? null, known });
    if (!v.allow && typeof v.restore === 'string') out.push({ path, restore: v.restore, reason: v.reason || 'changed without being asked' });
  }
  return out;
}

/** Lock 1's words to the builder: what was refused, why, and what to do instead. */
export function growthRefusal(path: string, reason: string): string {
  return `REFUSED (growth guard): ${path} was not changed — ${reason}. This game grows by ADDING: create a NEW file under src/game/features/ `
    + 'with defineFeature({ id, needs?, setup, update }) and add ONE line to src/game/features/index.ts; build on another feature with needs + '
    + 'api.get(id), never by editing it. A new place is ONE more entry in src/game/world.ts. This file opens the moment the user\'s own words '
    + 'ask for it — its name or what it does ("camera badlo", "police hatao"), "jo chahe badlo", or "poora game badal do" — so if you believe the '
    + 'user asked for exactly this change, do everything else, then say in your reply which part it needs and ask them to say so.';
}

/** The feature or place a protected path stands for, in the user's words; '' for the mount and the kit. PURE. */
export function partNameOf(path: string): string {
  return FEATURE_FILE.test(path) && path !== FEATURES_INDEX ? featureIdOf(path) : '';
}

/**
 * What the user is told when the builder WANTED to change a working part and was not allowed to: which parts, that nothing
 * was changed, and the exact words that open it. Said by the platform itself, so it never depends on the builder to ask.
 */
export function growthAskNote(blockedPaths: readonly string[]): string {
  const parts = [...new Set(blockedPaths.map(partNameOf).filter(Boolean))];
  const engineParts = [...new Set(blockedPaths.filter((p) => isKitFile(p)).map(kitPartName).filter(Boolean))];
  const engine = blockedPaths.some((p) => isKitFile(p));
  if (parts.length === 0 && !engine) return '';
  const lines: string[] = [];
  if (parts.length) {
    lines.push(`🔒 To do this the way it was first planned, I would also have changed ${parts.length === 1 ? 'a part of your game that already works' : 'parts of your game that already work'}: ${parts.slice(0, 6).join(', ')}. I did not touch ${parts.length === 1 ? 'it' : 'them'}, because you did not ask me to.`);
    lines.push(`If you want that, say so by name — for example "${parts[0]} bhi badlo" — or say "jo zaroori ho badal do" to let me change what is needed this once.`);
  }
  // 🔓 The engine is this game's too (admin 2026-11-22): it is opened by the user's words, never closed for good.
  if (engine) {
    const named = engineParts.slice(0, 4);
    lines.push(`I also left the game engine${named.length ? ` (${named.join(', ')})` : ''} as it was, because you did not ask me to change it.`
      + ` If you want that part of the engine changed for this game, say so by name — for example "${named[0] || 'camera'} badlo" — or say "jo chahe badlo".`);
  }
  return `\n\n${lines.join(' ')}`;
}

/** A kit file in the user's words ("camera", "touch controls"); '' when its name says nothing. PURE. */
export function kitPartName(path: string): string {
  return kitPartOwnName(path);
}

/** What the user is told when something was put back. Plain words, no file paths. */
export function growthUserNote(restores: readonly GrowthRestore[]): string {
  if (restores.length === 0) return '';
  const features = restores.filter((r) => FEATURE_FILE.test(r.path) && r.path !== FEATURES_INDEX).map((r) => featureIdOf(r.path));
  const parts: string[] = [];
  if (features.length) parts.push(`${features.length === 1 ? 'a part of your game that you did not ask to change' : `${features.length} parts of your game that you did not ask to change`} (${features.slice(0, 5).join(', ')})`);
  if (restores.some((r) => r.path === FEATURES_INDEX)) parts.push('a part that had been dropped from the game');
  if (restores.some((r) => r.path === WORLD_FILE)) parts.push('a place that had been dropped from the map');
  if (restores.some((r) => r.path === APP_FILE)) parts.push('the way the game starts');
  if (restores.some((r) => isKitFile(r.path))) parts.push('the game engine itself');
  return `\n\n🛡️ I kept what already worked: this change had also altered ${parts.join(', ')}. I put that back exactly as it was. Tell me by name if you want one of those changed.`;
}

/**
 * What the user is told when a change they did not ask for could NOT be put back (the write failed). Before 2026-11-22 only
 * the report said so: the user heard "I kept what already worked" for the parts that were restored and nothing at all about
 * the ones that were not — an unasked change surviving silently. Plain words, no file paths. PURE.
 */
export function growthNotRestoredNote(failed: readonly GrowthRestore[]): string {
  if (failed.length === 0) return '';
  const nameOf = (r: GrowthRestore): string => partNameOf(r.path) || (isKitFile(r.path) ? kitPartName(r.path) : '')
    || (r.path === WORLD_FILE ? 'the map' : r.path === APP_FILE ? 'the way the game starts' : r.path === FEATURES_INDEX ? 'the list of parts' : 'a part of the game');
  const names = [...new Set(failed.map(nameOf).filter(Boolean))];
  const it = failed.length === 1 ? 'it' : 'them';
  return `\n\n⚠️ This change also altered ${names.slice(0, 5).join(', ')}, which you did not ask for, and I could not put ${it} back, so ${failed.length === 1 ? 'it is' : 'they are'} still changed. Tell me if you want ${it} changed back.`;
}
