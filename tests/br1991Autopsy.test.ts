// BR1991 autopsy (owner t311u sequential audit). The report bytes for this number are NOT retained: the
// registry row exists (number, outcome "stopped") but the history document it points to is gone, so
// `get_build_report` returns "not found in retained storage" and nothing about the build itself can be
// read. No code was changed. These tests pin the facts the ledger's explanation rests on, so that if any
// of them changes the BR1991 ledger is revisited instead of silently going stale:
//  E1. A numbered report always had saved bytes: the registry row and the history document are written in
//      ONE transaction (covered in tests/buildReportRegistry.test.ts; re-pinned here at the source).
//  E2. The one in-repo path that removes a RECENT report is the user deleting that build's chat: the
//      conversation DELETE route's GA-1 cascade (`purgeWorkspace`) calls `deleteDiagnostics`, which
//      deletes the workspace's history documents and its latest-report document, and leaves the registry
//      row, so the number stays reserved and the list shows it as not retained.
//  E3. The other removal paths cannot explain a report a few days old: history retention is 180 days on
//      `savedAt` with a strict "< cutoff" bound, and account erasure of workspace stores refuses every uid
//      (ownership unverified), so it deletes nothing.
// Synthetic ids only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { purgeWorkspace } from '../src/server/AgentV3/WorkspaceManager';
import { SUBCOLLECTION_RETENTION_POLICIES } from '../src/server/lib/DataRetentionManager';
import { planWorkspaceErase, eraseableWorkspaceId } from '../src/server/lib/workspaceDataErase';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('E1 — a numbered report always had saved bytes', () => {
  it('the registry row and the history document are committed in the same transaction', () => {
    const src = read('src/server/AgentV3/diagnosticsHistoryPersistence.ts');
    const body = src.slice(src.indexOf('export async function commitDiagnosticsHistory'));
    const tx = body.slice(body.indexOf('await db.runTransaction'));
    expect(tx).toMatch(/applyRegistryPlan\(tx,/);
    expect(tx).toMatch(/tx\.set\(historyRef, \{ report,/);
    expect(tx.indexOf('applyRegistryPlan(tx,')).toBeLessThan(tx.indexOf('tx.set(historyRef'));
  });
});

describe('E2 — deleting a build\'s chat removes its report and keeps its number', () => {
  it('purgeWorkspace calls deleteDiagnostics with the same workspace id, after the conversation', async () => {
    const calls: string[] = [];
    const rec = (name: string) => async (id: string) => { calls.push(`${name}:${id}`); };
    const res = await purgeWorkspace({
      removeConversation: rec('conversation'), purgeFiles: rec('files'), deletePlan: rec('plan'),
      deleteMemory: rec('memory'), deleteDiagnostics: rec('diagnostics'), releaseDeployment: rec('deployment'),
    }, 'agentv3-synthetic-ws');
    expect(res.ok).toBe(true);
    expect(calls).toContain('diagnostics:agentv3-synthetic-ws');
    expect(calls.indexOf('conversation:agentv3-synthetic-ws')).toBeLessThan(calls.indexOf('diagnostics:agentv3-synthetic-ws'));
  });

  it('the conversation DELETE route wires the real deleteDiagnostics into the cascade', () => {
    const src = read('src/server/routes/agentv3.ts');
    expect(src).toMatch(/import \{[^}]*\bdeleteDiagnostics\b[^}]*\} from '\.\.\/AgentV3\/DiagnosticsStore'/);
    const cascade = src.slice(src.indexOf('GA-1 — cascade purge'), src.indexOf('GA-1 — cascade purge') + 1200);
    expect(cascade).toContain('deleteDiagnostics: deleteDiagnostics,');
  });

  it('deleteDiagnostics deletes the history documents and the latest-report document, not the registry row', () => {
    const src = read('src/server/AgentV3/DiagnosticsStore.ts');
    const fn = src.slice(src.indexOf('export async function deleteDiagnostics'), src.indexOf('export async function saveDiagnostics'));
    expect(fn).toContain("root.collection('history')");
    expect(fn).toContain('batch.delete(d.ref)');
    expect(fn).toContain('await root.delete()');
    expect(fn).not.toMatch(/build_report_numbers|registryRef/);
  });
});

describe('E3 — retention and account erasure cannot explain a recent missing report', () => {
  it('history retention is 180 days on savedAt (epoch ms)', () => {
    const p = SUBCOLLECTION_RETENTION_POLICIES.filter((x) => x.parent === 'workspace_diagnostics_v3' && x.subcollection === 'history');
    expect(p).toEqual([expect.objectContaining({ ttlDays: 180, timestampField: 'savedAt', timestampKind: 'epochMs' })]);
  });

  it('account erasure of workspace stores refuses every uid, so it deletes no report', () => {
    for (const uid of ['synthUid123', 'abc', 'abc-d']) {
      expect(planWorkspaceErase(uid).range).toBeNull();
      expect(eraseableWorkspaceId(uid, `agentv3-${uid}-session1`)).toBe(false);
    }
  });
});
