// AgentV3 — Visual Editor: apply a text-content edit made in the RENDERED preview back into the
// REAL source file, precisely and safely, using a real AST (ts-morph), never blind string/line
// replacement. This is what makes the Visual Editor "100% real" rather than editing a disposable
// compiled copy the next build would silently overwrite (see PROGRESS.md 2026-07-01 for the full
// architecture discussion — a v5.0 project has no single "the HTML"; the rendered DOM is compiled
// from real .tsx/.jsx source files, so an edit must land in the exact source JSX node it came from).
//
// Scope (kept honest, v1): only edits the DIRECT text content of a JSX element that has EXACTLY ONE
// simple text child (e.g. `<h1>Welcome</h1>`). An element with mixed children (text + expressions,
// text + nested elements, multiple text runs) is REFUSED with a clear reason rather than guessing
// which part the user meant — a wrong guess silently corrupting a file is worse than an honest "can't
// do this one yet". Style/layout/attribute edits and multi-child text edits are a follow-up, not this
// slice.
//
// Dynamic import of ts-morph mirrors ASTAnalyzer.ts's pattern (kept optional, loads on first use).

let TsMorphProject: any;

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

export interface VisualEditRequest {
  /** File path exactly as it appears in the workspace VFS (e.g. "src/App.tsx"). */
  filePath: string;
  /** Current full source of that file. */
  source: string;
  /** 1-based line number of the JSX element's OPENING tag (matches React's `_debugSource.lineNumber`). */
  line: number;
  /** 1-based column number of the JSX element's opening tag (matches `_debugSource.columnNumber`). */
  column: number;
  /** The new text the user typed in place of the element's current text content. */
  newText: string;
}

export type VisualEditResult =
  | { ok: true; newSource: string }
  | { ok: false; error: string };

const isJsxFile = (f: string): boolean => /\.(tsx|jsx)$/.test(f);

/**
 * Apply a single text-content edit to the JSX element that starts at (line, column) in `source`.
 * Pure (no I/O) — the caller durably saves `newSource` and writes it back to the sandbox/VFS.
 */
export async function applyVisualTextEdit(req: VisualEditRequest): Promise<VisualEditResult> {
  const { filePath, source, line, column, newText } = req;
  if (!isJsxFile(filePath)) {
    return { ok: false, error: `${filePath} is not a JSX/TSX file — visual text edits only apply to JSX elements.` };
  }
  if (!Number.isFinite(line) || line < 1 || !Number.isFinite(column) || column < 0) {
    return { ok: false, error: 'Invalid source position.' };
  }
  const loaded = await loadTsMorph();
  if (!loaded) return { ok: false, error: 'AST tooling unavailable on the server.' };

  try {
    const project = new TsMorphProject({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 2 },
    });
    const sf = project.createSourceFile(filePath, source, { overwrite: true });

    // React's _debugSource is 1-based line, 1-based column (matches Babel's own convention) —
    // ts-morph/TypeScript's getPositionOfLineAndCharacter wants 0-based line, 0-based character.
    const compiler = sf.compilerNode;
    const lineCount = compiler.getLineStarts().length;
    if (line > lineCount) return { ok: false, error: 'That line no longer exists in the current file — the source may have changed since this preview was rendered. Reload the preview and try again.' };
    const pos = compiler.getPositionOfLineAndCharacter(line - 1, Math.max(0, column - 1));

    const target = findJsxElementStartingAt(sf, pos);
    if (!target) {
      return { ok: false, error: 'Could not find the exact JSX element at that position in the current source — it may have moved. Reload the preview and try again.' };
    }

    const children = getJsxChildren(target);
    const textChildren = children.filter((c: any) => c.getKindName() === 'JsxText');
    const nonTrivialTextChildren = textChildren.filter((c: any) => c.getText().trim().length > 0);
    const nonTextChildren = children.filter((c: any) => c.getKindName() !== 'JsxText');

    if (nonTextChildren.length > 0) {
      return { ok: false, error: 'This element has more than plain text inside it (nested elements or expressions) — visual text editing only supports a single simple text child for now.' };
    }
    if (nonTrivialTextChildren.length !== 1) {
      return {
        ok: false,
        error: nonTrivialTextChildren.length === 0
          ? 'This element has no editable text content.'
          : 'This element has multiple separate text runs — visual text editing only supports a single simple text child for now.',
      };
    }

    nonTrivialTextChildren[0].replaceWithText(escapeJsxText(newText));
    return { ok: true, newSource: sf.getFullText() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Find the innermost JsxElement/JsxSelfClosingElement whose OPENING tag starts exactly at `pos`. */
function findJsxElementStartingAt(sf: any, pos: number): any {
  let found: any = null;
  sf.forEachDescendant((node: any) => {
    const kind = node.getKindName();
    if (kind !== 'JsxElement' && kind !== 'JsxSelfClosingElement') return;
    const opening = kind === 'JsxElement' ? node.getOpeningElement() : node;
    if (opening.getStart() === pos) {
      // Prefer the innermost/most-specific match when elements share a start (shouldn't normally
      // happen for distinct opening tags, but stay deterministic if it does).
      if (!found || node.getFullWidth() < found.getFullWidth()) found = node;
    }
  });
  return found;
}

/** JsxElement's direct children (empty for a self-closing element — it has none to edit). */
function getJsxChildren(node: any): any[] {
  return typeof node.getJsxChildren === 'function' ? node.getJsxChildren() : [];
}

/**
 * Escape characters that are meaningful in JSX text (`{` starts an expression container, `<` starts a
 * tag) by wrapping each in a REAL JSX expression container holding a JS string literal — e.g. `{` →
 * `{'{'}`. This is a genuine JSX construct the parser round-trips exactly, unlike an HTML entity
 * (`&#123;`): JSX text is NOT parsed as HTML, but Babel's/esbuild's JSX-text tokenizer coincidentally
 * still decodes numeric/named entities back to their literal character during tokenization — meaning
 * an HTML-entity "escape" happens to survive THOSE specific toolchains today, but isn't a real JSX
 * escape and would leave literal `&#123;` in the file for any tool that reads JSX text as plain text
 * (a formatter, a different parser, a lint rule). An expression-container string literal has no such
 * toolchain-dependent behavior — it's unambiguously "insert this exact character" to any JS parser.
 */
function escapeJsxText(text: string): string {
  return text.replace(/[{<]/g, (c) => `{'${c}'}`);
}
