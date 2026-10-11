/**
 * Preview give-up is per workspace, not per dispatcher (TD-20).
 * A later dispatcher on the same workspace must see that an earlier one already gave up.
 */
const gaveUp = new Map<string, true>();

export function markPreviewGaveUp(workspaceId: string): void {
  if (workspaceId) gaveUp.set(workspaceId, true);
}

export function previewGaveUp(workspaceId: string): boolean {
  return gaveUp.get(workspaceId) === true;
}

export function clearPreviewGaveUp(workspaceId: string): void {
  gaveUp.delete(workspaceId);
}
