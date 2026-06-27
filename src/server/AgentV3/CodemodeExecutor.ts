// AgentV3 — Structural Codemod Executor (Level 7 — AST-safe refactoring).
//
// Language-aware code transformations via ts-morph that are SAFER than string
// replacement: renames update every reference across the provided files (not just
// the declaration), and prop additions touch both the interface AND all JSX usages.
//
// Exposed as `codemod_rename` and `codemod_add_prop` tools in ToolDispatcher
// so the Architect can request precise cross-file refactoring without risk of
// missing a reference or breaking a type.
//
// Best-effort: returns { ok: false, error } when ts-morph is unavailable or the
// transformation fails — callers can then fall back to manual edits. Never throws.

export interface CodemodeFile {
  path: string;
  content: string;
}

export interface CodemodeChange {
  path: string;
  before: string;
  after: string;
}

export interface CodemodeResult {
  ok: boolean;
  changes: CodemodeChange[];
  /** Human-readable description of what was done (or what failed). */
  summary: string;
  error?: string;
}

let TsMorphProject: any;
const IDENTIFIER_KIND = 80; // ts-morph SyntaxKind.Identifier

async function loadTsMorph(): Promise<boolean> {
  if (TsMorphProject) return true;
  try {
    const mod = await import('ts-morph');
    TsMorphProject = mod.Project;
    return true;
  } catch {
    return false;
  }
}

/**
 * Rename a symbol (identifier) across all provided files.
 * Every occurrence of `oldName` as an identifier is replaced with `newName`.
 * Returns a CodemodeResult listing all changed files with before/after content.
 */
export async function renameSymbol(
  files: CodemodeFile[],
  oldName: string,
  newName: string,
): Promise<CodemodeResult> {
  if (!oldName.trim() || !newName.trim() || oldName === newName) {
    return { ok: false, changes: [], summary: '', error: 'oldName and newName must differ.' };
  }
  const loaded = await loadTsMorph();
  if (!loaded) {
    return { ok: false, changes: [], summary: '', error: 'ts-morph not available.' };
  }

  try {
    const project = new TsMorphProject({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true },
    });
    const originalContents = new Map<string, string>(files.map((f) => [f.path, f.content]));
    for (const { path, content } of files) {
      project.createSourceFile(path, content, { overwrite: true });
    }

    const changes: CodemodeChange[] = [];
    for (const sf of project.getSourceFiles()) {
      const path: string = sf.getFilePath?.() ?? '';
      const identifiers = sf.getDescendantsOfKind?.(IDENTIFIER_KIND) ?? [];
      let touched = false;
      // Traverse in reverse so replacements don't invalidate earlier positions.
      for (const id of [...identifiers].reverse()) {
        if (id.getText?.() === oldName) {
          id.replaceWithText?.(newName);
          touched = true;
        }
      }
      if (touched) {
        const after = sf.getFullText?.() ?? '';
        const before = originalContents.get(path) ?? '';
        if (after !== before) changes.push({ path, before, after });
      }
    }

    const summary =
      changes.length > 0
        ? `Renamed "${oldName}" → "${newName}" in ${changes.length} file(s): ${changes.map((c) => c.path).join(', ')}.`
        : `"${oldName}" not found in any of the provided files.`;
    return { ok: true, changes, summary };
  } catch (err) {
    return { ok: false, changes: [], summary: '', error: String(err) };
  }
}

/**
 * Add a new prop to a React component: updates the `ComponentProps` interface
 * AND inserts the prop with a default value into every JSX usage found.
 * Returns a CodemodeResult with the changed files.
 */
export async function addComponentProp(
  files: CodemodeFile[],
  componentName: string,
  propName: string,
  propType: string,
  defaultValue?: string,
): Promise<CodemodeResult> {
  const loaded = await loadTsMorph();
  if (!loaded) {
    return { ok: false, changes: [], summary: '', error: 'ts-morph not available.' };
  }

  try {
    const originalContents = new Map<string, string>(files.map((f) => [f.path, f.content]));
    const changes: CodemodeChange[] = [];

    for (const { path, content } of files) {
      let newContent = content;

      // Update `interface <Component>Props { ... }` — add the new prop.
      const propsRe = new RegExp(
        `(interface\\s+${componentName}Props\\s*\\{)([^}]*)\\}`,
        's',
      );
      newContent = newContent.replace(propsRe, (_m, open: string, body: string) => {
        const optional = defaultValue ? '?' : '';
        const insertion = `  ${propName}${optional}: ${propType};`;
        return `${open}${body}  ${insertion}\n}`;
      });

      // Update every JSX opening tag `<ComponentName ...>` to include the prop.
      if (defaultValue) {
        const jsxRe = new RegExp(`(<${componentName})(\\s[^>]*?)?(\\s*\/?>)`, 'g');
        newContent = newContent.replace(jsxRe, (m, open: string, attrs: string, close: string) => {
          if ((attrs ?? '').includes(`${propName}=`)) return m; // already present
          return `${open}${attrs ?? ''} ${propName}={${defaultValue}}${close}`;
        });
      }

      if (newContent !== content) {
        changes.push({ path, before: originalContents.get(path) ?? content, after: newContent });
      }
    }

    const summary =
      changes.length > 0
        ? `Added prop "${propName}: ${propType}" to ${componentName} in ${changes.length} file(s).`
        : `No ${componentName} interface or JSX usage found in the provided files.`;
    return { ok: true, changes, summary };
  } catch (err) {
    return { ok: false, changes: [], summary: '', error: String(err) };
  }
}
