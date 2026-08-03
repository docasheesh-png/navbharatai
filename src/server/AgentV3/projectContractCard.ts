// AgentV3 — PROJECT CONTRACT CARD (build-report autopsy 2026-08-02, SaaS-dashboard edit build).
//
// ROOT CAUSE it prevents (the 50/50 law's PREVENT half — stop the bug being written, don't heal it):
// on an EDIT build of a 165-file imported project, the builder was given the file TREE plus a few
// grounded file CONTENTS — but never a compact answer to the two questions it actually gets wrong:
//   1. "which module exports the symbol I want?"  → it wrote `import { Team } from './storage'` when
//      the types live in the shared schema module, then spent a turn self-healing the wrong import.
//   2. "which packages may I import?"             → it used `nanoid` without declaring it in
//      package.json, and the dependency reconciler had to add it after the fact.
// Both are HEALED today (fixWrongSourceImports / DependencyReconciler). A heal that keeps firing is an
// unfixed root cause wearing a green checkmark, so this module removes the reason to guess: the builder
// is handed the project's real symbol→module map and its declared packages BEFORE it writes a line.
//
// Pure + bounded: no I/O, no clock, hard caps on modules/symbols so the prompt can never bloat.

export interface ContractSymbol {
  name: string;
  /** Where it is defined — the project-relative file path (never a guessed import alias). */
  file: string;
}

export interface ContractCardInput {
  /** Exported symbols across the project (WorkspaceMemory.graph().symbols). */
  symbols: readonly ContractSymbol[];
  /** Package names declared in package.json dependencies + devDependencies. */
  declaredPackages: readonly string[];
}

export interface ContractCardOptions {
  /** Max modules listed (default 40). */
  maxModules?: number;
  /** Max symbols listed per module (default 8). */
  maxPerModule?: number;
  /** Max packages listed (default 40). */
  maxPackages?: number;
}

/** Files that carry no reusable contract — listing them wastes prompt budget. */
const SKIP_FILE = /(^|\/)(node_modules|dist|build|\.next|coverage)\//;
const SKIP_EXT = /\.(css|scss|json|md|svg|png|jpe?g|gif|webp|ico|txt|lock)$/i;

function usableFile(f: string): boolean {
  return !!f && !SKIP_FILE.test(f) && !SKIP_EXT.test(f) && !/\.d\.ts$/.test(f);
}

/**
 * Build the compact "existing contract" block for an EDIT build's system prompt: which module owns
 * which exported symbol, and which packages are already declared. Returns '' when there is nothing
 * useful to say (a fresh/empty project), so the caller can skip the block entirely.
 *
 * Deliberately lists FILE PATHS, never a guessed import specifier — the project's own alias/relative
 * convention is visible in the grounded files, and inventing `@shared/...` for a project that doesn't
 * use it would trade one wrong import for another. Pure.
 */
export function projectContractCard(input: ContractCardInput, opts: ContractCardOptions = {}): string {
  const maxModules = Math.max(1, opts.maxModules ?? 40);
  const maxPerModule = Math.max(1, opts.maxPerModule ?? 8);
  const maxPackages = Math.max(1, opts.maxPackages ?? 40);

  // Group symbols by owning module, preserving first-seen order within each module and de-duping names.
  const byFile = new Map<string, string[]>();
  for (const s of input.symbols || []) {
    if (!s || typeof s.name !== 'string' || typeof s.file !== 'string') continue;
    const name = s.name.trim();
    if (!name || !usableFile(s.file)) continue;
    const list = byFile.get(s.file) ?? [];
    if (!list.includes(name)) list.push(name);
    byFile.set(s.file, list);
  }

  // Richest modules first (they carry the shared contract others import), then alphabetical for
  // determinism — the same project always produces the same card.
  const modules = [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, maxModules);

  const packages = [...new Set((input.declaredPackages || []).filter((p) => typeof p === 'string' && p.trim()))]
    .sort()
    .slice(0, maxPackages);

  if (modules.length === 0 && packages.length === 0) return '';

  const lines: string[] = ['## THIS PROJECT ALREADY EXISTS — use its real contract, do not guess'];

  if (modules.length > 0) {
    lines.push(
      '',
      'These symbols are ALREADY exported by this project. Import each one from the module listed here —',
      'never from another file that merely re-uses it, and never re-declare your own copy:',
    );
    for (const [file, names] of modules) {
      const shown = names.slice(0, maxPerModule);
      const more = names.length - shown.length;
      lines.push(`- ${file} — ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`);
    }
    lines.push('Match the project\'s existing import style (alias or relative) as seen in the files above.');
  }

  if (packages.length > 0) {
    lines.push(
      '',
      `Declared packages (package.json): ${packages.join(', ')}`,
      'Import ONLY from these. If you genuinely need another package, add it to package.json in the SAME turn —',
      'code that imports an undeclared package fails to install and breaks the app.',
    );
  }

  return lines.join('\n');
}

/** Package names declared in a package.json's dependencies + devDependencies. Never throws. Pure. */
export function declaredPackagesFromPackageJson(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    const names = [...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})];
    return [...new Set(names.filter((n) => typeof n === 'string' && n.trim()))];
  } catch {
    return []; // an unparseable package.json simply contributes no package list
  }
}
