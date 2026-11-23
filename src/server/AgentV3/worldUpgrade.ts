// 🧬 AN OLD, HAND-EDITED WORLD IS UPGRADED ONLY WHEN THE USER SAYS SO (map expansion plan, item 11: migration).
//
// The kit brings an older kit file up to date only when nobody edited it (gameRecipeLayers.planKitLayers): a game whose
// src/game/play/openWorld.ts was changed by hand keeps it for ever — and with it, none of the new map features (venues,
// joined lands, streaming places, late edits). The owner's decision (2026-11-23): an old hand-edited game gets the new
// system only after the user agrees. So:
//   • NOTE — on a map request in such a game the builder is told the bridge is the user's edited copy: never overwrite it
//     or rewrite it by hand, and ask the user ONE question, offering the exact words "world upgrade karo";
//   • UPGRADE — only on those explicit words (English, Hinglish, Devanagari; never a negation or a question) the platform
//     itself keeps ONE backup of the edited file beside it (never overwritten), writes the current kit bridge, and brings the
//     kit files the bridge imports up to date by the kit's own rules (an untouched older version is replaced; an absent one
//     added). It refuses — and changes NOTHING — when an edited kit file would lose names the new bridge needs, when the
//     game's own files import names the new bridge no longer exports, or when a backup from an earlier upgrade is already
//     there (the user's first copy is never lost).
// Racing and sports games have no bridge: moving them onto a world is the ask-once route (mapGrowthIntent.ts, items 7/8).
//
// PURE except upgradeWorldAtTurnStart, which reads and writes through the ports it is given. Never throws.

import { exportedNames, importedNames, isKnownKitVersion, planKitLayers, recipeFilePool, type LayerFile } from '../lib/gameRecipeLayers';

export const BRIDGE_PATH = 'src/game/play/openWorld.ts';
/** The one backup an upgrade keeps (not a module: nothing compiles or imports it). */
export const BRIDGE_BACKUP_PATH = 'src/game/play/openWorld.before-upgrade.txt';

export type BridgeState = 'absent' | 'current' | 'older-kit' | 'edited';

/** What this game's bridge is: none, the current kit version, an older untouched kit version, or somebody's edited copy. PURE. */
export function bridgeState(content: string | null | undefined, current: string | null | undefined = recipeFilePool().get(BRIDGE_PATH)?.content): BridgeState {
  if (typeof content !== 'string') return 'absent';
  if (typeof current === 'string' && content === current) return 'current';
  return isKnownKitVersion(BRIDGE_PATH, content) ? 'older-kit' : 'edited';
}

/** Kill switch: AGENTV3_WORLD_UPGRADE=off — no note and no upgrade (exactly as before). */
export function worldUpgradeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(?:0|off|false|no)$/i.test(String(env.AGENTV3_WORLD_UPGRADE ?? '').trim());
}

const norm = (s: string): string => ` ${String(s ?? '').slice(0, 400).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}?]+/gu, ' ').replace(/\?/g, ' ? ').trim()} `;
const WORLD = /(?<=\s)(?:world|वर्ल्ड)(?=\s)/u;
const UPGRADE = /(?<=\s)(?:upgrade|upgraded|upgrading|अपग्रेड)(?=\s)/u;
const NEW_SYSTEM = /(?<=\s)(?:naya|nayi|new|नया|नई)\s+(?:world|वर्ल्ड)\s+(?:system|kit|सिस्टम)(?=\s)/u;
const NEGATION = /(?<=\s)(?:nahi|nahin|nahiin|nai|mat|no|not|dont|don|never|नहीं|नही|मत)(?=\s)/u;
const QUESTION = /(?<=\s)(?:kya|should|can|could|will|would|what|kaise|kyun|why|how|क्या|कैसे|क्यों|\?)(?=\s)/u;

/** Does the user explicitly ask to upgrade this game's world to the current system? Never on a negation or a question. PURE. */
export function worldUpgradeAsked(prompt: string): boolean {
  try {
    const raw = String(prompt ?? '');
    if (raw.length > 200) return false;                                   // an upgrade is a short answer, not a specification
    const t = norm(raw);
    if (NEGATION.test(t) || QUESTION.test(t)) return false;
    return (WORLD.test(t) && UPGRADE.test(t)) || NEW_SYSTEM.test(t);
  } catch { return false; }
}

/** What the builder is told on a map request in a game whose bridge is an edited copy ('' otherwise). PURE. */
export function editedBridgeNote(state: BridgeState): string {
  if (state !== 'edited') return '';
  return `🧬 THIS GAME'S ${BRIDGE_PATH} IS THE USER'S OWN EDITED COPY of an older kit bridge, so the platform never replaces it by itself — and the newer map features (venues, lands joined edge to edge, streaming places, late ground edits) may not be in it. Do NOT overwrite it and do NOT rewrite it by hand to add them. If the request needs one of those features and the file does not support it, ask the user ONE short question in their language: upgrade this game's world to the current NavBharatAI world system? Their changes inside ${BRIDGE_PATH} would be replaced by the current version, and one backup copy is kept at ${BRIDGE_BACKUP_PATH}. To agree, they reply "world upgrade karo". Change nothing in that file this turn.`;
}

export type UpgradePlan =
  | { ok: true; writes: Array<{ path: string; content: string }>; backup: string; refreshed: string[]; added: string[] }
  | { ok: false; reason: string };

const IMPORT_SPEC = /(?:import|export)\s[^'";]*?from\s*['"]([^'"]*\/openWorld(?:\.ts)?)['"]/g;

/**
 * The upgrade, decided without writing anything. `bridge` is the edited (or older) bridge; `files` the project's files (for the
 * names its own code imports); `kitFiles` the live content of kit paths the plan asked for (null = absent). PURE.
 */
export function planWorldUpgrade(input: {
  bridge: string; backupExists: boolean; files: Readonly<Record<string, string>>;
  kitFiles: ReadonlyMap<string, string | null>; pool?: ReadonlyMap<string, LayerFile>;
}): UpgradePlan & { unread?: string[] } {
  const pool = input.pool ?? recipeFilePool();
  const next = pool.get(BRIDGE_PATH)?.content;
  if (typeof next !== 'string') return { ok: false, reason: 'the current world bridge could not be found in the kit' };
  if (input.bridge === next) return { ok: false, reason: 'this game\'s world is already the current version' };
  if (input.backupExists) return { ok: false, reason: `a backup from an earlier upgrade is already at ${BRIDGE_BACKUP_PATH}, and it is never overwritten — move or delete that file first if a new upgrade is wanted` };
  // The game's own files must keep every name they import from the bridge.
  const nextNames = exportedNames(next);
  const lost = new Set<string>();
  for (const [path, content] of Object.entries(input.files)) {
    if (path === BRIDGE_PATH || typeof content !== 'string' || !/\.(?:tsx?|jsx?)$/.test(path)) continue;
    for (const m of content.matchAll(IMPORT_SPEC)) for (const n of importedNames(content, m[1])) if (nextNames && !nextNames.has(n)) lost.add(`${n} (used in ${path})`);
  }
  if (lost.size) return { ok: false, reason: `the game's own code uses names the current world bridge does not have: ${[...lost].slice(0, 6).join(', ')}` };
  // The kit files the new bridge imports, by the kit's own rules.
  const present = new Set<string>([...Object.keys(input.files), ...[...input.kitFiles].filter(([, c]) => typeof c === 'string').map(([p]) => p)]);
  for (const [p, c] of input.kitFiles) if (c === null) present.delete(p);
  const existing = new Map<string, string | null>();
  for (const [p, c] of input.kitFiles) if (typeof c === 'string') existing.set(p, c);
  const plan = planKitLayers({ [BRIDGE_PATH]: next }, present, existing, pool);
  // A file is added only once it was READ as absent (a stale listing must never let a kit file overwrite somebody's).
  const unconfirmed = [...plan.add.keys()].filter((p) => !input.kitFiles.has(p));
  if (plan.unread.length || unconfirmed.length) return { ok: false, reason: 'unread', unread: [...plan.unread, ...unconfirmed] };
  if (plan.kept.length) return { ok: false, reason: `the game's own edited kit file${plan.kept.length === 1 ? '' : 's'} would not work with the current world: ${plan.kept.slice(0, 4).map((k) => `${k.path} lacks ${k.missing.join(', ')}`).join('; ')}` };
  const writes = [...plan.add].map(([path, f]) => ({ path, content: f.content }))
    .concat([...plan.refresh].map(([path, f]) => ({ path, content: f.content })))
    .concat([{ path: BRIDGE_PATH, content: next }]);
  return { ok: true, writes, backup: input.bridge, refreshed: [...plan.refresh.keys()], added: [...plan.add.keys()] };
}

type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

/**
 * On the user's explicit "world upgrade karo" in a game whose bridge is an edited (or older) copy: the backup, then the kit
 * files, then the bridge. Returns what the builder is told; '' when this turn is not that request. Never throws; on any
 * refusal nothing was written.
 */
export async function upgradeWorldAtTurnStart(io: {
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  try {
    if (!worldUpgradeEnabled(io.env ?? process.env) || !io.filesAtTurnStart || !worldUpgradeAsked(io.prompt)) return '';
    const readOrNull = (p: string) => io.read(p).then((c) => (typeof c === 'string' ? c : null), () => null);
    const bridge = await readOrNull(BRIDGE_PATH);
    const state = bridgeState(bridge);
    const refuse = (why: string) => {
      io.record({ phase: 'build', severity: 'info', code: 'WORLD_UPGRADE_NOT_DONE', autoResolved: true, message: `The user asked to upgrade the game's world, and it was not done: ${why}. Nothing was changed.` });
      return `🧬 THE USER ASKED TO UPGRADE THIS GAME'S WORLD, AND THE PLATFORM DID NOT DO IT: ${why}. Nothing was changed. Tell the user this plainly, in their language, in one or two sentences — do not rewrite ${BRIDGE_PATH} or any kit file by hand.`;
    };
    if (state === 'absent') return refuse(`this game has no ${BRIDGE_PATH} (it is not an open-world game on the kit; a race or a sports game moves onto a world only through its own question)`);
    if (state === 'current') return refuse('its world is already the current NavBharatAI world system');
    const backupExists = (await readOrNull(BRIDGE_BACKUP_PATH)) !== null;
    const kitFiles = new Map<string, string | null>();
    let plan = planWorldUpgrade({ bridge: bridge!, backupExists, files: io.filesAtTurnStart, kitFiles });
    for (let round = 0; !plan.ok && plan.reason === 'unread' && round < 12; round++) {
      for (const p of plan.unread ?? []) kitFiles.set(p, await readOrNull(p));
      plan = planWorldUpgrade({ bridge: bridge!, backupExists, files: io.filesAtTurnStart, kitFiles });
    }
    if (!plan.ok) return refuse(plan.reason === 'unread' ? 'the kit files it needs could not all be read' : plan.reason);
    await io.write(BRIDGE_BACKUP_PATH, plan.backup);                       // the user's copy first, before anything else
    const done: string[] = [];
    try {
      for (const w of plan.writes) { await io.write(w.path, w.content); done.push(w.path); }
    } catch (error) {
      // Put back what was written, so a half-upgrade never stays.
      for (const p of done) { const before = p === BRIDGE_PATH ? plan.backup : kitFiles.get(p); if (typeof before === 'string') await io.write(p, before).catch(() => undefined); }
      return refuse(`a file could not be written (${String(error instanceof Error ? error.message : error).slice(0, 120)}); what was written was put back, and the backup is at ${BRIDGE_BACKUP_PATH}`);
    }
    io.record({ phase: 'build', severity: 'info', code: 'WORLD_UPGRADED', autoResolved: true, message: `On the user's explicit request the platform upgraded the game's world: ${BRIDGE_PATH} is the current kit version (the user's copy is kept at ${BRIDGE_BACKUP_PATH})${plan.refreshed.length ? `; brought up to date: ${plan.refreshed.join(', ')}` : ''}${plan.added.length ? `; added: ${plan.added.join(', ')}` : ''}.` });
    return `🧬 THE PLATFORM UPGRADED THIS GAME'S WORLD, AS THE USER ASKED: ${BRIDGE_PATH} is now the current NavBharatAI world system; the user's own copy is kept unchanged at ${BRIDGE_BACKUP_PATH}${plan.refreshed.length || plan.added.length ? `, and the kit files it uses were brought up to date (${[...plan.refreshed, ...plan.added].join(', ')})` : ''}. Do not edit ${BRIDGE_PATH} or the backup. If the user's old copy had their own changes (compare the backup), tell them in one sentence which ones are no longer there and offer to add them back in their own files — never by editing the bridge. Typecheck the project; then tell the user plainly that the world was upgraded and where the backup is.`;
  } catch { return ''; }
}
