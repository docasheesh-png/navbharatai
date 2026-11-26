/**
 * WHAT THE PLAYER HOLDS MUST BE IN THE GAME (autopsy BR #2535, 2026-11-26 — "hero ke haath me gun nahi banayi").
 *
 * The user asked for a big gun in the hero's hand. The builder wrote `holds: { right: 'rifle' }` into src/game/player.ts and
 * said "the hero now holds a rifle". The kit puts a held item in the hand ONLY when that subject is one of the game's saved
 * models (src/game/three/assetModels.ts — `loadRequestedAsset` looks the subject up by exact key); otherwise the hand stays
 * empty and the game shows a small hint. The builder never called add_library_models, so nothing was in the hand.
 *
 * 🧬 THE CLASS: a player setting that names a library model the game does not have. GAME_PLAYER_RULE told the builder to add
 * a CHARACTER first, and said nothing about what the character HOLDS. Now the rule says it, and this note is attached on every
 * write of player.ts until each held subject is a saved model — the same shape as missingGroundContact. PURE; never throws.
 */
import { localModelSubjects } from './gameAssets/localModelNote';

export const PLAYER_FILE_PATH = 'src/game/player.ts';

/** The subjects PLAYER.holds names, in order (right, left). Comments ignored. PURE. */
export function heldSubjects(playerSource: string | null | undefined): string[] {
  const code = String(playerSource ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const block = /\bholds\s*:\s*\{([^}]*)\}/.exec(code);
  if (!block) return [];
  const out: string[] = [];
  for (const m of block[1].matchAll(/\b(right|left)\s*:\s*(['"`])([^'"`]+)\2/g)) {
    const subject = m[3].trim();
    if (subject && !out.includes(subject)) out.push(subject);
  }
  return out;
}

/** The note for held subjects the game has no saved model for ('' when every one is saved). PURE. */
export function missingHeldModels(playerSource: string | null | undefined, assetModelsSource: string | null | undefined): string {
  const held = heldSubjects(playerSource);
  if (held.length === 0) return '';
  const saved = localModelSubjects(assetModelsSource);
  const missing = held.filter((s) => !saved.includes(s));
  if (missing.length === 0) return '';
  const list = missing.map((s) => `'${s}'`).join(', ');
  return `\n\n✋ HELD ITEM NOT IN THE GAME — not done yet. PLAYER.holds names ${list}, but this game has no saved model by that`
    + ` name (${saved.length ? `saved: ${saved.slice(0, 12).join(', ')}` : 'it has no saved library models yet'}), so the hand stays EMPTY`
    + ` and the game only shows a hint. First call add_library_models with ${missing.map((s) => `{ "subject": "${s}" }`).join(', ')},`
    + ` then set PLAYER.holds to the exact subject it was saved under. If the library has no such item, tell the user plainly —`
    + ` never say the character is holding it.`;
}
