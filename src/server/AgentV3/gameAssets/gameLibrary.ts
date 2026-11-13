/** One metadata librarian over existing reviewed models and object recipes. No downloads, new assets or paid calls. */
import { OBJECT_CATALOG } from '../../lib/objectCatalog';
import { compileMatch, PLACEMENT, type CatalogEntry, type ObjectCategory } from '../../lib/objectCatalogTypes';
import { ASSET_LIMITS, candidateMatches } from './assetPolicy';
import { gameAssetRequirements } from './assetPlan';
import { REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';

export type LibraryCategory = ObjectCategory | 'maps' | 'audio' | 'other';
export interface GameLibraryEntry {
  id: string;
  name: string;
  category: LibraryCategory;
  kind: 'reviewed-model' | 'recipe' | 'specification';
  subjects: readonly string[];
  builder?: string;
  animations: readonly string[];
  license?: { spdx: string; evidenceUrl: string; attribution: string };
  /** Metadata compatibility is not a downloaded/rendered/placed proof. */
  availability: 'requires-admission' | 'code-recipe' | 'specification-only';
  size: string;
  quality: { deviceCertification: 'not-measured'; runtime: 'Three.js'; admissionLimits?: typeof ASSET_LIMITS };
  placement: readonly string[];
  verification: readonly string[];
}
export interface LibrarySearch {
  query?: string;
  category?: string;
  animation?: string;
  limit?: number;
}
export interface LibraryResult {
  entries: GameLibraryEntry[];
  total: number;
  categories: Array<{ category: LibraryCategory; count: number }>;
  missing: string[];
  notes: string[];
}
const COMMON_CHECKS = [
  'Load the admitted model or generated recipe in the finished game; metadata is not a render test.',
  'Verify scale, orientation, terrain contact, collision and unobstructed player paths.',
  'Run the normal game playtest on keyboard and touch; check performance on the target device.',
];
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const bound = (n: number | undefined) => Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n!))) : 8;
const categories = Object.keys(PLACEMENT) as ObjectCategory[];

export function createGameLibrary(models: readonly ReviewedAsset[] = REVIEWED_GAME_ASSETS, specs: readonly CatalogEntry[] = OBJECT_CATALOG) {
  const exact = new Map<string, CatalogEntry>();
  const compiled = specs.map(spec => ({ spec, match: compileMatch(spec) }));
  for (const spec of specs) exact.set(normalize(spec.id), spec);
  const findSpec = (s: string) => exact.get(normalize(s)) ?? compiled.find(v => v.match.test(s))?.spec;
  const rows: Array<{ entry: GameLibraryEntry; model?: ReviewedAsset; spec?: CatalogEntry }> = [];
  for (const spec of specs) rows.push({ spec, entry: {
    id: `object:${spec.id}`, name: spec.name, category: spec.category,
    kind: spec.builder ? 'recipe' : 'specification', subjects: [spec.id], builder: spec.builder,
    animations: [], availability: spec.builder ? 'code-recipe' : 'specification-only', size: spec.dims,
    quality: { deviceCertification: 'not-measured', runtime: 'Three.js' },
    placement: PLACEMENT[spec.category].rules, verification: COMMON_CHECKS,
  } });
  for (const model of models) {
    // Never expose an unlicensed/incompatible candidate as usable simply because it was indexed.
    if (!model.subjects.length || !candidateMatches(model, { subject: model.subjects[0] })) continue;
    const spec = model.subjects.map(findSpec).find(Boolean);
    rows.push({ model, entry: {
      id: `model:${model.provider}:${model.id}:${model.revision}`, name: model.id,
      category: model.libraryCategory ?? spec?.category ?? 'other', kind: 'reviewed-model', subjects: model.subjects,
      animations: Object.keys(model.animationRoles ?? {}).length ? Object.keys(model.animationRoles!) : model.animations,
      license: { spdx: model.license.spdx, evidenceUrl: model.license.evidenceUrl, attribution: model.license.attribution },
      availability: 'requires-admission', size: `${model.height} m height; yaw ${model.yaw}`,
      quality: { deviceCertification: 'not-measured', runtime: 'Three.js', admissionLimits: ASSET_LIMITS },
      placement: model.libraryCategory ? PLACEMENT[model.libraryCategory].rules : spec ? PLACEMENT[spec.category].rules : ['Normalize scale and orientation and verify placement in the completed scene.'],
      verification: [...COMMON_CHECKS, 'Keep source/license attribution with exported source and published assets.',
        'A decorative building model does not prove enterable rooms, working doors or stairs.'],
    } });
  }
  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) { const bucket = byCategory.get(row.entry.category) ?? []; bucket.push(row); byCategory.set(row.entry.category, bucket); }
  const summary = [...categories, 'maps', 'audio', 'other']
    .map(category => ({ category: category as LibraryCategory, count: byCategory.get(category)?.length ?? 0 }));
  return {
    search(input: LibrarySearch = {}): LibraryResult {
      const query = normalize(String(input.query ?? '').slice(0, 512));
      const animation = normalize(String(input.animation ?? '').slice(0, 64));
      const category = String(input.category ?? '').trim();
      const requested = new Set(gameAssetRequirements(query, models).map(r => r.subject));
      const terms = query.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
      const source = category ? byCategory.get(category) ?? [] : rows;
      const ranked = source.map(row => {
        const names = [row.entry.id, row.entry.name, ...row.entry.subjects].map(normalize);
        let score = !query ? 1 : names.some(n => n === query) ? 100 : 0;
        if (row.model && row.model.subjects.some(s => requested.has(s))) score += 50;
        if (row.spec && compileMatch(row.spec).test(query)) score += 40;
        if (!score && terms.length && terms.every(term => names.some(n => n.split(/[^\p{L}\p{N}_-]+/u).includes(term)))) score = 10;
        if (animation && (!row.model || !candidateMatches(row.model, { subject: row.model.subjects[0], animation }))) score = 0;
        return { row, score };
      }).filter(v => v.score > 0).sort((a, b) => b.score - a.score || a.row.entry.id.localeCompare(b.row.entry.id));
      const missing: string[] = [];
      if (category && !summary.some(c => c.category === category)) missing.push(`Unknown category: ${category}`);
      if (!ranked.length) missing.push(query ? `No compatible indexed asset for: ${query}${animation ? ` (${animation})` : ''}` : `No indexed entries${category ? ` in ${category}` : ''}`);
      return { entries: ranked.slice(0, bound(input.limit)).map(v => structuredClone(v.row.entry)), total: ranked.length, categories: summary.map(c => ({ ...c })), missing,
        notes: ['Search is metadata-only: requires-admission models are not proof of local bytes or live availability.',
          'Use already prepared project models first. Keep existing download/license/hash/render admission and game playtests.',
          'Empty maps/audio categories do not imply runtime terrain or synthesized effects are absent; they mean no indexed ready-made files.',
          'No claim of universal game support or photorealism. Missing content must be reported, not replaced with an unrelated asset.'] };
    },
  };
}
const library = createGameLibrary();
export const searchGameLibrary = (input: LibrarySearch = {}): LibraryResult => library.search(input);
export function gameLibraryObjectNote(object: string): string {
  const result = searchGameLibrary({ query: object, limit: 3 });
  return '[GAME_LIBRARY]\n' + JSON.stringify({ entries: result.entries.map(({ id, kind, availability, builder, category, license }) => ({ id, kind, availability, builder, category, license })), missing: result.missing,
    verification: COMMON_CHECKS, note: result.notes[0] });
}

/** Builder handoff, not a release certificate. Only the seed's acknowledged files establish local readiness. */
export function gameLibraryBuildReport(prompt: string, seed: {
  status: string; outcomes: ReadonlyArray<{ subject: string; outcome: { kind: string; reason?: string } }>;
}, models: readonly ReviewedAsset[] = REVIEWED_GAME_ASSETS): string {
  const requested = gameAssetRequirements(prompt, models);
  const prepared = seed.status === 'prepared';
  const index = createGameLibrary(models);
  const selected = requested.map(requirement => {
    const result = seed.outcomes.find(o => o.subject === requirement.subject);
    return {
      subject: requirement.subject, animation: requirement.animation,
      status: prepared && result?.outcome.kind === 'model' ? 'local-model-prepared' : 'not-prepared',
      alternatives: index.search({ query: requirement.subject, animation: requirement.animation, limit: 3 }).entries.map(e => ({
        id: e.id, kind: e.kind, availability: e.availability,
      })),
    };
  });
  return '[GAME_LIBRARY_BUILD_REPORT]\n' + JSON.stringify({
    seedStatus: seed.status, selected,
    missing: selected.filter(s => s.status === 'not-prepared').map(s => s.subject),
    verification: { modelAdmission: prepared ? 'See actual seed outcomes; only local-model-prepared entries passed admission.' : 'No prepared models confirmed.',
      placement: 'pending finished-scene verification', gameplay: 'pending normal game playtest' },
    instructions: 'Use prepared models first. Query object_spec library_query/category for compatible alternatives and report missing content. Never claim a catalogue entry is a downloaded map, enterable building or working gameplay. Keep existing collision, controls, playtest and release gates.',
  });
}
