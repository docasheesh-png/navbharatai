// CHANGE ENGINE slice 7 (2026-10-04) — the user's view of their app's memory. Plain words, real statuses,
// and never a vendor, a model id or an internal code.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicAppMemory } from '../src/server/AgentV3/changeEngine/publicView';
import { emptyMemory, type EngineeringMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { hasProviderLeak } from '../src/server/lib/providerRedaction';

function mem(): EngineeringMemory {
  const m = emptyMemory();
  m.spec = {
    nextReq: 6,
    items: [
      { id: 'REQ-001', feature: 'add', label: 'Add / create', status: 'verified', firstChange: 'CHG-0001', lastChange: 'CHG-0001' },
      { id: 'REQ-002', feature: 'delete', label: 'Delete / remove', status: 'regressed', firstChange: 'CHG-0001', lastChange: 'CHG-0002' },
      { id: 'REQ-003', feature: 'label:coupon-codes', label: 'Coupon codes', status: 'built', firstChange: 'CHG-0002', lastChange: 'CHG-0002', probeable: false },
      { id: 'REQ-004', feature: 'search', label: 'Search', status: 'requested', firstChange: 'CHG-0002', lastChange: 'CHG-0002' },
      { id: 'REQ-005', feature: 'auth', label: 'Login', status: 'dropped', firstChange: 'CHG-0001', lastChange: 'CHG-0002' },
    ],
  };
  m.queue = {
    nextIss: 4,
    issues: [
      { id: 'ISS-001', key: 'a', code: 'RUNTIME_ERRORS_REMAIN', severity: 'error', message: 'TypeError in Cart', status: 'assigned', firstSeen: 1, lastSeen: 1, seenCount: 2, cleanPasses: 0, changes: [] },
      { id: 'ISS-002', key: 'b', code: 'X', severity: 'warning', message: 'claude-sonnet-4-6 timed out on GLM', status: 'triaged', firstSeen: 1, lastSeen: 1, seenCount: 2, cleanPasses: 0, changes: [] },
      { id: 'ISS-003', key: 'c', code: 'Y', severity: 'warning', message: 'fixed one', status: 'verified', firstSeen: 1, lastSeen: 1, seenCount: 1, cleanPasses: 2, changes: [] },
    ],
  };
  m.changes = [
    { id: 'CHG-0001', ts: 1, summary: 'a todo app', kind: 'feature', risk: 'medium', depth: 'standard', requirements: [], issues: [], files: [], status: 'completed', gate: 'green', regressed: [] },
    { id: 'CHG-0002', ts: 2, summary: 'make header blue with gemini', kind: 'micro-ui', risk: 'low', depth: 'light', requirements: [], issues: [], files: [], status: 'partial', gate: 'yellow', regressed: ['REQ-002'] },
  ];
  return m;
}

describe('the public view', () => {
  const v = publicAppMemory(mem());

  it('maps every ledger state to a plain status and hides dropped requirements', () => {
    expect(v.requirements.map((r) => [r.id, r.status])).toEqual([['REQ-001', 'working'], ['REQ-002', 'missing'], ['REQ-003', 'built'], ['REQ-004', 'pending']]);
  });

  it('shows open issues only, marks the one being worked on, and never a verified one', () => {
    expect(v.openIssues.map((i) => i.id)).toEqual(['ISS-001', 'ISS-002']);
    expect(v.openIssues[0].fixing).toBe(true);
    expect(v.openIssueCount).toBe(2);
  });

  it('newest change first, in plain words, with what it lost', () => {
    expect(v.changes[0]).toMatchObject({ id: 'CHG-0002', kind: 'Small visual change', outcome: 'Done, some checks open', lost: 1 });
  });

  it('🔒 nothing in it names a vendor or a model, and no internal code leaks', () => {
    const json = JSON.stringify(v);
    expect(hasProviderLeak(json)).toBe(false);
    expect(json).not.toMatch(/RUNTIME_ERRORS_REMAIN|micro-ui|regressed|verified"/);
  });
});

describe('wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the route is a STRICT owner read', () => {
    const at = route.indexOf("app.get('/api/agentv3/app-memory'");
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 1200)).toMatch(/assertVerifiedWorkspaceOwner\(req, workspaceId\)/);
    expect(route.slice(at, at + 1200)).toMatch(/publicAppMemory\(await loadEngineeringMemory\(workspaceId\)\)/);
  });
  it('the History tab renders the card and the knowledge base can point users at it', () => {
    expect(readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8')).toMatch(/<AppMemoryCard workspaceId=\{state\.workspaceId\}/);
    expect(readFileSync('src/server/AppContext/AppKnowledgeBase.ts', 'utf8')).toMatch(/id: 'app-requirements-memory'/);
  });
  it('the card fetches the white-labelled view and nothing else', () => {
    const card = readFileSync('src/components/agentv3/AppMemoryCard.tsx', 'utf8');
    expect(card).toMatch(/\/api\/agentv3\/app-memory\?/);
    expect(card.match(/fetch\(/g)).toHaveLength(1);
  });
});
