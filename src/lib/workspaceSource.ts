// Shared "what is the user's REAL app right now?" resolver for the Developer Tools (admin autopsy
// 2026-07-21). Root cause the whole tool group shared: they read the retired v2.0 `generatedCode`
// string, which sits at the "Waiting for magic…" placeholder in the v5.0 sandbox architecture — so
// Test Runner / Performance / Minifier all ran against the placeholder, not the built app, and
// looked like they "did nothing". This pure module is the single honest source-of-truth resolver:
// it recognizes the placeholder as "no app yet" and prefers the bundled preview, then the real file
// set. Pure → unit-tested.

export type AppSourceKind = 'preview' | 'files' | 'unbundled' | 'none';

export interface ResolvedAppSource {
  /** The best runnable/analysable HTML for the current app, or '' when none is available yet. */
  html: string;
  /** Where `html` came from — drives the tool's honest empty/guidance state. */
  kind: AppSourceKind;
}

/**
 * True when an HTML string is empty or the built-in "Waiting for magic…" placeholder (there are two
 * near-identical copies of it in the app — WorkspaceContext + App.tsx boot — both carry this text).
 * The placeholder is a truthy string, which is exactly why the tools' `!generatedCode` empty-state
 * guards never fired. Pure.
 */
export function isPlaceholderHtml(html: string | undefined | null): boolean {
  const s = String(html ?? '').trim();
  if (!s) return true;
  return /Waiting for magic/i.test(s) && /Ask Navbharat/i.test(s);
}

/** True when the workspace file set holds at least one file with real (non-empty) content. Pure. */
export function filesHaveRealContent(files: Record<string, string> | undefined | null): boolean {
  if (!files) return false;
  return Object.entries(files).some(([name, content]) =>
    !name.startsWith('__pending__') && typeof content === 'string' && content.trim().length > 0);
}

/**
 * Resolve the current app's best analysable source from the two legacy channels the tools receive:
 * the (on-demand-bundled) `generatedCode` and the (v5-synced) `files` map.
 *  • a real bundled preview           → kind 'preview'  (analyse it)
 *  • else an HTML app's index.html    → kind 'files'    (analyse it)
 *  • else real files but no HTML yet  → kind 'unbundled'(tell the user to open Preview once to bundle)
 *  • else nothing built               → kind 'none'     (tell the user to build first)
 * Pure.
 */
export function resolveAppSource(
  generatedCode: string | undefined | null,
  files: Record<string, string> | undefined | null,
): ResolvedAppSource {
  if (!isPlaceholderHtml(generatedCode)) {
    return { html: String(generatedCode), kind: 'preview' };
  }
  const indexHtml = files?.['index.html'];
  if (typeof indexHtml === 'string' && indexHtml.trim().length > 0) {
    return { html: indexHtml, kind: 'files' };
  }
  if (filesHaveRealContent(files)) {
    return { html: '', kind: 'unbundled' };
  }
  return { html: '', kind: 'none' };
}

/** Whether the resolved source gives the tool something real to work on. Pure. */
export function hasAnalysableApp(source: ResolvedAppSource): boolean {
  return source.kind === 'preview' || source.kind === 'files';
}

/** The honest one-line guidance for a source that isn't directly analysable. Pure. */
export function appSourceGuidance(kind: AppSourceKind): string {
  if (kind === 'unbundled') return 'Open the Preview once to bundle your app, then run this tool.';
  if (kind === 'none') return 'Build an app in NavBharatAI Pro v5.0 first, then run this tool.';
  return '';
}
