import { describe, it, expect } from 'vitest';
import {
  buildTraceabilityMatrix,
  testCoversFile,
  type TraceabilityInput,
} from '../src/server/AppMakerLab/intelligence/RequirementTraceabilityMatrix';

describe('testCoversFile', () => {
  it('matches an explicit covers path', () => {
    expect(testCoversFile({ path: 'x.test.ts', covers: ['src/auth/authService.ts'] }, 'src/auth/authService.ts')).toBe(true);
  });
  it('matches by filename convention (.test)', () => {
    expect(testCoversFile({ path: 'src/auth/auth.test.ts' }, 'src/auth/auth.ts')).toBe(true);
  });
  it('matches by filename convention (.spec)', () => {
    expect(testCoversFile({ path: 'auth.spec.tsx' }, 'auth.ts')).toBe(true);
  });
  it('does not match an unrelated file', () => {
    expect(testCoversFile({ path: 'auth.test.ts' }, 'src/user/user.ts')).toBe(false);
  });
});

describe('buildTraceabilityMatrix', () => {
  const input: TraceabilityInput = {
    requirements: [
      { id: 'R1', text: 'Users can log in' },
      { id: 'R2', text: 'Users can view profile' },
      { id: 'R3', text: 'Admin dashboard' }, // deliberately unimplemented
    ],
    files: [
      { path: 'src/auth/authService.ts', requirementIds: ['R1'] },
      { path: 'src/profile/profile.ts', requirementIds: ['R2'] }, // no test → untested
    ],
    tests: [
      { path: 'src/auth/authService.test.ts' }, // convention-matches authService.ts
      { path: 'src/orphan/orphan.test.ts' }, // covers nothing known → orphan
    ],
  };

  it('links requirement → file → test and flags fullyTested', () => {
    const m = buildTraceabilityMatrix(input, 'ws-1');
    const r1 = m.requirements.find((r) => r.id === 'R1')!;
    expect(r1.implemented).toBe(true);
    expect(r1.fullyTested).toBe(true);
    expect(r1.files[0].tests).toEqual(['src/auth/authService.test.ts']);
  });

  it('flags an implemented-but-untested requirement', () => {
    const m = buildTraceabilityMatrix(input);
    const r2 = m.requirements.find((r) => r.id === 'R2')!;
    expect(r2.implemented).toBe(true);
    expect(r2.fullyTested).toBe(false);
    expect(r2.files[0].tested).toBe(false);
  });

  it('flags an unimplemented requirement (silently dropped)', () => {
    const m = buildTraceabilityMatrix(input);
    const r3 = m.requirements.find((r) => r.id === 'R3')!;
    expect(r3.implemented).toBe(false);
    expect(m.summary.unimplementedRequirements).toContain('R3');
  });

  it('computes the coverage summary honestly', () => {
    const m = buildTraceabilityMatrix(input, 'ws-1');
    expect(m.summary.totalRequirements).toBe(3);
    expect(m.summary.implementedRequirements).toBe(2);
    expect(m.summary.fullyTestedRequirements).toBe(1); // only R1
    expect(m.summary.coveragePct).toBe(33); // 1/3
    expect(m.summary.untestedFiles).toEqual(['src/profile/profile.ts']);
    expect(m.summary.orphanTests).toEqual(['src/orphan/orphan.test.ts']);
    expect(m.workspaceId).toBe('ws-1');
    expect(m.schema).toBe('navbharatai.traceability/1');
  });

  it('dedupes a file linked to a requirement twice', () => {
    const m = buildTraceabilityMatrix({
      requirements: [{ id: 'R1' }],
      files: [
        { path: 'a.ts', requirementIds: ['R1'] },
        { path: 'a.ts', requirementIds: ['R1'] },
      ],
      tests: [],
    });
    expect(m.requirements[0].files).toHaveLength(1);
  });

  it('is empty-safe (no requirements → 0% coverage, no crash)', () => {
    const m = buildTraceabilityMatrix({ requirements: [], files: [], tests: [] });
    expect(m.summary.totalRequirements).toBe(0);
    expect(m.summary.coveragePct).toBe(0);
    expect(m.requirements).toEqual([]);
  });

  it('ignores malformed entries defensively', () => {
    const m = buildTraceabilityMatrix({
      // @ts-expect-error — intentional malformed input
      requirements: [{ id: 'R1' }, { id: '' }, null, { text: 'no id' }],
      // @ts-expect-error — intentional malformed input
      files: [{ path: 'a.ts', requirementIds: ['R1'] }, null, { path: '' }],
      tests: [],
    });
    expect(m.requirements).toHaveLength(1);
    expect(m.requirements[0].id).toBe('R1');
  });
});
