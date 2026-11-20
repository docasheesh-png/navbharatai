/**
 * 🔴 THE GAME KIT IS A LIBRARY THE MODEL BUILDS ON, NOT A FILE IT REWRITES (failedbr #2216, 2026-11-20).
 *
 * A 3D racing game: the platform laid down the kit (32 files, 28.5 s), and the builder then wrote its own
 * `src/game/core/loop.ts` and `src/game/core/input.ts` over the kit's. The kit's shell (`src/game/Game.ts`) calls
 * `loop.setPaused(…)` and passes the render callback two arguments; the rewritten loop had neither, so every write-time
 * typecheck failed (16 → 26 → 21 → 16 errors, none clean) and the user stopped at 4.3 minutes with no game. The system
 * prompt said "import from it"; nothing made the rewrite impossible.
 *
 * 🔑 THE CLASS: a whole-file write that silently removes a library's API from under its own consumers. Precise by
 * construction — refused only when ALL hold: the path is in the kit's library (`RECIPE_LIBRARY_PATH`), the file on
 * disk is byte-for-byte what the platform seeded (`isPlatformSeededFile` — a file the user or model already changed is
 * theirs), the write comes from the model, and the new content DROPS an export the kit file had. Adding to the kit, or
 * rewriting it while keeping every export, is allowed. PURE.
 */
import { RECIPE_LIBRARY_PATH, declaredMembers } from './typeMembers';
import { isPlatformSeededFile } from './platformAuthored';
import { createExportCapabilities } from './exportCapabilities';

/** The model's own write paths. Platform passes (kit refresh, heals) never reach this guard. */
const MODEL_SOURCES = new Set(['write_file', 'write_files_batch', 'replace_symbol']);

function exportNames(path: string, content: string): Set<string> | null {
  try {
    const info = createExportCapabilities({ [path]: content }).exportsOf(path);
    if (info.uncertain) return null;
    return new Set([...info.exports.keys()]);
  } catch {
    return null;
  }
}

/** The refusal message for a kit rewrite that removes exports, or null when the write may proceed. PURE. */
export function kitLibraryRewriteRefusal(
  path: string,
  existing: string | null | undefined,
  next: string,
  source: string,
  isSeeded: (p: string, c: string) => boolean = isPlatformSeededFile,
): string | null {
  const rel = String(path ?? '').replace(/^\.?\//, '');
  if (!MODEL_SOURCES.has(source) || !RECIPE_LIBRARY_PATH.test(rel)) return null;
  if (typeof existing !== 'string' || !existing || !isSeeded(rel, existing)) return null;
  const before = exportNames(rel, existing);
  const after = exportNames(rel, String(next ?? ''));
  if (!before || !after) return null;
  const dropped = [...before].filter((n) => !after.has(n));
  // …and a class or interface that keeps its NAME but loses public members (the report's case: `GameLoop` without
  // `setPaused`, which the shell calls). Member names only; a changed signature is the compiler's to report.
  const memberName = (m: string) => m.split(/[(:?<\s]/)[0];
  for (const name of [...before].filter((n) => after.has(n))) {
    const was = declaredMembers(existing, name);
    const now = declaredMembers(String(next ?? ''), name);
    if (!was || !now) continue;
    const kept = new Set(now.map(memberName));
    for (const m of was.map(memberName)) if (m && !kept.has(m)) dropped.push(`${name}.${m}`);
  }
  if (dropped.length === 0) return null;
  const shown = dropped.slice(0, 8).join(', ') + (dropped.length > 8 ? `, … (${dropped.length} in all)` : '');
  return `${rel} is NavBharatAI's game kit, and this rewrite would REMOVE ${shown} — the kit's other files (its shell, `
    + 'HUD and recipes) use them, so the game would stop compiling. Do not rewrite kit files. Import what you need from it, '
    + 'put your game\'s own logic in a NEW file (for example src/game/RacingGame.tsx), or use edit_file to ADD to the kit '
    + 'without removing anything.';
}
