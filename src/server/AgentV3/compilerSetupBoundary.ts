import { countTscErrors } from './TscGate';

// BR1958: compiler consumers are not broken components when ONLY known package resolution failed.
// Narrow on purpose: no alias, relative import, unknown package, mixed source error or partial parse.
const ROOTS = new Set(['react', 'react-dom', 'three', 'vitest', 'vite']);
export function compilerNeedsPackageSetup(output: string): boolean {
  const rows = [...String(output ?? '').matchAll(/\berror (TS\d+): ([^\n\r]+)/g)];
  if (!rows.length || countTscErrors(output) !== rows.length) return false;
  return rows.every(([, code, message]) => {
    const name = code === 'TS2307' ? /^Cannot find module '([^']+)'/.exec(message)?.[1]
      : code === 'TS2875' ? /requires the module path '([^']+)'/.exec(message)?.[1] : undefined;
    return !!name && ROOTS.has(name.split('/')[0]);
  });
}
export const PACKAGE_SETUP_REQUIRED = 'Known runtime/test packages could not be resolved. Restore the project manifest and dependencies before repairing source; replacing working components cannot install a missing package. Types remain unverified.';
