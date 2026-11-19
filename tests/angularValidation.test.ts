import { describe, expect, it } from 'vitest';
import { angularValidationPlan, isAngularValidationCommand, parseAngularValidation, angularTypeScriptOnlyWriteNote } from '../src/server/AgentV3/angularValidation';

const COMPLETE = 'Initial chunk files | Names | Raw size\nmain.js | main | 120.00 kB\nApplication bundle generation complete. [3.417 seconds]\nOutput location: /app/dist/app';

describe('Angular native validation — cdffbb71', () => {
  it('recognises only actual native build argv, not shell data or nonchecking commands', () => {
    expect(isAngularValidationCommand(angularValidationPlan('angular')!.command)).toBe(true);
    expect(isAngularValidationCommand('node_modules/.bin/ng build')).toBe(true);
    for (const command of ['echo ./node_modules/.bin/ng build', 'npm install @angular/cli', './node_modules/.bin/ng build --help', './node_modules/.bin/ng version', './node_modules/.bin/ng build | head', './node_modules/.bin/ng build || true', './node_modules/.bin/ng build\ntrue', 'npx ng build']) {
      expect(isAngularValidationCommand(command), command).toBe(false);
    }
  });
  it('uses the installed Angular builder and the actual workspace default configuration', () => {
    expect(angularValidationPlan('angular')).toEqual({ command: './node_modules/.bin/ng build --progress=false', timeoutMs: 90_000 });
    expect(angularValidationPlan('Angular')).toEqual(angularValidationPlan('angular'));
    expect(angularValidationPlan('angular')?.command).not.toMatch(/tsc|npx|configuration|serve/);
  });

  it.each(['vite-react', 'vue', 'static', 'nestjs', '', undefined])('does not replace the compiler for %s', (framework) => {
    expect(angularValidationPlan(framework)).toBeUndefined();
  });

  it.each([
    "An unhandled exception occurred: Configuration 'development' is not set in the workspace.",
    'Error: Schema validation failed with the following errors:\n  Data path "" must have required property \'buildTarget\'.',
    "✘ [ERROR] NG5002: Parser Error: Unexpected token ')' at column 43 in [!wallet.txns.some((t) => t.note === 'demo')] [plugin angular-compiler]",
    "✘ [ERROR] NG9: Property 'colour' does not exist on type 'BetTarget'. [plugin angular-compiler]",
    "src/app/game.component.ts:76:102 - error NG9: Property 'colour' does not exist on type 'BetTarget'.",
    "src/main.ts:1:1 - error TS2307: Cannot find module './missing'.",
  ])('retains the actual report/compiler failure even when a wrapper says zero: %s', (output) => {
    for (const exit of [0, 1, null]) {
      const result = parseAngularValidation(exit, output, '');
      expect(result.status).toBe('failed');
      expect(result.output).toBe(output);
    }
  });

  it('accepts a completed application build, but does not claim live execution', () => {
    const result = parseAngularValidation(0, COMPLETE, '');
    expect(result.status).toBe('passed');
    expect(result.summary).toContain('configured template checks');
    expect(result.summary).toContain('live preview and user journeys still need verification');
  });

  it('supports the legacy browser-builder completion marker', () => {
    expect(parseAngularValidation(0, '✔ Browser application bundle generation complete.\nBuild at: 2026-11-18T10:00:00.000Z - Hash: abc123 - Time: 5000ms', '').status).toBe('passed');
  });

  it.each([null, undefined, NaN, Infinity, -1, 1])('a completion line without a successful known exit %s is not a pass', (exitCode) => {
    expect(parseAngularValidation(exitCode, COMPLETE, '').status).not.toBe('passed');
  });

  it.each(['', '18.2.21', 'Building...', '✔ Building...', 'ng build [project]\nOptions:\n  --help'])('silence, version, progress and help are not successful Angular builds: %s', (output) => {
    expect(parseAngularValidation(0, output, '').status).not.toBe('passed');
  });

  it('reports a missing CLI as unrun, not a source-code failure', () => {
    const result = parseAngularValidation(127, '', '/bin/bash: ./node_modules/.bin/ng: No such file or directory');
    expect(result.status).toBe('not-run');
    expect(result.summary).toContain('remain unverified');
  });

  it('distinguishes a broken CLI installation from a missing application import', () => {
    expect(parseAngularValidation(1, '', "Error: Cannot find module '/app/node_modules/@angular/cli/bin/ng.js'").status).toBe('not-run');
    expect(parseAngularValidation(1, '', "Error: Cannot find module './app.component'").status).toBe('failed');
  });

  it('preserves native diagnostics printed to stderr and ignores terminal colouring', () => {
    const result = parseAngularValidation(1, 'Building...', '\u001b[31m✘ [ERROR] NG9: bad binding\u001b[0m');
    expect(result.status).toBe('failed');
    expect(result.output).toContain('NG9: bad binding');
    expect(result.output).not.toContain('\u001b[');
  });

  it('does not misclassify successful extended template warnings as failed builds', () => {
    const warning = '▲ [WARNING] NG8107: The left side of this optional chain operation does not include null or undefined. [plugin angular-compiler]';
    expect(parseAngularValidation(0, COMPLETE, warning).status).toBe('passed');
    expect(parseAngularValidation(0, '', warning).status).toBe('unknown');
    expect(parseAngularValidation(1, COMPLETE, warning.replace('[WARNING]', '[ERROR]')).status).toBe('failed');
  });

  it('does not turn a build crash without compiler results into a pass', () => {
    expect(parseAngularValidation(134, 'FATAL ERROR: Reached heap limit Allocation failed', '').status).toBe('unknown');
  });

  it('write-time tsc success stays TypeScript-only', () => {
    const note = angularTypeScriptOnlyWriteNote(['src/app/wallet.component.ts']);
    expect(note).toContain('src/app/wallet.component.ts');
    expect(note).toContain('tsc reported no TypeScript errors');
    expect(note).toContain('Angular templates, build configuration and assets have not been validated');
    expect(note).not.toMatch(/whole project compiles|do not.*typecheck/i);
  });
});
