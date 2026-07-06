// AgentV3 — JSX undefined-component analyzer (build-robustness evaluator).
//
// Catches the classic "ReferenceError: Foo is not defined" white-screen: a JSX element `<Foo />` (or
// `<Foo.Bar />` / `<lib.Widget />`) whose component identifier is never imported or declared anywhere
// in the file. This crashes the app the moment that element renders — a hard failure the existing
// evaluator suite (dependency/import-existence/hooks) does NOT catch.
//
// It is conservative to keep false positives near zero:
//   • Only component-cased tags (Uppercase) or member-expression tags are checked — lowercase host
//     elements (`div`, `span`) are never flagged.
//   • A tag is OK if its name is bound ANYWHERE in the file (import, const/let/var, function, class,
//     parameter, or destructured binding) — a file-wide bound-name set, so an in-scope definition is
//     never mis-flagged.
//   • Known JSX globals (React, Fragment) are always allowed.

export interface UndefinedComponent {
  file: string;
  line: number;
  component: string;
  detail: string;
}

export interface JsxComponentReport {
  undefinedComponents: UndefinedComponent[];
  filesScanned: number;
  ok: boolean;
}

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

const JSX_FILE = /\.(t|j)sx$/;
const GLOBALS = new Set(['React', 'Fragment']);

/** Collect every identifier name bound anywhere in the source file (over-collect → safe). */
function collectBoundNames(sf: any, mod: any): Set<string> {
  const names = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v) names.add(v); };
  const K = mod.SyntaxKind;

  try {
    for (const imp of sf.getImportDeclarations()) {
      add(imp.getDefaultImport?.()?.getText?.());
      add(imp.getNamespaceImport?.()?.getText?.());
      for (const ni of imp.getNamedImports?.() ?? []) add((ni.getAliasNode?.() ?? ni.getNameNode?.())?.getText?.());
    }
  } catch { /* ignore */ }

  // Declaration names (functions, classes) + all binding identifiers (var/let/const, params, destructuring).
  const kinds = [K.FunctionDeclaration, K.ClassDeclaration, K.VariableDeclaration, K.Parameter, K.BindingElement, K.ImportSpecifier];
  for (const kind of kinds) {
    let nodes: any[] = [];
    try { nodes = sf.getDescendantsOfKind(kind); } catch { continue; }
    for (const n of nodes) {
      try {
        const nameNode = n.getNameNode?.();
        if (nameNode && nameNode.getKindName?.() === 'Identifier') add(nameNode.getText());
        else if (typeof n.getName === 'function') add(n.getName());
      } catch { /* ignore */ }
    }
  }
  return names;
}

/** The root identifier of a JSX tag name: `Foo` → "Foo"; `Foo.Bar` / `lib.Widget` → "Foo" / "lib". */
function tagRootName(tagNode: any): { root: string; full: string; isMember: boolean } | null {
  if (!tagNode) return null;
  const kind = tagNode.getKindName?.();
  if (kind === 'Identifier') {
    return { root: tagNode.getText(), full: tagNode.getText(), isMember: false };
  }
  if (kind === 'PropertyAccessExpression') {
    // Walk to the leftmost identifier.
    let n = tagNode;
    while (n && n.getKindName?.() === 'PropertyAccessExpression') n = n.getExpression?.();
    const root = n?.getText?.() ?? '';
    return { root, full: tagNode.getText(), isMember: true };
  }
  return null;
}

/** Analyze a file set for JSX components used but never imported/declared. Pure + deterministic. */
export async function analyzeJsxComponents(files: Record<string, string>): Promise<JsxComponentReport> {
  const mod = await loadTsMorph();
  if (!mod) return { undefinedComponents: [], filesScanned: 0, ok: true };

  const project = new mod.Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 2 },
  });
  const K = mod.SyntaxKind;

  const undefinedComponents: UndefinedComponent[] = [];
  let scanned = 0;

  for (const [path, content] of Object.entries(files)) {
    if (!JSX_FILE.test(path) || typeof content !== 'string' || !content.includes('<')) continue;
    scanned++;
    let sf: any;
    try { sf = project.createSourceFile(path, content, { overwrite: true }); } catch { continue; }

    const bound = collectBoundNames(sf, mod);
    const seen = new Set<string>(); // de-dupe per file

    let tags: any[] = [];
    try {
      tags = [
        ...sf.getDescendantsOfKind(K.JsxOpeningElement),
        ...sf.getDescendantsOfKind(K.JsxSelfClosingElement),
      ];
    } catch { continue; }

    for (const tag of tags) {
      let info: ReturnType<typeof tagRootName>;
      try { info = tagRootName(tag.getTagNameNode?.()); } catch { continue; }
      if (!info || !info.root) continue;

      // Only components: an Uppercase simple tag, OR any member-expression tag (Foo.Bar / lib.Widget).
      const isComponentTag = info.isMember || /^[A-Z]/.test(info.root);
      if (!isComponentTag) continue;
      if (GLOBALS.has(info.root) || bound.has(info.root)) continue;
      if (seen.has(info.full)) continue;
      seen.add(info.full);

      undefinedComponents.push({
        file: path,
        line: tag.getStartLineNumber?.() ?? 0,
        component: info.full,
        detail: `<${info.full}> is used but ${info.isMember ? `'${info.root}'` : `'${info.full}'`} is never imported or defined in this file — it will throw "${info.root} is not defined" at runtime.`,
      });
    }
  }

  return { undefinedComponents, filesScanned: scanned, ok: undefinedComponents.length === 0 };
}
