// Autopsy 0c2a987a (2026-09-30). The agent ran `npm run build` — exit 0, 1523 modules transformed, built
// in 357ms — and the platform's own production build said PROD_BUILD_OK; the release gate still told the
// user "the typecheck did not run". The build script was `tsc -p tsconfig.build.json && vite build`: the
// compiler ran first, and `&&` means the bundle exists only because it passed. The evidence reader only
// counted `tsc --noEmit`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildScriptTypecheckVerdict, typecheckEvidenceFromCommands } from '../src/server/AgentV3/TscGate';
import { prodBuildCommand } from '../src/server/AgentV3/prodBuildGate';

// Verbatim from the report's commands log.
const REPORT_BUILD = {
  command: 'npm run build',
  exitCode: 0,
  stdout: '\n> project@0.1.0 build\n> tsc -p tsconfig.build.json && vite build\n\nvite v8.3.1 building client environment for production...\ntransforming...\n✓ 1523 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                            20.60 kB │ gzip:  7.96 kB\n\n✓ built in 357ms\n',
  stderr: '',
};

describe('the report\'s own build', () => {
  it('🔴 is a passed typecheck', () => {
    expect(buildScriptTypecheckVerdict(REPORT_BUILD)).toBe('passed');
    expect(typecheckEvidenceFromCommands([REPORT_BUILD])).toBe('passed');
  });
  it('the platform\'s own piped production build reads the same', () => {
    expect(buildScriptTypecheckVerdict({ ...REPORT_BUILD, command: 'npm run build 2>&1 | tail -120', exitCode: null })).toBe('passed');
  });
  it('the unpiped production command trusts a real non-zero exit (BLD-1)', () => {
    expect(buildScriptTypecheckVerdict({ ...REPORT_BUILD, command: prodBuildCommand(), exitCode: 0 })).toBe('passed');
    expect(buildScriptTypecheckVerdict({ ...REPORT_BUILD, command: prodBuildCommand(), exitCode: 2 })).not.toBe('passed');
  });
});

describe('what it is not', () => {
  it('a type error stops the chain — failed', () => {
    const out = '> tsc -p tsconfig.build.json && vite build\n\nsrc/App.tsx(3,1): error TS2304: Cannot find name \'x\'.\n';
    expect(buildScriptTypecheckVerdict({ command: 'npm run build', exitCode: 2, stdout: out })).toBe('failed');
  });
  it('a build script with no tsc says nothing about types', () => {
    expect(buildScriptTypecheckVerdict({ command: 'npm run build', exitCode: 0, stdout: '> vite build\n✓ built in 300ms\n' })).toBeUndefined();
  });
  it('a bundle that never finished says nothing either way', () => {
    expect(buildScriptTypecheckVerdict({ command: 'npm run build', exitCode: 0, stdout: '> tsc && vite build\ntransforming...\n' })).toBeUndefined();
  });
  it('a command that is not a build is left to the --noEmit reader', () => {
    expect(buildScriptTypecheckVerdict({ command: 'npm run dev', exitCode: 0, stdout: '> tsc && vite\n✓ built in 1s' })).toBeUndefined();
  });
  it('a later clean --noEmit run still wins over an earlier failed build (latest wins)', () => {
    const failedBuild = { command: 'npm run build', exitCode: 2, stdout: '> tsc && vite build\nsrc/a.ts(1,1): error TS1005: x' };
    const clean = { command: './node_modules/.bin/tsc --noEmit', exitCode: 0, stdout: '' };
    expect(typecheckEvidenceFromCommands([failedBuild, clean])).toBe('passed');
  });
});

describe('both producers feed the gate', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('the platform\'s production build fills a not-run typecheck', () => {
    expect(route).toContain('const fromBuild = buildScriptTypecheckVerdict({ command: prodBuildCommand(), stdout: output, exitCode });');
  });
});
