// 🔴 WHEN THE FILE "MISSING AN EXPORT" IS OURS, THE IMPORTER IS WRONG (failedbr #2278, 2026-11-20 — a racing game).
//
// The builder's `src/game/RacingGameLogic.tsx` imported `Vehicle` and `createVehicle` from the kit's
// `src/game/three/objects.ts`, which exports neither. The missing-export gate asked a cheap model to rewrite the KIT
// file from a 6,000-character slice "so it exports EXACTLY the required names", the mismatch stayed, and the gate went
// RED on an app that had rendered. The report line blamed the kit: "objects.ts MUST provide named export(s): Vehicle".
// Reversion: make `exportRepairRequest` regenerate every target (drop the `library` split) and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { exportRepairRequest, exportFindingText } from '../src/server/AgentV3/exportRepairDirection';
import type { ExportRegenTarget } from '../src/server/AgentV3/ImportExportAnalysis';

const KIT = 'src/game/three/objects.ts';
const kitSource = recipeFilePool().get(KIT)?.content ?? '';
const IMPORTER = 'src/game/RacingGameLogic.tsx';
const importer = `import { Vehicle, createVehicle } from './three/objects';\nexport function RacingGameLogic() { const v: Vehicle = createVehicle(); return null; }\n`;
const written = new Map<string, string>([[KIT, kitSource], [IMPORTER, importer]]);
const project = Object.fromEntries(written);
const target: ExportRegenTarget = { target: KIT, missingNamed: ['Vehicle', 'createVehicle'], missingDefault: false, neededBy: [`${IMPORTER}:1`] };

describe("#2278: the kit's missing export is the importer's mistake", () => {
  it('the kit file is never sent to the repair model; the importer is, with the kit\'s real exports', () => {
    expect(kitSource.length).toBeGreaterThan(1000);
    const req = exportRepairRequest([target], written, project);
    expect(req.files.map((f) => f.path)).toEqual([IMPORTER]);
    expect(req.libraries).toEqual([KIT]);
    expect(req.regenerated).toEqual([]);
    expect(req.instruction).toMatch(/Never write src\/game\/three\/objects\.ts/);
    expect(req.instruction).not.toMatch(/MUST provide/);
    // the kit's real exports are named, so the importer can be fixed against them
    const realExport = /export\s+function\s+(\w+)/.exec(kitSource)?.[1];
    expect(realExport).toBeTruthy();
    expect(req.instruction).toContain(String(realExport));
  });
  it('the report line names the importer as the wrong file, not the library', () => {
    const line = exportFindingText([target], written, project);
    expect(line).toContain(IMPORTER);
    expect(line).toMatch(/the importing file is wrong, not the library/);
    expect(line).not.toMatch(/MUST provide/);
  });
});

describe('the boundaries', () => {
  it('a file the model wrote (a truncated generation) is still regenerated exactly as before', () => {
    const own = 'src/server/routes/cards.ts';
    const t: ExportRegenTarget = { target: own, missingNamed: ['cardRoutes'], missingDefault: false, neededBy: ['src/server/index.ts:3'] };
    const req = exportRepairRequest([t], new Map([[own, 'const x = 1;\n']]), { [own]: 'const x = 1;\n' });
    expect(req.files.map((f) => f.path)).toEqual([own]);
    expect(req.instruction).toMatch(/MUST provide named export\(s\): cardRoutes/);
    expect(exportFindingText([t], new Map([[own, 'const x = 1;\n']]), {})).toMatch(/MUST provide/);
  });
  it('a kit file the model changed is the user\'s and is regenerated (only byte-exact seeds are libraries)', () => {
    const changed = new Map<string, string>([[KIT, kitSource + '\n// edited\n'], [IMPORTER, importer]]);
    const req = exportRepairRequest([target], changed, Object.fromEntries(changed));
    expect(req.files.map((f) => f.path)).toEqual([KIT]);
  });
  it('the route builds its repair through this module, never inline', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const exportRepair = exportRepairRequest(targets, writtenFiles,');
    expect(route).not.toMatch(/Rewrite EACH file in full ` \+/);
  });
});
