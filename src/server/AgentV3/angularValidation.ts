import { stripAnsi } from './testRunner';

/** Angular templates/configuration/assets are checked by the Angular builder, not plain tsc. */
export function angularValidationPlan(framework?: string): { command: string; timeoutMs: number } | undefined {
  if (framework?.toLowerCase() !== 'angular') return undefined;
  // Honour the workspace's own default configuration. Inventing `development` repeats cdffbb71's
  // first launch error. The installed CLI avoids npx downloading an unrelated compiler version.
  return { command: './node_modules/.bin/ng build --progress=false', timeoutMs: 90_000 };
}

/** Only the literal native build invocation can supply this receipt; mentions/help/pipes cannot. */
export function isAngularValidationCommand(command: string): boolean {
  return /^(?:\.\/)?node_modules\/\.bin\/ng[ \t]+build(?:[ \t]+--progress(?:=false|[ \t]+false))?$/.test(command.trim());
}

export interface AngularValidationResult {
  status: 'passed' | 'failed' | 'not-run' | 'unknown';
  output: string;
  summary: string;
}

/** Read only the native command's completed output; silence and a wrapper's exit never prove a build. */
export function parseAngularValidation(
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string,
): AngularValidationResult {
  const output = stripAnsi(`${stdout || ''}\n${stderr || ''}`).trim();
  const result = (status: AngularValidationResult['status'], summary: string): AngularValidationResult => ({ status, output, summary });
  const sourceError = /\berror\s+(?:NG|TS)\d+\b|\[ERROR\]|Application bundle generation failed|Schema validation failed|Configuration ['"][^'"\n]+['"] is not set|Error:\s*(?:Could not resolve|The .* path does not exist)/i.test(output);
  // These are the report's real NG5002/NG9 and workspace-schema failures. A shell wrapper reporting
  // zero cannot erase diagnostics from the framework compiler.
  if (sourceError) return result('failed', 'Angular build failed. Fix the native compiler/configuration diagnostics below before claiming the app compiles.');
  if (exitCode === 127 || /(?:node_modules\/\.bin\/ng|\bng): (?:not found|No such file or directory)|Cannot find module ['"][^'"\n]*(?:@angular[\/]cli|angular[\/]cli|bin[\/]ng)|Cannot find package ['"]@angular\/cli/i.test(output)) {
    return result('not-run', 'Angular validation did not run: the installed Angular CLI is unavailable. Templates and the app build remain unverified.');
  }
  if (/^\s*ng build(?:\s+\[project\])?\s*$|^\s*Usage:.*\bng\b|^\s*Options:\s*$/im.test(output)) {
    return result('not-run', 'The Angular CLI printed usage instead of completing a build; templates and the app build remain unverified.');
  }
  if (typeof exitCode !== 'number' || !Number.isInteger(exitCode) || exitCode < 0) {
    return result('unknown', 'Angular validation has no completed process exit; templates and the app build remain unverified.');
  }
  // Angular's application builder (17+) and the older browser builder use different completion lines.
  const completed = /Application bundle generation complete\.|(?:^|\n)\s*Build at: [^\n]+ - Hash: [^\n]+ - Time: \d+ms\b/.test(output);
  if (exitCode === 0 && completed) {
    return result('passed', 'Angular build completed successfully, including its configured template checks. The live preview and user journeys still need verification.');
  }
  if (exitCode !== 0 && /(?:^|\n)(?:Error:|An unhandled exception occurred:)/.test(output)) {
    return result('failed', 'Angular build failed. Review the native build diagnostic below; no successful template or app build is established.');
  }
  return result('unknown', 'Angular validation did not report a completed build; templates and the app build remain unverified.');
}

/** The existing write-time tsc is useful, but its success must not be widened into Angular proof. */
export function angularTypeScriptOnlyWriteNote(written: readonly string[]): string {
  const files = written.length === 1 ? written[0] : `${written.length} files`;
  return `\n\n✓ TypeScript check after this write (${files}): tsc reported no TypeScript errors. `
    + 'Angular templates, build configuration and assets have not been validated by this check. '
    + 'Run the typecheck tool to execute the native Angular build before claiming the app compiles.';
}
