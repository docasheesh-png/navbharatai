import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { abortOutcomeFor } from '../src/server/AgentV3/abortOutcome';
import { buildWalletBudgetDiagnostic, buildWalletStopDetail } from '../src/server/AgentV3/buildWalletDiagnostic';
import { repairStyleRegression } from '../src/server/AgentV3/repairAcceptance';
import { cssConsistencyError } from '../src/server/AgentV3/CssConsistency';
import { combinedVerifyErrors } from '../src/server/AgentV3/TscGate';
import { manifestSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';

const ERROR = "src/App.tsx(78,26): error TS2339: Property 'error' does not exist on type 'CalcOutcome'.";
const failure = (code: string) => ({ phase: 'build' as const, severity: 'warning' as const,
  code, message: `Fast-lane verify failed: ${ERROR}`, detail: ERROR, autoResolved: true });

describe('a handed-off compiler error stays unresolved until a genuine recheck', () => {
  it('only a recheck of the current source can resolve a handed-off compiler finding', () => {
    let revision = 7;
    const diag = new BuildDiagnostics({ currentSourceRevision: () => revision });
    diag.record(failure('SIMPLE_BUILD_VERIFY_ERROR'));
    const clean = { command: 'tsc --noEmit', stdout: '', exitCode: 0 };
    revision++;
    for (const proof of [undefined, { revision: 7, project: true }, { revision, project: false }]) {
      diag.recordCommand({ ...clean, typecheckProof: proof });
      expect(diag.report().issues.find(issue => issue.code === 'SIMPLE_BUILD_VERIFY_ERROR')?.autoResolved).toBe(false);
    }
    diag.recordCommand({ ...clean, typecheckProof: { revision, project: true } });
    expect(diag.report().issues.find(issue => issue.code === 'SIMPLE_BUILD_VERIFY_ERROR')?.autoResolved).toBe(true);
  });

  it.each(['SIMPLE_BUILD_VERIFY_ERROR', 'ONESHOT_VERIFY_FAILED'])('%s is not healed by handing off or by a wallet stop', code => {
    const diag = new BuildDiagnostics({ workspaceId: 'synthetic-calculator' });
    diag.record(failure(code));
    diag.record({ phase: 'build', severity: 'info', code: 'SIMPLE_BUILD_SALVAGE', message: 'Files handed over', autoResolved: true });
    const stop = abortOutcomeFor('wallet-empty')!;
    diag.record({ phase: 'build', ...stop, autoResolved: false });
    diag.finish(false, 'Your balance is not enough for this build, please recharge!');
    const report = diag.report();
    expect(report.issues.find(issue => issue.code === code)?.autoResolved).toBe(false);
    expect(report.counts.autoResolved).toBe(0);
    expect(report.rootCause).toBe(stop.message);
    expect(report.rootCause).not.toContain('Not a defect in the app');
  });

  it.each(['SIMPLE_BUILD_VERIFY_ERROR', 'ONESHOT_VERIFY_FAILED'])('a completed project typecheck can close %s', code => {
    const diag = new BuildDiagnostics({});
    diag.record(failure(code));
    diag.recordCommand({ command: './node_modules/.bin/tsc --noEmit', stdout: '', stderr: '', exitCode: 0 });
    expect(diag.report().issues.find(issue => issue.code === code)?.autoResolved).toBe(true);
  });

  it.each([
    { command: './node_modules/.bin/tsc --noEmit', stdout: ERROR, exitCode: 0 },
    { command: './node_modules/.bin/tsc --noEmit', stdout: 'Version 5.8.2\ntsc: The TypeScript Compiler\nCOMMON COMMANDS', exitCode: 0 },
    { command: './node_modules/.bin/tsc --noEmit', stdout: '', exitCode: null },
    { command: './node_modules/.bin/tsc --noEmit src/other.ts', stdout: '', exitCode: 0 },
    { command: './node_modules/.bin/tsc --noEmit | head -20', stdout: '', exitCode: 0 },
    { command: './node_modules/.bin/tsc --noEmit --noCheck', stdout: '', exitCode: 0 },
    { command: 'echo tsc --noEmit', stdout: '', exitCode: 0 },
    { command: 'tsc --noEmit -p tsconfig.other.json', stdout: '', exitCode: 0 },
    { command: 'npm run build', stdout: 'vite build completed', exitCode: 0 },
  ])('incomplete or unrelated proof cannot close the finding: $command', command => {
    const diag = new BuildDiagnostics({});
    diag.record(failure('SIMPLE_BUILD_VERIFY_ERROR'));
    diag.recordCommand(command);
    expect(diag.report().issues.find(issue => issue.code === 'SIMPLE_BUILD_VERIFY_ERROR')?.autoResolved).toBe(false);
  });

  it('a compiler pass does not clear a stylesheet-only or mixed verify failure', () => {
    for (const detail of ['CSS class mismatch: .calc-app', `${ERROR}\nCSS class mismatch: .calc-app`]) {
      const diag = new BuildDiagnostics({});
      diag.record({ ...failure('SIMPLE_BUILD_VERIFY_ERROR'), message: 'Fast-lane verify failed', detail });
      diag.recordCommand({ command: 'tsc --noEmit', stdout: '', exitCode: 0 });
      expect(diag.report().issues.find(issue => issue.code === 'SIMPLE_BUILD_VERIFY_ERROR')?.autoResolved).toBe(false);
    }
  });
});

describe('two missing classes introduced by a compiler repair are a regression, regardless of the review threshold', () => {
  const app = readFileSync('tests/fixtures/calculator9fba77d7.tsx.txt', 'utf8');
  const styled = app.replace('className="calc-app"', 'className="calc-page"').replace('className="calc-result"', 'className="calc-preview"');
  const sheet = ['calc-page', 'calc-preview', 'calc-header', 'calc-title', 'calc-subtitle', 'calc-shell',
    'calc-display', 'calc-expression', 'calc-error', 'calc-keys', 'calc-hint'].map(name => `.${name} { display: block; }`).join('\n');
  const before = { 'src/App.tsx': styled, 'src/index.css': sheet };

  it('rejects the report\'s two class renames without writing its wholesale screen replacement', () => {
    const proposed = [{ path: 'src/App.tsx', content: app }];
    // The ordinary review deliberately tolerates two; the repair must preserve the known baseline.
    expect(cssConsistencyError({ ...before, 'src/App.tsx': app })).toBeNull();
    const reason = repairStyleRegression(before, proposed);
    expect(reason).toContain('.calc-app');
    expect(reason).toContain('.calc-result');
    expect(before['src/App.tsx']).toBe(styled);
  });

  it('accepts the same renames when their real stylesheet changes in the same batch', () => {
    expect(repairStyleRegression(before, [
      { path: 'src/App.tsx', content: app },
      { path: 'src/index.css', content: `${sheet}\n.calc-app { display: grid; }\n.calc-result { font-size: 24px; }` },
    ])).toBeNull();
  });

  it('accepts a focused compiler guard repair and leaves existing missing classes alone', () => {
    expect(repairStyleRegression(before, [{ path: 'src/App.tsx', content: styled.replaceAll('if (outcome.ok)', 'if (outcome.ok === true)') }])).toBeNull();
    const existing = { ...before, 'src/App.tsx': app };
    expect(repairStyleRegression(existing, [{ path: 'src/App.tsx', content: app }])).toBeNull();
  });
});

describe('wallet stop facts do not pretend to be a debit or a clean app', () => {
  it('records the admitted amount and estimate, then the provisional amount that crossed the guard', () => {
    const admission = buildWalletBudgetDiagnostic(20, 12);
    expect(JSON.parse(admission.detail)).toMatchObject({ balanceAtAdmissionInr: 20, estimatedBuildCostInr: 12 });
    expect(JSON.parse(buildWalletStopDetail(20, 12, 21))).toMatchObject({
      balanceAtAdmissionInr: 20, estimatedBuildCostInr: 12, provisionalBuildCostInr: 21,
    });
    expect(buildWalletStopDetail(20, 12, 21)).toContain('does not debit the wallet');
  });

  it('unknown or invalid values stay unknown, never fabricated zero balances', () => {
    expect(JSON.parse(buildWalletBudgetDiagnostic(null, NaN).detail)).toMatchObject({
      balanceAtAdmissionInr: null, estimatedBuildCostInr: null,
    });
  });

  it.each(['wallet-empty', 'cost-cap', 'lock-reclaimed'] as const)('%s does not absolve unfinished source', cause => {
    expect(abortOutcomeFor(cause)?.message).toContain('does not establish whether the app compiles or runs');
  });
});

describe('the verification order keeps unfinished style and packaging evidence', () => {
  it('retains compiler errors when the same verification finds a stylesheet mismatch', () => {
    const message = combinedVerifyErrors(ERROR, 'CSS class mismatch: .calc-app');
    expect(message).toContain(ERROR);
    expect(message).toContain('CSS class mismatch');
    expect(combinedVerifyErrors('__TSC_CLEAN__', 'CSS class mismatch')).toBe('CSS class mismatch');
  });

  it('the real fast verifier reaches its free spacing snap before returning a compiler failure', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const start = route.indexOf('const fastVerifyOnce =');
    const body = route.slice(start, route.indexOf('const fastRepair =', start));
    expect(body.indexOf('spacingSnapPatches(project')).toBeGreaterThan(0);
    expect(body.indexOf('if (hasErrors) return')).toBeGreaterThan(body.indexOf('spacingSnapPatches(project'));
  });

  it('the file planner is told to include manifests the shell links or caches', () => {
    expect(manifestSystemPrompt('vite-react')).toContain('include the real manifest');
    expect(manifestSystemPrompt('vite-react')).toContain('not a signed Android store bundle');
  });
});
