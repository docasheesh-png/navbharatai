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

/** Escape regex metacharacters so a component name like `List<T>`, `Foo.Bar` or `Btn$` can't produce
 *  a RegExp SyntaxError or a wrong match when interpolated into a pattern. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert `insertion` immediately before the MATCHING close brace of `interface <Component>Props { … }`,
 * located by brace-counting. The old `[^}]*` regex stopped at the FIRST `}`, so any nested object/
 * generic type in the interface body (e.g. `meta: { id: string }`) ended the capture early and produced
 * invalid TypeScript. Returns the content unchanged if the interface isn't found or braces are
 * unbalanced. Pure.
 */
export function insertPropBeforeInterfaceClose(content: string, componentName: string, insertion: string): string {
  const header = new RegExp(`interface\\s+${escapeRegExp(componentName)}Props\\s*\\{`);
  const m = header.exec(content);
  if (!m || m.index === undefined) return content;
  let depth = 1;
  let i = m.index + m[0].length;
  for (; i < content.length && depth > 0; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth !== 0) return content; // unbalanced — never write a corrupt file
  const closeIdx = i - 1; // index of the matching `}`
  return content.slice(0, closeIdx) + insertion + content.slice(closeIdx);
}

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
 * True when this identifier is a PROPERTY NAME, not a reference to a value binding — the `.name` of a
 * property access, the key of an object literal, or an interface/class member name. Renaming those
 * corrupts unrelated same-named properties. Compares by source position so it is robust to ts-morph
 * wrapper identity. Never throws.
 */
function isNonReferenceIdentifier(id: any): boolean {
  try {
    const parent = id.getParent?.();
    if (!parent) return false;
    const kind: string = parent.getKindName?.() ?? '';
    const NAME_BEARING = new Set([
      'PropertyAccessExpression', // obj.NAME
      'PropertyAssignment', // { NAME: value }
      'PropertySignature', // interface { NAME: T }
      'PropertyDeclaration', // class { NAME = … }
      'MethodSignature',
      'MethodDeclaration',
      'EnumMember',
    ]);
    if (!NAME_BEARING.has(kind)) return false;
    const nameNode = parent.getNameNode?.();
    if (!nameNode) return false;
    return nameNode.getStart?.() === id.getStart?.() && nameNode.getEnd?.() === id.getEnd?.();
  } catch {
    return false; // on any API mismatch, don't skip — preserve prior behaviour rather than crash
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
        if (id.getText?.() !== oldName) continue;
        // Skip positions that are NOT a reference to the renamed value binding — the `.name` side of
        // `obj.oldName`, an object-literal key `{ oldName: … }`, and interface/class member names.
        // Renaming those mangled unrelated same-named properties (the reported corruption); they are a
        // different symbol from the local binding, so they must be left alone.
        if (isNonReferenceIdentifier(id)) continue;
        id.replaceWithText?.(newName);
        touched = true;
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

      // Update `interface <Component>Props { ... }` — add the new prop before the MATCHING close brace
      // (brace-counted, so a nested object/generic type in the body doesn't corrupt the interface).
      const optional = defaultValue ? '?' : '';
      const insertion = `  ${propName}${optional}: ${propType};\n`;
      newContent = insertPropBeforeInterfaceClose(newContent, componentName, insertion);

      // Update every JSX opening tag `<ComponentName ...>` to include the prop.
      if (defaultValue) {
        const jsxRe = new RegExp(`(<${escapeRegExp(componentName)})(\\s[^>]*?)?(\\s*\/?>)`, 'g');
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
