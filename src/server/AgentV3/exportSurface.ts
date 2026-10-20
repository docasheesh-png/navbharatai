// Dependency context keeps declared contracts, not guesses made by cutting at the first brace.
// TypeScript's syntax tree distinguishes inline object types, destructured/default parameters and
// actual bodies. No program/type checker, filesystem, module resolution or provider call is needed.
// Inferred returns/values keep actual source, explicitly NOT a complete inferred type contract.
// The parser and rendered context are bounded; omissions are visible, never labelled exact.
import * as ts from 'typescript';

export interface SurfaceFile {
  path: string;
  content: string;
}

/** True when the signature-surface context is enabled (default ON; env kill switch). */
export function signatureContextEnabled(): boolean {
  return process.env.AGENTV3_SIGNATURE_CONTEXT !== 'off';
}

const MAX_PARSE_CHARS = 1_000_000;
const INCOMPLETE = '\n// INCOMPLETE: context budget reached. Read this producer before using omitted contracts.';
interface SurfaceEntry {
  text: string;
  source: boolean;
  references: readonly ts.Node[];
  local?: boolean;
}
interface ScriptSurface {
  names: string[];
  entries: SurfaceEntry[];
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : []);
}

/** Parse the WHOLE bounded file, including late exports and local declarations exported by alias. */
function parseScriptSurface(content: string, path: string): ScriptSurface | null {
  if (!content.trim() || content.length > MAX_PARSE_CHARS) return null;
  try {
    const kind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX
      : /\.(js|mjs|cjs)$/i.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
    // A recovered/partial parse is not an exact contract. Fall back to labelled actual source.
    if ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return null;
    const text = (node: ts.Node) => node.getText(file);
    const has = (node: ts.Node, flag: ts.SyntaxKind) => ts.canHaveModifiers(node)
      && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === flag);
    const overloads = new Set(file.statements.filter(ts.isFunctionDeclaration)
      .filter((node) => !node.body && node.name).map((node) => node.name!.text));
    const local = new Map<string, SurfaceEntry[]>();
    const roots: SurfaceEntry[] = [];
    const names = new Set<string>();
    const addLocal = (name: string, entries: SurfaceEntry[]) => {
      const existing = local.get(name);
      if (existing) existing.push(...entries);
      else local.set(name, [...entries]);
    };
    for (const statement of file.statements) {
      let entries: SurfaceEntry[] = [];
      let declared: string[] = [];
      if (ts.isVariableStatement(statement)) {
        // Split declarations so a large inferred value cannot hide the next callable in the same const.
        const prefix = content.slice(statement.getStart(file), statement.declarationList.declarations[0].getStart(file));
        for (const declaration of statement.declarationList.declarations) {
          const init = declaration.initializer;
          let value = text(declaration);
          let source = !!init;
          let references: readonly ts.Node[] = [declaration];
          if (declaration.type) {
            value = content.slice(declaration.getStart(file), declaration.type.end) + (init ? ' = …' : '');
            source = false;
            references = [declaration.name, declaration.type];
          } else if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.type) {
            value = content.slice(declaration.getStart(file), init.body.getStart(file)).trimEnd()
              + (ts.isBlock(init.body) ? ' { … }' : ' …');
            source = false;
            references = [...(init.typeParameters || []), ...init.parameters, init.type];
          }
          const entry = { text: `${prefix}${value};`, source, references };
          entries.push(entry);
          const bindings = bindingNames(declaration.name);
          declared.push(...bindings);
          for (const name of bindings) addLocal(name, [entry]);
        }
      } else {
        if (ts.isFunctionDeclaration(statement) && statement.body) {
          // An overload implementation is NOT an additional callable overload.
          if (statement.name && overloads.has(statement.name.text)) continue;
          entries = [{
            text: statement.type ? `${content.slice(statement.getStart(file), statement.body.getStart(file)).trimEnd()} { … }` : text(statement),
            source: !statement.type,
            references: statement.type ? [...(statement.typeParameters || []), ...statement.parameters, statement.type] : [statement],
          }];
        } else {
          entries = [{ text: text(statement), source: ts.isClassDeclaration(statement) || ts.isModuleDeclaration(statement)
            || (ts.isExportAssignment(statement) && !ts.isIdentifier(statement.expression)), references: [statement] }];
        }
        if (ts.isImportEqualsDeclaration(statement)) {
          declared.push(statement.name.text);
          // Both `import X = require("module")` and local namespace aliases can supply a
          // public signature. External module strings are not local dependencies; namespace
          // references are, and must bring their declaration into the supporting context.
          entries[0].references = ts.isExternalModuleReference(statement.moduleReference)
            ? [] : [statement.moduleReference];
        } else if (ts.isImportDeclaration(statement)) {
          const clause = statement.importClause;
          if (clause?.name) declared.push(clause.name.text);
          if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) declared.push(clause.namedBindings.name.text);
            else declared.push(...clause.namedBindings.elements.map((element) => element.name.text));
          }
          entries[0].references = []; // Do not resolve external specifiers against unrelated local names.
        } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
          || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
          || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
          if (statement.name) declared.push(statement.name.text);
        }
        for (const name of declared) addLocal(name, entries);
      }
      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) names.add(element.name.text);
          entries[0].references = statement.moduleSpecifier ? [] : statement.exportClause.elements.map((element) => element.propertyName || element.name);
        } else {
          names.add(statement.exportClause && ts.isNamespaceExport(statement.exportClause)
            ? statement.exportClause.name.text : `* from ${statement.moduleSpecifier ? text(statement.moduleSpecifier) : '?'}`);
          entries[0].references = [];
        }
        roots.push(...entries);
      } else if (ts.isExportAssignment(statement)) {
        names.add(statement.isExportEquals ? 'export =' : 'default');
        roots.push(...entries);
      } else if (has(statement, ts.SyntaxKind.ExportKeyword)) {
        if (has(statement, ts.SyntaxKind.DefaultKeyword)) names.add('default');
        else declared.forEach((name) => names.add(name));
        roots.push(...entries);
      }
    }
    if (!roots.length) return null;
    // Keep local types/imports/default-export targets that the real contract depends on. These are
    // labelled support, NEVER advertised as additional exports. Cycles terminate by entry identity.
    const rootEntries = new Set(roots);
    const selected = new Set(roots);
    const entries = [...roots];
    for (let i = 0; i < entries.length; i++) {
      const pending = [...entries[i].references];
      while (pending.length) {
        const node = pending.pop()!;
        if (ts.isIdentifier(node)) {
          for (const dependency of local.get(node.text) || []) {
            if (selected.has(dependency)) continue;
            selected.add(dependency);
            entries.push(dependency);
          }
        }
        ts.forEachChild(node, (child) => { pending.push(child); });
      }
    }
    return { names: [...names], entries: entries.map((entry) => ({ ...entry, local: !rootEntries.has(entry) })) };
  } catch {
    return null; // Pathological/malformed source still receives the honest bounded source fallback.
  }
}

function entryText(entry: SurfaceEntry): string {
  const label = entry.local ? '// Local support (not an additional export).\n' : '';
  return `${label}${entry.source ? '// Actual source; inferred shape is NOT a complete type contract.\n' : ''}${entry.text}`;
}

/** Head AND tail retain actual source (often the return) without inventing a shape for omitted code. */
function excerpt(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const marker = '\n// … omitted source …\n';
  if (cap <= marker.length) return text.slice(0, cap);
  const head = Math.ceil((cap - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(cap - marker.length - head));
}

function renderScriptSurface(surface: ScriptSurface, cap = Infinity): string {
  const inventory = `// Exported names: ${surface.names.join(', ')}\n`;
  const full = inventory + surface.entries.map(entryText).join('\n');
  if (full.length <= cap) return full;
  if (cap <= INCOMPLETE.length) return INCOMPLETE.trimStart().slice(0, cap);
  let available = cap - INCOMPLETE.length;
  if (inventory.length >= available) return inventory.slice(0, available) + INCOMPLETE;
  const parts = [inventory.trimEnd()];
  available -= inventory.length;
  const deferred: string[] = [];
  // Complete declared signatures first. One giant inferred hook must not erase later exports or
  // their supporting types. When there is no complete signature, share the remaining source budget.
  for (const entry of surface.entries) {
    const rendered = entryText(entry);
    if (!entry.source && rendered.length + 1 <= available) {
      parts.push(rendered);
      available -= rendered.length + 1;
    } else deferred.push(rendered);
  }
  for (let i = 0; i < deferred.length && available > 1; i++) {
    const share = Math.min(deferred[i].length, Math.floor(available / (deferred.length - i)) - 1);
    if (share > 0) {
      parts.push(excerpt(deferred[i], share));
      available -= share + 1;
    }
  }
  return parts.join('\n') + INCOMPLETE;
}

/** Export declarations + required local support, or null when reliable extraction is unavailable. */
export function scriptExportSurface(content: string): string | null {
  const surface = parseScriptSurface(content, 'surface.ts');
  return surface ? renderScriptSurface(surface) : null;
}

/** Export surface of a CSS file: the class/id/var/keyframes vocabulary a consumer may reference. */
export function cssExportSurface(content: string): string | null {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const vars = new Set<string>();
  const keyframes = new Set<string>();
  for (const m of content.matchAll(/(^|[\s,>+~({])\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(m[2]);
  for (const m of content.matchAll(/(^|[\s,>+~({])#([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.add(m[2]);
  for (const m of content.matchAll(/--([A-Za-z_][A-Za-z0-9_-]*)\s*:/g)) vars.add(`--${m[1]}`);
  for (const m of content.matchAll(/@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g)) keyframes.add(m[1]);
  const parts: string[] = [];
  if (classes.size) parts.push(`classes: ${[...classes].join(', ')}`);
  if (ids.size) parts.push(`ids: ${[...ids].join(', ')}`);
  if (vars.size) parts.push(`css vars: ${[...vars].join(', ')}`);
  if (keyframes.size) parts.push(`keyframes: ${[...keyframes].join(', ')}`);
  return parts.length > 0 ? parts.join('\n') : null;
}

/** The export surface of one file, or null when extraction found nothing (caller falls back). */
export function exportSurfaceOf(path: string, content: string): string | null {
  if (typeof content !== 'string' || content.trim().length === 0) return null;
  if (/\.(css|scss)$/i.test(path)) return cssExportSurface(content);
  if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(path)) {
    const surface = parseScriptSurface(content, path);
    return surface ? renderScriptSurface(surface) : null;
  }
  return null;
}

/** Bounded source fallback is explicit about both unavailable contracts and truncation. */
function fallbackSource(content: string, cap: number): string {
  const label = '// Actual source fallback; complete export/type contract unavailable.\n';
  const full = label + content;
  return full.length <= cap ? full : (cap <= INCOMPLETE.length ? INCOMPLETE.trimStart().slice(0, cap)
    : excerpt(full, cap - INCOMPLETE.length) + INCOMPLETE);
}

/** Every producer remains represented, with a strict per-file character budget and honest omissions. */
export function signatureDependencyContext(producers: SurfaceFile[], perFileCap = 4000): string {
  const real = (producers || []).filter((f) => f && f.path && typeof f.content === 'string');
  if (real.length === 0) return '';
  const cap = Number.isFinite(perFileCap) ? Math.max(0, Math.floor(perFileCap)) : 4000;
  const dump = real.map((file) => {
    const script = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(file.path) ? parseScriptSurface(file.content, file.path) : null;
    const css = /\.(css|scss)$/i.test(file.path) ? cssExportSurface(file.content) : null;
    const body = script ? renderScriptSurface(script, cap) : css !== null
      ? (css.length <= cap ? css : fallbackSource(css, cap)) : fallbackSource(file.content, cap);
    return `<<<EXPORTS ${file.path}>>>\n${body}\n<<<ENDEXPORTS>>>`;
  }).join('\n\n');
  return [
    '',
    'ALREADY-WRITTEN FILES YOU CAN IMPORT — real declared signatures, types and export names.',
    'Import ONLY actual exports, never local support declarations. Typed implementation bodies may be',
    'omitted (“{ … }” / “= …;”). Inferred shapes use ACTUAL SOURCE, not guessed type contracts.',
    'Context is bounded: INCOMPLETE blocks or source fallbacks are NOT complete contracts. Read the',
    'producer for missing details; do NOT invent return members, parameters, types or export names.',
    dump,
  ].join('\n');
}
