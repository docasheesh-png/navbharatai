/**
 * ✨ ANY EFFECT THE USER IMAGINES, MADE AS DATA (admin 2026-11-24: "navbharatai api call se user ki sabhi ulti sidhi
 * imagination ko real banaye").
 *
 * The kit's particles (src/game/fx/particles.ts) draw any effect described by one ParticleSpec — how many particles, their
 * colour from birth to death, size, life, speed, spread, gravity, glow. A request in any words ("aag ka bawandar", "rainbow
 * trail", "magic sparkles when the coin is taken") is designed by ONE model call as that spec, checked by the same limits the
 * kit applies, and written to src/game/effects/<name>.ts, which the kit reads by itself: ctx.particles.burst('<name>', x, y, z).
 * An effect the kit already has (muzzleFlash, impact, dust, explosion, smoke, sparks, heal, pickup, blood) asks no model.
 * The same free model path as generate_stand_in.
 */
import { firstJson } from './composeAction';

export type EffectAsk = (prompt: string) => Promise<{ text: string } | null>;

export interface EffectSpec {
  name: string; count: number; color: number; colorEnd?: number; size: number; sizeEnd?: number;
  life: number; speed: number; spread: number; gravity: number; additive: boolean; drag?: number;
}

const SHAPE = '{"name":"fire-tornado","count":80,"color":"#fff1a8","colorEnd":"#d0350a","size":0.4,"sizeEnd":0.05,"life":1.2,"speed":6,"spread":1.0,"gravity":4,"additive":true,"drag":1.5}';

export function effectPrompt(name: string, description: string): string {
  return [
    'Design ONE particle effect for a 3D game as JSON. No prose, no code.',
    `Shape: ${SHAPE}`,
    'count 1–200 particles; colours as "#rrggbb" (start → end of each particle\'s life); size and sizeEnd in metres; life in seconds (0.05–5);',
    'speed in m/s (0–40); spread 0 (a narrow jet) to 3.2 (every direction); gravity in m/s² (negative falls, positive rises);',
    'additive true for anything that glows (fire, magic, sparks), false for smoke, dust, liquids; drag 0–10 slows particles.',
    `Effect: ${String(name).slice(0, 40)}`,
    description ? `What it should look like: ${String(description).slice(0, 200)}` : '',
  ].filter(Boolean).join('\n');
}

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
function colour(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(0xffffff, Math.max(0, Math.round(v)));
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim())) return parseInt(v.trim().replace('#', ''), 16);
  return null;
}
const slug = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** A well-formed effect, clamped to what a phone can draw, or null. PURE. */
export function validateEffect(raw: unknown, nameHint?: string): EffectSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = slug(typeof r.name === 'string' && r.name.trim() ? r.name : String(nameHint ?? ''));
  const color = colour(r.color);
  const count = num(r.count, 1, 200); const size = num(r.size, 0.01, 3); const life = num(r.life, 0.05, 5);
  const speed = num(r.speed, 0, 40); const spread = num(r.spread, 0, 3.2); const gravity = num(r.gravity, -40, 40);
  if (!name || color === null || count === null || size === null || life === null || speed === null || spread === null || gravity === null) return null;
  const out: EffectSpec = { name, count: Math.round(count), color, size, life, speed, spread, gravity, additive: r.additive === true };
  const ce = colour(r.colorEnd); if (ce !== null) out.colorEnd = ce;
  const se = num(r.sizeEnd, 0, 5); if (se !== null) out.sizeEnd = se;
  const dr = num(r.drag, 0, 10); if (dr !== null) out.drag = dr;
  return out;
}

export type ComposedEffect =
  | { kind: 'library'; name: string }
  | { kind: 'made'; spec: EffectSpec; path: string; source: string; fromModel: boolean }
  | { kind: 'refused'; reason: string };

/** The kit's own presets (src/game/fx/particles.ts PARTICLE_PRESETS) — a census test keeps this list in step. */
export const KIT_EFFECTS: readonly string[] = ['muzzleFlash', 'impact', 'dust', 'explosion', 'smoke', 'sparks', 'heal', 'pickup', 'blood'];
const PRESETS: ReadonlySet<string> = new Set(KIT_EFFECTS);

export async function composeEffect(name: string, description: string, ask: EffectAsk, supplied?: string): Promise<ComposedEffect> {
  const raw = String(name ?? '').trim();
  const preset = [...PRESETS].find((p) => p.toLowerCase() === raw.toLowerCase().replace(/[^a-z]/g, ''));
  if (preset && !supplied) return { kind: 'library', name: preset };
  const key = slug(raw);
  if (!key) return { kind: 'refused', reason: 'Name the effect in a few words (for example "fire tornado").' };
  let plan: unknown = null;
  let fromModel = false;
  if (supplied) plan = firstJson(supplied);
  else {
    const reply = await ask(effectPrompt(key, description)).catch(() => null);
    if (!reply) return { kind: 'refused', reason: 'The effect could not be designed right now (no model answered). Pass effect_json yourself in the same shape, or use the closest kit effect.' };
    plan = firstJson(reply.text);
    fromModel = true;
  }
  const spec = validateEffect(plan, key);
  if (!spec) return { kind: 'refused', reason: 'The effect plan did not validate (it needs a colour, a count, a size, a life, a speed, a spread and a gravity). Nothing was written.' };
  spec.name = key;
  return {
    kind: 'made', spec, fromModel,
    path: `src/game/effects/${key}.ts`,
    source: [
      `// The "${key}" effect, made by NavBharatAI. ctx.particles.burst('${key}', x, y, z) plays it (src/game/fx/particles.ts reads this file).`,
      '// Change a number to change the look: count, colour → colorEnd over its life, size → sizeEnd, life (s), speed, spread, gravity.',
      '',
      `export const EFFECT = ${JSON.stringify(spec, null, 2)};`,
      '',
    ].join('\n'),
  };
}
