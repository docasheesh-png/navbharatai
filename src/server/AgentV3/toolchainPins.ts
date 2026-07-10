// D11 (roadmap Tier 2) — toolchain version pinning check. Big / imported repos pin exact toolchains
// (.nvmrc, engines, .python-version, go.mod, pom.xml java.version) and fail cryptically on drift. This
// surfaces the toolchain a project DECLARES and flags INTERNAL contradictions (two files disagreeing on
// the version) — a real, silent cause of "works for them, breaks here" that no other check catches.
//
// PURE + dependency-free (reads the relevant config files' text) → fully unit-testable. The ToolDispatcher
// `check_toolchain` tool reads the files and reports. Honest by design: it reports what's declared and any
// contradictions; it never claims the sandbox matches (the sandbox runtime is fixed and out of scope here).

export type ToolLang = 'node' | 'python' | 'java' | 'go';

export interface ToolchainDecl {
  language: ToolLang;
  /** The file the version was declared in. */
  source: string;
  /** The raw declared value. */
  raw: string;
  /** Normalized comparable key (node/java/go: major; python: major.minor). */
  key: string;
}

export interface ToolchainResult {
  declarations: ToolchainDecl[];
  /** One message per language whose sources disagree. */
  inconsistencies: string[];
  summary: string;
}

/** First integer in a version-ish string, honoring an optional leading v (v18 → 18, >=20 → 20). */
function major(raw: string): string | null {
  const m = raw.match(/(\d+)/);
  return m ? m[1] : null;
}
/** major.minor for Python (3.11.4 → 3.11, >=3.10 → 3.10). */
function majorMinor(raw: string): string | null {
  const m = raw.match(/(\d+)\.(\d+)/);
  if (m) return `${m[1]}.${m[2]}`;
  const one = raw.match(/(\d+)/);
  return one ? one[1] : null;
}

function readJson(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

/**
 * Analyse the declared toolchain from a map of {filename → content}. Only the relevant files need be
 * present. Pure.
 */
export function analyzeToolchain(files: Record<string, string>): ToolchainResult {
  const declarations: ToolchainDecl[] = [];
  const add = (language: ToolLang, source: string, raw: string | null | undefined, key: string | null) => {
    if (raw && key) declarations.push({ language, source, raw: raw.trim(), key });
  };

  // ── Node ──
  if (files['.nvmrc'] != null) { const v = files['.nvmrc'].trim(); add('node', '.nvmrc', v, major(v)); }
  if (files['.node-version'] != null) { const v = files['.node-version'].trim(); add('node', '.node-version', v, major(v)); }
  const pkg = readJson(files['package.json']);
  if (pkg) {
    const enginesNode = (pkg.engines as Record<string, string> | undefined)?.node;
    if (enginesNode) add('node', 'package.json engines.node', enginesNode, major(enginesNode));
    const voltaNode = (pkg.volta as Record<string, string> | undefined)?.node;
    if (voltaNode) add('node', 'package.json volta.node', voltaNode, major(voltaNode));
  }

  // ── Python ──
  if (files['.python-version'] != null) { const v = files['.python-version'].trim(); add('python', '.python-version', v, majorMinor(v)); }
  if (files['runtime.txt'] != null) { const v = files['runtime.txt'].trim(); add('python', 'runtime.txt', v, majorMinor(v)); }
  if (files['pyproject.toml'] != null) {
    const m = files['pyproject.toml'].match(/requires-python\s*=\s*["']([^"']+)["']/);
    if (m) add('python', 'pyproject.toml requires-python', m[1], majorMinor(m[1]));
  }

  // ── Java ──
  if (files['.java-version'] != null) { const v = files['.java-version'].trim(); add('java', '.java-version', v, major(v)); }
  if (files['pom.xml'] != null) {
    const jv = files['pom.xml'].match(/<java\.version>\s*([^<]+?)\s*<\/java\.version>/);
    if (jv) add('java', 'pom.xml java.version', jv[1], major(jv[1]));
    else {
      const cs = files['pom.xml'].match(/<maven\.compiler\.(?:source|release)>\s*([^<]+?)\s*</);
      if (cs) add('java', 'pom.xml maven.compiler', cs[1], major(cs[1]));
    }
  }

  // ── Go ──
  if (files['go.mod'] != null) {
    const m = files['go.mod'].match(/^\s*go\s+(\d+\.\d+(?:\.\d+)?)/m);
    if (m) add('go', 'go.mod', m[1], majorMinor(m[1]));
  }

  // Inconsistencies: per language, more than one distinct normalized key.
  const inconsistencies: string[] = [];
  for (const lang of ['node', 'python', 'java', 'go'] as ToolLang[]) {
    const forLang = declarations.filter(d => d.language === lang);
    const keys = new Set(forLang.map(d => d.key));
    if (keys.size > 1) {
      inconsistencies.push(
        `${lang}: sources disagree — ${forLang.map(d => `${d.source}=${d.raw}`).join(', ')}. Pin one version consistently.`,
      );
    }
  }

  const parts = (['node', 'python', 'java', 'go'] as ToolLang[])
    .map(lang => {
      const forLang = declarations.filter(d => d.language === lang);
      return forLang.length ? `${lang} ${[...new Set(forLang.map(d => d.raw))].join('/')}` : null;
    })
    .filter(Boolean);
  const summary = declarations.length
    ? `Declared toolchain: ${parts.join(', ')}.` + (inconsistencies.length ? ` ${inconsistencies.length} inconsistency(ies).` : ' Consistent.')
    : 'No toolchain pins declared (.nvmrc / engines / .python-version / go.mod / pom.xml).';

  return { declarations, inconsistencies, summary };
}
