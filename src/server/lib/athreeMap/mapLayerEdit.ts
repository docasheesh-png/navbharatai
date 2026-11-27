// ✏️ CHANGE ONE LAYER OF A MAP BY CHAT (admin 2026-11-27, wave 2 part 2): "yahan nadi ki jagah jheel karo", "colony badi karo",
// "sadkein tedhi-medhi karo", "map 2 guna bada karo", "kinara pahaadon wala karo".
//
// A follow-up message about a game's map changes ONLY the layer it names, as a DIFF on the plan the game already has (its MAP_PLAN in
// src/game/athree/config.ts): the same seed, every other field kept. The words are read by MEANING with the planner's own parsers
// (mapPlan.ts: roadStyleIn, densityIn, boundaryIn, areaKm2In, the water kinds and count words), in English, Hinglish and Devanagari
// input. Nothing is changed on a guess: a message must ask for a change (a verb of changing, or "X ki jagah Y"), and name the layer.
//
// What a layer edit REALLY does is said per layer, from the world's own source (mapPlan.appliedMapLayers), never assumed: a road style
// on a map wider than 25 km, a river or a lake count (the world makes its own), a density before the colonies layer exists, an edge on
// a looping map — each is answered honestly as "recorded, not built into this world", or not done at all.
//
// PURE: no I/O. Never throws.

import { ARCHETYPES } from './athreeMapKinds';
import { areaKm2In, boundaryIn, COUNT_WORDS, densityIn, roadStyleIn, WATER_KINDS, type BoundaryKind, type Density, type MapLayer, type RoadStyle, type WaterPlan } from './mapPlan';
import type { MapPlanData } from './mapPlanData';

export type EditableLayer = 'frame' | 'boundary' | 'water' | 'roadStyle' | 'density';

export interface LayerChange {
  layer: EditableLayer;
  /** Plain words: what it was, and what it is now. */
  from: string;
  to: string;
  /** The plan field(s) it changed, for the honest "applied or recorded" verdict. */
  waterKinds?: Array<keyof WaterPlan>;
}

export type LayerEditVerdict =
  | { kind: 'none' }
  | { kind: 'changed'; data: MapPlanData; changes: LayerChange[]; frameChanged: boolean }
  | { kind: 'refused'; layer: EditableLayer; reason: string };

const norm = (s: string): string => String(s ?? '').normalize('NFKC').toLowerCase();

/** The message asks for a change (not a question about the map). */
const CHANGE_VERB = /\b(?:karo|kar\s*do|kardo|kar\s*de|karein|kare|kijiye|kro|banao|bana\s*do|banado|badlo|badal\s*do|badaldo|change|make|turn|set|chahiye|chahie|daalo|dalo|daal\s*do|add|hatao|hata\s*do|remove|delete|replace|instead|jagah|rakho|rakh\s*do)\b|करो|कर\s*दो|बनाओ|बदलो|बदल\s*दो|चाहिए|डालो|हटाओ|जगह|रखो/u;
const MAP_WORD = /\b(?:map|maps|naksha|nakshe|world|duniya)\b|नक्शा|नक्शे|मैप/u;
const ROAD_WORD = /\b(?:roads?|sadak\w*|sadk\w*|streets?|gali\w*|lanes?|highways?|rasta|raste|raaste)\b|सड़क|सडक|गली|रास्त/u;
const EDGE_WORD = /\b(?:kinar\w*|edges?|boundary|border|seema)\b|किनार\S*|सीमा/u;
/** A colony itself: its size or crowding is the density layer. */
const COLONY_WORD = /\b(?:colony|colonies|coloni\w*|basti\w*|mohall\w*|plots)\b|कॉलोनी|बस्ती|मोहल्ल/u;
/** Houses as a NUMBER ("zyada ghar", "more houses", "kam makaan") — never one house made bigger ("hero ka ghar bada karo"). */
const HOUSE_COUNT = /\b(?:zyada|jyada|more|kam|fewer|less|ghane)\s+(?:ghar|gharon|houses|makaan|makan|buildings|imaratein)\b|\b(?:ghar|gharon|houses|makaan|makan|buildings|imaratein)\s+(?:zyada|jyada|kam|badhao|ghatao)\b|ज़्यादा\s+घर|ज्यादा\s+घर|कम\s+घर/u;
/** A verb of making or putting, right after a water word with at most two words between ("ek jheel banao", "talab bhi daalo"). */
const VERB_RIGHT_AFTER = /^\s*(?:[\p{L}\p{M}]+\s+){0,2}?(?:karo|kar\s*do|banao|bana\s*do|daalo|dalo|daal\s*do|add|chahiye|rakho|करो|बनाओ|डालो|चाहिए)/u;
const GROW = /\b(?:badi|bada|bade|badhao|badha\w*|zyada|jyada|more|bigger|larger|dense|denser|ghani|ghana|bhari)\b|बड़ी|बड़ा|ज़्यादा|ज्यादा|घनी/u;
const SHRINK = /\b(?:chhoti|choti|chhota|chota|kam|less|fewer|smaller|sparse|halki)\b|छोटी|छोटा|कम/u;
const REPLACE_HI = /\b(?:ki|ke)\s+jagah\b|\b(?:ki|ke)\s+bajaye\b|की\s+जगह|के\s+बजाय|के\s+बजाए/u;
const REMOVE = /\b(?:hatao|hata\s*do|hatado|remove|delete|nikalo|nikal\s*do|mat|nahi\s+chahiye|nahin\s+chahiye|no\s+more)\b|हटाओ|हटा\s*दो|नहीं\s+चाहिए/u;
const ADD_MORE = /\b(?:aur|more|add|extra|ek\s+aur)\b|और/u;

const KIND_WORD: Record<keyof Omit<WaterPlan, 'sea'>, string> = { rivers: 'river', lakes: 'lake', ponds: 'pond', canals: 'canal' };
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const DENSITY_ORDER: readonly Density[] = ['sparse', 'normal', 'dense'];
const DENSITY_WHAT: Record<Density, string> = { sparse: 'sparse (a village)', normal: 'normal', dense: 'dense (a crowded city)' };
const ROAD_WHAT: Record<RoadStyle, string> = { grid: 'a smart-city grid with highways', highway: 'highways between superblocks', organic: 'random, winding old-town lanes', hill: 'curvy hill roads', straight: 'long straight roads' };
const EDGE_WHAT: Record<BoundaryKind, string> = { sea: 'the sea', mountains: 'a ring of mountains', canyon: 'a canyon', 'forest-river': 'a forest and river', dunes: 'high dunes', wall: 'a wall' };
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Every water kind named in the text, with where it was said. */
function waterMentions(t: string): Array<{ kind: keyof Omit<WaterPlan, 'sea'>; at: number; end: number }> {
  const out: Array<{ kind: keyof Omit<WaterPlan, 'sea'>; at: number; end: number }> = [];
  for (const [kind, re] of WATER_KINDS) for (const m of t.matchAll(new RegExp(re.source, 'gu'))) out.push({ kind, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out.sort((a, b) => a.at - b.at);
}

function countBefore(t: string, at: number): number | null {
  const word = t.slice(Math.max(0, at - 16), at).trim().split(/\s+/u).pop() ?? '';
  const n = Number(word);
  if (Number.isInteger(n) && n >= 0 && n <= 40) return n;
  return COUNT_WORDS[word] ?? null;
}

function waterEdit(t: string, d: MapPlanData): LayerChange | null {
  const named = waterMentions(t);
  if (named.length === 0) return null;
  const w = { ...d.water };
  const before = describeWater(d.water);
  const kinds = new Set<keyof WaterPlan>();
  const rep = REPLACE_HI.exec(t);
  const instead = /\b(?:instead\s+of|in\s+place\s+of)\b/u.exec(t);
  const replaceWith = /\breplace\b/u.exec(t);
  if (named.length >= 2 && (rep || instead || replaceWith)) {
    let from: keyof Omit<WaterPlan, 'sea'>; let to: keyof Omit<WaterPlan, 'sea'>;
    if (rep) {
      // "nadi ki jagah jheel": the kind before "ki jagah" goes, the one after comes.
      const a = [...named].reverse().find((n) => n.end <= rep.index); const b = named.find((n) => n.at >= rep.index + rep[0].length);
      if (!a || !b) return null;
      from = a.kind; to = b.kind;
    } else if (instead) {
      // "a lake instead of the river": the kind after "instead of" goes.
      const a = named.find((n) => n.at >= instead.index + instead[0].length); const b = named.find((n) => n !== a);
      if (!a || !b) return null;
      from = a.kind; to = b.kind;
    } else {
      // "replace the river with a lake".
      from = named[0].kind; to = named[1].kind;
    }
    if (from === to) return null;
    const moved = Math.max(1, w[from]);
    w[to] = Math.max(w[to], 0) + moved;
    w[from] = 0;
    kinds.add(from); kinds.add(to);
  } else {
    for (const m of named) {
      const after = t.slice(m.end, m.end + 30);
      const beforeText = t.slice(Math.max(0, m.at - 24), m.at);
      if (REMOVE.test(after) || /\b(?:no|without|bina|hatao|remove)\s+(?:\w+\s+)?$/u.test(beforeText)) { w[m.kind] = 0; kinds.add(m.kind); continue; }
      const n = countBefore(t, m.at);
      if (ADD_MORE.test(beforeText) || ADD_MORE.test(after.slice(0, 12))) { w[m.kind] = Math.min(40, w[m.kind] + (n ?? 1)); kinds.add(m.kind); continue; }
      if (n !== null && VERB_RIGHT_AFTER.test(after)) { w[m.kind] = Math.min(40, n); kinds.add(m.kind); continue; }
      // A water word in passing ("nadi ke upar pul banao") is not a wish for water: only one with its own verb is.
      if (VERB_RIGHT_AFTER.test(after)) { w[m.kind] = Math.max(1, w[m.kind]); kinds.add(m.kind); }
    }
  }
  const changed = [...kinds].filter((k) => w[k] !== d.water[k]);
  if (changed.length === 0) return null;
  d.water = w;
  return { layer: 'water', from: before, to: describeWater(w), waterKinds: changed };
}

export function describeWater(w: WaterPlan): string {
  const parts = [w.sea ? 'the sea' : '', ...(['rivers', 'lakes', 'ponds', 'canals'] as const).filter((k) => w[k] > 0).map((k) => plural(w[k], KIND_WORD[k]))].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no water of its own';
}

const FACTOR_RE = /(\d+(?:[.,]\d+)?)\s*(?:x|guna|gunaa|times|गुना)\b|\b(?:x|×)\s*(\d+(?:[.,]\d+)?)\b/u;
function frameFactor(t: string): number | null {
  const m = FACTOR_RE.exec(t);
  const n = m ? Number((m[1] ?? m[2]).replace(',', '.')) : NaN;
  const smaller = SHRINK.test(t) || /\b(?:aadha|adha|half)\b|आधा/u.test(t);
  if (Number.isFinite(n) && n > 0) return smaller && n > 1 ? 1 / n : n;
  if (/\b(?:double|dugna|doguna|do\s+guna)\b|दुगना|दोगुना/u.test(t)) return smaller ? 0.5 : 2;
  if (/\b(?:triple|tigna|teen\s+guna)\b|तिगुना/u.test(t)) return smaller ? 1 / 3 : 3;
  if (/\b(?:aadha|adha|half)\b|आधा/u.test(t)) return 0.5;
  return null;
}

function frameEdit(t: string, d: MapPlanData, openWorld: boolean): LayerChange | { refused: string } | null {
  if (!MAP_WORD.test(t)) return null;
  const said = areaKm2In(t);
  const factor = said && said.said !== 'word' ? null : frameFactor(t);
  if (!(said && said.said !== 'word') && factor === null) return null;
  if (openWorld) {
    return { refused: 'In this open-world game the map\'s size is set by where its places stand (src/game/world.ts), so the plan\'s frame was not changed. Say the size in km — for example "map 40 km x 40 km" — and the platform lays the places across it.' };
  }
  const area = said && said.said !== 'word' ? said.areaKm2 : d.areaKm2 * (factor as number);
  const side = Math.max(1, Math.min(1000, Math.sqrt(area)));
  const sideKm = round2(side);
  const areaKm2 = round2(side * side);
  if (Math.abs(sideKm - d.sideKm) < 0.005) return null;
  const from = `${d.sideKm} x ${d.sideKm} km (${d.areaKm2} km²)`;
  d.sideKm = sideKm; d.areaKm2 = areaKm2;
  return { layer: 'frame', from, to: `${sideKm} x ${sideKm} km (${areaKm2} km²)${factor !== null ? ` — ${factor >= 1 ? `${round2(factor)} times the area` : `${round2(factor)} of the area`}` : ''}` };
}

/**
 * Read a follow-up message against the game's current plan and return the changed plan, or why it cannot be changed, or 'none' when
 * the message does not ask to change a map layer. `openWorld`: the game keeps its places in src/game/world.ts (the open-world kit).
 */
export function mapLayerEditsIn(request: string | null | undefined, current: MapPlanData, opts: { openWorld?: boolean } = {}): LayerEditVerdict {
  try {
    const t = norm(String(request ?? ''));
    if (!t || !CHANGE_VERB.test(t)) return { kind: 'none' };
    const d: MapPlanData = { ...current, water: { ...current.water } };
    const changes: LayerChange[] = [];
    let frameChanged = false;
    // FRAME — "map 2 guna bada karo", "map 10 km karo".
    const frame = frameEdit(t, d, opts.openWorld === true);
    if (frame && 'refused' in frame) return { kind: 'refused', layer: 'frame', reason: frame.refused };
    if (frame) { changes.push(frame); frameChanged = true; }
    // ROADS — "sadkein tedhi-medhi karo".
    if (ROAD_WORD.test(t)) {
      const style = roadStyleIn(t);
      if (style && style !== d.roadStyle) { changes.push({ layer: 'roadStyle', from: ROAD_WHAT[d.roadStyle], to: ROAD_WHAT[style] }); d.roadStyle = style; }
    }
    // EDGE — "kinara pahaadon wala karo", "pahaadon se ghira karo".
    const edgeText = EDGE_WORD.test(t) ? t.replace(new RegExp(EDGE_WORD.source, 'gu'), ' boundary ') : t;
    const edge = EDGE_WORD.test(t) || /\b(?:ghira|ghiri|ghire|surrounded)\b|घिरा/u.test(t) ? boundaryIn(edgeText) : null;
    if (edge && edge !== d.boundary) {
      if (ARCHETYPES[d.archetype].mode === 'loop') {
        return { kind: 'refused', layer: 'boundary', reason: `This map loops round at its edges (${d.archetype} land), so it has no edge to change. An edge needs a map with a shore, such as an island or a battle royale map — ask for that, and the edge can be ${EDGE_WHAT[edge]}.` };
      }
      changes.push({ layer: 'boundary', from: EDGE_WHAT[d.boundary], to: EDGE_WHAT[edge] }); d.boundary = edge;
    }
    // WATER — "nadi ki jagah jheel karo", "3 talaab daalo", "talab hatao".
    const water = waterEdit(t, d);
    if (water) changes.push(water);
    // DENSITY — "colony badi karo", "ghani basti", "kam ghar".
    if ((COLONY_WORD.test(t) || HOUSE_COUNT.test(t)) && !/\b(?:andar|inside|enter|darwaz\w*|door)\b|अंदर/u.test(t)) {
      const explicit = densityIn(t);
      const i = DENSITY_ORDER.indexOf(d.density);
      const next: Density | null = explicit ?? (GROW.test(t) ? DENSITY_ORDER[Math.min(2, i + 1)] : SHRINK.test(t) ? DENSITY_ORDER[Math.max(0, i - 1)] : null);
      if (next && next !== d.density) { changes.push({ layer: 'density', from: DENSITY_WHAT[d.density], to: DENSITY_WHAT[next] }); d.density = next; }
      else if (next && next === d.density && (GROW.test(t) || SHRINK.test(t)) && changes.length === 0) {
        return { kind: 'refused', layer: 'density', reason: `The colonies are already as ${next === 'dense' ? 'dense' : 'sparse'} as the plan allows (${DENSITY_WHAT[next]}).` };
      }
    }
    if (changes.length === 0) return { kind: 'none' };
    return { kind: 'changed', data: d, changes, frameChanged };
  } catch {
    return { kind: 'none' };
  }
}

/**
 * Per change, is it built into this world or only recorded? Read from the world's own layer verdict (appliedMapLayers) — and the two
 * honest exceptions inside a layer: a road style is laid only on maps up to 25 km, and of the water only the ponds are built (the world
 * makes its own rivers and lakes).
 */
export function changeVerdict(c: LayerChange, applied: Record<MapLayer, boolean>, d: MapPlanData): { built: boolean; why?: string } {
  if (c.layer === 'frame') return { built: true };
  if (c.layer === 'roadStyle') {
    if (!applied.roadStyle) return { built: false, why: 'this world does not lay road styles yet' };
    return d.sideKm <= 25 ? { built: true } : { built: false, why: `a map wider than 25 km keeps its regional village roads (this one is ${d.sideKm} km)` };
  }
  if (c.layer === 'boundary') return applied.boundary ? { built: true } : { built: false, why: 'this world does not build natural edges yet' };
  if (c.layer === 'density') return applied.density ? { built: true } : { built: false, why: 'the colonies layer (the houses between the roads) is not built into this world yet' };
  const kinds = c.waterKinds ?? [];
  if (kinds.length && kinds.every((k) => k === 'ponds')) return applied.water ? { built: true } : { built: false, why: 'this world does not carve ponds yet' };
  if (kinds.includes('ponds') && applied.water) return { built: true, why: 'the ponds are carved; the world makes its own rivers and lakes, so their counts are recorded only' };
  return { built: false, why: 'the world makes its own rivers and lakes, so their counts are recorded in the plan, not carved' };
}

export const LAYER_NAME: Record<EditableLayer, string> = { frame: 'the map size', boundary: 'the edge', water: 'the water', roadStyle: 'the roads', density: 'the colonies' };
