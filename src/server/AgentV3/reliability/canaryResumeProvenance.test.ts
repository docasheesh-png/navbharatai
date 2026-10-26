import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { canaryWorkspaceId, isCanaryWorkspace } from './canaryIsolation';
import { isWorkspaceId, ownedByVerifiedUid, workspaceIdFor } from '../../lib/workspaceIdentity';

const root = resolve(__dirname, '../../../..');
function files(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : [];
  });
}
// Read once per suite; parse only candidates, and reuse the same AST across censuses.
const sources = new Map<string, string>();
const parsed = new Map<string, ts.SourceFile>();
function source(path: string): string {
  if (!sources.has(path)) sources.set(path, readFileSync(resolve(root, path), 'utf8'));
  return sources.get(path)!;
}
function couldContain(text: string, spellings: readonly string[]): boolean {
  const needles = spellings.map(spelling => spelling.toLowerCase());
  const matches = (value: string) => needles.some(needle => value.toLowerCase().includes(needle));
  if (matches(text)) return true;
  // Decode a conservative textual superset of ECMAScript identifier/string escapes.
  // Identity escapes may create false positives, never exclusions. Malformed Unicode/
  // hex escapes are parsed rather than guessed. Template raw text still participates above.
  if (/\\(?:u(?![0-9a-f]{4}|\{[0-9a-f]+\})|x(?![0-9a-f]{2}))/i.test(text)) return true;
  let uncertain = false;
  const decoded = text.replace(/\\(?:u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|[0-7]{1,3}|\r\n|[\s\S])/gi, escape => {
    const value = escape.slice(1);
    if (/^[\r\n\u2028\u2029]/.test(value)) return '';
    if (value[0] === 'u' || value[0] === 'x') {
      const digits = value.startsWith('u{') ? value.slice(2, -1) : value.slice(1);
      const point = parseInt(digits, 16);
      if (point > 0x10ffff) { uncertain = true; return ''; }
      return String.fromCodePoint(point);
    }
    if (/^[0-7]/.test(value)) return String.fromCharCode(parseInt(value, 8));
    return value;
  });
  return uncertain || matches(decoded);
}
function candidates(spellings: readonly string[]): string[] {
  return files('src/server').filter(path => couldContain(source(path), spellings));
}
function parse(path: string): ts.SourceFile {
  if (!parsed.has(path)) parsed.set(path, ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true));
  return parsed.get(path)!;
}
function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node); ts.forEachChild(node, child => walk(child, visitor));
}
function localInitializer(call: ts.CallExpression, name: string): ts.Expression | undefined {
  for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
    if (!ts.isBlock(node)) continue;
    for (const statement of node.statements) {
      if (!ts.isVariableStatement(statement) || statement.pos >= call.pos) continue;
      const declaration = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === name);
      if (declaration) return declaration.initializer;
    }
  }
  return undefined;
}
function member(node: ts.Expression): { receiver: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) return { receiver: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    return { receiver: node.expression, name: node.argumentExpression.text };
  }
  return undefined;
}
const compact = (node: ts.Node, file: ts.SourceFile) => node.getText(file).replace(/\s+/g, '');

function dormantReferences(file: ts.SourceFile, path: string) {
  const violations: string[] = [], scopeCalls: string[] = [], authorityCollections: string[] = [];
  const spendAliases = new Set(['runWithCanarySpendGuard']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const imported of bindings.elements) {
      if ((imported.propertyName ?? imported.name).text === 'runWithCanarySpendGuard') spendAliases.add(imported.name.text);
    }
  }
  walk(file, node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && /canarySandboxController/i.test(specifier.text)) violations.push(`${path}: controller import/export`);
    }
    if (ts.isNewExpression(node) && node.expression.getText(file) === 'CanarySandboxController') violations.push(`${path}: controller construction`);
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file);
      if (spendAliases.has(callee) || member(node.expression)?.name === 'runWithCanarySpendGuard') violations.push(`${path}: model driver scope`);
      if (callee === 'runWithCanaryIsolation') scopeCalls.push(path);
      if (callee === 'import' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && /canarySandboxController/i.test(node.arguments[0].text)) violations.push(`${path}: dynamic controller import`);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && node.text.includes('benchmark_canary_authorities')) {
      authorityCollections.push(path);
      if (path !== 'src/server/AgentV3/reliability/canarySpendGuard.ts') violations.push(`${path}: authority collection outside guard`);
    }
  });
  return { violations, scopeCalls, authorityCollections };
}

describe('reviewed canary native-identity containment', () => {
  it('prefilters only impossible spellings including encoded and case-varied sources', () => {
    for (const spelling of ['canarySandboxController', 'CanarySandboxController', 'runWithCanarySpendGuard', 'runWithCanaryIsolation', 'benchmark_canary_authorities', 'ensureWorkspace', 'sandboxStore']) {
      expect(couldContain(`/* prefix */ ${spelling} /* suffix */`, [spelling])).toBe(true);
      expect(couldContain(`'${spelling}'`, [spelling])).toBe(true);
      const escaped = `\\u${spelling.charCodeAt(0).toString(16).padStart(4, '0')}${spelling.slice(1)}`;
      expect(escaped.charCodeAt(0)).toBe(92);
      expect(escaped[1]).toBe('u');
      const escapedFile = ts.createSourceFile('escape.ts', `const value = '${escaped}';`, ts.ScriptTarget.Latest, true);
      const declaration = (escapedFile.statements[0] as ts.VariableStatement).declarationList.declarations[0];
      expect((declaration.initializer as ts.StringLiteral).text).toBe(spelling);
      expect(couldContain(escaped, [spelling])).toBe(true);
      expect(couldContain(`'${escaped}'`, [spelling])).toBe(true);
    }
    for (const encoded of [String.raw`\u0073andboxStore`, String.raw`\u{73}andboxStore`, String.raw`\x73andboxStore`, String.raw`\163andboxStore`, String.raw`\sandboxStore`, 'sandboxSto' + String.fromCharCode(92, 10) + 're', 'SANDBOXSTORE']) {
      expect(couldContain(encoded, ['sandboxStore']), JSON.stringify(encoded)).toBe(true);
    }
    expect(couldContain(String.raw`export const unrelated = "\n";`, ['sandboxStore'])).toBe(false);
    expect(couldContain('export const unrelated = 1;', ['sandboxStore'])).toBe(false);
  });
  it('keeps controller, model driver and authority issuance unreachable from production callers', () => {
    const scopeCalls: string[] = [];
    const authorityCollections: string[] = [];
    const violations: string[] = [];
    for (const path of candidates(['canarySandboxController', 'CanarySandboxController', 'runWithCanarySpendGuard', 'runWithCanaryIsolation', 'benchmark_canary_authorities'])) {
      const result = dormantReferences(parse(path), path);
      violations.push(...result.violations);
      scopeCalls.push(...result.scopeCalls);
      authorityCollections.push(...result.authorityCollections);
    }
    expect(violations).toEqual([]);
    expect(scopeCalls).toEqual(['src/server/AgentV3/reliability/canarySandboxController.ts']);
    expect([...new Set(authorityCollections)]).toEqual(['src/server/AgentV3/reliability/canarySpendGuard.ts']);
  });
  it.each([
    ["import { CanarySandboxController as C } from './CANARYSandboxController'; new C();", 'controller import/export'],
    ["import * as controller from './canarySandboxController';", 'controller import/export'],
    ["import('./CANARYSANDBOXCONTROLLER');", 'dynamic controller import'],
    ["import { runWithCanarySpendGuard as enable } from './canarySpendGuard'; enable();", 'model driver scope'],
    ["import * as guard from './canarySpendGuard'; guard.runWithCanarySpendGuard();", 'model driver scope'],
    ["new CanarySandboxController();", 'controller construction'],
    ["db.collection('benchmark_canary_authorities').doc('synthetic').set({enabled:true});", 'authority collection outside guard'],
  ])('detects controlled forbidden production source: %s', (text, violation) => {
    expect(couldContain(text, ['canarySandboxController', 'runWithCanarySpendGuard', 'benchmark_canary_authorities'])).toBe(true);
    const file = ts.createSourceFile('synthetic.ts', text, ts.ScriptTarget.Latest, true);
    expect(dormantReferences(file, 'synthetic.ts').violations).toContain(`synthetic.ts: ${violation}`);
  });

  it('keeps every explicit production resume caller bound to the owned workspace store, not a request ID', () => {
    const sites: string[] = [];
    for (const path of candidates(['ensureWorkspace'])) {
      const file = parse(path);
      walk(file, node => {
        if (!ts.isCallExpression(node) || node.arguments.length < 3) return;
        if (member(node.expression)?.name !== 'ensureWorkspace') return;
        sites.push(path);
        expect(node.arguments[0].getText(file), path).toBe('workspaceId');
        expect(node.arguments[2].getText(file), path).toBe('resumeSandboxId');
        const initializer = localInitializer(node, 'resumeSandboxId');
        expect(initializer, path).toBeDefined();
        expect(compact(initializer!, file), path).toBe('sandboxResumeEnabled()?(awaitsandboxStore.get(workspaceId).catch(()=>null))??undefined:undefined');
      });
    }
    expect(sites).toEqual(Array(3).fill('src/server/routes/agentv3.ts'));
  });
  it('requires review for any new explicit identity record writer and keeps the existing one server-derived', () => {
    const writers: string[] = [];
    for (const path of candidates(['sandboxStore'])) {
      const file = parse(path);
      const aliases = new Set(['sandboxStore']);
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
          if ((specifier.propertyName ?? specifier.name).text === 'sandboxStore') aliases.add(specifier.name.text);
        }
      }
      walk(file, node => {
        if (!ts.isCallExpression(node)) return;
        const call = member(node.expression);
        if (call?.name !== 'record' || !aliases.has(call.receiver.getText(file))) return;
        writers.push(path);
        expect(node.arguments.map(arg => arg.getText(file)), path).toEqual(['workspaceId', 'userId', 'sbId']);
        const initializer = localInitializer(node, 'sbId');
        expect(initializer, path).toBeDefined();
        expect(compact(initializer!, file), path).toBe("awaitraceTimeout(actuator.getSandboxId(workspaceId),5_000,'getSandboxId').catch(()=>null)");
      });
    }
    expect(writers).toEqual(['src/server/routes/agentv3.ts']);
  });
  it('keeps the isolated controller away from normal identity persistence and public native handles', () => {
    const file = parse('src/server/AgentV3/reliability/canarySandboxController.ts');
    const forbidden = new Set(['sandboxStore', 'SandboxStore', 'getSandboxId', 'getPortUrl']);
    let privateConstructorIds = 0;
    const violations: string[] = [];
    walk(file, node => {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) violations.push(node.getText(file));
      if (ts.isIdentifier(node) && node.text === 'sandboxId') {
        // The only native-ID spelling is the validated, private SDK constructor argument.
        expect(ts.isPropertyAssignment(node.parent)).toBe(true);
        const property = node.parent as ts.PropertyAssignment;
        expect(property.name).toBe(node);
        expect(property.initializer.getText(file)).toBe('data.sandboxID');
        const object = property.parent;
        expect(ts.isObjectLiteralExpression(object)).toBe(true);
        const constructor = object.parent;
        expect(ts.isNewExpression(constructor) && constructor.expression.getText(file) === 'Sandbox').toBe(true);
        let owner: ts.Node | undefined = constructor;
        while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
        expect(owner && ts.isFunctionDeclaration(owner) && owner.name?.text).toBe('createPinnedSandbox');
        expect(owner && ts.isFunctionDeclaration(owner) && owner.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).toBeFalsy();
        privateConstructorIds++;
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (node.moduleSpecifier.text.includes('SandboxStore')) violations.push(node.moduleSpecifier.text);
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'Handle') {
        expect(node.members.map(member => member.name?.getText(file))).toEqual(['execute', 'kill']);
      }
      if (ts.isClassDeclaration(node) && node.name?.text === 'CanarySandboxController') {
        const publicMethods = node.members.filter(ts.isMethodDeclaration).filter(method => !ts.isPrivateIdentifier(method.name));
        expect(publicMethods.map(method => method.name.getText(file))).toEqual(['start', 'tool', 'close']);
      }
    });
    expect(violations).toEqual([]);
    expect(privateConstructorIds).toBe(1);
  });
  it('cannot collide with a valid generated or authorized normal app workspace', () => {
    const canary = canaryWorkspaceId('synthetic-owner', 'synthetic-job', 'a'.repeat(64));
    expect(isWorkspaceId(canary)).toBe(false);
    expect(ownedByVerifiedUid('synthetic-owner', canary)).toBe(false);
    for (const uid of ['owner', 'anon', 'nbai_canary_v1_', 'x'.repeat(64)]) {
      for (const session of ['session', canary, 'nbai_canary_v1_', '123456']) {
        const normal = workspaceIdFor(uid, session);
        expect(isWorkspaceId(normal)).toBe(true);
        expect(isCanaryWorkspace(normal)).toBe(false);
        expect(normal).not.toBe(canary);
      }
    }
  });
});
