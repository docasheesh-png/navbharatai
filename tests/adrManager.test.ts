import { describe, it, expect } from 'vitest';
import { generateADR, adrId, type RankedPattern } from '../src/server/AppMakerLab/intelligence/ADRManager';
import type { Pattern } from '../src/server/AppMakerLab/intelligence/PatternTypes';

/**
 * P-PME.10 — ADR auto-capture.
 */
function pattern(id: string): Pattern {
  return {
    id,
    description: `${id} description`,
    supportsFrontend: ['React'],
    supportsBackend: ['Express'],
    requiresDatabase: true,
    supportsRealtime: false,
    defaultStack: { frontend: 'React', backend: 'Express', database: 'Firebase', auth: 'Firebase' },
  };
}

describe('ADRManager — adrId', () => {
  it('zero-pads to 3 digits', () => {
    expect(adrId(1)).toBe('ADR-001');
    expect(adrId(42)).toBe('ADR-042');
    expect(adrId(0)).toBe('ADR-001'); // clamped to >=1
  });
});

describe('ADRManager — generateADR', () => {
  const ranked: RankedPattern[] = [
    { pattern: pattern('spa-firebase'), score: 90, matchedConstraints: ['realtime', 'auth'] },
    { pattern: pattern('ssr-postgres'), score: 70 },
  ];

  it('produces a docs/decisions/ADR-NNN.md path', () => {
    const adr = generateADR({ number: 3, date: '2026-06-29', ranked });
    expect(adr.path).toBe('docs/decisions/ADR-003.md');
  });

  it('records the chosen pattern, score, date, stack and matched constraints', () => {
    const adr = generateADR({ number: 1, date: '2026-06-29', ranked });
    expect(adr.content).toContain('ADR-001');
    expect(adr.content).toContain('spa-firebase');
    expect(adr.content).toContain('score 90');
    expect(adr.content).toContain('2026-06-29');
    expect(adr.content).toContain('frontend: React');
    expect(adr.content).toContain('Satisfies: realtime, auth');
    expect(adr.content).toContain('## Decision');
  });

  it('lists alternatives considered', () => {
    const adr = generateADR({ number: 1, date: '2026-06-29', ranked });
    expect(adr.content).toContain('## Alternatives considered');
    expect(adr.content).toContain('ssr-postgres');
    expect(adr.content).toContain('score 70');
  });

  it('says "None" when there are no alternatives', () => {
    const adr = generateADR({ number: 1, date: '2026-06-29', ranked: [ranked[0]] });
    expect(adr.content).toContain('only one pattern matched');
  });

  it('throws when no ranked patterns are supplied', () => {
    expect(() => generateADR({ number: 1, date: '2026-06-29', ranked: [] })).toThrow();
  });
});
