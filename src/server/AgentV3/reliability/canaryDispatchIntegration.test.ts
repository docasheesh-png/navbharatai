import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock('./canarySpendGuard', () => ({ assertCanaryLegacyAllowed: mock.guard }));
import { assertLegacyInferenceAllowed, runWithSurplusBuild } from '../../AI/inferencePolicy';
import { assertNoUnclaimedGatewayDispatch, runWithGatewaySelection } from '../../AI/InferenceGateway/dispatchBoundary';
import { createSurplusBuildTransport } from '../../AI/SurplusRegistry/transport';
const source = (path: string) => readFileSync(resolve(__dirname, '../../../..', path), 'utf8');
beforeEach(() => { mock.guard.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe('canary dispatch boundaries', () => {
  it.each(['image-generation', 'image-edit', 'image-enhancement', 'vision', 'vision-description', 'builder-claude', 'direct-text-provider', 'paid-web-search', 'builder-GeminiToolRunner'])('does not inherit a legacy exemption for %s', capability => {
    mock.guard.mockImplementation(() => { throw Error('canary denied'); });
    expect(() => runWithSurplusBuild(true, () => assertLegacyInferenceAllowed(capability))).toThrow('canary denied');
  });
  it.each(['embedding', 'image-generation'])('also fences gateway-only callers of %s', capability => {
    mock.guard.mockImplementation(() => { throw Error('canary denied'); });
    expect(() => runWithGatewaySelection(true, () => assertNoUnclaimedGatewayDispatch(capability))).toThrow('canary denied');
  });
  it('checks a previously constructed Surplus transport on each dispatch before HTTP', async () => {
    const fetcher = vi.fn();
    const transport = createSurplusBuildTransport({ AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: 'synthetic-test-key' }, fetcher);
    mock.guard.mockImplementation(() => { throw Error('canary denied'); });
    await expect(transport({}, new AbortController().signal)).rejects.toThrow('canary denied');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('canary physical transport census', () => {
  it('wraps every OpenAI construction in the four admitted builder factories, not only the call-site label', () => {
    const paths = ['src/server/routes/agentv3.ts', 'src/server/AgentV3/weakBuildAdmissionAsk.ts', 'src/server/AgentV3/clarityJudgeAsk.ts'];
    let count = 0;
    for (const path of paths) {
      const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node) && node.expression.getText(file) === 'OpenAI') {
          count++;
          const config = node.arguments?.[0];
          expect(config && ts.isObjectLiteralExpression(config), path).toBe(true);
          const properties = (config as ts.ObjectLiteralExpression).properties;
          expect(properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'fetch' && p.initializer.getText(file) === 'canaryFetch()'), path).toBe(true);
          expect(properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'maxRetries' && p.initializer.getText(file) === '0'), path).toBe(true);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(count).toBe(4);
  });
  it('requires review when any new SDK construction appears anywhere in the builder tree', () => {
    const walk = (directory: string): string[] => readdirSync(resolve(__dirname, '../../../..', directory), { withFileTypes: true }).flatMap(entry => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? walk(path) : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
    });
    const census: string[] = [];
    for (const path of [...walk('src/server/AgentV3'), 'src/server/routes/agentv3.ts']) {
      const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
      const sdkNames = new Set(['OpenAI', 'Anthropic', 'GoogleGenAI', 'Cls']);
      for (const node of file.statements) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
          && ['openai', '@anthropic-ai/sdk', '@google/genai'].includes(node.moduleSpecifier.text)) {
          if (node.importClause?.name) sdkNames.add(node.importClause.name.text);
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) sdkNames.add(item.name.text);
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node) && sdkNames.has(node.expression.getText(file))) census.push(`${path}:${node.expression.getText(file)}`);
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(census.sort()).toEqual([
      'src/server/AgentV3/ClaudeClient.ts:Anthropic',
      'src/server/AgentV3/EmbeddingSearch.ts:Cls',
      'src/server/AgentV3/clarityJudgeAsk.ts:OpenAI',
      'src/server/AgentV3/weakBuildAdmissionAsk.ts:OpenAI',
      'src/server/routes/agentv3.ts:OpenAI',
      'src/server/routes/agentv3.ts:OpenAI',
    ].sort());
  });
  it('keeps guards at selected gateway invocation and both sandbox acquisition doors', () => {
    const gateway = source('src/server/AI/InferenceGateway/runtime.ts');
    expect(gateway).toMatch(/async function runGatewayInvocation\([^]*?\{\s*assertCanaryLegacyAllowed\('inference-gateway'\)/);
    const sandbox = source('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    for (const method of ['getSandbox', '_createSandbox']) {
      expect(sandbox).toMatch(new RegExp(`private async ${method}\\([^]*?Promise<Sandbox> \\{\\s*assertCanaryLegacyAllowed\\('sandbox-infrastructure'\\)`));
    }
    expect(sandbox).toMatch(/noteUserActivity\(workspaceId: string\): boolean \{\s*assertCanaryLegacyAllowed\('sandbox-infrastructure'\)/);
    expect(sandbox).toMatch(/private _extendLifetime\([^]*?: void \{\s*assertCanaryLegacyAllowed\('sandbox-infrastructure'\)/);
    expect(source('src/server/AgentV3/clarityJudgeAsk.ts')).toContain("assertCanaryLegacyAllowed('clarity-judge')");
  });
});


it('denies every function tool before dispatch, secrets, events or recursive signal handling', () => {
  expect(source('src/server/AgentV3/ToolDispatcher.ts')).toMatch(/async dispatch\(call: ToolUse[^]*?Promise<ToolResult> \{\s*assertCanaryLegacyAllowed\('builder-function-tools'\)/);
});
