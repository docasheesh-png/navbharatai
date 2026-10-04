// CHANGE ENGINE slice 3 (2026-10-04) — a requirement no browser probe can judge (a coupon box, an order
// history page) is still REMEMBERED across edits. It is `built` only by a build that passed its release
// gate, it is never called verified, and it can never be called regressed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { foldRequestedLabels, markLabelsBuilt, labelKey, regressionProbeFeatures, foldProbeResults, renderSpecForBuilder, parseAppSpec } from '../src/server/AgentV3/changeEngine/appSpec';
import { emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { foldSettle, type ChangeSession } from '../src/server/AgentV3/changeEngine/changeSession';
import { classifyChange } from '../src/server/AgentV3/changeEngine/changeClassifier';

function session(over: Partial<ChangeSession>): ChangeSession {
  return {
    workspaceId: 'w', isEdit: true, classification: classifyChange('add a coupon'), summary: '', requested: [], declined: [],
    requestedLabels: [], regressionTargets: [], assignedIssueIds: [], probes: new Map(), priorSpec: { items: [], nextReq: 1 }, ...over,
  };
}

describe('label requirements', () => {
  it('join the ledger once, as non-probe-able, with stable ids', () => {
    let s = foldRequestedLabels({ items: [], nextReq: 1 }, ['Coupon codes', 'Order history'], 'C1');
    s = foldRequestedLabels(s, ['coupon  codes'], 'C2');
    expect(s.items.map((i) => [i.id, i.feature, i.probeable])).toEqual([
      ['REQ-001', 'label:coupon-codes', false], ['REQ-002', 'label:order-history', false],
    ]);
  });

  it('a label the probe table already covers is not recorded twice', () => {
    const s = foldRequestedLabels({ items: [], nextReq: 1 }, ['Search'], 'C1', () => true);
    expect(s.items).toHaveLength(0);
  });

  it('are never re-probed and can never be called regressed, even if a probe result names their key', () => {
    let s = foldRequestedLabels({ items: [], nextReq: 1 }, ['Coupon codes'], 'C1');
    s = markLabelsBuilt(s, [labelKey('Coupon codes')], 'C1').spec;
    expect(regressionProbeFeatures(s)).toEqual([]);
    const f = foldProbeResults(s, [{ feature: 'label:coupon-codes', present: false }], 'C2', 1);
    expect(f.regressed).toEqual([]);
    expect(f.spec.items[0].status).toBe('built');
  });

  it('BUILT needs a green gate — a yellow, failed or stopped build leaves it requested', () => {
    const base = session({ requestedLabels: ['Coupon codes'] });
    for (const input of [
      { ok: true, stopped: false, gate: 'yellow' as const },
      { ok: false, stopped: false, gate: 'green' as const },
      { ok: true, stopped: true, gate: 'green' as const },
      { ok: true, stopped: false, gate: undefined },
    ]) {
      const { mem } = foldSettle(emptyMemory(), base, { ...input, files: [], issues: [] }, 1);
      expect(mem.spec.items[0].status).toBe('requested');
    }
    const { mem, result } = foldSettle(emptyMemory(), base, { ok: true, stopped: false, gate: 'green', files: [], issues: [] }, 1);
    expect(mem.spec.items[0].status).toBe('built');
    expect(result.record.requirements).toEqual(['REQ-001']);
  });

  it('the builder is told it was built, never that it was verified', () => {
    const s = markLabelsBuilt(foldRequestedLabels({ items: [], nextReq: 1 }, ['Order history'], 'C1'), [labelKey('Order history')], 'C1').spec;
    const block = renderSpecForBuilder(s, 'standard');
    expect(block).toContain('REQ-001 Order history — built by an earlier change');
    expect(block).not.toMatch(/Order history — verified/);
  });

  it('survives storage', () => {
    const s = foldRequestedLabels({ items: [], nextReq: 1 }, ['Coupon codes'], 'C1');
    expect(parseAppSpec(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('the route hands the same contract labels the builder is told to build', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/contractLabels: confirmedContractLabels\(featureLists, featureConfirmation\)/);
  });
});
