// CHANGE ENGINE slice 6 (2026-10-04) — the security findings the tech-debt register collected on every
// build (and nothing ever read back) become owned issues the next edit sees. A finding in a file this build
// never analysed is UNSEEN, not fixed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { foldSettle, securityFindings, type ChangeSession } from '../src/server/AgentV3/changeEngine/changeSession';
import { emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { classifyChange } from '../src/server/AgentV3/changeEngine/changeClassifier';

function session(): ChangeSession {
  return {
    workspaceId: 'w', isEdit: true, classification: classifyChange('fix it'), summary: '', requested: [], declined: [], requestedLabels: [],
    regressionTargets: [], assignedIssueIds: [], probes: new Map(), priorSpec: { items: [], nextReq: 1 },
  };
}
const leak = { severity: 'high', rule: 'hardcoded-secret', message: 'API key hardcoded in client code', file: 'src/lib/api.ts' };

describe('security findings in the issue queue', () => {
  it('high is an error, medium a warning, low is advice and stays out', () => {
    const f = securityFindings([leak, { ...leak, severity: 'medium', rule: 'x' }, { ...leak, severity: 'low', rule: 'y' }]);
    expect(f.map((x) => [x.code, x.severity])).toEqual([['SECURITY:hardcoded-secret', 'error'], ['SECURITY:x', 'warning']]);
    expect(f[0].file).toBe('src/lib/api.ts');
  });

  it('becomes an owned issue, and the secret-looking text is redacted', () => {
    const withKey = { ...leak, message: 'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA in client' };
    const { mem } = foldSettle(emptyMemory(), session(), { ok: true, stopped: false, gate: 'green', files: [], issues: [], security: [withKey], securityScanned: ['src/lib/api.ts'] }, 1);
    expect(mem.queue.issues[0]).toMatchObject({ id: 'ISS-001', status: 'triaged', severity: 'error', file: 'src/lib/api.ts' });
    expect(mem.queue.issues[0].message).not.toMatch(/sk-ant/);
  });

  it('cleared only when this build actually analysed that file', () => {
    let mem = foldSettle(emptyMemory(), session(), { ok: true, stopped: false, gate: 'green', files: [], issues: [], security: [leak], securityScanned: ['src/lib/api.ts'] }, 1).mem;
    const unseen = foldSettle(mem, session(), { ok: true, stopped: false, gate: 'green', files: [], issues: [], security: [], securityScanned: ['src/App.tsx'] }, 2).mem;
    expect(unseen.queue.issues[0].status).toBe('triaged');
    mem = foldSettle(mem, session(), { ok: true, stopped: false, gate: 'green', files: [], issues: [], security: [], securityScanned: ['src/lib/api.ts'] }, 2).mem;
    expect(mem.queue.issues[0].status).toBe('fixed');
  });

  it('the route hands the security findings and the scanned files to settle', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/security: \(\(\) => \{ try \{ return getWorkspaceMemory\(workspaceId\)\.appSecurityFindings\(\);/);
    expect(src).toMatch(/securityScanned: \(\(\) => \{ try \{ return getWorkspaceMemory\(workspaceId\)\.graph\(\)\.files;/);
  });
});
