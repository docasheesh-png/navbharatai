// A FILE THE FAST LANE SALVAGED AND THE APP NEVER USED IS TAKEN OUT AGAIN (autopsy f496c75b, open since 2026-09-30).
//
// 🔴 WHAT HAPPENED. The fast lane ran out of time, its finished files were salvaged into the workspace and
// the full builder was told to build around them. It built a different structure instead, and the salvaged
// `types.ts` and `MathUtils.ts` — importing each other, so neither looked unused on its own — shipped as
// dead code in the user's project.
//
// 🔑 THE RULE, and every condition is there for a reason:
//   • only a file the fast lane SALVAGED in this build — never a file the user had, never one the full
//     builder wrote;
//   • only when its name appears in no file outside the dead set. The set is found as a fixpoint, so two
//     salvaged files that only name each other are dead together, while one that anything else names lives.
//     A NAME, not a parsed import: a config entry, a dynamic import, an HTML tag or a string all keep it;
//   • never an entry, a config file or a file under a folder a framework reads by location (pages/, app/,
//     routes/, api/, public/);
//   • the app's own production build must pass without them; the route puts every file back if it does not.
//
// Kill switch: AGENTV3_PRUNE_DEAD_SALVAGE=off. PURE apart from the env read.

export function pruneDeadSalvageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PRUNE_DEAD_SALVAGE ?? '').trim().toLowerCase() !== 'off';
}

/** At most this many files are removed in one build — a bigger set means the analysis is wrong. */
export const MAX_DEAD_SALVAGE = 12;

const CODE_OR_STYLE = /\.(?:tsx?|jsx?|mjs|cjs|css|scss)$/i;
const NEVER_REMOVE = /(?:^|\/)(?:index|main|app|server|entry)\.[a-z]+$|(?:^|\/)[^/]*\.config\.[a-z]+$|\.d\.ts$|(?:^|\/)(?:pages|app|routes|api|public|migrations|scripts)\//i;

/** The name other files would use for this one: the basename, or its folder for an index file. PURE. */
export function referenceName(path: string): string {
  const parts = path.split('/');
  const file = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  if (file.toLowerCase() === 'index' && parts.length > 1) return parts[parts.length - 2];
  return file;
}

/**
 * Does `content` refer to a module called `name` the way code refers to a file — `./types`, `'../utils'`,
 * `/src/MathUtils.ts"`? A bare word is not enough: "types" appears in every package.json (`@types/…`)
 * and would keep every file of that name alive for ever. Anything path-shaped counts, so an import, a
 * dynamic import, an HTML `src` and a config entry all keep the file. PURE.
 */
function names(content: string, name: string): boolean {
  if (!name) return true; // nothing to search for ⇒ assume it is used
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[/'"\`]${esc}(?:\\.(?:tsx?|jsx?|mjs|cjs|css|scss))?(?=['"\`/?#)\\s]|$)`).test(content);
}

/**
 * The salvaged files nothing else in the project names. `files` is the whole project as it stands after the
 * build (path → content). PURE.
 */
export function deadSalvagedFiles(salvaged: readonly string[], files: Record<string, string>): string[] {
  const present = new Set(Object.keys(files));
  const dead = new Set(
    [...new Set(salvaged)].filter((p) => present.has(p) && CODE_OR_STYLE.test(p) && !NEVER_REMOVE.test(p)),
  );
  let changed = true;
  while (changed && dead.size > 0) {
    changed = false;
    for (const p of [...dead]) {
      const name = referenceName(p);
      const used = Object.entries(files).some(([other, content]) => !dead.has(other) && typeof content === 'string' && names(content, name));
      if (used) { dead.delete(p); changed = true; }
    }
  }
  const out = [...dead].sort();
  return out.length > MAX_DEAD_SALVAGE ? [] : out;
}

export interface DeadSalvageRun {
  run: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  write: (path: string, content: string) => Promise<void>;
}

export type DeadSalvageOutcome =
  | { status: 'removed'; removed: string[] }
  | { status: 'skipped'; reason: string }
  | { status: 'reverted'; reason: string; tried: string[] };

const SAFE_PATH = /^[\w./@-]+$/;

/**
 * Removes the files, proves the app's own production build passes, and writes every file back if it does
 * not. Never throws.
 */
export async function removeDeadSalvage(
  dead: readonly string[],
  files: Record<string, string>,
  hasBuildScript: boolean,
  io: DeadSalvageRun,
): Promise<DeadSalvageOutcome> {
  const remove = dead.filter((p) => SAFE_PATH.test(p) && !p.includes('..') && typeof files[p] === 'string');
  if (remove.length === 0) return { status: 'skipped', reason: 'no candidates' };
  if (!hasBuildScript) return { status: 'skipped', reason: 'no build script to verify the removal with' };
  const restore = async (): Promise<void> => {
    for (const p of remove) { try { await io.write(p, files[p]); } catch { /* best-effort */ } }
  };
  try {
    const rm = await io.run(`rm -f ${remove.map((p) => `'${p}'`).join(' ')}`);
    if (rm.exitCode !== 0) { await restore(); return { status: 'reverted', reason: 'the files could not be removed', tried: remove }; }
    const build = await io.run('timeout 240 npm run build');
    if (build.exitCode !== 0) { await restore(); return { status: 'reverted', reason: 'the app did not build without them', tried: remove }; }
    return { status: 'removed', removed: remove };
  } catch {
    await restore();
    return { status: 'reverted', reason: 'the removal could not be completed', tried: remove };
  }
}
