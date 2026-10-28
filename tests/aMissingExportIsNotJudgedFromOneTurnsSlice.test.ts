// A MISSING EXPORT IS NOT JUDGED FROM ONE TURN'S SLICE (2026-10-27).
//
// SIX REPORTS, ONE CLASS: Q-1378 (IndianBikeGame), Q-1380 (createGame from gameLogic.ts), Q-1384 and
// Q-1392 (combo from src/game/core/meta.ts), Q-1427 (DEFAULT_TOUCH_BUTTONS, right after a repair) and
// Q-1446 (BlockWorldGame). Every one of them is the same user-visible failure: the browser could not
// import a named export from a generated module, while the build's own gates were green.
//
// ROOT CAUSE. The MISSING-EXPORT GATE in `routes/agentv3.ts` built its analysis map from
// `Object.fromEntries(writtenFiles)` — THIS turn's writes alone. `analyzeImportExports` skips an import
// whose target is not in the map (`if (!target) continue`), and it never examines a target nobody in the
// map imports. So a mismatch whose two halves were authored in DIFFERENT turns — the importer now and the
// module earlier, or the module now and the importer earlier, which is what a repair pass produces — was
// invisible to the one gate whose whole job is that class.
//
// THE CLASS is wider than this gate: a consistency check must never judge a cross-file contract from the
// writer's own slice. The route itself already says so a few hundred lines below — "an edit turn's writes
// are a slice — the player the first build wrote is in a file this turn never touched" — and composes
// `{ ...loadWorkspaceFiles(), ...Object.fromEntries(writtenFiles) }` wherever it needs a whole-project
// fact. The gate now uses that same composition. DETECTION scope is the workspace; REPAIR scope is
// unchanged (only files this build wrote are ever regenerated), so the fix adds no new write surface.
//
// The first test encodes the hazard against the REAL analyzer. The second is a source guard: it fails the
// moment this gate — or a new sibling in the same route — is handed one turn's slice again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeImportExports } from '../src/server/AgentV3/ImportExportAnalysis';

const IMPORTER = 'src/game/App.tsx';
const TARGET = 'src/game/core/meta.ts';
// Q-1384's own shape: the importer reads `combo` as a value; the module exports something else.
const IMPORTER_SRC = "import { combo } from './core/meta';\nexport default function App() { return <div>{combo}</div>; }\n";
const TARGET_SRC = 'export const score = 0;\n';

describe('a missing export is invisible from one turn\'s slice', () => {
  it('the importer alone yields NO mismatch — the target it names is not in the map', async () => {
    const rep = await analyzeImportExports({ [IMPORTER]: IMPORTER_SRC });
    expect(rep.mismatches).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('the target alone yields NO mismatch — nothing in the map imports from it', async () => {
    const rep = await analyzeImportExports({ [TARGET]: TARGET_SRC });
    expect(rep.mismatches).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('both halves together name the real defect', async () => {
    const rep = await analyzeImportExports({ [IMPORTER]: IMPORTER_SRC, [TARGET]: TARGET_SRC });
    expect(rep.counts['named-import-not-exported']).toBe(1);
    expect(rep.mismatches[0].file).toBe(IMPORTER);
    expect(rep.mismatches[0].imported).toBe('combo');
    expect(rep.mismatches[0].detail).toContain('does not export');
  });
});

describe('the missing-export gate judges the whole workspace', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('its analysis map overlays this turn\'s writes on a workspace load', () => {
    expect(route).toContain('const map = { ...exportGateBase, ...Object.fromEntries(writtenFiles) };');
    expect(route).toContain('const exportGateBase = await loadWorkspaceFiles(workspaceId)');
  });

  it('no analyzeImportExports call in the route is handed one turn\'s slice', () => {
    const slice = [...route.matchAll(/analyzeImportExports\(\s*Object\.fromEntries\(writtenFiles\)\s*\)/g)];
    expect(slice.map((m) => m[0]), 'a consistency check was given the writer\'s own slice again').toEqual([]);
  });

  it('repair is still limited to files this build wrote', () => {
    expect(route).toContain('ours: all.filter((t) => writtenFiles.has(t.target))');
    expect(route).toContain('foreign: all.filter((t) => !writtenFiles.has(t.target))');
  });
});
