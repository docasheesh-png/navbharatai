// AgentV3 — Undefined-hook-call analyzer (build-robustness evaluator).
//
// Catches a hard runtime crash the other analyzers miss: a React hook is CALLED but was never imported
// or defined — e.g. `const [x] = useState(0)` with no `import { useState } from 'react'`. The app throws
// "useState is not defined" (ReferenceError) and white-screens. The JSX analyzer covers undefined
// *components* (<Foo/>); import/export covers *imports that don't match exports*; this covers the *hook
// call identifier* itself having no binding.
//
// High confidence, near-zero false positives: only `use…`-named CALL expressions are considered (never
// host code), a call is OK if its identifier is bound ANYWHERE in the file (import / const / function /
// param / destructuring), member-expression calls (`something.useX()`) are skipped (the object provides
// it), and `React`/`use` globals are allowed. Never throws (empty result on any parse/lib issue).

export interface UndefinedHook {
  file: string;
  line: number;
  hook: string;
  detail: string;
}

export interface UndefinedHookReport {
  undefinedHooks: UndefinedHook[];
  filesScanned: number;
  ok: boolean;
}

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

const CODE_FILE = /\.(t|j)sx?$/;
const HOOK_NAME = /^use([A-Z0-9].*)?$/;
const GLOBALS = new Set(['React']);

/** Collect every identifier name bound anywhere in the file (over-collect → safe). */
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
  for (const kind of [K.FunctionDeclaration, K.ClassDeclaration, K.VariableDeclaration, K.Parameter, K.BindingElement]) {
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

/** Analyze a file set for hook calls whose identifier is never imported/defined. Pure + deterministic. */
export async function analyzeUndefinedHooks(files: Record<string, string>): Promise<UndefinedHookReport> {
  const mod = await loadTsMorph();
  if (!mod) return { undefinedHooks: [], filesScanned: 0, ok: true };

  const project = new mod.Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 2 },
  });
  const K = mod.SyntaxKind;

  const undefinedHooks: UndefinedHook[] = [];
  let scanned = 0;

  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE.test(path) || typeof content !== 'string' || !content.includes('use')) continue;
    scanned++;
    let sf: any;
    try { sf = project.createSourceFile(path, content, { overwrite: true }); } catch { continue; }

    const bound = collectBoundNames(sf, mod);
    const seen = new Set<string>();

    let calls: any[] = [];
    try { calls = sf.getDescendantsOfKind(K.CallExpression); } catch { continue; }
    for (const call of calls) {
      const callee = call.getExpression?.();
      if (!callee || callee.getKindName?.() !== 'Identifier') continue; // skip obj.useX() member calls
      const name: string = callee.getText?.() ?? '';
      if (!HOOK_NAME.test(name) || name === 'use') continue;
      if (GLOBALS.has(name) || bound.has(name) || seen.has(name)) continue;
      seen.add(name);
      undefinedHooks.push({
        file: path,
        line: call.getStartLineNumber?.() ?? 0,
        hook: name,
        detail: `${name}() is called but never imported or defined in this file — it will throw "${name} is not defined" at runtime.`,
      });
    }
  }

  return { undefinedHooks, filesScanned: scanned, ok: undefinedHooks.length === 0 };
}
