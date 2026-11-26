/**
 * 🚪 "GHAR KE ANDAR JAANA HAI" IS DONE BY THE PLATFORM (admin 2026-11-26, open-world problem #3: "jaise user bole — agar user
 * bole ghar me game open karo, to painted gate ko real gate banao, aur ghar andar se khokhla hota hi hai, hero andar chala
 * jayega").
 *
 * An open world's city draws each house as one solid shell with its door painted on — fast, and right until the user wants
 * to go inside. When the turn's words ask to enter the houses (inside, a door that opens, walk in — English, Hinglish,
 * Hindi), the platform sets `enterableHouses: true` in src/game/world.ts: every house of every city becomes the kit's
 * enterable house (a real door on the interact key, hollow rooms, walls that collide), built by #4535's buildings kit.
 * Only where the game's own kit copy can do it (its play/openWorld.ts and three/city.ts know the option) — otherwise the
 * builder is told plainly, never a fake. Already on: the builder is told so. Never throws.
 */
import { withoutDeclinedSentences } from '../../lib/RequirementGapAnalyzer';

export const WORLD_FILE = 'src/game/world.ts';
export const OPEN_WORLD_KIT = 'src/game/play/openWorld.ts';
export const CITY_KIT = 'src/game/three/city.ts';

const HOUSE = /\b(?:ghar|gharon|gharo|gharo[nm]|makaan|makan|makano|houses?|bungalows?|kothi|imarat\w*)\b|घर|मकान/i;
const INSIDE = /\b(?:andar|ander|inside|indoors?|enter|enterable|walk\s*in(?:to)?|go\s*in(?:to)?|ghus\w*|darwaz\w*|darvaz\w*|doors?|gates?|khul\w*|khol\w*|open\w*|hollow|khokhl\w*)\b|अंदर|अन्दर|दरवाज|खुल|खोल/i;

/** Does this turn ask for houses the player can walk into? PURE. */
export function asksForEnterableHouses(text: string | null | undefined): boolean {
  const raw = withoutDeclinedSentences(String(text ?? ''));
  return raw.split(/[.!?\n।]+/).some((s) => HOUSE.test(s) && INSIDE.test(s));
}

/** WORLD with enterableHouses: true — null when there is no WORLD object to change. PURE. */
export function withEnterableHouses(worldSource: string): { source: string; changed: boolean } | null {
  const text = String(worldSource ?? '');
  const open = /(export\s+const\s+WORLD\b[^=]*=\s*\{)/.exec(text);
  if (!open) return null;
  const existing = /(\benterableHouses\s*:\s*)([^,\n}]+)/.exec(text);
  if (existing) {
    const source = text.slice(0, existing.index) + existing[1] + 'true' + text.slice(existing.index + existing[0].length);
    return { source, changed: source !== text };
  }
  const at = open.index + open[0].length;
  return { source: `${text.slice(0, at)}\n  enterableHouses: true, // houses you can walk into (the user asked)${text.slice(at)}`, changed: true };
}

interface Issue { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }

export async function housesAtTurnStart(io: {
  skip?: boolean;
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
}): Promise<string> {
  try {
    const start = io.filesAtTurnStart;
    if (io.skip || !start || typeof start[WORLD_FILE] !== 'string' || !asksForEnterableHouses(io.prompt)) return '';
    const read = (p: string) => io.read(p).then((c) => (typeof c === 'string' ? c : null), () => start[p] ?? null);
    const [world, kit, city] = await Promise.all([read(WORLD_FILE), read(OPEN_WORLD_KIT), read(CITY_KIT)]);
    if (world === null) return '';
    if (!kit?.includes('enterableHouses') || !city?.includes('enterableHouses')) {
      io.record({ phase: 'build', severity: 'warning', code: 'HOUSES_NOT_ENTERABLE', autoResolved: false,
        message: 'The request asked to walk into the houses, but this game\'s copy of the open-world kit is older and cannot make them enterable; nothing was changed and the builder was told.' });
      return 'HOUSES: the user asked to walk into the houses, but this game\'s copy of the game engine (src/game/play/openWorld.ts, src/game/three/city.ts) is older and does not have enterable city houses. Do NOT fake it (no painted door that "opens"): tell the user plainly that this game needs the engine update for it.';
    }
    const next = withEnterableHouses(world);
    if (!next) return '';
    if (next.changed) await io.write(WORLD_FILE, next.source);
    io.record({ phase: 'build', severity: 'info', code: 'HOUSES_ENTERABLE', autoResolved: true,
      message: next.changed ? 'The request asked to walk into the houses: the platform set enterableHouses in src/game/world.ts — every city house now has a real door and hollow rooms — no model call made this change.'
        : 'The request asked to walk into the houses; they already could (enterableHouses is on).' });
    return 'HOUSES — ALREADY DONE BY THE PLATFORM: every house in the cities is now one you can walk into (WORLD.enterableHouses in src/game/world.ts): a real door that opens with E (Use on a phone), '
      + 'hollow rooms with a floor and solid walls, the roof fading while the player is inside. Do NOT build your own houses or doors for this. Tell the user, in their language, how to go in.';
  } catch { return ''; }
}
