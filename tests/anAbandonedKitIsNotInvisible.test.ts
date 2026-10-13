import { describe, it, expect } from 'vitest';
import { orphansToHandBack, wroteTheAppEntry, orphanInstruction } from '../src/server/AgentV3/orphanHandBack';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

/**
 * 🧬 A PREDICTION CANNOT SURVIVE THE TURN THAT DISPROVES IT — Q-908, autopsy `50378049` (BlockWorld, a
 * voxel game, 2026-10-12).
 *
 * The game kit seeded 24 files under `src/game/**`. The builder then wrote its own game structure and
 * used none of them, and `READINESS_WARNING` noted it had removed the only import of `GameCanvas.tsx`.
 * **The one mechanism built to catch exactly that — the orphan hand-back (Q-202) — was switched off**,
 * because the turn was a project-mode module and `starterExpected` was set.
 *
 * Two holes, and either one alone reproduces the report:
 *
 * 1. **The carve-out outlived its premise.** It is excused because *"a component is wired in by a later
 *    module by design"* — and the thing that wires components in is the app's ENTRY. The moment THIS turn
 *    writes the entry, no later module is coming, so the premise is dead and the orphans are real.
 * 2. **Fixing (1) alone would have traded one problem for another.** The route's write set holds every kit
 *    file the seed wrote, so with the carve-out lifted the hand-back would have named OUR OWN untouched
 *    kit and told the model to wire in or delete 24 files it never wrote.
 *
 * 🔒 Hole 1 is unreachable on an honest module turn, and that is worth stating: a module that owns the
 * entry makes `shellModuleFor` return null, so `starterExpected` is never set. It can only fire when the
 * builder went OUT of its module's scope — exactly the reported build.
 */

/**
 * 🔒 THE FIXTURE IS REAL WHERE IT MATTERS, and small on purpose.
 *
 * `unreferencedComponents` is deliberately precise: it names nothing unless an entry exists AND every
 * relative import resolves to a file it was given. The real kit's `Game.ts` imports seventeen files from
 * four OTHER recipes, so handing it the whole shell proves nothing — the graph refuses and the answer is
 * empty for the wrong reason. (My first fixture did exactly that and the test failed, correctly.)
 *
 * So the project below is the reported SHAPE with its imports closed: the model's own entry and game, one
 * orphan of the model's own making, and `src/game/GameCanvas.tsx` with the kit's REAL BYTES — the file the
 * report says lost its only import — plus stubs for the two files it imports.
 */
const KIT = generateGameShell().files;
const GAME_CANVAS = 'src/game/GameCanvas.tsx';

const project = (over: Record<string, string> = {}): Record<string, string> => ({
  'src/main.tsx': "import App from './App';\n",
  'src/App.tsx': "import { World } from './World';\nexport default function App() { return <World />; }\n",
  'src/World.tsx': 'export function World() { return <canvas />; }\n',
  // Written by the model, imported by nothing — a real orphan of its own making.
  'src/CraftingPanel.tsx': 'export function CraftingPanel() { return <div/>; }\n',
  // OUR kit, byte for byte, with its only import removed — the report's own words.
  [GAME_CANVAS]: KIT[GAME_CANVAS],
  'src/game/Game.ts': 'export class Game {}\n',
  'src/game/ui/Hud.tsx': 'export function Hud() { return <div/>; }\n',
  ...over,
});

const writtenByTheTurn = (p: Record<string, string>): string[] => Object.keys(p);

describe('an abandoned kit is not invisible (Q-908, autopsy 50378049)', () => {
  describe('wroteTheAppEntry — the fact that kills the premise', () => {
    it('🔴 THE REPORTED BUILD: the turn wrote the entry, so no later module is coming', () => {
      expect(wroteTheAppEntry(['src/types/index.ts', 'src/App.tsx'])).toBe(true);
      expect(wroteTheAppEntry(['index.html'])).toBe(true);
      expect(wroteTheAppEntry(['src/main.tsx'])).toBe(true);
    });

    it('an honest module turn wrote no entry, so the carve-out still protects it', () => {
      expect(wroteTheAppEntry(['src/types/index.ts', 'src/constants/index.ts'])).toBe(false);
      expect(wroteTheAppEntry([])).toBe(false);
    });

    it('paths are normalised, so "./src/App.tsx" is the same entry', () => {
      expect(wroteTheAppEntry(['./src/App.tsx'])).toBe(true);
      expect(wroteTheAppEntry(['src\\\\App.tsx'])).toBe(false); // a Windows path to a non-entry stays false
    });
  });

  describe('hole 1 — the carve-out yields when the turn wrote the entry', () => {
    it('🔴 with starterExpected AND the entry written, the real orphan is named', () => {
      const p = project();
      const out = orphansToHandBack({ project: p, written: writtenByTheTurn(p), starterExpected: true, env: {} as NodeJS.ProcessEnv });
      expect(out).toContain('src/CraftingPanel.tsx');
    });

    it('a module turn that did NOT write the entry is still excused, unchanged', () => {
      const p = project();
      // The same project — only the write set differs: no entry among this turn's writes.
      const out = orphansToHandBack({ project: p, written: ['src/CraftingPanel.tsx'], starterExpected: true, env: {} as NodeJS.ProcessEnv });
      expect(out).toEqual([]);
    });
  });

  describe('hole 2 — our own kit is never handed back as the model\'s leftover', () => {
    it('🔴 GameCanvas.tsx lost its only import and is NOT handed back — it is ours, byte for byte', () => {
      const p = project();
      const out = orphansToHandBack({ project: p, written: writtenByTheTurn(p), starterExpected: true, env: {} as NodeJS.ProcessEnv });
      expect(out).not.toContain(GAME_CANVAS);
      // …and the test is not passing because the graph found nothing at all.
      expect(out).toContain('src/CraftingPanel.tsx');
    });

    it('🔑 one edited byte makes it the model\'s again, so it IS nameable — the exclusion is byte-exact', () => {
      const p = project({ [GAME_CANVAS]: `${KIT[GAME_CANVAS]}\n// the model changed this\n` });
      const out = orphansToHandBack({ project: p, written: writtenByTheTurn(p), starterExpected: true, env: {} as NodeJS.ProcessEnv });
      expect(out).toContain(GAME_CANVAS);
    });
  });

  describe('everything else about the hand-back is unchanged', () => {
    it('the kill switch still kills it', () => {
      const p = project();
      expect(orphansToHandBack({ project: p, written: writtenByTheTurn(p), env: { AGENTV3_ORPHAN_HANDBACK: 'off' } as unknown as NodeJS.ProcessEnv })).toEqual([]);
    });

    it('tests, stories, type files and UI-kit parts are still never a screen', () => {
      const p = project({
        'src/World.test.tsx': 'it("x", () => {});\n',
        'src/ui/Button.tsx': 'export function Button() { return <button/>; }\n',
      });
      const out = orphansToHandBack({ project: p, written: writtenByTheTurn(p), env: {} as NodeJS.ProcessEnv });
      expect(out).not.toContain('src/World.test.tsx');
      expect(out).not.toContain('src/ui/Button.tsx');
    });

    it('the message still asks the model to wire in OR delete, never just delete', () => {
      const text = orphanInstruction(['src/CraftingPanel.tsx']);
      expect(text).toContain('import it and show it on the screen where it belongs');
      expect(text).toContain('Never delete something the user asked for');
    });

    it('an empty write set names nothing', () => {
      expect(orphansToHandBack({ project: project(), written: [], env: {} as NodeJS.ProcessEnv })).toEqual([]);
    });
  });
});
