// THE HERO OBJECTS — what this game is about, how big they really are, and how to put them in a scene.
//
// ── THE REPORT (admin screenshot, 2026-09-14) ─────────────────────────────────────────────────────
// A bike racing game. The bike was a red capsule lying across two grey cylinders. *"Object ek dam
// nakli se bante hai, farzi object lagte hai."*
//
// The cause was not the realism switch and not the lighting. `realismIntent.ts` (the admin\'s own
// 2026-08-27 instruction) already read real/asli/realistic from INTENTION; `objects.ts` already built
// genuinely good things at that tier; the build prompt already ordered, in capitals, *"build every
// object with objects.ts rather than hand-modelling shapes."* 🔴 **And none of it could help, because
// the library had no BIKE** — so that order was one the model could not obey. It hand-modelled with
// no spec, and three primitives is what free-form hand-modelling produces. `setDetailLevel` could not
// rescue it either: the tier only ever reaches objects.ts builders.
//
// ── SO THIS FILE ANSWERS THREE QUESTIONS, AND THE THIRD IS THE ONE THAT MAKES IT PERMANENT ────────
//   1. WHAT does this game need?      → `objectCatalog.ts`, 100 objects with real measurements.
//   2. HOW is that kind of thing put into a scene? → `PLACEMENT`, per CATEGORY, because a perfectly
//      modelled car floating 20 cm above the road with no contact shadow looks FAKER than a crude car
//      that is planted, shadowed and rolling. Placement is most of what the eye reads as "real", and
//      it is the part an improvising builder skips first because nothing errors when it is missing.
//   3. WHAT IF IT IS NOT IN THE LIST?  → `objectSpecProvider.ts`. A hundred-object list meets its
//      hundred-and-first request the same week; without an answer for that case this is the reported
//      bug again, one object later.
//
// PURE: prompt in, contract out. No clock, no I/O, no env.

import { realismIntent, type RealismTier } from './realismIntent';
import { OBJECT_CATALOG } from './objectCatalog';
import { PLACEMENT, compileMatch, type CatalogEntry, type ObjectCategory } from './objectCatalogTypes';
import { genericObjectProtocol } from './objectSpecProvider';

export interface HeroObjectSpec extends CatalogEntry {
  /** Compiled once at module load — see objectCatalogTypes for why it is built rather than written. */
  match: RegExp;
}

/** The catalogue, with matchers compiled. */
export const HERO_OBJECTS: readonly HeroObjectSpec[] = Object.freeze(
  OBJECT_CATALOG.map((e) => ({ ...e, match: compileMatch(e) })),
);

/** Look one up by name — the first step of the spec ladder, and free. */
export function findInCatalog(name: string): HeroObjectSpec | undefined {
  const text = String(name ?? '').trim();
  if (!text) return undefined;
  return HERO_OBJECTS.find((s) => s.id === text.toLowerCase() || s.match.test(text));
}

export interface HeroObjectContract {
  specs: HeroObjectSpec[];
  /** The distinct categories present — the placement teaching is keyed by these. */
  categories: ObjectCategory[];
  tier: RealismTier;
  /** The prompt block to hand the builder. Empty when there is nothing to say. */
  block: string;
}

/**
 * How many objects and how many placement blocks may reach one prompt.
 *
 * ⚠️ A WALL OF TEXT IS IGNORED, so "more" is not automatically better here even though the catalogue
 * is. Six objects covers every prompt anyone actually types ("a 3d village with houses, trees, a river
 * and cows" is four); four placement blocks covers the kinds those six fall into.
 */
const MAX_SPECS = 6;
const MAX_PLACEMENT = 4;

/** Which hero objects does this prompt need, what must be true of each, and how are they placed? */
export function heroObjectContract(prompt: string | null | undefined): HeroObjectContract {
  const text = String(prompt ?? '');
  const tier = realismIntent(text).tier;
  const empty: HeroObjectContract = { specs: [], categories: [], tier, block: '' };
  if (!text.trim()) return empty;

  const specs = HERO_OBJECTS.filter((s) => s.match.test(text)).slice(0, MAX_SPECS);
  if (specs.length === 0) return empty;

  const categories: ObjectCategory[] = [];
  for (const s of specs) if (!categories.includes(s.category)) categories.push(s.category);

  const lines: string[] = [];
  lines.push('HERO OBJECTS — what this game is actually about, and what each one must be:');
  for (const s of specs) {
    lines.push('');
    lines.push('• ' + s.name.toUpperCase());
    lines.push(s.builder
      // A builder that exists and is not used is the reported failure, inverted.
      ? '  BUILD IT WITH ' + s.builder + ' from objects.ts. Do NOT hand-model it — the library version '
        + 'already has the real proportions and every part below.'
      : '  There is no library builder for this one, so HAND-MODEL it to this spec — never as two or '
        + 'three primitives stuck together.');
    lines.push('  Real size: ' + s.dims + '. Use these numbers; do not round them to look tidy.');
    lines.push('  Must have: ' + s.parts.join('; ') + '.');
    lines.push('  The tell: ' + s.tell);
  }

  // ── HOW TO PUT IT IN THE SCENE ──────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('HOW TO PLACE THEM — this is half of whether the scene reads as real. A perfectly');
  lines.push('modelled car hovering above the road with no contact shadow looks FAKER than a crude car');
  lines.push('that is planted, shadowed and rolling.');
  for (const c of categories.slice(0, MAX_PLACEMENT)) {
    const p = PLACEMENT[c];
    lines.push('');
    lines.push('▸ ' + c.toUpperCase() + ' — ' + p.headline);
    for (const r of p.rules) lines.push('  - ' + r);
  }

  lines.push('');
  lines.push(tier === 'real'
    ? 'The user asked for REAL, so build EVERY part listed above, give each its own material '
      + '(surfaceMaterial for anything the player gets close to), call applyEnvironment so there is '
      + 'something to reflect, and make any light EMIT. Say "real-looking" in your summary — never '
      + '"photorealistic", which this cannot deliver.'
    : 'The user did not ask for realism, so the parts above may be simplified — but the SIZES, the '
      + 'tell and every placement rule still apply. A wrong-proportioned or floating object looks '
      + 'broken at every detail level, and getting those right costs no frames on a phone.');

  // ── AND FOR ANYTHING NOT IN THE LIST ────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('ANY OTHER OBJECT THIS GAME NEEDS: call the object_spec tool with its name FIRST. It '
    + 'returns real dimensions, the required parts and the tell — the same contract as above, for '
    + 'anything the list does not carry. If that is unavailable, do this instead:');
  lines.push(genericObjectProtocol());

  return { specs, categories, tier, block: lines.join('\n') };
}

/** The matched object ids, for the build report. PURE. */
export function heroObjectIds(prompt: string | null | undefined): string[] {
  return heroObjectContract(prompt).specs.map((s) => s.id);
}
