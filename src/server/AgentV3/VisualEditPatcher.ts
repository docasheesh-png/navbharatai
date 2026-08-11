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

export interface VisualStyleEditRequest {
  /** File path exactly as it appears in the workspace VFS (e.g. "src/App.tsx"). */
  filePath: string;
  /** Current full source of that file. */
  source: string;
  /** 1-based line of the JSX element's opening tag (matches data-nbai-src / _debugSource). */
  line: number;
  /** 1-based column of the JSX element's opening tag. */
  column: number;
  /**
   * camelCase CSS property → value to set on the element's inline `style`, e.g.
   * `{ fontSize: '18px', color: '#ff0000', fontWeight: 'bold', width: '200px' }`. An EMPTY-string value
   * REMOVES that property (a reset). This one primitive powers the toolbar (font/color/bold/align/
   * padding), resize (width/height) and safe reposition (margin/transform) — all are inline-style edits.
   */
  styleUpdates: Record<string, string>;
}

// A camelCase CSS property name (fontSize, color, marginLeft, …). No hyphens — React inline styles are
// camelCase — and nothing that could break out of an identifier position in source.
const SAFE_STYLE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
// A conservative CSS-value charset: letters, digits, spaces, and the punctuation real values use
// (# % . , ( ) - + / and space). Deliberately EXCLUDES quotes, semicolons, braces, angle brackets and
// backslash, so the value can be embedded in a single-quoted string literal with zero injection risk.
const SAFE_STYLE_VALUE = /^[A-Za-z0-9 #%.,()\-+/]*$/;

/**
 * Merge inline-style changes onto the JSX element at (line, column), via a real AST (ts-morph) — never a
 * string hack. Adds `style={{ … }}` when absent; merges/updates keys when present; refuses honestly when
 * the element's `style` is dynamic (`style={x}` / a spread) rather than a plain object literal, so a
 * wrong guess can never corrupt a file. Pure — the caller durably saves `newSource`.
 */
export async function applyVisualStyleEdit(req: VisualStyleEditRequest): Promise<VisualEditResult> {
  const { filePath, source, line, column, styleUpdates } = req;
  if (!isJsxFile(filePath)) {
    return { ok: false, error: `${filePath} is not a JSX/TSX file — visual style edits only apply to JSX elements.` };
  }
  if (!Number.isFinite(line) || line < 1 || !Number.isFinite(column) || column < 0) {
    return { ok: false, error: 'Invalid source position.' };
  }
  if (!styleUpdates || typeof styleUpdates !== 'object' || Array.isArray(styleUpdates) || Object.keys(styleUpdates).length === 0) {
    return { ok: false, error: 'No style changes provided.' };
  }
  for (const [k, v] of Object.entries(styleUpdates)) {
    if (!SAFE_STYLE_KEY.test(k)) return { ok: false, error: `Unsafe style property name: ${k}` };
    if (typeof v !== 'string' || !SAFE_STYLE_VALUE.test(v) || v.length > 200) return { ok: false, error: `Unsafe style value for ${k}.` };
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
    const compiler = sf.compilerNode;
    const lineCount = compiler.getLineStarts().length;
    if (line > lineCount) return { ok: false, error: 'That line no longer exists in the current file — reload the preview and try again.' };
    const pos = compiler.getPositionOfLineAndCharacter(line - 1, Math.max(0, column - 1));

    const target = findJsxElementStartingAt(sf, pos);
    if (!target) {
      return { ok: false, error: 'Could not find the exact JSX element at that position — it may have moved. Reload the preview and try again.' };
    }
    const opening = target.getKindName() === 'JsxElement' ? target.getOpeningElement() : target;

    const styleAttr = typeof opening.getAttribute === 'function' ? opening.getAttribute('style') : undefined;
    if (styleAttr && styleAttr.getKindName() !== 'JsxAttribute') {
      return { ok: false, error: 'This element\'s style comes from a spread — cannot safely edit it visually yet.' };
    }

    // No style attribute yet → add one from the (non-empty) updates.
    if (!styleAttr) {
      const parts = Object.entries(styleUpdates).filter(([, v]) => v !== '').map(([k, v]) => `${k}: '${v}'`);
      if (parts.length === 0) return { ok: true, newSource: sf.getFullText() }; // only resets on a styleless element — no-op
      opening.addAttribute({ name: 'style', initializer: `{{ ${parts.join(', ')} }}` });
      return { ok: true, newSource: sf.getFullText() };
    }

    // Existing style → it MUST be `style={{ … }}` (a JsxExpression wrapping a plain object literal).
    const init = styleAttr.getInitializer();
    if (!init || init.getKindName() !== 'JsxExpression') {
      return { ok: false, error: 'This element\'s style is not a simple object — cannot safely merge it visually yet.' };
    }
    const objLit = init.getExpression();
    if (!objLit || objLit.getKindName() !== 'ObjectLiteralExpression') {
      return { ok: false, error: 'This element\'s style is dynamic — cannot safely merge it visually yet.' };
    }
    for (const [k, v] of Object.entries(styleUpdates)) {
      const existing = typeof objLit.getProperty === 'function' ? objLit.getProperty(k) : undefined;
      if (v === '') { if (existing) existing.remove(); continue; }
      if (existing && existing.getKindName() === 'PropertyAssignment') {
        existing.setInitializer(`'${v}'`);
      } else {
        if (existing) existing.remove(); // shorthand/other → replace cleanly
        objLit.addPropertyAssignment({ name: k, initializer: `'${v}'` });
      }
    }
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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// MULTI-ELEMENT SELECT (ROADMAP §2) — several elements restyled in ONE pass.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** One element's worth of style change, inside a batch. */
export interface VisualStyleEditItem {
  line: number;
  column: number;
  styleUpdates: Record<string, string>;
}

export interface VisualBatchEditResult {
  /** True when at least one edit applied — the caller must then save `newSource`. */
  ok: boolean;
  newSource?: string;
  applied: number;
  /** Edits that could not be applied, each with the honest reason. Never silently dropped. */
  failures: Array<{ line: number; column: number; error: string }>;
  error?: string;
}

/**
 * Apply several style edits to ONE file in a single read-modify-write.
 *
 * 🔒 WHY THIS EXISTS AT ALL, RATHER THAN THE CLIENT CALLING THE SINGLE-EDIT ROUTE N TIMES. That was the
 * obvious implementation of multi-select and it is silently destructive. The single-edit route reads the
 * file, patches it, and saves it; two of those in flight for the same file is a textbook LOST UPDATE —
 * whichever saves last wins and the other user-visible change vanishes, with both requests returning 200.
 * Selecting two elements in one component is the NORMAL case for this feature, not an edge case.
 *
 * 🔒 AND WHY BOTTOM-UP. Adding `style={{ … }}` to an element rewrites that region of the file, which can
 * move every position after it. Applying edits in DESCENDING source order means each remaining edit's
 * (line, column) still points at the same element when its turn comes: an edit low in the file cannot
 * disturb one above it. Top-down would corrupt or silently mis-target every edit after the first.
 *
 * Partial success is reported honestly rather than hidden: an element whose style is dynamic still
 * refuses (as it does for a single edit), the others still apply, and the caller learns exactly which
 * ones did not — a batch that quietly dropped an element would be the "looks done" state rule 2 forbids.
 */
export async function applyVisualStyleEdits(req: {
  filePath: string;
  source: string;
  edits: VisualStyleEditItem[];
}): Promise<VisualBatchEditResult> {
  const { filePath, source, edits } = req;
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, applied: 0, failures: [], error: 'No edits provided.' };
  }

  // De-duplicate by position: the same element selected twice must be patched once, not twice.
  const seen = new Set<string>();
  const unique = edits.filter((e) => {
    const key = `${e.line}:${e.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // DESCENDING source order — see the bottom-up note above. This ordering is the correctness property.
  const ordered = [...unique].sort((a, b) => (b.line - a.line) || (b.column - a.column));

  let current = source;
  let applied = 0;
  const failures: VisualBatchEditResult['failures'] = [];

  for (const edit of ordered) {
    const result = await applyVisualStyleEdit({
      filePath,
      source: current,
      line: edit.line,
      column: edit.column,
      styleUpdates: edit.styleUpdates,
    });
    if (result.ok) {
      current = result.newSource;
      applied += 1;
    } else {
      failures.push({ line: edit.line, column: edit.column, error: result.error || 'Could not apply this change.' });
    }
  }

  if (applied === 0) {
    return { ok: false, applied: 0, failures, error: failures[0]?.error || 'None of the changes could be applied.' };
  }
  return { ok: true, newSource: current, applied, failures };
}
