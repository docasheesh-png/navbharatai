import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { redactReportSecrets, trimReportForStorage } from '../src/server/AgentV3/DiagnosticsStore';
import { redactFailedReport } from '../src/server/lib/failedBuildReports';
import { sourceCensusFiles } from './helpers/sourceCensus';

vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => null }));

const ROOT = join(__dirname, '..');
const SOURCE = 'export interface User { password: string; }\nexport function useAuth(): { login: (password: string) => Promise<void>; } { throw new Error(); }';
const EVIDENCE = `<<<FILE src/hooks/useAuth.ts>>>\n${SOURCE}\n// password=syntheticCredential\nconst incomplete = (`;

describe('a type annotation survives every retained-report redaction boundary', () => {
  it('collects, stores, exports and re-exports real pipeline fields without losing syntax or secrets', () => {
    let now = 1000;
    const diagnostics = new BuildDiagnostics({ now: () => ++now });
    diagnostics.recordCommand({ command: 'cat src/hooks/useAuth.ts', exitCode: 0, stdout: EVIDENCE });
    diagnostics.recordLlmCall({ ok: true, promptPreview: EVIDENCE, responsePreview: EVIDENCE });
    diagnostics.recordFile({ path: 'src/hooks/useAuth.ts', content: `${SOURCE}\nconst password: string = "syntheticCredential";` });
    diagnostics.finish(false, 'A synthetic compile failure');
    const collected = diagnostics.report();
    expect(collected.commands![0].stdout).toContain(SOURCE);
    expect(collected.commands![0].stdout).not.toContain('syntheticCredential');
    const stored = trimReportForStorage(collected);
    const exported = redactFailedReport(stored) as typeof stored;
    for (const report of [stored, exported, redactReportSecrets(exported), redactFailedReport(exported) as typeof stored]) {
      expect(report.commands![0].stdout).toContain(SOURCE);
      expect(report.llmCalls![0].promptPreview).toContain(SOURCE);
      expect(report.llmCalls![0].responsePreview).toContain(SOURCE);
      expect(report.generatedFiles![0].content).toContain(SOURCE);
      expect(JSON.stringify(report)).not.toContain('syntheticCredential');
      expect(report.ok).toBe(false);
    }
    expect(redactFailedReport(exported)).toEqual(exported);
  });

  it('never invents the missing type or punctuation in an already-corrupted historical field', () => {
    const prior = { llmCalls: [{ responsePreview: 'password: [REDACTED:secret] => Promise<void>;' }] };
    const output = redactFailedReport(prior);
    expect(JSON.stringify(output)).not.toContain('password: string)');
    expect(JSON.stringify(output)).toContain('[REDACTED:');
  });

  it('keeps recursive failed-report credential-key masking even beside clean source', () => {
    const output = redactFailedReport({ source: SOURCE, password: 'short', nested: { token: 'string' }, access: 'nbfr_' + 'a'.repeat(43) });
    expect(output).toMatchObject({ source: SOURCE, password: '[REDACTED:credential]', nested: { token: '[REDACTED:credential]' } });
    expect(JSON.stringify(output)).not.toContain('nbfr_');
  });
});

describe('one server evidence policy, with a compiler-free client boundary', () => {
  it('does not let a new server evidence caller silently use the plain-text-only redactor', () => {
    const genericCallers = sourceCensusFiles(join(ROOT, 'src/server'), (p) => /\.tsx?$/.test(p) && !/\.test\.[tj]sx?$/.test(p))
      .filter((p) => /(?:from\s*|import\s*\()['"][^'"]*\/SecretRedactor['"]/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(ROOT, p)).sort();
    expect(genericCallers).toEqual([
      'src/server/AgentV3/SourceSecretRedactor.ts',
      // Vault/config views and uploaded-content safety are not source-evidence exemptions.
      'src/server/AgentV3/secretFileView.ts',
      'src/server/lib/promptSafety.ts',
    ]);
    for (const file of [
      'src/server/AgentV3/BuildDiagnostics.ts', 'src/server/AgentV3/DiagnosticsStore.ts',
      'src/server/AgentV3/ToolDispatcher.ts', 'src/server/AgentV3/FleetMistakeLedger.ts',
      'src/server/AgentV3/changeEngine/changeSession.ts', 'src/server/lib/failedBuildReports.ts',
      'src/server/routes/agentv3.ts',
    ]) expect(readFileSync(join(ROOT, file), 'utf8'), file).toMatch(/from ['"][^'"]*\/SourceSecretRedactor['"]/);
  });

  it('bundles the real browser sanitizer without a compiler or server wrapper', async () => {
    const result = await build({
      absWorkingDir: ROOT, entryPoints: ['src/lib/observability/sanitize.ts'],
      bundle: true, platform: 'browser', write: false, metafile: true, logLevel: 'silent',
    });
    expect(Object.keys(result.metafile!.inputs).some((p) => /(?:typescript|ts-morph|SourceSecretRedactor)/.test(p))).toBe(false);
    expect(result.outputFiles[0].text.length).toBeLessThan(50_000);
  });
});
