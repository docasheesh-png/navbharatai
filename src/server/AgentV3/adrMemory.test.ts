import { describe, it, expect } from 'vitest';
import { buildAdrRecord, renderAdrMarkdown, adrDigest, foldAdr, stackChanged, type AdrRecord } from './adrMemory';

const NOW = '2026-07-14T10:20:30.000Z';
const prismaTailwindTsx: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { '@prisma/client': '^5', tailwindcss: '^3' } }),
  'src/App.tsx': 'export default function App() { return null; }',
};

describe('buildAdrRecord', () => {
  it('returns null when nothing about the stack is detectable (no fake ADR)', () => {
    expect(buildAdrRecord({ files: {}, prompt: '', priorCount: 0, nowIso: NOW })).toBeNull();
  });

  it('numbers = priorCount + 1 and dates to the ISO day', () => {
    const rec = buildAdrRecord({ framework: 'vite-react', files: prismaTailwindTsx, prompt: 'a todo app', priorCount: 2, nowIso: NOW });
    expect(rec).not.toBeNull();
    expect(rec!.number).toBe(3);
    expect(rec!.date).toBe('2026-07-14');
  });

  it('fills the stack from a prisma/tailwind/tsx file map', () => {
    const rec = buildAdrRecord({ framework: 'vite-react', files: prismaTailwindTsx, prompt: 'shop with cart and checkout', priorCount: 0, nowIso: NOW })!;
    expect(rec.framework).toBe('vite-react');
    expect(rec.database).toBe('prisma');
    expect(rec.styling).toBe('tailwind');
    expect(rec.language).toBe('typescript');
    expect(rec.pattern).toBe('e-commerce');
    expect(rec.rationale).toContain('e-commerce');
  });
});

describe('renderAdrMarkdown', () => {
  it('renders the numbered file with status/decision and an HONEST alternatives note', () => {
    const rec = buildAdrRecord({ framework: 'vite-react', files: prismaTailwindTsx, prompt: 'a dashboard', priorCount: 0, nowIso: NOW })!;
    const { path, content } = renderAdrMarkdown(rec);
    expect(path).toBe('docs/decisions/ADR-001.md');
    expect(content).toContain('# ADR-001');
    expect(content).toContain('**Status:** Accepted');
    expect(content).toContain('## Decision');
    expect(content).toContain('framework: vite-react');
    expect(content).toContain('Not ranked by this engine'); // never fabricate scored alternatives
  });
});

describe('adrDigest', () => {
  const rec = (n: number): AdrRecord => ({ number: n, date: '2026-07-14', framework: 'vite-react', database: 'firestore', styling: 'tailwind', language: 'typescript', pattern: 'dashboard', rationale: 'x' });
  it('is empty for no records', () => {
    expect(adrDigest([])).toBe('');
    expect(adrDigest(null)).toBe('');
  });
  it('lists prior decisions and caps to the latest N', () => {
    const many = Array.from({ length: 8 }, (_, i) => rec(i + 1));
    const d = adrDigest(many, 3);
    expect(d).toContain('PRIOR ARCHITECTURE DECISIONS');
    expect(d).toContain('ADR-006');
    expect(d).toContain('ADR-008');
    expect(d).not.toContain('ADR-005'); // beyond the limit
  });
});

describe('foldAdr + stackChanged', () => {
  const rec = (over: Partial<AdrRecord> = {}): AdrRecord => ({ number: 1, date: '2026-07-14', framework: 'vite-react', database: 'firestore', styling: 'tailwind', language: 'typescript', pattern: 'dashboard', rationale: 'x', ...over });
  it('appends newest last and caps', () => {
    let log: AdrRecord[] = [];
    for (let i = 1; i <= 55; i++) log = foldAdr(log, rec({ number: i }), 50);
    expect(log).toHaveLength(50);
    expect(log[0].number).toBe(6);   // oldest 5 dropped
    expect(log[49].number).toBe(55); // newest last
  });
  it('stackChanged is true vs no prior, false for an identical stack, true on any stack diff', () => {
    expect(stackChanged(null, rec())).toBe(true);
    expect(stackChanged(rec(), rec({ number: 2 }))).toBe(false); // same stack, different number → no new ADR
    expect(stackChanged(rec(), rec({ database: 'supabase' }))).toBe(true);
  });
});
