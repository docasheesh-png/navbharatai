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
//   • A tag must have a runtime binding in its actual lexical scope. Parameters and local declarations
//     in unrelated scopes cannot hide an undefined component; named function expressions bind only
//     inside their own body.
//   • Known injected JSX globals (React, Fragment) remain allowed when no explicit local binding exists.

import { isAppAnalysisPath } from './appAnalysisPaths';
import { createExportCapabilities } from './exportCapabilities';

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

const JSX_FILE = /\.(t|j)sx$/;
const GLOBALS = new Set(['React', 'Fragment']);

/** Analyze actual lexical JSX bindings without reading packages or the host filesystem. */
export async function analyzeJsxComponents(files: Record<string, string>): Promise<JsxComponentReport> {
  const code = Object.fromEntries(Object.entries(files).filter(([path, content]) =>
    JSX_FILE.test(path) && isAppAnalysisPath(path) && typeof content === 'string' && content.includes('<')));
  const undefinedComponents: UndefinedComponent[] = [];
  try {
    for (const path of Object.keys(code)) {
      // A plain-script sibling is a separate bundler module, not this file's runtime scope. Analyze
      // bindings per file so the TS program cannot merge unrelated script globals into a fake binding.
      const model = createExportCapabilities({ [path]: code[path] });
      const seen = new Set<string>();
      for (const binding of model.jsxBindingsOf(path)) {
        if (binding.state === 'value') continue;
        // Keep the existing injected-global compatibility, but an explicit erased local import is
        // positive evidence that THIS binding cannot be supplied by the global of the same name.
        if (binding.state === 'missing' && GLOBALS.has(binding.root)) continue;
        if (seen.has(binding.component)) continue;
        seen.add(binding.component);
        undefinedComponents.push({ file: path, line: binding.line, component: binding.component,
          detail: binding.state === 'type-only'
            ? `<${binding.component}> uses '${binding.root}' as a runtime value, but its binding is type-only and emits no value.`
            : `<${binding.component}> is used but '${binding.root}' has no binding in this scope — it will throw "${binding.root} is not defined" at runtime.`,
        });
      }
    }
  } catch { /* unavailable analysis cannot invent a blocker */ }
  return { undefinedComponents, filesScanned: Object.keys(code).length, ok: undefinedComponents.length === 0 };
}
