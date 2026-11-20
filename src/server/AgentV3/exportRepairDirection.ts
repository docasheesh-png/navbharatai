/**
 * 🔴 WHEN THE FILE "MISSING AN EXPORT" IS OURS, THE IMPORTER IS WRONG (failedbr #2278, 2026-11-20 — a racing game).
 *
 * The builder wrote `src/game/RacingGameLogic.tsx` importing `Vehicle` and `createVehicle` from the game kit's
 * `src/game/three/objects.ts`. The kit exports neither. The missing-export gate then did what it does for a
 * truncated generation: it asked a cheap model to REWRITE `objects.ts` (1,300+ lines, shown from a 6,000-character
 * slice) "so it exports EXACTLY the required names … with real implementations". That is the wrong direction for a
 * file NavBharatAI seeded: a rewrite from a slice can only damage the kit every other file imports, and the names
 * were never the kit's to provide. The repair left the mismatch in place, the gate went RED, and the build was not
 * ok — on an app that had already rendered.
 *
 * 🔑 THE CLASS: the repair direction was decided by "who is missing the name", never by "whose file is it". A file
 * whose bytes are exactly what the platform seeds (`isPlatformSeededFile`: the kit, a golden scaffold, boilerplate)
 * is a fixed library; when a consumer imports a name it does not export, the CONSUMER is rewritten — told the
 * library's real exports — and the library is never sent to the model. Every other target is regenerated exactly as
 * before. The verdict is untouched: the re-check still reads the whole project, so an importer the repair did not fix
 * still fails the gate honestly. PURE.
 */

import type { ExportRegenTarget } from './ImportExportAnalysis';
import { exportRegenInstruction } from './ImportExportAnalysis';
import { createExportCapabilities } from './exportCapabilities';
import { isPlatformSeededFile } from './platformAuthored';

export interface ExportRepairRequest {
  /** The files the repair model may rewrite, with their current content. Never a platform-seeded file. */
  files: Array<{ path: string; content: string }>;
  /** The instruction block for the repair prompt: what each file must do. */
  instruction: string;
  /** Targets left to regenerate (the old behaviour) and seeded targets whose importers are rewritten instead. */
  regenerated: string[];
  libraries: string[];
}

const importerPath = (neededBy: string): string => neededBy.replace(/:\d+$/, '');

/** The exported names of one file, in declaration order; [] when they cannot be read. */
function exportedNames(path: string, project: Readonly<Record<string, string>>): string[] {
  try {
    const caps = createExportCapabilities({ [path]: project[path] ?? '' });
    return [...caps.exportsOf(path).exports.keys()].filter((n) => n !== 'default');
  } catch {
    return [];
  }
}

export function exportRepairRequest(
  targets: readonly ExportRegenTarget[],
  written: ReadonlyMap<string, string>,
  project: Readonly<Record<string, string>>,
  isSeeded: (path: string, content: string) => boolean = isPlatformSeededFile,
): ExportRepairRequest {
  const library = (t: ExportRegenTarget): boolean => {
    const content = written.get(t.target) ?? project[t.target];
    return typeof content === 'string' && isSeeded(t.target, content);
  };
  const regen = targets.filter((t) => !library(t));
  const libs = targets.filter(library);
  const files = new Map<string, string>();
  for (const t of regen) {
    const c = written.get(t.target) || '';
    if (c) files.set(t.target, c);
  }
  const importerLines: string[] = [];
  for (const t of libs) {
    const real = exportedNames(t.target, project);
    const names = [...t.missingNamed, ...(t.missingDefault ? ['default'] : [])].join(', ');
    for (const importer of [...new Set(t.neededBy.map(importerPath))]) {
      const c = written.get(importer) ?? project[importer];
      if (typeof c !== 'string' || !c || isSeeded(importer, c)) continue;
      files.set(importer, c);
      importerLines.push(`- ${importer} imports ${names} from ${t.target}, which NavBharatAI ships as a fixed library and which does NOT export ${t.missingNamed.length + (t.missingDefault ? 1 : 0) > 1 ? 'them' : 'it'}. `
        + `${t.target} exports: ${real.length ? real.slice(0, 150).join(', ') : '(could not be read — remove the import and the code that uses it)'}. `
        + `Rewrite ${importer} to use only those exports (or remove what needed the missing ones). Never write ${t.target}.`);
    }
  }
  const parts: string[] = [];
  if (regen.length) {
    parts.push('These files are imported by other modules for specific bindings, but they DO NOT export those bindings '
      + '(usually a generation that was cut off before the export). Rewrite EACH file in full so it exports EXACTLY the required '
      + 'names, keeping all its existing logic/UI and adding the missing export(s) with real implementations (no stubs). Change '
      + `nothing else.\n\nREQUIRED EXPORTS:\n${exportRegenInstruction(regen)}`);
  }
  if (importerLines.length) {
    parts.push(`These files import names a NavBharatAI library does not have. Fix the IMPORTING file, keeping its logic/UI:\n${importerLines.join('\n')}`);
  }
  return {
    files: [...files.entries()].map(([path, content]) => ({ path, content })),
    instruction: parts.join('\n\n'),
    regenerated: regen.map((t) => t.target),
    libraries: libs.map((t) => t.target),
  };
}

/**
 * The report's lines for these targets, telling the truth about direction: "`src/game/three/objects.ts` MUST provide
 * Vehicle" blamed the kit for a name the importer invented. A seeded library's line names the importer as the file
 * that is wrong; every other target keeps `exportRegenInstruction`'s wording. PURE.
 */
export function exportFindingText(
  targets: readonly ExportRegenTarget[],
  written: ReadonlyMap<string, string>,
  project: Readonly<Record<string, string>>,
  isSeeded: (path: string, content: string) => boolean = isPlatformSeededFile,
): string {
  return targets.slice(0, 15).map((t) => {
    const content = written.get(t.target) ?? project[t.target];
    if (typeof content !== 'string' || !isSeeded(t.target, content)) return exportRegenInstruction([t]);
    const names = [...t.missingNamed, ...(t.missingDefault ? ['a default export'] : [])].join(', ');
    const importers = [...new Set(t.neededBy.map(importerPath))];
    return `- ${importers.slice(0, 4).join(', ')}${importers.length > 4 ? ', …' : ''} import(s) ${names} from ${t.target}, a NavBharatAI library that does not export them — the importing file is wrong, not the library`;
  }).join('\n');
}
