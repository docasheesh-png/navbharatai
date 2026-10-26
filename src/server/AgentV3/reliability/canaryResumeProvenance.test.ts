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
function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
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

describe('reviewed canary native-identity containment', () => {
  it('keeps controller, model driver and authority issuance unreachable from production callers', () => {
    const scopeCalls: string[] = [];
    const authorityCollections: string[] = [];
    for (const path of files('src/server')) {
      const file = parse(path);
      walk(file, node => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const source = node.moduleSpecifier;
          if (source && ts.isStringLiteral(source)) expect(source.text, path).not.toMatch(/canarySandboxController/);
        }
        if (ts.isNewExpression(node)) expect(node.expression.getText(file), path).not.toBe('CanarySandboxController');
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(file);
          expect(callee, path).not.toBe('runWithCanarySpendGuard');
          if (callee === 'runWithCanaryIsolation') scopeCalls.push(path);
          if (callee === 'import' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            expect(node.arguments[0].text, path).not.toMatch(/canarySandboxController/);
          }
        }
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node))
          && node.text.includes('benchmark_canary_authorities')) authorityCollections.push(path);
      });
    }
    expect(scopeCalls).toEqual(['src/server/AgentV3/reliability/canarySandboxController.ts']);
    // The only authority collection reference is the guard's validated path builder;
    // it reads authority documents, writes only ledger/attempt descendants, and issues none.
    expect([...new Set(authorityCollections)]).toEqual(['src/server/AgentV3/reliability/canarySpendGuard.ts']);
  });

  it('keeps every explicit production resume caller bound to the owned workspace store, not a request ID', () => {
    const sites: string[] = [];
    for (const path of files('src/server')) {
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
    for (const path of files('src/server')) {
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
    walk(file, node => {
      if (ts.isIdentifier(node)) expect(forbidden.has(node.text), node.getText(file)).toBe(false);
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
        expect(node.moduleSpecifier.text).not.toMatch(/SandboxStore/);
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'Handle') {
        expect(node.members.map(member => member.name?.getText(file))).toEqual(['execute', 'kill']);
      }
      if (ts.isClassDeclaration(node) && node.name?.text === 'CanarySandboxController') {
        const publicMethods = node.members.filter(ts.isMethodDeclaration).filter(method => !ts.isPrivateIdentifier(method.name));
        expect(publicMethods.map(method => method.name.getText(file))).toEqual(['start', 'tool', 'close']);
      }
    });
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
