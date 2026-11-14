/** Planning evidence only: no inferred phone model, benchmark or automatic asset activation. */
import { buildGameContract } from '../gameIntent';
import { gameAssetRequirements } from './assetPlan';
import { REVIEWED_GAME_ASSETS } from './providers';
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
