// AgentV3 — Documentation engine: README generator (Phase 4 v1).
//
// Phase 4 (Engines Expansion) includes a docs-generation engine. This PURE,
// deterministic function turns the REAL project graph + package.json into an
// accurate README — detected tech stack, how to run, project structure, and the
// available scripts. Everything is derived from real data (never invented), so the
// generated README honestly reflects what was actually built. The `generate_readme`
// tool calls this and writes the result to README.md.

import type { ProjectGraph } from './WorkspaceMemory';
import type { PackageManager } from '../lib/DeployArtifactGenerator';

export interface ReadmeInput {
  projectName?: string;
  graph: ProjectGraph;
  /** Raw package.json contents, if available. */
  packageJson?: string | null;
  /**
   * The project's package manager (detected from its lockfile by the caller). When absent, it is read
   * from package.json's `packageManager` (Corepack) field, else defaults to npm — so the README's
   * install/run commands match a pnpm/yarn/bun project instead of always saying npm.
   */
  packageManager?: PackageManager;
}

/** Parse package.json's Corepack `packageManager` field ("pnpm@9.0.0" → "pnpm"). */
function pmFromField(field?: string): PackageManager | null {
  const name = (field || '').split('@')[0].trim().toLowerCase();
  return name === 'npm' || name === 'yarn' || name === 'pnpm' || name === 'bun' ? name : null;
}

/** The install command a developer runs after cloning (plain install, not lockfile-frozen). */
function pmInstall(pm: PackageManager): string {
  return pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm install' : pm === 'bun' ? 'bun install' : 'npm install';
}

/** Run a named script (`npm run dev` / `yarn dev` / `pnpm dev` / `bun run dev`). */
function pmScript(pm: PackageManager, script: string): string {
  return pm === 'yarn' ? `yarn ${script}` : pm === 'pnpm' ? `pnpm ${script}` : pm === 'bun' ? `bun run ${script}` : `npm run ${script}`;
}

interface Pkg {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

function parsePkg(raw?: string | null): Pkg | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as Pkg) : null;
  } catch {
    return null;
  }
}

// dependency name → friendly stack label. First match per dep wins; deduped.
const STACK: Array<[RegExp, string]> = [
  [/^next$/, 'Next.js'],
  [/^react$/, 'React'],
  [/^react-dom$/, 'React'],
  [/^vue$/, 'Vue'],
  [/^svelte$/, 'Svelte'],
  [/^@angular\//, 'Angular'],
  [/^express$/, 'Express'],
  [/^fastify$/, 'Fastify'],
  [/^typescript$/, 'TypeScript'],
  [/^vite$/, 'Vite'],
  [/^tailwindcss$/, 'Tailwind CSS'],
  [/^firebase$/, 'Firebase'],
  [/^@supabase\/supabase-js$/, 'Supabase'],
  [/^mongodb$/, 'MongoDB'],
  [/^mongoose$/, 'MongoDB'],
  [/^pg$/, 'PostgreSQL'],
  [/^mysql2?$/, 'MySQL'],
  [/^prisma$/, 'Prisma'],
  [/^@prisma\/client$/, 'Prisma'],
  [/^redis$/, 'Redis'],
  [/^convex$/, 'Convex'],
];

function detectStack(deps: string[]): string[] {
  const labels = new Set<string>();
  for (const dep of deps) {
    for (const [re, label] of STACK) {
      if (re.test(dep)) {
        labels.add(label);
        break;
      }
    }
  }
  return [...labels];
}

/** Generate a README markdown string from the real project graph + package.json. */
export function generateReadme(input: ReadmeInput): string {
  const graph = input.graph || ({ files: [], symbols: [], components: [], routes: [], imports: {}, dependencies: [] } as ProjectGraph);
  const pkg = parsePkg(input.packageJson);

  const name = (input.projectName || pkg?.name || 'My App').trim() || 'My App';
  const description = (pkg?.description || 'A web application built with NavBharatAI Pro v3.0.').trim();

  // Tech stack from both the manifest deps and the imports seen in the graph.
  const manifestDeps = pkg ? [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})] : [];
  const stack = detectStack([...new Set([...manifestDeps, ...(graph.dependencies || [])])]);

  // Package manager: caller-detected (lockfile) → package.json packageManager field → npm.
  const pm: PackageManager = input.packageManager || pmFromField(pkg?.packageManager) || 'npm';

  // How to run — prefer a real dev/start script from package.json, in the project's own manager.
  const scripts = pkg?.scripts || {};
  const devCmd = scripts.dev
    ? pmScript(pm, 'dev')
    : scripts.start
      ? `${pm} start`
      : scripts.serve
        ? pmScript(pm, 'serve')
        : pmScript(pm, 'dev');

  const components = graph.components || [];
  const routes = graph.routes || [];
  const fileCount = (graph.files || []).length;

  const lines: string[] = [];
  lines.push(`# ${name}`, '', description, '');

  lines.push('## Tech Stack', '');
  if (stack.length) for (const s of stack) lines.push(`- ${s}`);
  else lines.push('- (not detected yet)');
  lines.push('');

  lines.push('## Getting Started', '', '```bash', pmInstall(pm), devCmd, '```', '');

  lines.push('## Project Structure', '');
  lines.push(`- ${fileCount} file(s), ${components.length} component(s), ${routes.length} route(s).`);
  if (components.length) {
    lines.push(`- Key components: ${components.slice(0, 8).join(', ')}${components.length > 8 ? ', …' : ''}.`);
  }
  if (routes.length) {
    lines.push(`- Routes: ${routes.slice(0, 12).join(', ')}${routes.length > 12 ? ', …' : ''}.`);
  }
  lines.push('');

  const scriptNames = Object.keys(scripts);
  if (scriptNames.length) {
    lines.push('## Available Scripts', '');
    for (const s of scriptNames.slice(0, 12)) lines.push(`- \`${pmScript(pm, s)}\` — ${scripts[s]}`);
    lines.push('');
  }

  lines.push('---', '_Generated by NavBharatAI Pro v3.0._', '');
  return lines.join('\n');
}
