// A GAME SHIPS ITS CONTROLS TEST — AND EVERY RECIPE THAT SHIPS A TEST SHIPS ITS RUNNER (Q-843, build 46e2d74b;
// admin 2026-10-12: "game wali rows bhi aap hi karo").
//
// No game had a behaviour test: the readiness gate said "No tests at all", and nothing a test runner could run
// ever checked that LEFT turns left, W accelerates, or that the camera sits behind the car — the two defects the
// admin found by PLAYING. The game shell now ships `src/game/controls.test.ts`.
//
// Hunting the siblings found the class underneath: five recipes and the integration-test recipe already wrote a
// `*.test.ts` that imports vitest, and none declared vitest — so the project's own typecheck reported "Cannot find
// module 'vitest'" and run_tests found no runner. Every recipe writer now declares it first.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { generateGameShell, GAME_CONTROLS_TEST, GAME_CONTROLS_TEST_PATH } from '../src/server/lib/GameShellGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { recipeShipsVitestTest } from '../src/server/AgentV3/TestGenerationAgent';
import { generateAuditLogIntegration } from '../src/server/lib/AuditLogGenerator';
import { generateCsrfIntegration } from '../src/server/lib/CsrfGenerator';
import { generateIndianValidatorsIntegration } from '../src/server/lib/IndianValidatorsGenerator';
import { generateMoneyFormatIntegration } from '../src/server/lib/MoneyFormatGenerator';
import { generateUpiIntegration } from '../src/server/lib/UpiGenerator';

describe('the game shell ships the controls test', () => {
  it('beside Game.ts, whole or as a subset that pulls Game.ts in', () => {
    expect(generateGameShell().files[GAME_CONTROLS_TEST_PATH]).toBe(GAME_CONTROLS_TEST);
    expect(generateGameShell(['gamecanvas']).files[GAME_CONTROLS_TEST_PATH]).toBe(GAME_CONTROLS_TEST);
  });

  it('it checks the four things the admin found by playing', () => {
    expect(GAME_CONTROLS_TEST).toContain("it('W speeds the car up'");
    expect(GAME_CONTROLS_TEST).toContain("LEFT turns the car to the driver's left (+X)");
    expect(GAME_CONTROLS_TEST).toContain("RIGHT turns the car to the driver's right (-X)");
    expect(GAME_CONTROLS_TEST).toContain('the chase camera sits BEHIND the car');
  });
});

// ── It really runs, against the real generated kit — and it really catches a mirrored kit ─────────────────────
const DIR = join(__dirname, `.tmp-controls-test-${process.pid}`);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function writeKit(mirrored: boolean): void {
  rmSync(DIR, { recursive: true, force: true });
  for (const r of [generateGameRuntime(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) {
      const f = join(DIR, p);
      mkdirSync(dirname(f), { recursive: true });
      // The 46e2d74b defect, put back: LEFT turns the car to the right.
      writeFileSync(f, mirrored ? c.replace('state.heading - axis.x * steerRate', 'state.heading + axis.x * steerRate') : c);
    }
  }
  writeFileSync(join(DIR, GAME_CONTROLS_TEST_PATH), GAME_CONTROLS_TEST);
  writeFileSync(join(DIR, 'package.json'), '{ "name": "game", "type": "module" }\n');
}

function runIt(): Promise<string> {
  return new Promise((res) => {
    execFile(process.execPath, [join(process.cwd(), 'node_modules/vitest/vitest.mjs'), 'run', GAME_CONTROLS_TEST_PATH, '--root', DIR],
      { cwd: DIR, timeout: 120_000 }, (_e, out, err) => res(`${out}\n${err}`));
  });
}

describe('🔒 the shipped test, run by vitest in a project laid out like the game\'s', () => {
  it('passes on the real kit', async () => {
    writeKit(false);
    const out = await runIt();
    expect(out).toMatch(/Tests\s+5 passed \(5\)/);
  }, 150_000);

  it('FAILS on a kit whose LEFT turns right — the defect it exists to catch', async () => {
    writeKit(true);
    const out = await runIt();
    expect(out).toMatch(/Tests\s+2 failed \| 3 passed \(5\)/);
  }, 150_000);
});

describe('🔒 every recipe that ships a vitest test declares vitest first (the class)', () => {
  const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const WIRED: Array<[string, () => { files: Record<string, string> }, string]> = [
    ['AuditLogGenerator', generateAuditLogIntegration, 'auditcfg'],
    ['CsrfGenerator', generateCsrfIntegration, 'csrfcfg'],
    ['IndianValidatorsGenerator', generateIndianValidatorsIntegration, 'ivcfg'],
    ['MoneyFormatGenerator', generateMoneyFormatIntegration, 'mfcfg'],
    ['UpiGenerator', generateUpiIntegration, 'upicfg'],
  ];

  for (const [name, gen, local] of WIRED) {
    it(`${name}: ships a vitest test, and its recipe declares the runner before writing it`, () => {
      expect(recipeShipsVitestTest(gen().files)).toBe(true);
      expect(dispatcher).toContain(`this.declareVitestForRecipeTests(${local}.files, agent)`);
    });
  }

  it('the integration-test recipe and every writeRecipeFiles recipe (the game shell among them) declare it too', () => {
    expect(dispatcher).toContain('this.declareVitestForRecipeTests(itCfg.files, agent)');
    const writer = dispatcher.slice(dispatcher.indexOf('private async writeRecipeFiles('));
    expect(writer.slice(0, 400)).toContain('await this.declareVitestForRecipeTests(files, agent);');
    expect(recipeShipsVitestTest(generateGameShell().files)).toBe(true);
  });

  it('CENSUS: a NEW generator that writes a *.test.ts is in the list above — or this fails', () => {
    const shipping = readdirSync('src/server/lib')
      .filter((f) => /Generator\.ts$/.test(f) && !f.endsWith('.test.ts'))
      .filter((f) => /\.test\.tsx?'\s*:/.test(readFileSync(join('src/server/lib', f), 'utf8')))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort();
    expect(shipping).toEqual(WIRED.map(([n]) => n).sort());
  });

  it('recipeShipsVitestTest reads the shape: a test path that imports vitest, nothing else', () => {
    expect(recipeShipsVitestTest({ 'a.test.ts': "import { it } from 'vitest';" })).toBe(true);
    expect(recipeShipsVitestTest({ 'a.ts': "import { it } from 'vitest';" })).toBe(false);
    expect(recipeShipsVitestTest({ 'e2e/a.spec.ts': "import { test } from '@playwright/test';" })).toBe(false);
  });
});
