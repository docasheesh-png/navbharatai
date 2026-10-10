/** True when a sandbox read failed because the file is absent, not because the read itself failed. */
export function isNotFoundError(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (code === 'ENOENT') return true;
  return /ENOENT|no such file|not found|does not exist/i.test(message);
}
