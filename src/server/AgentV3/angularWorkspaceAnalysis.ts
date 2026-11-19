// Angular's CLI wires styles, polyfills and the HTML entry through its workspace, not source imports.
// Autopsy cdffbb71: three independent import-only checks misread that wiring as missing/unused.
import ts from 'typescript';
import { isAppAnalysisPath } from './appAnalysisPaths';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;

function json(path: string, text: string | undefined): JsonObject | null {
  if (typeof text !== 'string') return null;
  const parsed = ts.parseConfigFileTextToJson(path, text);
  return parsed.error ? null : object(parsed.config);
}

function resolve(dir: string, path: string): string | null {
  if (!path || /^(?:[a-z][\w+.-]*:|\/)/i.test(path)) return null;
  const parts = dir ? dir.split('/') : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

function packageOf(spec: string): string | null {
  spec = spec.replace(/^(?:\.\/)?node_modules\//, '');
  if (/^(?:[./#~]|[a-z][\w+.-]*:)/i.test(spec)) return null;
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

export interface AngularWorkspaceFacts {
  styles: Set<string>;
  packages: Set<string>;
  entries: Array<{ index: string; browser: string }>;
}

/** Read only actual Angular builder options, including configuration overrides and nested workspaces. */
export function angularWorkspaceFacts(files: Readonly<Record<string, string>>): AngularWorkspaceFacts {
  const facts: AngularWorkspaceFacts = { styles: new Set(), packages: new Set(), entries: [] };
  // Component-scoped sheets are wired by metadata too; importing them globally changes encapsulation.
  for (const [path, text] of Object.entries(files)) {
    if (!/\.[cm]?[jt]s$/.test(path) || !isAppAnalysisPath(path) || !/\bstyleUrls?\s*:/.test(text)) continue;
    const file = source(files, path);
    if (!file) continue;
    for (const statement of file.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      const data = metadata(file, statement.name.text, 'Component');
      for (const property of data?.properties ?? []) {
        if (!ts.isPropertyAssignment(property) || !/^['"]?styleUrls?['"]?$/.test(property.name.getText(file))) continue;
        const values = ts.isArrayLiteralExpression(property.initializer) ? property.initializer.elements : [property.initializer];
        for (const value of values) {
          if (!ts.isStringLiteral(value)) continue;
          const local = resolve(path.split('/').slice(0, -1).join('/'), value.text);
          if (local && typeof files[local] === 'string') facts.styles.add(local);
        }
      }
    }
  }
  for (const [path, text] of Object.entries(files)) {
    if (!/(^|\/)angular\.json$/.test(path) || !isAppAnalysisPath(path)) continue;
    const workspace = json(path, text);
    const projects = object(workspace?.projects);
    if (!projects) continue;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    for (const value of Object.values(projects)) {
      const project = object(value);
      const targets = object(project?.architect) ?? object(project?.targets);
      if (!targets) continue;
      for (const targetValue of Object.values(targets)) {
        const target = object(targetValue);
        if (typeof target?.builder !== 'string' || !/^@(?:angular-devkit\/build-angular|angular\/build|nx\/angular):(?:application|browser|browser-esbuild|webpack-browser)$/.test(target.builder)) continue;
        const base = object(target.options) ?? {};
        const variants = [base, ...Object.values(object(target.configurations) ?? {}).map((c) => ({ ...base, ...object(c) }))];
        for (const options of variants) {
          for (const style of Array.isArray(options.styles) ? options.styles : []) {
            const spec = typeof style === 'string' ? style : object(style)?.input;
            if (typeof spec !== 'string') continue;
            const local = resolve(dir, spec);
            // inject:false is an intentional separate bundle; never "repair" it into an auto-import.
            if (local && typeof files[local] === 'string') facts.styles.add(local);
            else { const pkg = packageOf(spec); if (pkg) facts.packages.add(pkg); }
          }
          for (const key of ['polyfills', 'scripts']) {
            const raw = options[key];
            for (const value of Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []) {
              const spec = typeof value === 'string' ? value : object(value)?.input;
              if (typeof spec !== 'string') continue;
              const local = resolve(dir, spec);
              if (local && typeof files[local] === 'string') continue;
              const pkg = packageOf(spec);
              if (pkg) facts.packages.add(pkg);
            }
          }
          const index = typeof options.index === 'string' ? options.index : object(options.index)?.input;
          const browser = options.browser ?? options.main;
          if (typeof index === 'string' && typeof browser === 'string') {
            const indexPath = resolve(dir, index), browserPath = resolve(dir, browser);
            if (indexPath && browserPath) facts.entries.push({ index: indexPath, browser: browserPath });
          }
        }
      }
    }
  }
  return facts;
}

/** Required peers are used by their declaring Angular package, even without a direct app import. */
export function angularRequiredDependencies(packageJson: string | null | undefined): Set<string> {
  const pkg = json('package.json', packageJson ?? undefined);
  const declared = new Set(Object.keys({ ...object(pkg?.dependencies), ...object(pkg?.devDependencies) }));
  const peers: Record<string, readonly string[]> = {
    '@angular/core': ['rxjs'],
    '@angular/common': ['@angular/core', 'rxjs'],
    '@angular/forms': ['@angular/common', '@angular/core', '@angular/platform-browser', 'rxjs'],
    '@angular/router': ['@angular/common', '@angular/core', '@angular/platform-browser', 'rxjs'],
    '@angular/platform-browser': ['@angular/common', '@angular/core'],
    '@angular/platform-browser-dynamic': ['@angular/common', '@angular/core', '@angular/compiler', '@angular/platform-browser'],
    '@angular/animations': ['@angular/core'],
    '@angular/compiler-cli': ['@angular/compiler'],
  };
  return new Set(Object.entries(peers).flatMap(([name, required]) => declared.has(name) ? required : []));
}

function source(files: Readonly<Record<string, string>>, path: string): ts.SourceFile | null {
  return typeof files[path] === 'string' ? ts.createSourceFile(path, files[path], ts.ScriptTarget.Latest, true) : null;
}

function namedImport(file: ts.SourceFile, local: string, exported: string, module: string): boolean {
  return file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== module) return false;
    const bindings = statement.importClause?.namedBindings;
    return !!bindings && ts.isNamedImports(bindings) && bindings.elements.some((binding) =>
      binding.name.text === local && (binding.propertyName ?? binding.name).text === exported);
  });
}

function importedClass(files: Readonly<Record<string, string>>, from: ts.SourceFile, name: string): { file: ts.SourceFile; name: string } | null {
  for (const statement of from.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const binding = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((b) => b.name.text === name) : null;
    if (!binding || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const path = resolve(from.fileName.split('/').slice(0, -1).join('/'), statement.moduleSpecifier.text);
    if (!path) continue;
    for (const candidate of [path, `${path}.ts`, `${path}/index.ts`, `${path}.js`]) {
      const file = source(files, candidate);
      if (file) return { file, name: (binding.propertyName ?? binding.name).text };
    }
  }
  return null;
}

function metadata(file: ts.SourceFile, name: string, decorator: string): ts.ObjectLiteralExpression | null {
  for (const statement of file.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== name) continue;
    for (const d of ts.getDecorators(statement) ?? []) {
      if (!ts.isCallExpression(d.expression) || !ts.isIdentifier(d.expression.expression)
        || !namedImport(file, d.expression.expression.text, decorator, '@angular/core')) continue;
      const value = d.expression.arguments[0];
      if (value && ts.isObjectLiteralExpression(value)) return value;
    }
  }
  return null;
}

/** An Angular mount is proven by CLI index/entry + its actual bootstrap target's component selector. */
export function isAngularMountShell(
  path: string, html: string, files: Readonly<Record<string, string>>, facts = angularWorkspaceFacts(files),
): boolean {
  for (const entry of facts.entries) {
    if (entry.index !== path) continue;
    const file = source(files, entry.browser);
    if (!file) continue;
    const selectors: string[] = [];
    const component = (from: ts.SourceFile, name: string) => {
      const imported = importedClass(files, from, name);
      if (!imported) return;
      const data = metadata(imported.file, imported.name, 'Component');
      const selector = data?.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(imported.file) === 'selector');
      if (selector && ts.isPropertyAssignment(selector) && ts.isStringLiteral(selector.initializer)) selectors.push(selector.initializer.text);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isIdentifier(node.arguments[0])) {
        if (ts.isIdentifier(node.expression) && namedImport(file, node.expression.text, 'bootstrapApplication', '@angular/platform-browser')) component(file, node.arguments[0].text);
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'bootstrapModule'
          && ts.isCallExpression(node.expression.expression) && ts.isIdentifier(node.expression.expression.expression)
          && (namedImport(file, node.expression.expression.expression.text, 'platformBrowserDynamic', '@angular/platform-browser-dynamic')
            || namedImport(file, node.expression.expression.expression.text, 'platformBrowser', '@angular/platform-browser'))) {
          const module = importedClass(files, file, node.arguments[0].text);
          const data = module && metadata(module.file, module.name, 'NgModule');
          const boot = data?.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(module!.file) === 'bootstrap');
          if (boot && ts.isPropertyAssignment(boot) && ts.isArrayLiteralExpression(boot.initializer)) {
            for (const item of boot.initializer.elements) if (ts.isIdentifier(item)) component(module!.file, item.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    if (selectors.some((selector) => /^[a-z][\w-]*-[\w-]+$/i.test(selector)
      && new RegExp(`<${selector}\\b[^>]*>\\s*</${selector}\\s*>`, 'i').test(markup))) return true;
  }
  return false;
}
