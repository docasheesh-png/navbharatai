// AgentV3 — A PORT IS HANDED ITS SOURCE PROJECT ONCE (autopsy 51ef24ad, 2026-10-04).
//
// "Build app in this format" over a 54-file Android project. The frontend specialist spent its 40 steps
// reading Kotlin: 78 reads covered 34 files, `HomeScreen.kt` five times, `AssamExamDataProvider.kt` four.
// It stopped at its step cap with half the screens unwritten. Nothing handed it the project it was
// porting: the task handoff (`taskHandoff.ts`) recognised only web extensions, so a task naming
// `…/HomeScreen.kt` attached nothing, and no block anywhere said what the original app contained.
//
// This module reads the original project ONCE, deterministically (no model call), and produces a
// bounded digest: every screen, model, view-model and data file by path, with its declarations, and the
// data-model files verbatim. The architect and every specialist read it before their first step.
//
// Precision: it fires only when the turn is a build ORDER over an existing project (`buildOrderReadAsEdit`)
// whose own files hold at least PORT_MIN_SOURCES non-web sources. An ordinary edit of a web app never
// sees it. PURE except `collectPortSources`, which reads only through the port it is given.

/** Source languages a web build cannot run but may be asked to port. */
const FOREIGN_SOURCE = /\.(kt|java|swift|dart)$/i;
/** Never part of the app being ported: build output, tests, generated code. */
const NOT_APP_SOURCE = /(^|\/)(build|\.gradle|\.idea|Pods|DerivedData|\.dart_tool|node_modules)\/|(^|\/)(test|androidTest|tests?|UITests?)\/|\.g\.dart$|R\.java$|BuildConfig\.java$/i;

export const PORT_MIN_SOURCES = 3;
export const PORT_MAX_FILES = 40;
export const PORT_MAX_FILE_CHARS = 30_000;
export const PORT_DIGEST_MAX_CHARS = 16_000;
/** A data-model file this short is inlined whole: its fields ARE the port's data contract. */
const MODEL_INLINE_MAX_CHARS = 2_500;

/** The non-web source files of the project, app code only, in a stable order. PURE. */
export function foreignSourcePaths(paths: readonly string[] | null | undefined): string[] {
  return [...new Set((paths ?? []).map((p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '')))]
    .filter((p) => FOREIGN_SOURCE.test(p) && !NOT_APP_SOURCE.test(p))
    .sort((a, b) => portRank(a) - portRank(b) || a.localeCompare(b));
}

/** Screens and models first: they decide the port. Then view-models, data, everything else. */
function portRank(path: string): number {
  const base = path.split('/').pop() ?? path;
  if (/(Screen|Page|View|Activity|Fragment)\.\w+$/.test(base)) return 0;
  if (/(^|\/)models?\//i.test(path) || /Model(s)?\.\w+$/.test(base)) return 1;
  if (/ViewModel\.\w+$/.test(base)) return 2;
  if (/(Repository|Provider|Data|Dao|Database|Service)\w*\.\w+$/.test(base)) return 3;
  return 4;
}

/** Should this turn get a port digest? PURE. */
export function isPortTurn(buildOrderOverProject: boolean, paths: readonly string[]): boolean {
  return buildOrderOverProject && foreignSourcePaths(paths).length >= PORT_MIN_SOURCES;
}

const DECLARATION = new RegExp([
  // Kotlin / Java / Swift / Dart type declarations
  /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|protected|open|abstract|final|sealed|data|enum|inner|static|value|annotation)\s+)*(?:class|interface|object|struct|enum|protocol|extension|mixin|typealias)\s+[A-Za-z_]\w*/.source,
  // functions: Kotlin `fun`, Swift `func`, Java/Dart methods with a return type are too noisy — named funs only
  /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|protected|override|open|suspend|static|inline)\s+)*(?:fun|func)\s+(?:<[^>]*>\s*)?[A-Za-z_][\w.]*\s*\(/.source,
].join('|'));

/** A file's declarations, one per line, without bodies. PURE. */
export function declarationsOf(content: string, max = 30): string[] {
  const out: string[] = [];
  let composable = false;
  for (const raw of String(content ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*@Composable\b/.test(line) && !/\bfun\b/.test(line)) { composable = true; continue; }
    if (!DECLARATION.test(line)) { if (line.trim() !== '' && !line.trim().startsWith('@')) composable = false; continue; }
    const head = line.trim().replace(/\s*\{\s*$/, '').replace(/\s*=\s*$/, '');
    out.push(`${composable ? '@Composable ' : ''}${head.length > 160 ? `${head.slice(0, 160)}…` : head}`);
    composable = false;
    if (out.length >= max) { out.push('…'); break; }
  }
  return out;
}

/** A data-model file: only type declarations, no behaviour. Its whole text is the contract. PURE. */
export function isModelFile(content: string): boolean {
  const text = String(content ?? '');
  if (text.length > MODEL_INLINE_MAX_CHARS) return false;
  if (/\b(fun|func)\s+[A-Za-z_]/.test(text)) return false;
  return /\b(data class|enum class|sealed class|struct|enum)\s+[A-Za-z_]/.test(text);
}

export interface PortSource { path: string; content: string }

/** Read the project's foreign sources through `read`, within the bounds. A failed read is skipped. */
export async function collectPortSources(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<PortSource[]> {
  const out: PortSource[] = [];
  for (const path of foreignSourcePaths(paths).slice(0, PORT_MAX_FILES)) {
    let content: string | null = null;
    try { content = await read(path); } catch { content = null; }
    if (typeof content !== 'string' || content.length === 0 || content.length > PORT_MAX_FILE_CHARS) continue;
    out.push({ path, content });
  }
  return out;
}

/**
 * The digest handed to the architect and every specialist. '' when there is nothing to say. PURE.
 *
 * Bounded by PORT_DIGEST_MAX_CHARS: files are added in rank order (screens, models, view-models, data)
 * and a file that would overflow is listed by name only, so nothing is silently missing — the reader
 * knows a file exists even when its declarations did not fit.
 */
export function portDigest(sources: readonly PortSource[], totalForeign = sources.length): string {
  if (!sources || sources.length === 0) return '';
  const head = [
    `THE PROJECT YOU ARE PORTING — read once by NavBharatAI from the ${totalForeign} original source file(s) in this workspace.`,
    'It lists every screen, model and data file with its declarations; data models are copied whole. Use it to plan',
    'the web screens and types. Read an original file ONLY when you write its web version and need its exact text',
    '(labels, data values) — and read it once. Do not re-read a file this digest already gives you whole.',
  ].join('\n');
  const blocks: string[] = [];
  const nameOnly: string[] = [];
  let used = head.length;
  for (const s of sources) {
    const body = isModelFile(s.content)
      ? `### ${s.path} (whole file)\n\`\`\`\n${s.content.trim()}\n\`\`\``
      : (() => {
        const decls = declarationsOf(s.content);
        return decls.length > 0 ? `### ${s.path}\n${decls.map((d) => `- ${d}`).join('\n')}` : `### ${s.path}\n- (no declarations found)`;
      })();
    if (used + body.length + 2 > PORT_DIGEST_MAX_CHARS) { nameOnly.push(s.path); continue; }
    blocks.push(body);
    used += body.length + 2;
  }
  const tail = nameOnly.length > 0 ? `\n\nAlso in the project (did not fit here — read when you port it): ${nameOnly.join(', ')}` : '';
  const unread = totalForeign > sources.length ? `\n\n${totalForeign - sources.length} more original file(s) were not read for this digest (too many or too large).` : '';
  return `${head}\n\n${blocks.join('\n\n')}${tail}${unread}`;
}
