/** Public app endpoints must not target internal snapshots or storage paths.
 * This is resource-shape validation only, NOT proof of ownership. Legacy UID
 * prefix ambiguity remains and must be resolved by exact trusted ownership.
 * Issued legacy session IDs use letters, digits, underscores or hyphens (with
 * numeric timestamp fallbacks). Do not impose a new minimum/maximum length.
 */
export function isPublicAppWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && /^agentv3-[A-Za-z0-9_-]+$/.test(value);
}
