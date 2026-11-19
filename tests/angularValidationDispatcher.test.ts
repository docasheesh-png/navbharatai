import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { angularValidationPlan } from '../src/server/AgentV3/angularValidation';
import { agentRunEvidence } from '../src/server/AgentV3/agentRunEvidence';
import * as previewCompiler from '../src/server/runtime/PreviewCompileCheck';

const NATIVE_COMMAND = angularValidationPlan('angular')!.command;
const COMPLETE = 'Application bundle generation complete. [3.417 seconds]\nOutput location: /app/dist/app';
const COMPONENT = "import { Component } from '@angular/core';\n@Component({ selector: 'app-root', standalone: true, template: `<p>{{ picked()?.type === 'colour' && picked()?.colour }}</p>` })\nexport class AppComponent { picked() { return { type: 'colour' } as { type: 'colour'; colour: string } | { type: 'number'; number: number }; } }";
type Receipt = { exitCode: number; stdout: string; stderr: string };

class AngularActuator implements ActuatorPort {
  ensureDependencies?: ActuatorPort['ensureDependencies'];
  files = new Map<string, string>([
    ['tsconfig.json', '{"compilerOptions":{"strict":true},"angularCompilerOptions":{"strictTemplates":true}}'],
    ['package.json', '{"dependencies":{"@angular/core":"18.2.21"},"scripts":{"build":"ng build"}}'],
    ['angular.json', '{"projects":{"app":{"architect":{"build":{"options":{"tsConfig":"tsconfig.json"}}}}}}'],
    ['src/main.ts', COMPONENT],
  ]);
  commands: string[] = [];
  native: Receipt | Error = { exitCode: 0, stdout: COMPLETE, stderr: '' };
  tsc: Receipt = { exitCode: 0, stdout: '', stderr: '' };
  async readFile(_workspace: string, path: string): Promise<string> {
    const file = this.files.get(path);
    if (file === undefined) throw new Error(`ENOENT: ${path}`);
    return file;
  }
  async writeFile(_workspace: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_workspace: string, command: string): Promise<Receipt> {
    this.commands.push(command);
    if (command === NATIVE_COMMAND) {
      if (this.native instanceof Error) throw this.native;
      return this.native;
    }
    if (/\btsc\b/.test(command)) return this.tsc;
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(): Promise<string> { return 'https://sandbox.example.test'; }
}

let nextWorkspace = 0;
function harness(framework = 'angular') {
  const actuator = new AngularActuator();
  const events = new AgentEventStream();
  const recorded: Array<{ command: string; exitCode: number | null; stdout: string; stderr: string }> = [];
  const dispatcher = new ToolDispatcher(
    actuator, `angular-native-${++nextWorkspace}`, new WorkspaceState(events), events,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, framework,
    (receipt) => recorded.push(receipt),
  );
  return { actuator, dispatcher, recorded };
}
const typecheck = (dispatcher: ToolDispatcher) => dispatcher.dispatch({ id: 'native-typecheck', name: 'typecheck', input: {} }, 'architect');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('the dispatcher uses Angular validation, not a clean tsc as template proof', () => {
  it.each([
    "NG5002: Parser Error: Unexpected token ')' in [!wallet.txns.some((t) => t.note === 'demo')]",
    "NG9: Property 'colour' does not exist on type 'BetTarget'.",
    "TS2339: Property 'number' does not exist on type 'BetTarget'.",
  ])('returns the native failure after plain TypeScript can parse the component: %s', async (diagnostic) => {
    const { actuator, dispatcher, recorded } = harness();
    actuator.native = { exitCode: 1, stdout: `✘ [ERROR] ${diagnostic} [plugin angular-compiler]`, stderr: '' };
    const result = await typecheck(dispatcher);
    expect(result.content).toContain('Angular build failed');
    expect(result.content).toContain(diagnostic);
    expect(result.content).not.toContain('type-checks clean');
    expect(dispatcher.lastKnownTypeErrors()).toBeGreaterThan(0);
    expect(recorded.find((r) => r.command === NATIVE_COMMAND)).toMatchObject(actuator.native);
    expect(agentRunEvidence(recorded).typecheck).toBe('failed');
  });

  it('reports the native completion and records its unpiped exit, without claiming runtime proof', async () => {
    const { actuator, dispatcher, recorded } = harness();
    const result = await typecheck(dispatcher);
    expect(result.content).toContain('Angular build completed successfully');
    expect(result.content).toContain('live preview and user journeys still need verification');
    expect(recorded.filter((r) => r.command === NATIVE_COMMAND)).toHaveLength(1);
    expect(recorded.find((r) => r.command === NATIVE_COMMAND)?.exitCode).toBe(0);
    expect(dispatcher.lastKnownTypeErrors()).toBe(0);
    expect(agentRunEvidence(recorded).typecheck).toBe('passed');
    expect(actuator.commands.some((command) => /\btsc\b/.test(command))).toBe(false);
  });

  it('syncs dependencies before the native build when the actuator supports it', async () => {
    const { actuator, dispatcher } = harness();
    actuator.ensureDependencies = vi.fn(async () => {
      expect(actuator.commands).not.toContain(NATIVE_COMMAND);
      return { ok: true, ran: true, log: 'dependencies installed' };
    });
    expect((await typecheck(dispatcher)).content).toContain('Angular build completed successfully');
    expect(actuator.ensureDependencies).toHaveBeenCalledTimes(1);
  });

  it('failed dependency preparation does not invent a native command or completion', async () => {
    const { actuator, dispatcher, recorded } = harness();
    actuator.ensureDependencies = vi.fn(async () => ({ ok: false, ran: true, log: 'dependency sync failed' }));
    const result = await typecheck(dispatcher);
    expect(result.content).toContain('remain unverified');
    expect(result.content).toContain('dependency preparation failed');
    expect(actuator.commands).not.toContain(NATIVE_COMMAND);
    expect(recorded.some((receipt) => receipt.command === NATIVE_COMMAND)).toBe(false);
  });

  it.each([
    { exitCode: 127, stdout: '', stderr: '/bin/bash: ./node_modules/.bin/ng: No such file or directory' },
    { exitCode: 0, stdout: 'Building...', stderr: '' },
    new Error('typecheck-angular timed out after 90000ms'),
  ])('cannot promote missing CLI, incomplete output or timeout into a native pass: %s', async (native) => {
    const { actuator, dispatcher, recorded } = harness();
    actuator.native = native;
    const result = await typecheck(dispatcher);
    expect(result.content).toContain('remain unverified');
    expect(result.content).not.toContain('completed successfully');
    expect(result.content).not.toContain('type-checks clean');
    expect(dispatcher.lastKnownTypeErrors()).toBeNull();
    expect(recorded.filter((r) => r.command === NATIVE_COMMAND)).toHaveLength(1);
    expect(agentRunEvidence(recorded).typecheck).toBeUndefined();
  });

  it('lets Angular resolve a custom tsconfig instead of requiring a root tsconfig.json', async () => {
    const { actuator, dispatcher } = harness();
    actuator.files.delete('tsconfig.json');
    actuator.files.set('tsconfig.app.json', '{"compilerOptions":{"strict":true}}');
    actuator.files.set('angular.json', '{"projects":{"app":{"architect":{"build":{"options":{"tsConfig":"tsconfig.app.json"}}}}}}');
    const result = await typecheck(dispatcher);
    expect(actuator.commands).toContain(NATIVE_COMMAND);
    expect(result.content).toContain('Angular build completed successfully');
  });

  it('leaves the React typecheck path unchanged', async () => {
    const { actuator, dispatcher } = harness('vite-react');
    actuator.files.set('src/main.ts', 'export const value: number = 1;');
    const result = await typecheck(dispatcher);
    expect(result.content).toContain('type-checks clean (tsc --noEmit)');
    expect(actuator.commands).not.toContain(NATIVE_COMMAND);
  });

  it('the actual write response scopes a successful tsc check to TypeScript', async () => {
    vi.stubEnv('AGENTV3_WRITE_TYPECHECK', 'on');
    const { actuator, dispatcher } = harness();
    const result = await dispatcher.dispatch({ id: 'write-angular', name: 'write_file', input: { path: 'src/app/helpers.ts', content: 'export const amount: number = 1;' } }, 'architect');
    expect(result.content).toContain('tsc reported no TypeScript errors');
    expect(result.content).toContain('Angular templates, build configuration and assets have not been validated');
    expect(result.content).not.toContain('whole project compiles');
    expect(actuator.commands).not.toContain(NATIVE_COMMAND);
  });
});

describe('the two Babel readers respect preview applicability', () => {
  it.each([['angular', 0], ['vite-react', 1]] as const)('evaluate selects the correct compiler lane for %s', async (framework, expectedCalls) => {
    const check = vi.spyOn(previewCompiler, 'checkPreviewCompiles');
    const { dispatcher } = harness(framework);
    await dispatcher.dispatch({ id: 'evaluate-angular', name: 'evaluate', input: {} }, 'reviewer');
    expect(check).toHaveBeenCalledTimes(expectedCalls);
  });

  it('both final-route Babel calls remain enclosed by the framework applicability guard', () => {
    const source = ts.createSourceFile('agentv3.ts', readFileSync('src/server/routes/agentv3.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let checked = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'checkPreviewCompiles') {
        checked++;
        let parent: ts.Node | undefined = node.parent;
        let guarded = false;
        while (parent) {
          if (ts.isIfStatement(parent) && /admitPreviewCompileCheck\(|previewCompileSupport\.applicable/.test(parent.expression.getText(source))) guarded = true;
          parent = parent.parent;
        }
        expect(guarded, node.getText(source)).toBe(true);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(checked).toBe(2);
  });
});
