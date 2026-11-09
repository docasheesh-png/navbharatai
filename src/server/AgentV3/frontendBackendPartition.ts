// AgentV3 — Frontend/Backend file partition (AP-4, slice 1: read-only enabling analyzer).
//
// Toward safe frontend↔backend sub-agent PARALLELISM, the one precondition is a DISJOINT file partition:
// two writing agents can only run concurrently if they own non-overlapping file sets (there is no
// per-file lock — last writer wins, so overlapping writes would clobber). This PURE analyzer classifies a
// finished build's file paths into frontend / backend / shared / other and reports whether a clean,
// separable full-stack split exists. It writes nothing and parallelizes nothing — it only records an
// honest advisory in the build report, and is the load-bearing evidence for a later, flag-gated
// parallel-build slice (prove partitions are reliably disjoint on real builds first).
//
// Deterministic + dependency-free. Classification is by path shape + extension, conservative: anything
// ambiguous (a bare lib/util/type) is 'shared' (NOT assigned to either side), so the partitionable verdict
// never over-claims a split that isn't real.

export type FileSide = 'frontend' | 'backend' | 'shared' | 'other';

export interface FbPartition {
  frontend: string[];
  backend: string[];
  shared: string[];
  other: string[];
  /** A separable full-stack split exists: BOTH sides have files and neither is swamped by shared code. */
  partitionable: boolean;
}

// Backend signals — server trees, API/route/controller/model layers, DB, and server entry files.
const BACKEND_DIR = /(^|\/)(server|backend|api|routes?|controllers?|models?|services?|middleware|db|database|migrations?|prisma|repositories?|schema)(\/|$)/i;
// Only genuine server-entry names — NOT index/main/app, which are commonly the FRONTEND entry
// (e.g. Vite's src/main.tsx) or a barrel file, and would over-assign shared/frontend code to backend.
const BACKEND_FILE = /(^|\/)server\.(ts|js|mjs|cjs)$|\.server\.(ts|js|tsx|jsx)$|(^|\/)(knexfile|drizzle\.config|ormconfig)\.(ts|js)$/i;
// Frontend signals — component/page/view trees, client entry, styles, and any component-extension file.
const FRONTEND_DIR = /(^|\/)(components?|pages?|views?|screens?|layouts?|widgets?|ui|client|styles?|assets|hooks|context|store|stores|routes?\/\(.*\))(\/|$)/i;
const FRONTEND_EXT = /\.(tsx|jsx|vue|svelte|astro)$/i;
const STYLE_EXT = /\.(css|scss|sass|less)$/i;
// Shared — cross-cutting code neither side exclusively owns (types, shared contracts, generic utils/lib).
const SHARED_DIR = /(^|\/)(shared|common|types?|interfaces?|contracts?|lib|utils?|helpers?|constants?|config)(\/|$)/i;
// Non-source — config, docs, tests, lockfiles, binary assets: excluded from the FE/BE split entirely.
const OTHER_RE = /(^|\/)(node_modules|dist|build|coverage|\.git|public)(\/|$)|\.(test|spec)\.|(^|\/)__tests__(\/|$)|(^|\/)(package(-lock)?|tsconfig[^/]*|vite\.config|.*\.config|readme|license|\.env[^/]*|\.gitignore)\.?[^/]*$|\.(md|json|lock|ya?ml|toml|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|pdf)$/i;

/** Classify one file path. Order matters: OTHER (configs/tests/assets) → backend → frontend markup/styles
 *  → shared → default backend-for-plain-server-code / frontend otherwise. Pure. */
export function classifyFile(path: string): FileSide {
  const p = String(path || '');
  if (!p) return 'other';
  if (OTHER_RE.test(p)) return 'other';
  if (BACKEND_FILE.test(p) || BACKEND_DIR.test(p)) return 'backend';
  if (FRONTEND_EXT.test(p) || STYLE_EXT.test(p) || FRONTEND_DIR.test(p)) return 'frontend';
  if (SHARED_DIR.test(p)) return 'shared';
  // A plain .ts/.js not in any marked tree is ambiguous — treat as shared (never over-assign a side).
  return 'shared';
}

/**
 * Partition a build's file paths into frontend / backend / shared / other, and decide whether a separable
 * full-stack split exists. `partitionable` requires BOTH sides to hold real files AND the shared set not to
 * dominate (≤ half of the FE+BE side files) — so a pure SPA (no backend) or a build that is mostly shared
 * glue is honestly reported as NOT cleanly splittable. Pure + deterministic.
 */
// A CLIENT LAYER IS NOT A SERVER (BR1960, report 1946f797). A Vite SPA kept its mock data fetcher in
// `src/services/seoAPI.ts`; BACKEND_DIR matched `services/`, so the admin advisory said "1 backend … A clean
// full-stack split exists" about an app with no server at all. `src/services`, `src/api` and `src/models`
// directly under the source root are where front-end apps put fetch wrappers and data shapes. They are
// backend only when the SAME file set also has an unambiguous server signal (a server/backend tree, a
// routes/controllers/db layer, a server entry file). Otherwise they are 'shared' — never assigned a side.
// `classifyFile` (single-path) is unchanged; this only applies across a whole file set.
const CLIENT_LAYER = /^(?:\.\/)?src\/(?:services?|api|models?)\//i;
const SERVER_ANCESTOR = /(^|\/)(server|backend)(\/|$)/i;

/** True when a path is backend for a reason other than a client-layer directory under src/. */
function isUnambiguousBackend(path: string): boolean {
  if (classifyFile(path) !== 'backend') return false;
  return !CLIENT_LAYER.test(path) || SERVER_ANCESTOR.test(path);
}

export interface PartitionOptions {
  /** Keep the pre-BR1960 reading (a client layer under src/ always counts as backend). Used by the CSP
   *  scan so its skip decision — and therefore the agent-facing findings — does not change. */
  clientLayerAsBackend?: boolean;
}

export function partitionFrontendBackend(paths: readonly string[], opts: PartitionOptions = {}): FbPartition {
  const frontend: string[] = [];
  const backend: string[] = [];
  const shared: string[] = [];
  const other: string[] = [];
  const serverEvidence = opts.clientLayerAsBackend === true || paths.some((p) => isUnambiguousBackend(String(p || '')));
  for (const path of paths) {
    const side = classifyFile(path);
    if (side === 'backend' && !serverEvidence && CLIENT_LAYER.test(String(path || ''))) { shared.push(path); continue; }
    switch (side) {
      case 'frontend': frontend.push(path); break;
      case 'backend': backend.push(path); break;
      case 'shared': shared.push(path); break;
      default: other.push(path); break;
    }
  }
  const sided = frontend.length + backend.length;
  const partitionable = frontend.length > 0 && backend.length > 0 && shared.length <= sided;
  return { frontend, backend, shared, other, partitionable };
}

/** A concise, honest advisory line for the admin build report. Pure. */
export function partitionSummary(p: FbPartition): string {
  // "OF THE FILES THIS TURN WROTE" IS LOAD-BEARING (admin autopsy 2026-09-01). The caller partitions
  // `writtenFiles` on purpose — the question it answers is whether THIS build's work could have been
  // split across two agents, which is about what we wrote, not about what the app contains. But the
  // line used to open "Frontend/backend partition: 5 frontend, 0 backend", which reads as a statement
  // about the APP. On a real build it said "0 backend" for a project whose Express proxy the platform
  // had just started and health-checked — the backend simply belonged to an earlier turn. Every number
  // was true about the files measured and false about the app, which is the worst kind of wrong in a
  // diagnostic: confident, specific and misleading. The scope is now in the sentence.
  const base = `Of the ${p.frontend.length + p.backend.length + p.shared.length + p.other.length} file(s) THIS TURN wrote: ${p.frontend.length} frontend, ${p.backend.length} backend, ${p.shared.length} shared, ${p.other.length} other (not a survey of the whole project).`;
  return p.partitionable
    ? `${base} A clean full-stack split exists — this build is a candidate for parallel frontend/backend building (a future capability).`
    : `${base} No clean full-stack split (single-side or shared-heavy) — parallel FE/BE building would not help here.`;
}
