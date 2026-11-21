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
const words = (s: string): string[] => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** 'missionDelivery' / 'mission-delivery' / 'old_town' → ['mission', 'delivery'] / ['old', 'town']. */
export function nameTokens(id: string): string[] {
  return String(id ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}
const GENERIC = new Set(['game', 'feature', 'features', 'index', 'main', 'new', 'the', 'and', 'for', 'city', 'town', 'village', 'world', 'map', 'system', 'manager', 'controller']);

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

/** May this turn EDIT an existing feature / place? PURE. */
export function mayEdit(request: string, id: string): boolean {
  return requestNames(request, id) || ABOUT_EVERYTHING.test(request) || REPAIR.test(request) || PERMIT.test(request);
}
/** May this turn REMOVE it? Only when the user asks to remove, and names it. PURE. */
export function mayRemove(request: string, id: string): boolean {
  return REMOVAL.test(request) && requestNames(request, id);
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
export function repairFeatureList(before: string, after: string | null, request: string): string | null {
  const b = parseFeatureList(before);
  if (!b) return null;                               // not our shape before the turn: not ours to judge
  const a = after === null ? null : parseFeatureList(after);
  if (!a) return before;                             // deleted, or no longer a list: the list as it was
  const missing = b.listed.filter((name) => !a.listed.includes(name) && !mayRemove(request, name));
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
  const missing = b.filter((r) => !a.some((x) => x.id === r.id) && !mayRemove(request, r.id));
  if (missing.length === 0) return null;
  return (after as string).replace(/(\bregions\s*:\s*\[)/, (_all, open: string) => `${open}\n${missing.map((r) => `    ${r.text},`).join('\n')}`);
}

// ── the mount ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const MOUNT_PARTS = ['<OpenWorldGame', 'features={FEATURES}', 'world={WORLD}'] as const;
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
export function growthVerdict(input: { path: string; before: string | undefined; after: string | null; request: string; platformWrote?: string | null }): GrowthVerdict {
  const { path, before, after, request } = input;
  if (typeof before !== 'string') return { allow: true };            // new this turn: adding is how a game grows
  if (after === before) return { allow: true };
  if (input.platformWrote != null && after === input.platformWrote) return { allow: true };

  if (path === FEATURES_INDEX) {
    const fixed = repairFeatureList(before, after, request);
    return fixed === null ? { allow: true } : { allow: false, restore: fixed, reason: 'the features list lost a feature the request did not ask to remove' };
  }
  if (path === WORLD_FILE) {
    const fixed = repairWorld(before, after, request);
    return fixed === null ? { allow: true } : { allow: false, restore: fixed, reason: 'the map lost a place the request did not ask to remove' };
  }
  if (path === APP_FILE) {
    const lost = lostMount(before, after);
    return lost.length === 0 ? { allow: true } : { allow: false, restore: before, reason: `src/App.tsx no longer mounts the game as it did (${lost.join(', ')})` };
  }
  if (FEATURE_FILE.test(path)) {
    const id = featureIdOf(path);
    if (after === null) return mayRemove(request, id) ? { allow: true } : { allow: false, restore: before, reason: `the feature "${id}" was deleted, and the request did not ask to remove it` };
    return mayEdit(request, id) ? { allow: true } : { allow: false, restore: before, reason: `the feature "${id}" was rewritten, and the request is not about it` };
  }
  if (isKitFile(path)) {
    // The kit's own current version is the platform's write whoever carried it (a recipe run again, a layer brought up to date).
    if (after !== null && recipeFilePool().get(path)?.content === after) return { allow: true };
    // The kit is the platform's: a game is extended through a feature, never by editing the engine under every feature.
    return { allow: false, restore: before, reason: 'a game-kit file was changed; a game is extended through a feature, not by editing the kit' };
  }
  return { allow: true };
}

/** The files of a project the guard watches. PURE. */
export function growthProtectedPaths(filesAtTurnStart: Readonly<Record<string, string>>): string[] {
  if (!growsByLists(filesAtTurnStart)) return [];
  return Object.keys(filesAtTurnStart).filter((p) => p === FEATURES_INDEX || p === WORLD_FILE || p === APP_FILE || FEATURE_FILE.test(p) || isKitFile(p));
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
  for (const path of growthProtectedPaths(input.filesAtTurnStart)) {
    if (!(path in input.now)) continue;                               // not read: never judged on a guess
    const v = growthVerdict({ path, before: input.filesAtTurnStart[path], after: input.now[path], request: input.request, platformWrote: input.platformWrote?.get(path) ?? null });
    if (!v.allow && typeof v.restore === 'string') out.push({ path, restore: v.restore, reason: v.reason || 'changed without being asked' });
  }
  return out;
}

/** Lock 1's words to the builder: what was refused, why, and what to do instead. */
export function growthRefusal(path: string, reason: string): string {
  return `REFUSED (growth guard): ${path} was not changed — ${reason}. This game grows by ADDING: create a NEW file under src/game/features/ `
    + 'with defineFeature({ id, needs?, setup, update }) and add ONE line to src/game/features/index.ts; build on another feature with needs + '
    + 'api.get(id), never by editing it. A new place is ONE more entry in src/game/world.ts. If the user really asked to change or remove this '
    + 'one, say which in your reply and ask them to name it.';
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
  const engine = blockedPaths.some((p) => isKitFile(p));
  if (parts.length === 0 && !engine) return '';
  const lines: string[] = [];
  if (parts.length) {
    lines.push(`🔒 To do this the way it was first planned, I would also have changed ${parts.length === 1 ? 'a part of your game that already works' : 'parts of your game that already work'}: ${parts.slice(0, 6).join(', ')}. I did not touch ${parts.length === 1 ? 'it' : 'them'}, because you did not ask me to.`);
    lines.push(`If you want that, say so by name — for example "${parts[0]} bhi badlo" — or say "jo zaroori ho badal do" to let me change what is needed this once.`);
  }
  if (engine) lines.push('The game engine itself is never edited for one game. If something in it is wrong, tell me what you see and it will be fixed for every game.');
  return `\n\n${lines.join(' ')}`;
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
