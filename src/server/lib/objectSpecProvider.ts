// WHEN THE LIST DOES NOT HAVE IT — get the spec from the provider, and never ship an improvised blob.
//
// Admin, 2026-09-14: *"koi aisa object jo apni list me hai hi nahi, to provider se banwao — ek dam
// realistic aur game fit hona chahiye object."*
//
// ── WHY A SPEC AND NOT A MODEL ────────────────────────────────────────────────────────────────────
// The obvious reading is "ask an AI to generate the 3D model". That is a real product (Meshy, Tripo),
// it costs real money per object, takes 30-120 seconds, and returns a mesh we would then have to host,
// licence and attribute. It also breaks the admin's own bar for this engine — *"chutkiyon ka kaam"*,
// minutes and no struggle. So this is deliberately NOT that, and the difference is stated here rather
// than discovered later.
//
// What it does instead is the thing that actually fixed the reported bike: the model was never bad at
// BUILDING geometry — `createCar` proves it builds beautifully when it knows what it is building. It
// was bad at DECIDING what a bike is, because nothing told it, so it went straight to primitives. A
// spec — real dimensions, the parts, the one proportion that carries the silhouette — is the whole
// missing input, it costs one small JSON response, and it is reusable for every future build.
//
// ── THE LADDER, CHEAPEST FIRST ────────────────────────────────────────────────────────────────────
//   1. THE CATALOGUE (100 objects) — instant, free, and checked by a human.
//   2. THE CACHE — a spec generated once is reused for every later build of that object.
//   3. THE PROVIDER — one small call, STRICTLY validated before it is allowed to reach a build.
//   4. THE PROTOCOL — if all of that fails, the model is taught to write its own spec BEFORE it
//      models. Zero cost, always available, and strictly better than improvising.
//
// 🔒 STEP 4 IS WHY THIS CAN NEVER FAIL A BUILD. Every other step is an optimisation on top of it. A
// provider that is down, rate-limited or talking nonsense costs nothing and changes nothing.

import type { CatalogEntry } from './objectCatalogTypes';

/** A spec good enough to build from — the same shape a catalogue entry exposes to the builder. */
export interface ObjectSpec {
  name: string;
  dims: string;
  parts: string[];
  tell: string;
  /** Where it came from. Honest by construction — the build report prints this. */
  source: 'catalog' | 'cache' | 'provider' | 'protocol';
}

/** How the model is asked. Kept here so the wording is testable and versioned with the parser. */
export const SPEC_SYSTEM_PROMPT =
  'You describe real-world objects so a 3D artist can model them for a game. You answer ONLY with '
  + 'JSON. You never guess a measurement you are unsure of — you give the typical real size of the '
  + 'ordinary version of the thing, in metres.';

/**
 * The request. Asks for exactly the four fields the builder needs and nothing else.
 *
 * ⚠️ The "tell" is the field that matters most and the one a model will skip if not pushed, so it is
 * asked for last and described concretely. It is what turned a red capsule into a motorcycle: *"a bike
 * is mostly air; the wheels sit far apart with daylight under the engine."*
 */
export function specPrompt(objectName: string): string {
  return [
    'Describe this object so it can be modelled for a 3D game: "' + objectName + '".',
    '',
    'Answer with ONLY this JSON, no prose, no code fence:',
    '{',
    '  "name": "the common name",',
    '  "dims": "its real size in METRES — length, width, height, and any proportion that defines it '
      + '(wheelbase, wingspan, seat height). Real measurements of the ordinary version.",',
    '  "parts": ["6 to 10 parts it cannot read as itself without, most-defining first"],',
    '  "tell": "ONE sentence: the single proportion or property that carries its silhouette, and what '
      + 'it looks like instead when that is got wrong."',
    '}',
    '',
    'Rules: metres only. Real measurements, not round numbers chosen to look tidy. Parts must be '
    + 'things you can SEE from outside. The tell must name a mistake, not just praise a feature.',
  ].join('\n');
}

/** Anything shorter than this in `tell` is a platitude, not a usable instruction. */
const MIN_TELL = 30;
const MIN_PARTS = 4;
const MAX_PARTS = 14;

/**
 * Validate a provider answer. Returns null for ANYTHING that is not clearly usable.
 *
 * 🔴 STRICT ON PURPOSE, AND THE BAR IS "WOULD I PUT THIS IN THE CATALOGUE BY HAND?". A spec reaches
 * the builder as fact, so a confident wrong dimension is worse than no spec at all — the model would
 * build to it, and the result would look deliberate and be wrong. The protocol fallback is always
 * available, so rejecting is cheap and accepting rubbish is not.
 */
export function parseProviderSpec(raw: string | null | undefined): Omit<ObjectSpec, 'source'> | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  // Models wrap JSON in a fence more often than not; take the outermost object either way.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const r = obj as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const dims = typeof r.dims === 'string' ? r.dims.trim() : '';
  const tell = typeof r.tell === 'string' ? r.tell.trim() : '';
  const parts = Array.isArray(r.parts)
    ? r.parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 2).map((p) => p.trim())
    : [];

  if (!name || name.length > 80) return null;
  // The dimensions must actually BE dimensions: a number and a metre unit. "about the size of a car"
  // is exactly the useless answer this whole file exists to replace.
  if (!/\d/.test(dims) || !/\bm\b|metre|meter/i.test(dims)) return null;
  if (dims.length < 15 || dims.length > 400) return null;
  if (parts.length < MIN_PARTS) return null;
  if (tell.length < MIN_TELL || tell.length > 500) return null;

  return { name, dims, parts: parts.slice(0, MAX_PARTS), tell };
}

/**
 * The always-available fallback: teach the model to write the spec ITSELF before it models anything.
 *
 * This is the floor the whole feature stands on. It costs nothing, cannot fail, and is already a large
 * improvement on the reported behaviour — the bike was not badly built, it was built without anyone
 * having decided what a bike is.
 */
export function genericObjectProtocol(objectName?: string): string {
  const it = objectName && objectName.trim() ? '"' + objectName.trim() + '"' : 'any object';
  return [
    'NO LIBRARY BUILDER AND NO STORED SPEC FOR ' + it.toUpperCase() + '. So SPEC FIRST, THEN MODEL —',
    'never go straight to primitives. Before you write a line of geometry, write down, in a comment',
    'above the builder function:',
    '  1. its REAL size in metres (length, width, height, and the proportion that defines it);',
    '  2. the 6-10 parts it cannot read as itself without;',
    '  3. the ONE proportion that carries its silhouette, and what it looks like when that is wrong.',
    'Then build to exactly that, give each part its own material, and make any light EMIT.',
    'Two or three primitives stuck together is never an acceptable answer for something the player',
    'looks at for the whole game.',
  ].join('\n');
}

/** What `resolveObjectSpec` needs from the outside world. Injected, so the logic stays testable. */
export interface SpecDeps {
  /** The 100-object catalogue lookup. */
  findInCatalog: (name: string) => CatalogEntry | undefined;
  /** Process or durable cache. Both optional — absence just means a cache miss. */
  cacheGet?: (key: string) => Omit<ObjectSpec, 'source'> | undefined;
  cacheSet?: (key: string, spec: Omit<ObjectSpec, 'source'>) => void;
  /** Ask the provider. MUST resolve, never throw — callers wrap their router. */
  ask?: (prompt: string, system: string) => Promise<string | null>;
}

/** Normalised cache key: an object is the same object however it was typed. */
export function specKey(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Resolve a spec for one object, cheapest source first. NEVER throws and NEVER returns null — the
 * protocol is the floor.
 */
export async function resolveObjectSpec(name: string, deps: SpecDeps): Promise<ObjectSpec> {
  const asked = String(name ?? '').trim();
  const key = specKey(asked);
  const fallback = (): ObjectSpec => ({
    name: asked || 'object', dims: '', parts: [], tell: '', source: 'protocol',
  });
  if (!key) return fallback();

  try {
    const hit = deps.findInCatalog(asked);
    if (hit) {
      return { name: hit.name, dims: hit.dims, parts: [...hit.parts], tell: hit.tell, source: 'catalog' };
    }
    const cached = deps.cacheGet?.(key);
    if (cached) return { ...cached, source: 'cache' };

    if (!deps.ask) return fallback();
    const raw = await deps.ask(specPrompt(asked), SPEC_SYSTEM_PROMPT);
    const parsed = parseProviderSpec(raw);
    if (!parsed) return fallback();
    deps.cacheSet?.(key, parsed);
    return { ...parsed, source: 'provider' };
  } catch {
    // A spec is an optimisation. Nothing about it may ever reach a build as an error.
    return fallback();
  }
}

/** Render a resolved spec as the block the builder reads. PURE. */
export function renderSpec(spec: ObjectSpec, opts: { builder?: string; realTier?: boolean } = {}): string {
  if (spec.source === 'protocol') return genericObjectProtocol(spec.name);
  const lines = [
    'OBJECT SPEC — ' + spec.name.toUpperCase(),
    opts.builder
      ? '  BUILD IT WITH ' + opts.builder + ' from objects.ts. Do NOT hand-model it.'
      : '  There is no library builder for this one, so HAND-MODEL it to this spec — never as two or '
        + 'three primitives stuck together.',
    '  Real size: ' + spec.dims + '. Use these numbers; do not round them to look tidy.',
    '  Must have: ' + spec.parts.join('; ') + '.',
    '  The tell: ' + spec.tell,
  ];
  if (opts.realTier) {
    lines.push('  The user asked for REAL: build EVERY part, give each its own material, and make any '
      + 'light EMIT. Say "real-looking", never "photorealistic".');
  }
  return lines.join('\n');
}

/**
 * A process-level cache. Bounded, because an unbounded map fed by user prompts is a memory leak with a
 * friendly name.
 *
 * ⚠️ PER-INSTANCE, and that is stated rather than hidden: Cloud Run runs several, so the same object
 * may be generated once per instance. That is a few cents, not a problem — and a DURABLE cache is the
 * obvious next step, which is why `SpecDeps` takes the cache as an injection rather than reaching for
 * a store in here. The `OBJECT_SPEC_LEARNED` report line is the other half: an object that keeps being
 * asked for should be promoted into the permanent catalogue by hand, where it is checked.
 */
const MAX_CACHE = 400;
const memory = new Map<string, Omit<ObjectSpec, 'source'>>();
export const memoryCache = {
  get: (k: string): Omit<ObjectSpec, 'source'> | undefined => memory.get(k),
  set: (k: string, v: Omit<ObjectSpec, 'source'>): void => {
    if (memory.size >= MAX_CACHE) {
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(k, v);
  },
  size: (): number => memory.size,
  clear: (): void => { memory.clear(); },
};
