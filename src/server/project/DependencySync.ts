/**
 * G6 — Dependency auto-sync.
 *
 * After AI generation, every bare package imported by source files is checked
 * against package.json. Any that are missing are automatically declared so the
 * generated app can actually install and run (prevents the #1 "app generated but
 * won't run" failure for VFS-tier builds).
 *
 * Pure + dependency-free — VFS in, VFS out. Never throws. No-op for static
 * projects (no package.json).
 */
import { VirtualFileSystem } from './ProjectModel';
import { extractBareImports, collectDeclaredDeps } from './ProjectVerifier';

/** Curated pinned versions for the packages NavBharatAI's generator reaches for most.
 *  Unknown packages fall back to 'latest' (npm resolves the real version at install time). */
const KNOWN_VERSIONS: Record<string, string> = {
  // Routing
  'react-router-dom': '^6.26.0',
  // State management
  'zustand': '^4.5.0',
  'immer': '^10.1.0',
  'jotai': '^2.9.0',
  // HTTP
  'axios': '^1.7.0',
  // Forms
  'react-hook-form': '^7.52.0',
  'zod': '^3.23.0',
  // UI utilities
  'clsx': '^2.1.0',
  'tailwind-merge': '^2.4.0',
  'class-variance-authority': '^0.7.0',
  // Date/time
  'date-fns': '^3.6.0',
  'dayjs': '^1.11.11',
  // Animation
  'framer-motion': '^11.3.0',
  // Icons
  'lucide-react': '^0.400.0',
  'react-icons': '^5.2.0',
  // IDs
  'uuid': '^10.0.0',
  // Data fetching
  '@tanstack/react-query': '^5.51.0',
  // Charts
  'recharts': '^2.12.0',
  // Notifications
  'react-hot-toast': '^2.4.0',
  'sonner': '^1.5.0',
  // Radix UI
  '@radix-ui/react-dialog': '^1.1.0',
  '@radix-ui/react-dropdown-menu': '^2.1.0',
  '@radix-ui/react-tabs': '^1.1.0',
  '@radix-ui/react-tooltip': '^1.1.0',
  '@radix-ui/react-select': '^2.1.0',
  // Utilities
  'lodash': '^4.17.21',
  'lodash-es': '^4.17.21',
};

const DEFAULT_VERSION = 'latest';

export interface DependencySyncResult {
  added: string[];
}

/**
 * Ensure every bare package imported by the project's source files is declared
 * in package.json. Writes the updated package.json back into the VFS only when
 * at least one package was added. Best-effort: never throws.
 */
export function syncDependencies(vfs: VirtualFileSystem): DependencySyncResult {
  const text = vfs.readText('package.json');
  if (!text) return { added: [] };
  let pkg: any;
  try { pkg = JSON.parse(text); } catch { return { added: [] }; }

  const declared = collectDeclaredDeps(vfs) ?? new Set<string>();
  const imported = extractBareImports(vfs);
  const added: string[] = [];

  pkg.dependencies = pkg.dependencies || {};
  for (const name of imported) {
    if (declared.has(name)) continue;
    pkg.dependencies[name] = KNOWN_VERSIONS[name] ?? DEFAULT_VERSION;
    added.push(name);
  }

  if (added.length) {
    added.sort();
    vfs.write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  }
  return { added };
}
