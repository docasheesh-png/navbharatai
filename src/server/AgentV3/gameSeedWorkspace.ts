/** BR1958: a recipe's TS/React files need a real package manifest, even after setup recovered.
 * Reuse the actuator's existing ownership-checked starter completion; never synthesize/replace a manifest.
 * This preflight runs only after the route's source-preservation gate and inherits its admission budget.
 */
export async function prepareGameSeedWorkspace(io: {
  stopped: () => boolean;
  readManifest: () => Promise<string>;
  recoverStarter: () => Promise<void>;
  takeScaffold: () => Record<string, string> | undefined;
}): Promise<{ ready: boolean; scaffold: Record<string, string>; reason: string }> {
  const read = async () => io.readManifest().catch(() => null);
  const valid = (text: string | null): boolean => {
    try { const p = JSON.parse(text ?? ''); return !!p && typeof p === 'object' && !Array.isArray(p)
      && typeof (p.dependencies?.react ?? p.devDependencies?.react) === 'string'; } catch { return false; }
  };
  if (io.stopped()) return { ready: false, scaffold: {}, reason: 'the build was stopped' };
  let manifest = await read();
  if (valid(manifest)) return { ready: !io.stopped(), scaffold: {}, reason: 'manifest present' };
  // A malformed/existing manifest belongs to its writer; do not complete over it.
  if (manifest !== null) return { ready: false, scaffold: {}, reason: 'the existing package manifest is not a readable React project; keep it unchanged and reconcile setup first' };
  if (io.stopped()) return { ready: false, scaffold: {}, reason: 'the build was stopped' };
  try { await io.recoverStarter(); } catch { return { ready: false, scaffold: {}, reason: 'workspace setup did not recover; no game recipes were run' }; }
  const scaffold = io.takeScaffold() ?? {}; // exact acknowledged bytes, not a proposed write
  if (io.stopped()) return { ready: false, scaffold, reason: 'the build was stopped' };
  manifest = await read();
  return { ready: valid(manifest), scaffold, reason: valid(manifest) ? 'starter setup recovered'
    : 'no readable React package manifest after ownership-checked setup; no game recipes were run' };
}
