import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { assertCanaryPrivateDataAllowed, assertNotCanaryWorkspace, canaryWorkspaceId, currentCanaryIsolation, isCanaryWorkspace, runWithCanaryIsolation } from './canaryIsolation';

const fixtureHash = 'a'.repeat(64);
function binding(uid = 'synthetic-owner', jobId = 'synthetic-job') {
  return { uid, jobId, fixtureHash, workspaceId: canaryWorkspaceId(uid, jobId, fixtureHash) };
}
describe('dormant canary isolation', () => {
  it('keeps ordinary workspace and private read behavior unchanged without scope', () => {
    expect(currentCanaryIsolation()).toBeUndefined();
    expect(() => assertCanaryPrivateDataAllowed()).not.toThrow();
    for (const id of ['ordinary', 'abc-123', 'nbi_canary', undefined]) expect(() => assertNotCanaryWorkspace(id)).not.toThrow();
  });
  it('derives disjoint immutable owner/job/fixture identities, never a client marker', () => {
    const a = binding();
    expect(a.workspaceId).toMatch(/^nbai_canary_v1_[a-f0-9]{64}$/);
    expect(a.workspaceId).not.toBe(binding('other-owner').workspaceId);
    expect(a.workspaceId).not.toBe(binding('synthetic-owner', 'other-job').workspaceId);
    expect(a.workspaceId).not.toBe(canaryWorkspaceId(a.uid, a.jobId, 'b'.repeat(64)));
    runWithCanaryIsolation(a, () => {
      const captured = currentCanaryIsolation();
      a.uid = 'mutated';
      expect(captured?.uid).toBe('synthetic-owner');
      expect(Object.isFrozen(captured)).toBe(true);
    });
  });
  it('refuses foreign workspace bindings, noncanonical inputs and nested replacement', () => {
    const a = binding();
    expect(() => runWithCanaryIsolation({ ...a, uid: 'other-owner' }, () => {})).toThrow();
    expect(() => runWithCanaryIsolation({ ...a, workspaceId: a.workspaceId.toUpperCase() }, () => {})).toThrow();
    expect(() => canaryWorkspaceId(' owner ', a.jobId, fixtureHash)).toThrow();
    expect(() => canaryWorkspaceId(a.uid, '../job', fixtureHash)).toThrow();
    expect(() => canaryWorkspaceId(a.uid, a.jobId, fixtureHash.toUpperCase())).toThrow();
    expect(() => runWithCanaryIsolation(a, () => runWithCanaryIsolation(binding(), () => {}))).toThrow();
  });
  it('rejects reserved namespaces and malformed aliases outside ALS too', () => {
    const id = binding().workspaceId;
    for (const alias of [id, id.toUpperCase(), ` ${id} `, 'nbai_canary_v1_', 'NBAI_CANARY_V1_bad']) {
      expect(isCanaryWorkspace(alias)).toBe(true);
      expect(() => assertNotCanaryWorkspace(alias)).toThrow();
    }
  });
  it('propagates isolation to asynchronous work without contaminating sibling requests', async () => {
    await Promise.all([
      runWithCanaryIsolation(binding(), async () => {
        await Promise.resolve();
        expect(() => assertCanaryPrivateDataAllowed()).toThrow();
        expect(currentCanaryIsolation()?.workspaceId).toBe(binding().workspaceId);
      }),
      Promise.resolve().then(() => expect(() => assertCanaryPrivateDataAllowed()).not.toThrow()),
    ]);
  });
  // Actual private-reader integration is deliberately NOT part of this dormant slice.
  it('fences normal actuator acquisition and both held/cross-worker keepalive doors before mutations', () => {
    const path = resolve(__dirname, '../sandbox/EngineerAI/actuators/E2BActuator.ts');
    const source = readFileSync(path, 'utf8');
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const bodies = new Map<string, ts.Block>();
    function visit(node: ts.Node) {
      if (ts.isMethodDeclaration(node) && node.body) bodies.set(node.name.getText(file), node.body);
      ts.forEachChild(node, visit);
    }
    visit(file);
    for (const name of ['getSandbox', '_createSandbox', 'noteUserActivity', '_extendLifetime']) {
      const body = bodies.get(name)!;
      expect(body, name).toBeDefined();
      expect(body.statements[0].getText(file), name).toBe("assertCanaryLegacyAllowed('sandbox-infrastructure');");
      expect(body.statements[1].getText(file), name).toBe('assertNotCanaryWorkspace(workspaceId);');
    }
  });
});
