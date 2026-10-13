/**
 * True when a sandbox read failed because the FILE is absent, not because the read itself failed.
 *
 * ⚠️ ONE predicate (heal census of autopsy 303e8a6f): `writeTimeTypecheck.isMissingFileError` had drifted from this
 * one. It alone knew that a DEAD SANDBOX says "no such file or directory" about the whole workspace
 * (`[not_found] lstat /home/user/workspace: …`) — a missing machine, never a verdict about one file — so every
 * caller of this copy (and the dangling-stylesheet guard, which removed an import on ANY read error) could take a
 * dead machine for an absent file. A message naming the workspace root is unknown, not absent.
 */
export function isNotFoundError(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  if (code === 'ENOENT') return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes('/home/user/workspace:') || m.includes('workspace: no such file')) return false;
  return /enoent|no such file|not[_ ]found|does not exist/.test(m);
}
