// SHOULD A FRESH WORKSPACE GET OUR STARTER TEMPLATE? (build d62bf22d, 2026-10-17)
//
// An import's workspace must hold the user's project and nothing of ours. `'import'` used to fall through
// to the vite-react template, so a GitHub import landed beside our 11-file starter, and the leftover
// entry files made every later check call the user's working app "the untouched starter". PURE.

import type { EnsureWorkspaceOptions } from './IEngineerActuator';

export function shouldSeedStarter(projectType: string | undefined, opts?: EnsureWorkspaceOptions): boolean {
  if (projectType === 'import') return false;
  return opts?.seedStarter !== false;
}
