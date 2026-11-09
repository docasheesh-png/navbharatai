import { authoredPathSet, normalizeAuthoredPath } from './buildAuthorship';

/** Exact acknowledged platform paths, not a guess from src/game or a filename convention. */
export function splitSeedOrphans<T extends { file: string }>(orphans: readonly T[], seeded: Iterable<string>): { platform: T[]; preExisting: T[] } {
  const paths = authoredPathSet(seeded);
  return { platform: orphans.filter(o => paths.has(normalizeAuthoredPath(o.file))),
    preExisting: orphans.filter(o => !paths.has(normalizeAuthoredPath(o.file))) };
}
export function seedOrphanObservation(labels: readonly string[]): string {
  return `[platform preparation from this build — not the user's existing code] ${labels.length} game component(s) were seeded but not imported: ${labels.join(', ')}. Seed preparation is not delivered gameplay.`;
}
