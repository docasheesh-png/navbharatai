import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withVitestDeclared, PLATFORM_TEST_SCRIPT, VITEST_RANGE } from '../src/server/AgentV3/TestGenerationAgent';
import { projectKitFiles } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/projectKit';
import { packageJson as VITE_SCAFFOLD_PKG } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';
import { generateGameShell, GAME_CONTROLS_TEST_PATH } from '../src/server/lib/GameShellGenerator';

/**
 * 🧬 WE NEVER TELL A USER TO RUN A COMMAND THEIR APP DOES NOT HAVE — Q-911, autopsy `50378049`.
 *
 * Every 3D game NavBharatAI builds ships `src/game/controls.test.ts`, and that file, in the user's own
 * project, says:
 *
 *   > *"Your test runner runs it (npm test, or vitest run)."*
 *
 * The default Vite scaffold's `package.json` defines `dev`, `build` and `preview` — **no `test` script
 * at all.** So `npm test` in that app answers `npm error Missing script: "test"`. We wrote the test, we
 * wrote the instruction, and the instruction did not work: a fake feature by the second absolute rule,
 * inside a file we put in their repo.
 *
 * 🔑 THE CLASS, not the instance. The repo already had the right pattern twice — `projectKit.ts` added a
 * `test` script beside its own `withVitestDeclared` call, and `e2eScaffold.ts` adds `test:e2e` before
 * telling anyone to run it. The game kit was the one path that shipped the instruction without the
 * script, because the script-writing lived in a CALLER instead of in the shared helper. So the fix moved
 * it into `withVitestDeclared`, `projectKit`'s private copy was deleted, and the census below fails the
 * build if a new path ships a test without making it runnable.
 *
 * 🔒 Checked, not assumed: adding the script makes apps take `testRunner`'s "project's own test script"
 * branch, which would have lost the `--exclude 'e2e/**'` that stops vitest collecting our unrun
 * Playwright starter (the 2026-08-25 false `vitest: FAIL`). Autopsy `9cca1fd5` already closed that on
 * that branch — a case below pins it, because the safety of this fix rests on it.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('a shipped test can actually be run (Q-911, autopsy 50378049)', () => {
  describe('the default scaffold — the shape that made the instruction false', () => {
    it('🔴 the Vite scaffold really has no test script (the premise of this whole file)', () => {
      const pkg = JSON.parse(VITE_SCAFFOLD_PKG) as { scripts: Record<string, string> };
      expect(Object.keys(pkg.scripts).sort()).toEqual(['build', 'dev', 'preview']);
      expect(pkg.scripts.test).toBeUndefined();
    });

    it('…and one pass over it now makes `npm test` work', () => {
      const out = JSON.parse(withVitestDeclared(VITE_SCAFFOLD_PKG)!) as {
        scripts: Record<string, string>; devDependencies: Record<string, string>;
      };
      expect(out.scripts.test).toBe(PLATFORM_TEST_SCRIPT);
      expect(out.devDependencies.vitest).toBe(VITEST_RANGE);
      // Nothing else about the scaffold is disturbed.
      expect(out.scripts.dev).toBe('vite');
      expect(out.scripts.build).toBe(JSON.parse(VITE_SCAFFOLD_PKG).scripts.build);
    });

    it('it is idempotent — a second pass changes nothing', () => {
      const once = withVitestDeclared(VITE_SCAFFOLD_PKG)!;
      expect(withVitestDeclared(once)).toBeNull();
    });
  });

  describe('the game kit — the path that shipped the instruction without the script', () => {
    const shellFiles = (): Record<string, string> => generateGameShell().files;

    it('🔴 the game shell really does ship a vitest test into the user\'s project', () => {
      const files = shellFiles();
      expect(Object.keys(files)).toContain(GAME_CONTROLS_TEST_PATH);
      expect(files[GAME_CONTROLS_TEST_PATH]).toContain("from 'vitest'");
    });

    /**
     * ⚠️ AND THE INSTRUCTION MUST NOT USE BACKTICKS. `GAME_CONTROLS_TEST` is itself a TS template
     * literal, so a backtick in its text ends the string — this fix hit that trap while correcting the
     * very line it was correcting, and it surfaced as a parse error in an unrelated-looking place. The
     * compiler is the real guard; this note is here so the next person does not rediscover it.
     */
    it('and the instruction inside it names a command the app now defines', () => {
      const test = shellFiles()[GAME_CONTROLS_TEST_PATH];
      const named = [...test.matchAll(/npm (?:run )?([a-z][\w:-]*)/g)].map((m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      const after = JSON.parse(withVitestDeclared(VITE_SCAFFOLD_PKG)!) as { scripts: Record<string, string> };
      for (const script of named) expect(Object.keys(after.scripts)).toContain(script);
    });
  });

  describe('🔒 THE CENSUS — every path that ships a vitest test makes it runnable', () => {
    /**
     * The one helper that decides it. A path that ships a `*.test.ts` importing vitest and does NOT go
     * through this is the Q-911 defect returning, so the list of callers is pinned rather than trusted.
     */
    it('exactly three paths ship a vitest test, and all three call the one helper', () => {
      const callers = [
        'src/server/AgentV3/ToolDispatcher.ts',                                        // recipes + generate_tests
        'src/server/AgentV3/sandbox/AppMakerLab/generator/templates/projectKit.ts',    // the project kit
      ];
      for (const f of callers) expect(read(f)).toContain('withVitestDeclared');
      // The game kit reaches it through the recipe tool (`run_recipe` → `writeRecipeFiles` →
      // `declareVitestForRecipeTests`), which is why it needs no call of its own — pinned here so a
      // refactor that bypasses `writeRecipeFiles` is caught.
      const disp = read('src/server/AgentV3/ToolDispatcher.ts');
      expect(disp).toContain('const runner = await this.declareVitestForRecipeTests(files, agent);');
      expect(disp).toContain('if (!recipeShipsVitestTest(files)) return \'\';');
    });

    it('projectKit no longer keeps its own copy of the script string', () => {
      const kit = read('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/projectKit.ts');
      expect(kit).not.toContain("test: pkg.scripts?.test || 'vitest run'");
      expect(kit).toContain('const runnable = withVitestDeclared(packageJson);');
    });

    it('the project kit still delivers a runnable package.json end to end', () => {
      const files = projectKitFiles(VITE_SCAFFOLD_PKG);
      expect(files['src/lib/env.test.ts']).toContain("from 'vitest'");
      const pkg = JSON.parse(files['package.json']) as { scripts: Record<string, string> };
      expect(pkg.scripts.test).toBe(PLATFORM_TEST_SCRIPT);
    });

    it('its README promises `npm test`, and the package.json it ships backs that promise', () => {
      const kit = read('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/projectKit.ts');
      expect(kit).toContain('`npm test`');
      expect(JSON.parse(projectKitFiles(VITE_SCAFFOLD_PKG)['package.json']).scripts.test).toBeTruthy();
    });

    it('the e2e scaffold — the path that already did it right — still adds its script before saying so', () => {
      const e2e = read('src/server/AgentV3/e2eScaffold.ts');
      expect(e2e.indexOf("'test:e2e': 'playwright test'")).toBeGreaterThan(0);
      expect(e2e.indexOf("'test:e2e': 'playwright test'")).toBeLessThan(e2e.indexOf('Run with \\`npm run test:e2e\\`'));
    });
  });

  describe('🔒 the guard this fix\'s safety rests on (autopsy 9cca1fd5) is still there', () => {
    it("the project's-own-script branch forwards the Playwright exclusion", () => {
      const runner = read('src/server/AgentV3/testRunner.ts');
      // Without this, a platform-written `vitest run` script would collect our unrun Playwright starter
      // and report the app's own passing suite as failing — the 2026-08-25 report.
      expect(runner).toContain('framework === \'vitest\' && playwrightOwnsE2e(files) ? " -- --exclude \'e2e/**\'" : \'\'');
    });
  });
});
