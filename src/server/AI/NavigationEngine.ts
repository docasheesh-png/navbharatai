/**
 * P-DEV.1 — Code navigation engine (LSP-style) over the workspace file set, via ts-morph.
 *
 * Provides SEMANTIC (scope-aware, not text-match) navigation that Monaco's isolated per-file worker
 * can't do: Go to Definition and Find All References across the whole workspace. Built on the same
 * ts-morph dependency already used by `ASTAnalyzer`/`CodemodeExecutor`, loaded dynamically so it
 * degrades gracefully when unavailable, and wrapped so a parse error never throws to the caller.
 *
 * (Semantic *rename* across files already exists as a text-codemod in `CodemodeExecutor.renameSymbol`;
 * this module adds the position-based definition/reference lookups that power F12 / Shift+F12.)
 */

export interface NavFile { path: string; content: string }

export interface NavLocation {
  file: string;
  /** 1-based line + column of the symbol occurrence. */
  line: number;
  column: number;
  /** The text of the matched identifier/node (for display in a references panel). */
  text: string;
}

export interface NavResult {
  ok: boolean;
  locations: NavLocation[];
  error?: string;
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

let TsMorphProject: any;
let NodeApi: any;
async function loadTsMorph(): Promise<boolean> {
  if (TsMorphProject) return true;
  try {
    const mod = await import('ts-morph');
    TsMorphProject = mod.Project;
    NodeApi = mod.Node;
    return true;
  } catch {
    return false;
  }
}

/** Convert a 1-based (line, column) — Monaco's coordinate system — to a 0-based char offset. */
export function lineColToOffset(content: string, line: number, column: number): number {
  const lines = content.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1; // +1 for the \n
  return offset + Math.max(0, column - 1);
}

function buildProject(files: NavFile[]): any {
  const project = new TsMorphProject({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 2 /* react */ },
  });
  for (const { path, content } of files) {
    if (CODE_FILE.test(path)) project.createSourceFile(path, content, { overwrite: true });
  }
  return project;
}

function toLocation(node: any): NavLocation | null {
  try {
    const sf = node.getSourceFile?.();
    const start = node.getStart?.();
    if (!sf || typeof start !== 'number') return null;
    const lc = sf.getLineAndColumnAtPos?.(start);
    return {
      file: sf.getFilePath?.() ?? '',
      line: lc?.line ?? 1,
      column: lc?.column ?? 1,
      text: (node.getText?.() ?? '').slice(0, 200),
    };
  } catch {
    return null;
  }
}

function identifierAt(project: any, file: string, offset: number): any | null {
  const sf = project.getSourceFile?.(file);
  if (!sf) return null;
  const node = sf.getDescendantAtPos?.(offset);
  if (!node) return null;
  if (NodeApi?.isIdentifier?.(node)) return node;
  // The cursor landed on trivia/punctuation — climb to the nearest enclosing identifier.
  let cur = node;
  while (cur && !NodeApi?.isIdentifier?.(cur)) cur = cur.getParent?.();
  return cur ?? null;
}

/** Go to Definition: the declaration site(s) of the symbol at (file, offset). */
export async function getDefinition(files: NavFile[], file: string, offset: number): Promise<NavResult> {
  if (!(await loadTsMorph())) return { ok: false, locations: [], error: 'ts-morph not available.' };
  try {
    const project = buildProject(files);
    const id = identifierAt(project, file, offset);
    if (!id) return { ok: true, locations: [] };
    const defs = id.getDefinitionNodes?.() ?? [];
    const locations = defs.map(toLocation).filter(Boolean) as NavLocation[];
    return { ok: true, locations };
  } catch (err) {
    return { ok: false, locations: [], error: String(err) };
  }
}

/** Find All References: every use of the symbol at (file, offset) across the workspace. */
export async function findReferences(files: NavFile[], file: string, offset: number): Promise<NavResult> {
  if (!(await loadTsMorph())) return { ok: false, locations: [], error: 'ts-morph not available.' };
  try {
    const project = buildProject(files);
    const id = identifierAt(project, file, offset);
    if (!id) return { ok: true, locations: [] };
    const refs = id.findReferencesAsNodes?.() ?? [];
    const locations = refs.map(toLocation).filter(Boolean) as NavLocation[];
    return { ok: true, locations };
  } catch (err) {
    return { ok: false, locations: [], error: String(err) };
  }
}
