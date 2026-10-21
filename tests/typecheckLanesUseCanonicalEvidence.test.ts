import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Wiring guard only. TscGate's executable tests cover output classification; this prevents either
// production lane from drifting back to a zero-diagnostics or zero-exit-code shortcut.
const text = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('agentv3.ts', text, ts.ScriptTarget.Latest, true);
function bodyOf(name: string): string {
  let body: string | undefined;
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name &&
        node.initializer && ts.isArrowFunction(node.initializer)) body = node.initializer.body.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!body) throw new Error(`Missing production reader ${name}`);
  return body;
}

describe('production typecheck lanes use canonical evidence', () => {
  it('fast verification rejects unknown/not-run output but retains its additional success marker', () => {
    const body = bodyOf('fastVerifyOnce');
    expect(body).toContain('const verdict = tscVerdict(out);');
    expect(body).toContain("if (looksLikeBrokenTscInstall(out)) return { ok: true, errors: '', ran: false }");
    expect(body).toContain("const hasErrors = verdict === 'failed';");
    expect(body).toContain("if (verdict !== 'passed' || !out.includes('__TSC_CLEAN__'))");
    expect(body.indexOf("if (verdict !== 'passed' || !out.includes('__TSC_CLEAN__'))")).toBeGreaterThan(body.indexOf('cssConsistencyError(project)'));
    expect(body).not.toContain("if (verdict === 'not-run' || verdict === 'unknown') return");
  });

  it('the agentic lane cannot call unknown setup output verified', () => {
    const body = bodyOf('runTsc');
    expect(body).toContain('const verdict = tscVerdict(out);');
    expect(body).toContain("if (verdict === 'not-run' || verdict === 'unknown') return { ok: true, verified: false, errors: '' }");
    expect(body).toContain("return verdict === 'failed'");
    expect(body).not.toContain('tscNeverRan(out)');
    expect(body).not.toContain('hasTscErrors(out)');
  });
});
