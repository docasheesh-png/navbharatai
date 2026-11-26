// POLICE IN ONE STEP (admin 2026-11-26, failedbr #2549: "police ani chahiye, dikhni chahiye screen par, cyron ki awaz bhi aye";
// then: "abhi bhi enemy, police, bot nahi aa rahe … police ki gadi aye usse police utre, bolne par bhi na police aa rahi hai,
// na gadi!!!").
//
// 🔎 THE ROOT (read in #2549's project). The kit has REAL police — systems/dispatch.ts: a car with a light bar drives in with
// its siren, officers get out and walk to the target, a wanted level brings more — and nothing ever put it in a game. Every
// "police aaye" asked the builder to write it by hand, so the project collected police.ts, policeCars.ts, policeResponse.ts,
// policeSiren.ts, criminalNPCs.ts … none of them on the kit's systems (the project did not even have systems/dispatch.ts),
// and the playtest that could have caught it ran out of time at 3 frames a second. The summary still said "police ab dikhti hai".
//
// THE FIX. The platform writes the feature itself, at the start of the turn, from the user's words — the same way it writes
// enemies (GameEnemiesFeature.ts): src/game/features/policeDispatch.ts, listed in the game's features, with every kit file it
// imports that the project lacks (systems/entities.ts, systems/dispatch.ts …). Its numbers at the top are the user's to change.
// PURE (strings in, strings out).

import { featuresIndexWith, FEATURES_INDEX_PATH } from './GameEnemiesFeature';

export const POLICE_FEATURE_PATH = 'src/game/features/policeDispatch.ts';
export { FEATURES_INDEX_PATH };

export interface PoliceRequest {
  /** Police cars sent at once. */
  cars: number;
  /** Officers in each car. */
  crew: number;
  /** They come after the player (a wanted level from the start) — "police pakde / peecha kare / arrest". */
  chase: boolean;
}

// "cyron", "sairan", "siran": how #2549's user and others spell siren.
const POLICE_WORDS = /\b(?:police|polis|pulis|pulice|cops?|cop\s*car|thana|thane|havaldar|hawaldar|daroga|siren|sairan|siran|cyron|cyren)\b|पुलिस|सायरन|थाना|हवलदार|दरोगा/i;
const WANTS = /\b(?:ani|aani|aaye|aye|aayen|aa\s*jaye|aa\s*jaaye|aaegi|aayegi|chahiye|chaahiye|chahie|dikhe|dikhni|dikhna|dikhai|banao|bana|daalo|dalo|lao|add|bhejo|bulao|spawn|put|make|create|want|show|come|arrive|ho|hon|hai|with|wali|wala|wale|utre|utare|nikle|pakde|chase|arrest|karo|kar\s*do)\b|चाहिए|आए|आनी|दिखनी|बनाओ|भेजो|बुलाओ/i;
const NOT_WANTED = /\b(?:no|without|bina|nahi|nahin|mat|remove|hatao|hata\s*do|band\s*karo|delete)\b[^.!?\n]{0,24}\b(?:police|pulis|cops?|siren)\b|\b(?:police|pulis|cops?|siren)\b[^.!?\n]{0,16}\b(?:nahi|nahin|mat|hatao|remove|delete|band\s*karo)\b/i;
const NUMBER_WORDS: Record<string, number> = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5 };

/** The police a request asks for, or null when it asks for none (or refuses them). PURE. */
export function policeRequestFrom(prompt: string | null | undefined): PoliceRequest | null {
  const text = String(prompt ?? '');
  if (!POLICE_WORDS.test(text) || NOT_WANTED.test(text) || !WANTS.test(text)) return null;
  const carCount = /(\d{1,2}|[a-z]+)\s+(?:police\s+)?(?:gaadi|gaadiyan|gadi|gadiyan|gaari|cars?|jeep|vans?)\b/i.exec(text);
  let cars = 1;
  if (carCount) cars = /^\d+$/.test(carCount[1]) ? Number(carCount[1]) : (NUMBER_WORDS[carCount[1].toLowerCase()] ?? 1);
  if (/\b(?:bahut|bohot|many|lots?\s+of|saari|sari)\b/i.test(text)) cars = Math.max(cars, 3);
  cars = Math.max(1, Math.min(5, cars));
  const chase = /\b(?:pakde|pakad\w*|chase\w*|peeche|pichhe|piche|arrest\w*|giraftar\w*|hunt|follow\s+me|mere\s+peeche)\b|पकड़|पीछे|गिरफ्तार/i.test(text);
  return { cars, crew: 2, chase };
}

/** An input object handed back to the dispatcher (the model may have edited it), checked and bounded — or null. PURE. */
export function policeRequestOf(value: unknown): PoliceRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  return { cars: num(v.cars, 1, 5, 1), crew: num(v.crew, 1, 4, 2), chase: v.chase === true };
}

/** The feature file for that police (the user's file from then on). PURE. */
export function policeFeatureSource(req: PoliceRequest): string {
  return [
    "// THIS GAME'S POLICE — written by NavBharatAI from the user's request, on the kit's REAL police (src/game/systems/dispatch.ts):",
    '// a police car with its light bar drives in with the siren, the officers get out and come to the player. When none is around,',
    '// another car comes after POLICE.again seconds. To change it, change POLICE below. Never write a second police system.',
    "import type * as THREE from 'three';",
    "import { defineFeature } from '../play/features';",
    "import { Entities } from '../systems/entities';",
    "import { Dispatch, Wanted } from '../systems/dispatch';",
    "import type { OpenWorld } from '../play/openWorld';",
    '',
    'export const POLICE = {',
    `  /** Police cars sent at once (1–5). */`,
    `  cars: ${req.cars},`,
    `  /** Officers who get out of each car. */`,
    `  crew: ${req.crew},`,
    '  /** Seconds before another car comes when no police is around (0: only the first). */',
    '  again: 45,',
    `  /** true: they come after the player from the start (a wanted level); false: they come, get out and stand by. */`,
    `  chase: ${req.chase},`,
    '};',
    '',
    'interface PoliceState { dispatch: Dispatch; wanted: Wanted; waitFor: number; send(): void; anchor(o: THREE.Object3D | null | undefined): void }',
    '',
    'export default defineFeature<OpenWorld>({',
    "  id: 'policeDispatch',",
    "  about: ['police', 'pulis', 'cop', 'police car', 'siren', 'thana', 'havaldar'],",
    '  setup(ctx, world): PoliceState {',
    '    const host = { scene: ctx.scene, player: ctx.player, onStep: ctx.onStep };',
    '    const people = new Entities(host);',
    '    const dispatch = new Dispatch(host, people);',
    '    const wanted = new Wanted(host, people, dispatch);',
    '    // Every car and officer moves with the big map\'s floating origin (world.place keeps it where it stands).',
    '    const anchored = new WeakSet<THREE.Object3D>();',
    '    const anchor = (o: THREE.Object3D | null | undefined) => {',
    '      if (!o || anchored.has(o)) return;',
    '      anchored.add(o);',
    '      const origin = world.map.chunks?.origin ?? { x: 0, z: 0 };',
    '      world.place(o, o.position.x + origin.x, o.position.z + origin.z);',
    '    };',
    '    const target = () => ({ x: ctx.player.object.position.x, z: ctx.player.object.position.z });',
    '    const send = () => { for (let i = 0; i < POLICE.cars; i++) dispatch.call(\'police\', target, POLICE.crew); };',
    '    send();',
    "    if (POLICE.chase) wanted.commit('theft');",
    '    return { dispatch, wanted, waitFor: POLICE.again, send, anchor };',
    '  },',
    '  update(_ctx, _world, delta, api) {',
    "    const s = api.get<PoliceState>('policeDispatch');",
    '    if (!s) return;',
    '    for (const call of s.dispatch.active) { s.anchor(call.car); for (const unit of call.units) s.anchor(unit.object); }',
    '    if (POLICE.again <= 0 || s.dispatch.active.length > 0) { s.waitFor = POLICE.again; return; }',
    '    s.waitFor -= delta;',
    '    if (s.waitFor <= 0) { s.send(); s.waitFor = POLICE.again; }',
    '  },',
    '});',
    '',
  ].join('\n');
}

/** The game's features list with the police listed, or null (already there / not the kit's shape). PURE. */
export function featuresIndexWithPolice(index: string): string | null {
  return featuresIndexWith(index, 'policeDispatch');
}

/** What the builder is told when the platform put the police in. PURE. */
export function policeAddedHandoff(req: PoliceRequest, added: string[]): string {
  return `🚓 THE POLICE ARE ALREADY IN THE GAME: NavBharatAI wrote ${POLICE_FEATURE_PATH} on the kit's real police (src/game/systems/dispatch.ts) and listed it in ${FEATURES_INDEX_PATH}`
    + (added.length ? `, with the kit files it needs (${added.join(', ')})` : '')
    + `: ${req.cars} police car${req.cars === 1 ? '' : 's'} with the light bar and siren drive${req.cars === 1 ? 's' : ''} in, ${req.crew} officers get out of each and come to the player`
    + (req.chase ? ', and they are after the player from the start (a wanted level)' : '')
    + '; another car comes when none is around. Do NOT write another police system, police car, siren or officer beside it — and stop extending any hand-written police file in this project (they are not on the kit\'s systems). '
    + 'A change the user asks for ("2 gaadi", "police pakde", "aur jaldi aaye") is a change to the POLICE numbers at the top of that file.';
}
