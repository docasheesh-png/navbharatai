import { describe, it, expect } from 'vitest';
import { buildConnectAudit, auditMessage, type ConnectAuditFinding } from './ConnectAudit';
import type { ArchitectureReport } from './ArchitectureAnalysis';

const clean = (over: Partial<ArchitectureReport> = {}): ArchitectureReport => ({
  fileCount: 2_460,
  edgeCount: 5_000,
  cycles: [],
  unresolvedImports: [],
  layeringViolations: [],
  nodeBuiltinsInFrontend: [],
  orphanComponents: [],
  ...over,
});

describe('buildConnectAudit — what a freshly connected project is told', () => {
  it('reports a broken import as broken, because that is what the user cares about', () => {
    const a = buildConnectAudit(clean({ unresolvedImports: ['src/App.tsx -> ./Missing', 'src/x.ts -> ./gone'] }), []);
    const f = a.findings.find((x) => x.kind === 'brokenImport')!;
    expect(f.count).toBe(2);
    expect(f.headline).toMatch(/do(es)? not exist/i);
    expect(f.fixable).toBe(true);
  });

  it('puts what is BROKEN before what is merely unused', () => {
    const a = buildConnectAudit(
      clean({ unresolvedImports: ['a -> ./b'], orphanComponents: ['src/Page.tsx (Page)'] }),
      ['src/old.ts'],
    );
    const kinds = a.findings.map((f) => f.kind);
    expect(kinds.indexOf('brokenImport')).toBeLessThan(kinds.indexOf('orphanComponent'));
    expect(kinds.indexOf('orphanComponent')).toBeLessThan(kinds.indexOf('unwiredFile'));
  });

  it('never offers to "fix" unused files — deleting someone\'s files on a guess is not ours to decide', () => {
    const a = buildConnectAudit(clean(), ['src/legacy.ts', 'src/old.ts']);
    expect(a.findings.find((f) => f.kind === 'unwiredFile')!.fixable).toBe(false);
  });

  it('bounds the examples so a 3,000-item finding does not become a wall of text', () => {
    const many = Array.from({ length: 3_000 }, (_, i) => `src/f${i}.ts -> ./missing`);
    const a = buildConnectAudit(clean({ unresolvedImports: many }), []);
    const f = a.findings.find((x) => x.kind === 'brokenImport')!;
    expect(f.count).toBe(3_000);          // the COUNT stays true
    expect(f.examples).toHaveLength(3);   // only the illustration is bounded
  });

  it('gives every finding concrete examples, so a claim can be checked rather than trusted', () => {
    const a = buildConnectAudit(
      clean({
        unresolvedImports: ['a -> ./b'],
        nodeBuiltinsInFrontend: ['src/ui.tsx -> fs'],
        orphanComponents: ['src/P.tsx (P)'],
        cycles: [['a.ts', 'b.ts', 'a.ts']],
      }),
      ['src/old.ts'],
    );
    expect(a.findings).toHaveLength(5);
    for (const f of a.findings) expect(f.examples.length).toBeGreaterThan(0);
  });
});

describe('auditMessage — an audit that cries wolf destroys trust in one screen', () => {
  it('says nothing manufactured about a clean project', () => {
    const m = auditMessage(2_460, []);
    expect(m).toContain('2,460');
    expect(m).toMatch(/nothing broken to flag/i);
    // No invented severity, no score, no "your app is slow" — none of that was measured.
    expect(m).not.toMatch(/score|grade|%|slower|risk/i);
  });

  it('offers a fix ONLY when something is genuinely repairable', () => {
    const fixable: ConnectAuditFinding = { kind: 'brokenImport', count: 1, headline: 'x', examples: ['a'], fixable: true };
    const notFixable: ConnectAuditFinding = { kind: 'unwiredFile', count: 1, headline: 'y', examples: ['b'], fixable: false };
    expect(auditMessage(10, [fixable])).toMatch(/fix these/i);
    // Only unused-file notes: offering to "fix" them would mean deleting files nobody asked us to.
    expect(auditMessage(10, [notFixable])).not.toMatch(/fix these/i);
    expect(auditMessage(10, [notFixable])).toMatch(/cleanup notes, not errors/i);
  });

  it('stays silent on an empty project rather than reporting on nothing', () => {
    expect(auditMessage(0, [])).toBe('');
  });

  it('reads as plain language, not analyzer jargon', () => {
    const m = auditMessage(100, [{
      kind: 'orphanComponent', count: 14,
      headline: '14 screen(s)/component(s) exist but nothing ever shows them — built, but unreachable in the app.',
      examples: ['src/Page.tsx (Page)'], fixable: true,
    }]);
    expect(m).toContain('nothing ever shows them');
    expect(m).not.toMatch(/orphanComponent|ArchitectureReport|graph/i);
  });
});
