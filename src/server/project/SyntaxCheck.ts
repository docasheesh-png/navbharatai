/**
 * Syntax / compile gate (catches malformed TS/JSX the model emitted).
 *
 * The verifier checks JSON, imports and architecture — but NOT whether the
 * generated .ts/.tsx actually parses. A model that wrote unbalanced JSX (e.g.
 * `<HashRouter><App/></React.StrictMode>` — missing `</HashRouter>`) passed every
 * gate, was reported "App is live", then crashed the preview with
 * "Unterminated JSX contents". This gate parses each source file with esbuild
 * (fast, synchronous-enough) and reports real syntax errors so the repair loop
 * can fix them and a broken build is honestly blocked instead of shown as live.
 */
import { transform } from 'esbuild';
import { VirtualFileSystem } from './ProjectModel';
import type { ProjectIssue } from './ProjectVerifier';

const SRC_RE = /\.(jsx|tsx|ts|js|mjs|cjs)$/i;

function loaderFor(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (/\.tsx$/i.test(path)) return 'tsx';
  if (/\.ts$/i.test(path)) return 'ts';
  if (/\.jsx$/i.test(path)) return 'jsx';
  return 'jsx'; // .js/.mjs may contain JSX in these generated apps — parse permissively
}

/** Parse every JS/TS source file; return an error issue for each that fails to compile. */
export async function checkSyntax(vfs: VirtualFileSystem): Promise<ProjectIssue[]> {
  const issues: ProjectIssue[] = [];
  for (const path of vfs.paths()) {
    if (!SRC_RE.test(path)) continue;
    const code = vfs.readText(path);
    if (code == null || code.trim() === '') continue;
    try {
      await transform(code, { loader: loaderFor(path), jsx: 'automatic', logLevel: 'silent' });
    } catch (e: any) {
      const first = e?.errors?.[0];
      const where = first?.location ? ` (line ${first.location.line})` : '';
      const msg = first?.text || e?.message || 'syntax error';
      issues.push({ severity: 'error', file: path, message: `Syntax error${where}: ${msg}` });
    }
  }
  return issues;
}
