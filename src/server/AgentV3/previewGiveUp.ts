import { BoundedCache } from '../lib/boundedCache';

/**
 * Preview give-up is per workspace, not per dispatcher (TD-20).
 * A later dispatcher on the same workspace must see that an earlier one already gave up.
 */
// Bounded (audit 2026-10-11): one entry per workspace ever given up on used to stay for the instance's life.
const gaveUp = new BoundedCache<string, true>({ maxEntries: 20_000 });

export function markPreviewGaveUp(workspaceId: string): void {
  if (workspaceId) gaveUp.set(workspaceId, true);
}

export function previewGaveUp(workspaceId: string): boolean {
  return gaveUp.get(workspaceId) === true;
}

export function clearPreviewGaveUp(workspaceId: string): void {
  gaveUp.delete(workspaceId);
}
