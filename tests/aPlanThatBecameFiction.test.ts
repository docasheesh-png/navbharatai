import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProjectPlan, parsePlannedModules, markModuleStatus, moduleBuildContext,
  recordModuleDelivery, undeliveredOwnFiles, contractIsUnbacked,
} from '../src/server/AgentV3/ProjectPlan';

/**
 * 🧬 A MODULE IS DONE WHEN IT DELIVERED ITS FILES, NOT WHEN ITS TURN SUCCEEDED — autopsy `50378049`,
 * Q-905 (BlockWorld, a voxel game, 2026-10-12).
 *
 * The plan's module 1 was *"Shared Types & Constants"*, owning `src/types/index.ts` and
 * `src/constants/index.ts`, carrying the frozen contract every later module would import. The builder
 * ignored the scope and wrote the whole game — 56 files — and **never those two**. The route settled it
 * with `result.ok ? markModuleStatus(…, 'done')`, and the user read `✅ Module … done — 1/15`.
 *
 * 🔑 The damage is downstream and certain: `moduleBuildContext` hands every DONE module's contract to
 * the next turn under the heading *"ALREADY-BUILT MODULES — their files exist in the workspace. Import
 * from them using ONLY these frozen contracts"*. Module 2 would be told, in writing, to import exact
 * names from a file that does not exist. The model cannot win that turn.
 *
 * ⚠️ IT IS THE UNHUNTED HALF OF AUTOPSY `8e124182`. That one is the mirror image — *"module 1's turn
 * wrote 33 files, the whole app, and the plan still recorded 1 of 14 done"* — and its fix,
 * `reconcilePlanWithWrites`, promotes OTHER modules whose planned paths were all written. It is
 * path-exact by design, so a builder that invents its own structure matches nothing. One half of the
 * reconciliation shipped; this is the half that asks whether the module in progress delivered its share.
 *
 * 🔒 The status is deliberately NOT failed: the reported build gave the user a complete, running game,
 * so "module 1 failed" would be its own lie. What changes is that the plan RECORDS what is missing, and
 * a contract nothing backs is never handed forward as a fact.
 */

/** The reported plan's shape: types-and-constants first, the shell later. */
const PLAN_JSON = JSON.stringify([
  {
    id: 'types', name: 'Shared Types & Constants', description: 'types and constants', dependsOn: [],
    files: ['src/types/index.ts', 'src/constants/index.ts'],
    contracts: 'export interface Block { id: number; }\nexport const CHUNK_SIZE: number;',
  },
  {
    id: 'world', name: 'World Generation', description: 'chunks', dependsOn: ['types'],
    files: ['src/world/generator.ts'], contracts: 'export function generateChunk(): void;',
  },
  {
    id: 'shell', name: 'App Shell & Game Loop', description: 'mounts the game', dependsOn: ['world'],
    files: ['src/App.tsx'], contracts: 'export default function App(): JSX.Element;',
  },
]);

const plan = () => createProjectPlan('BlockWorld: Infinite Adventures', 'vite-react', parsePlannedModules(PLAN_JSON), 1);

/** What the builder actually left in the project — the whole game, by its own names. */
const WHAT_IT_REALLY_WROTE = [
  'index.html', 'src/main.ts', 'src/game/Game.ts', 'src/game/Chunk.ts', 'src/game/Player.ts',
  'src/ui/Hud.tsx', 'src/ui/InventoryPanel.tsx', 'src/ui/CraftingPanel.tsx', 'package.json',
];

describe('a plan that became fiction (autopsy 50378049, Q-905)', () => {
  describe('undeliveredOwnFiles — the measurement', () => {
    it('🔴 THE REPORTED BUILD: both of module 1\'s own files are missing', () => {
      expect(undeliveredOwnFiles(plan().modules[0], WHAT_IT_REALLY_WROTE))
        .toEqual(['src/types/index.ts', 'src/constants/index.ts']);
    });

    it('a module that delivered everything it owns has nothing missing', () => {
      expect(undeliveredOwnFiles(plan().modules[0], ['src/types/index.ts', 'src/constants/index.ts', 'x.ts'])).toEqual([]);
    });

    it('names are compared normalised, so "./src/x" and "src/x" are the same file', () => {
      expect(undeliveredOwnFiles({ files: ['./src/types/index.ts'] }, ['src/types/index.ts'])).toEqual([]);
      expect(undeliveredOwnFiles({ files: ['src/types/index.ts'] }, ['./src/types/index.ts'])).toEqual([]);
    });

    it('it asks about the PROJECT, so a file an earlier turn wrote counts as delivered', () => {
      // The route passes `actuator.listFiles`, never this turn's write set — the distinction matters
      // because every module after the first builds on files it did not write.
      expect(undeliveredOwnFiles(plan().modules[1], ['src/world/generator.ts'])).toEqual([]);
    });

    it('a module that owns no files has nothing to deliver and is never called short', () => {
      expect(undeliveredOwnFiles({ files: [] }, [])).toEqual([]);
      expect(undeliveredOwnFiles({ files: ['', '  '] as string[] }, [])).toEqual([]);
    });

    it('never throws on a missing or malformed file list', () => {
      expect(undeliveredOwnFiles({ files: ['a.ts'] }, null)).toEqual(['a.ts']);
      expect(undeliveredOwnFiles({ files: ['a.ts'] }, undefined)).toEqual(['a.ts']);
    });
  });

  describe('contractIsUnbacked — only ALL-missing, never partial', () => {
    it('🔴 module 1 of the reported build: nothing it owns exists, so its contract is unbacked', () => {
      const settled = recordModuleDelivery(markModuleStatus(plan(), 'types', 'done'), 'types', WHAT_IT_REALLY_WROTE);
      expect(contractIsUnbacked(settled.modules[0])).toBe(true);
    });

    it('a PARTIALLY delivered module keeps its contract — the names it did write are real', () => {
      const settled = recordModuleDelivery(markModuleStatus(plan(), 'types', 'done'), 'types',
        [...WHAT_IT_REALLY_WROTE, 'src/types/index.ts']);
      expect(settled.modules[0].undelivered).toEqual(['src/constants/index.ts']);
      expect(contractIsUnbacked(settled.modules[0])).toBe(false);
    });

    it('a module nobody asked about is not unbacked — absent is not missing', () => {
      expect(contractIsUnbacked(plan().modules[0])).toBe(false);
    });

    it('a module that owns no files is never unbacked', () => {
      expect(contractIsUnbacked({ files: [], undelivered: [] })).toBe(false);
    });
  });

  describe('the next module\'s build prompt — where the damage actually landed', () => {
    const done = (present: string[]) =>
      recordModuleDelivery(markModuleStatus(plan(), 'types', 'done'), 'types', present);

    it('🔴 REVERSION: without the delivery record, module 2 is told to import names from a missing file', () => {
      // Exactly the pre-fix state: marked done on `result.ok`, with nothing recorded.
      const asItWas = markModuleStatus(plan(), 'types', 'done');
      const ctx = moduleBuildContext(asItWas, asItWas.modules[1]);
      expect(ctx).toContain('their files exist in the workspace');
      expect(ctx).toContain('export const CHUNK_SIZE: number;');
    });

    it('…and with it recorded, the unbacked contract is WITHHELD and the turn is told why', () => {
      const p = done(WHAT_IT_REALLY_WROTE);
      const ctx = moduleBuildContext(p, p.modules[1]);
      expect(ctx).not.toContain('export const CHUNK_SIZE: number;');
      expect(ctx).not.toContain('their files exist in the workspace');
      expect(ctx).toContain('DID NOT LEAVE THEIR FILES BEHIND');
      expect(ctx).toContain('Shared Types & Constants');
      expect(ctx).toContain('src/types/index.ts');
    });

    it('a module that DID deliver still hands its contract forward, exactly as before', () => {
      const p = done(['src/types/index.ts', 'src/constants/index.ts']);
      const ctx = moduleBuildContext(p, p.modules[1]);
      expect(ctx).toContain('their files exist in the workspace');
      expect(ctx).toContain('export const CHUNK_SIZE: number;');
      expect(ctx).not.toContain('DID NOT LEAVE THEIR FILES BEHIND');
    });

    it('a PARTIAL delivery hands the contract forward WITH the missing file named', () => {
      const p = done(['src/types/index.ts']);
      const ctx = moduleBuildContext(p, p.modules[1]);
      expect(ctx).toContain('export const CHUNK_SIZE: number;');
      expect(ctx).toContain('not in the project: src/constants/index.ts');
    });

    it('a plan nobody measured behaves exactly as it does today — this is additive', () => {
      const untouched = markModuleStatus(plan(), 'types', 'done');
      expect(moduleBuildContext(untouched, untouched.modules[1]))
        .toBe(moduleBuildContext(markModuleStatus(plan(), 'types', 'done'), untouched.modules[1]));
    });
  });

  describe('the route settles delivery from the project, and says so honestly', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

    it('the delivery question is asked against the PROJECT file list, not the turn\'s writes', () => {
      expect(route).toContain("const projectFiles = await withTimeout(actuator.listFiles(workspaceId), 15_000, 'module-delivery-list');");
      expect(route).toContain('settled = recordModuleDelivery(settled, projectModuleRef.id, projectFiles);');
      // Never from `writtenFiles` — that is the question `reconcilePlanWithWrites` already answers, and
      // asking it here would call an earlier turn's delivered file missing.
      expect(route).not.toContain('recordModuleDelivery(settled, projectModuleRef.id, writtenFiles');
    });

    it('it is asked only on a successful turn, and a failure to ask never changes the plan', () => {
      const at = route.indexOf('let moduleUndelivered: string[] = [];');
      expect(at).toBeGreaterThan(0);
      const block = route.slice(at, at + 900);
      expect(block).toContain('if (result.ok) {');
      expect(block).toContain('catch { /* unasked is not undelivered');
    });

    it('the report records it as a MEASUREMENT of our process, never a finding against the app', () => {
      for (const f of ['src/server/AgentV3/BuildDiagnostics.ts', 'src/server/AgentV3/buildFindingSuggestions.ts']) {
        expect(readFileSync(join(process.cwd(), f), 'utf8')).toContain("'PROJECT_MODULE_FILES_UNDELIVERED'");
      }
      const at = route.indexOf("code: 'PROJECT_MODULE_FILES_UNDELIVERED'");
      expect(at).toBeGreaterThan(0);
      expect(route.slice(at - 200, at + 200)).toContain("severity: 'info'");
    });

    it('the user is not told a flat "done" when the module\'s own files are not there', () => {
      expect(route).toContain('this step built the app its own way rather than those exact files');
    });
  });
});
