import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isBuildReviewProviderEligible } from './surplusReviewEligibility';

describe('post-build review provider eligibility', () => {
  it.each(['GLM', 'KIMI', 'glm', 'kimi'])('preserves %s legacy eligibility with or without Surplus', provider => {
    expect(isBuildReviewProviderEligible(provider, false)).toBe(true);
    expect(isBuildReviewProviderEligible(provider, true)).toBe(true);
  });
  it.each(['SURPLUS', 'surplus'])('requires an admitted active session for %s', provider => {
    expect(isBuildReviewProviderEligible(provider, false)).toBe(false);
    expect(isBuildReviewProviderEligible(provider, true)).toBe(true);
  });
  it.each([undefined, null, '', 'CLAUDE', 'CLAUDE_OPUS', 'VERTEX', 'GEMINI', 'other', 'SURPLUS-other'])('does not widen eligibility to %s', provider => {
    expect(isBuildReviewProviderEligible(provider, false)).toBe(false);
    expect(isBuildReviewProviderEligible(provider, true)).toBe(false);
  });
  it('the real escalation gate uses the predicate and retains its judge/attempt guards', () => {
    const source = ts.createSourceFile('agentv3.ts', readFileSync(new URL('../routes/agentv3.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations: ts.VariableDeclaration[] = [];
    const guards: ts.IfStatement[] = [];
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'deliveredCheap') declarations.push(node);
      if (ts.isIfStatement(node) && node.expression.getText(source).includes('!deliveredCheap')) guards.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(declarations).toHaveLength(1);
    const initializer = declarations[0].initializer;
    expect(initializer && ts.isCallExpression(initializer)).toBe(true);
    if (!initializer || !ts.isCallExpression(initializer)) throw new Error('Route bypasses provider eligibility helper');
    expect(initializer.expression.getText(source)).toBe('isBuildReviewProviderEligible');
    expect(initializer.arguments.map(arg => arg.getText(source).replace(/\s+/g, '')))
      .toEqual(['dominantProvider(providerTurns)', '!!surplusSession']);
    expect(guards).toHaveLength(1);
    expect(guards[0].expression.getText(source).replace(/\s+/g, ''))
      .toBe('!judgeOn||lastAttempt!==1||!deliveredCheap');
    expect(guards[0].thenStatement.getText(source)).toBe('return base;');
  });
});
