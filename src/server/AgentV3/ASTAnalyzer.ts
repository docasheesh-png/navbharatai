// AgentV3 — AST-level code analysis (Level 2 — accurate symbol/import extraction).
//
// Uses ts-morph (TypeScript Compiler API wrapper) to parse .ts/.tsx files into a
// real AST — more accurate than regex for:
//   - Exact symbol locations (line numbers)
//   - Import graph with resolved specifiers and named bindings
//   - React component detection (PascalCase functions/consts returning JSX)
//   - Re-exports, destructured exports, default exports
//
// Integrated as an ENHANCEMENT LAYER on top of the existing regex-based
// extractFacts pipeline in WorkspaceMemory: when available it enriches the output;
// on any failure (parse error, ts-morph not installed) it degrades gracefully to null
// so extractFacts falls back to its regex baseline. Never throws to callers.
//
// Dynamic import of ts-morph keeps it optional — the module loads on first use.

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

export interface ASTSymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'const' | 'interface' | 'type' | 'enum' | 'component';
  file: string;
  /** 1-based line number in the source file. */
  line: number;
}

export interface ASTImport {
  /** The raw module specifier string, e.g. 'react', './Button', '@scope/pkg'. */
  specifier: string;
  /** Individual named bindings, including the default import name if present. */
  names: string[];
}

export interface ASTFacts {
  symbols: ASTSymbolInfo[];
  imports: ASTImport[];
  /** Flat list of all import specifiers (for compatibility with WorkspaceMemory). */
  specifiers: string[];
  /** PascalCase exported function/const names in JSX files (React components). */
  components: string[];
  /** Route paths detected by the same patterns used in extractFacts. */
  routes: string[];
}

const isComponentName = (n: string): boolean => /^[A-Z]/.test(n) && /[a-z]/.test(n);
const isJsx = (f: string): boolean => /\.(tsx|jsx)$/.test(f);

/**
 * Parse a TypeScript/TSX file with ts-morph and extract structured AST facts.
 * Returns null when ts-morph is unavailable or parsing fails — callers MUST
 * check for null and fall back to the regex pipeline.
 */
export async function analyzeWithAST(
  filePath: string,
  content: string,
): Promise<ASTFacts | null> {
  if (!/\.(t|j)sx?$/.test(filePath)) return null;
  const loaded = await loadTsMorph();
  if (!loaded) return null;

  try {
    const project = new TsMorphProject({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: isJsx(filePath) ? 2 : 0 },
    });
    const sf = project.createSourceFile(filePath, content, { overwrite: true });

    const symbols: ASTSymbolInfo[] = [];
    const imports: ASTImport[] = [];
    const components: string[] = [];
    const routeSet = new Set<string>();

    // ── Imports ──────────────────────────────────────────────────────────────
    for (const decl of sf.getImportDeclarations()) {
      const specifier = decl.getModuleSpecifierValue();
      const defaultImp = decl.getDefaultImport()?.getText();
      const namedImps = decl.getNamedImports().map((n: any) => n.getName());
      const names = [...(defaultImp ? [defaultImp] : []), ...namedImps];
      imports.push({ specifier, names });
    }

    // ── Exported declarations ─────────────────────────────────────────────────
    const exportedMap: Map<string, any[]> = sf.getExportedDeclarations();
    for (const [name, nodes] of exportedMap) {
      for (const node of nodes) {
        const kindName: string = node.getKindName?.() ?? '';
        let kind: ASTSymbolInfo['kind'] = 'const';
        if (kindName.includes('Function')) kind = 'function';
        else if (kindName.includes('Class')) kind = 'class';
        else if (kindName.includes('Interface')) kind = 'interface';
        else if (kindName.includes('TypeAlias')) kind = 'type';
        else if (kindName.includes('Enum')) kind = 'enum';

        if (isJsx(filePath) && isComponentName(name) && (kind === 'function' || kind === 'const')) {
          kind = 'component';
          components.push(name);
        }

        const startPos = node.getStart?.();
        const line =
          typeof startPos === 'number'
            ? (sf.getLineAndColumnAtPos?.(startPos)?.line ?? 1)
            : 1;
        symbols.push({ name, kind, file: filePath, line });
      }
    }

    // ── Routes (same heuristics as the regex pipeline) ────────────────────────
    const text = sf.getText();
    const routePatterns = [
      /\b(?:app|router)\.(?:get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g,
      /<Route\s+[^>]*?path=['"]([^'"]+)['"]/g,
      /\bpath:\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of routePatterns) {
      for (let m = re.exec(text); m; m = re.exec(text)) routeSet.add(m[1]);
    }

    return {
      symbols,
      imports,
      specifiers: imports.map((i) => i.specifier),
      components: [...new Set(components)],
      routes: [...routeSet],
    };
  } catch {
    return null;
  }
}
