/** Planning evidence only: no inferred phone model, benchmark or automatic asset activation. */
import { buildGameContract } from '../gameIntent';
import { gameAssetRequirements } from './assetPlan';
import { REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';
import { sceneryFor } from './worldDressing';
import { searchGameLibrary } from './gameLibrary';
export interface LibraryRequest {
  prompt: string;
  requirements?: ReadonlyArray<{ subject: string; role?: 'player' | 'opponent' | 'environment' | 'prop'; animation?: string }>;
  device?: { profile?: 'conservative-mobile' | 'standard-web'; webgl2?: boolean };
}
export function planGameLibrary(input: LibraryRequest) {
  const prompt = String(input.prompt ?? '').slice(0, 4000);
  const explicit = (input.requirements ?? []).slice(0, 16).map(r => ({
    subject: String(r.subject ?? '').trim().slice(0, 64),
    role: (['player','opponent','environment','prop'].includes(r.role ?? '') ? r.role : undefined) ?? 'prop',
    animation: r.animation ? String(r.animation).slice(0, 64) : undefined,
  })).filter(r => r.subject);
  const requested = explicit.length ? explicit : gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => ({ ...r, role: 'prop' }));
  const scenery = sceneryFor(prompt);
  const subjects = new Set(requested.map(r => r.subject));
  const suggestions = (scenery?.subjects ?? []).filter(subject => !subjects.has(subject)).map(subject => ({ subject, role: 'environment', animation: undefined }));
  const profile = input.device?.profile === 'standard-web' ? 'standard-web' : 'conservative-mobile';
  // Planning ceilings, NOT measured capability and never substituted for the renderer's real checks.
  const budget = profile === 'conservative-mobile'
    ? { maxVisibleTriangles: 50000, maxDrawCalls: 80, maxAnimatedCharacters: 2, maxPixelRatio: 1 }
    : { maxVisibleTriangles: 150000, maxDrawCalls: 150, maxAnimatedCharacters: 4, maxPixelRatio: 1.5 };
  const compatible = input.device?.webgl2 === false ? 'unsupported-3d-runtime' : 'unmeasured';
  const select = (r: typeof requested[number], required: boolean) => {
    const found = searchGameLibrary({ query: r.subject, animation: r.animation, limit: 3 });
    return { ...r, required, candidates: compatible === 'unsupported-3d-runtime' ? [] : found.entries,
      missing: compatible === 'unsupported-3d-runtime' ? ['Known target does not support the required WebGL2 runtime; offer a 2D alternative without silently changing the request.'] : found.missing,
      deviceFit: compatible, placementVerified: false, gameplayVerified: false };
  };
  return { genre: buildGameContract(prompt).genre, profile, budget, deviceFit: compatible,
    requirements: requested.map(r => select(r, true)), suggestions: suggestions.map(r => select(r, false)),
    warnings: [
      'Automatic prompt extraction is bounded and not exhaustive. Supply explicit requirements for every requested object, map, sound and interaction; an empty list is not completeness.',
      'Explicit subjects and roles take priority. Optional genre scenery is not a substitute for a missing requested asset.',
      'Budgets are conservative planning ceilings, not measured FPS or device certification. Measure the completed scene on the target device.',
      'Player/opponent roles require controls, physics and animation integration; an asset match alone does not implement gameplay.',
      ...(input.requirements && input.requirements.length > 16 ? ['Only the first 16 explicit requirements were planned; split the remaining requirements into another request.'] : []),
    ],
    verificationRequired: ['Actual renderer capability check', 'Finished-scene draw calls/triangles and frame-time measurement', 'Touch and keyboard gameplay', 'Collision/navigation/door and terrain placement checks'],
  };
}

/** Compact automatic builder context; caller has no measured target capabilities, so keep the conservative default. */
export function gameLibraryPlanningHandoff(prompt: string): string {
  const plan=planGameLibrary({prompt});
  const concise=(r: typeof plan.requirements[number])=>({subject:r.subject,role:r.role,required:r.required,animation:r.animation,candidates:r.candidates.map(c=>({id:c.id,availability:c.availability})),missing:r.missing});
  return '[GAME_LIBRARY_REQUIREMENTS]\n'+JSON.stringify({genre:plan.genre,profile:plan.profile,budget:plan.budget,deviceFit:plan.deviceFit,requirements:plan.requirements.map(concise),optionalScenery:plan.suggestions.map(concise),warnings:plan.warnings,verificationRequired:plan.verificationRequired});
}

/**
 * THE LIBRARY BY MEANING, NOT BY WORD (admin 2026-11-20: "words par nahi, intention par depend hona chahiye").
 * The seed and the plan above match the WORDS of a request, so "a story set in a village" got no villager because nobody
 * typed "villager". The builder model reads meaning; it simply never saw what the library holds. This is that menu: one
 * line per category, each subject once, with the animation roles it can play — so the model can call add_library_models
 * for what the game NEEDS. Only shown when the library is on for the account (a menu of tools it cannot use would cost a
 * wasted call per build). Bounded: subjects are the reviewed catalogue's own, never prompt text.
 */
export function gameLibraryMenuHandoff(catalogue: readonly ReviewedAsset[] = REVIEWED_GAME_ASSETS): string {
  const byCategory = new Map<string, Map<string, Set<string>>>();
  for (const c of catalogue) {
    const category = c.libraryCategory ?? 'other';
    const subjects = byCategory.get(category) ?? new Map<string, Set<string>>(); byCategory.set(category, subjects);
    const roles = Object.keys(c.animationRoles ?? {}).filter(r => r !== 'idle');
    for (const s of c.subjects.slice(0, 16)) { const set = subjects.get(s) ?? new Set<string>(); subjects.set(s, set); roles.forEach(r => set.add(r)); }
  }
  const lines = [...byCategory].sort(([a], [b]) => a.localeCompare(b)).map(([category, subjects]) =>
    `${category}: ${[...subjects].sort(([a], [b]) => a.localeCompare(b)).map(([s, roles]) => roles.size ? `${s} (${[...roles].join('/')})` : s).join(', ')}`);
  return '[GAME_LIBRARY_MENU]\n'
    + `Every ready 3D model in the NavBharatAI library, by subject. The models already prepared above were matched from the WORDS of the request; `
    + `choose from this menu by its MEANING. When the game needs something listed here that was not prepared — a village story needs villagers, `
    + `houses and a well even if nobody typed "villager"; a hunting game needs a hunter and animals — call add_library_models with those subjects `
    + `(and the animation role the game uses, in brackets). Add only what the game needs, at most 6 per call. Not listed → build it with the recipes.\n`
    + lines.join('\n');
}
