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

/**
 * Q-2715 (autopsy 57604006, builds 969740df and 1712adfa): the game kit's own `src/game/GameCanvas.tsx`, untouched, was
 * reported as "[observation about your existing code] 1 component(s) created but never used" because this game mounts
 * its own canvas. It is NavBharatAI's library code, not the user's component, and an unused kit module is not bundled.
 * It is NOT deleted: the builder's prompt promises the kit's modules, so a later edit may import it, and a deleted one
 * would turn that edit into a failed build. It is named for what it is instead. PURE.
 */
export function kitOrphanObservation(labels: readonly string[]): string {
  return `[NavBharatAI's game kit — not the user's code] ${labels.length} kit component(s) this game does not use: ${labels.join(', ')}. Kit modules are a library a later edit may use; an unused one is not part of the built app.`;
}

