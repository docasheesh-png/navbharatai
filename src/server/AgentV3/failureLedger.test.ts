import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { foldFailure, rankFailures, frameworkKey, MAX_FRAMEWORK_KEYS, type FailureDay, type FailureEntry } from './failureLedger';

/**
 * WHY DO BUILDS FAIL? (admin: "mera paisa kam kharch ho").
 *
 * The dashboard could already say "29% of builds failed" and could not say why, or what it cost. These
 * tests pin the two properties that make the answer worth acting on: the money is ranked, and an
 * unclassified majority says so about OUR classifier instead of quietly promoting the second row.
 */

const entry = (over: Partial<FailureEntry> = {}): FailureEntry => ({
  category: 'dependency', framework: 'react', realUsd: 0.01, inputTokens: 100, outputTokens: 50, ms: 60_000, ...over,
});

const codeOf = (src: string) => src.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');

describe('folding one failure into a day', () => {
  it('accumulates builds, money and time per cause', () => {
    let day = foldFailure(null, '2026-09-12', entry());
    day = foldFailure(day, '2026-09-12', entry({ realUsd: 0.02, ms: 30_000 }));
    expect(day.builds).toBe(2);
    expect(day.usd).toBeCloseTo(0.03, 9);
    expect(day.categories.dependency.builds).toBe(2);
    expect(day.categories.dependency.ms).toBe(90_000);
  });

  it('🔒 keeps six decimals — a build can genuinely cost a fraction of a cent', () => {
    // Rounding those to zero would make the cheapest-but-most-frequent failure look free, which is
    // exactly the failure most worth finding.
    const day = foldFailure(null, '2026-09-12', entry({ realUsd: 0.000004 }));
    expect(day.usd).toBe(0.000004);
  });

  it('never mutates the document it was given', () => {
    const before: FailureDay = { date: '2026-09-12', builds: 1, usd: 1, categories: {}, frameworks: {} };
    const snapshot = JSON.stringify(before);
    foldFailure(before, '2026-09-12', entry());
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('🔒 bounds the framework keys — one day’s document cannot grow without limit', () => {
    let day: FailureDay | null = null;
    for (let i = 0; i < MAX_FRAMEWORK_KEYS + 15; i++) day = foldFailure(day, '2026-09-12', entry({ framework: `fw${i}` }));
    expect(Object.keys(day!.frameworks).length).toBeLessThanOrEqual(MAX_FRAMEWORK_KEYS + 1);
    expect(day!.frameworks.other).toBe(15);
    // Nothing is lost — every build is still counted somewhere.
    expect(Object.values(day!.frameworks).reduce((a, b) => a + b, 0)).toBe(MAX_FRAMEWORK_KEYS + 15);
  });

  it('a framework name is normalised, never trusted as a Firestore key', () => {
    // A key must not contain `.` (a field path) or start with `__`.
    expect(frameworkKey('Next.js 15')).toBe('next-js-15');
    expect(frameworkKey('__proto__')).toBe('proto');
    expect(frameworkKey('')).toBe('unknown');
    expect(frameworkKey(undefined)).toBe('unknown');
    expect(frameworkKey('x'.repeat(200)).length).toBeLessThanOrEqual(40);
  });

  it('a missing category becomes unknown rather than vanishing', () => {
    const day = foldFailure(null, '2026-09-12', entry({ category: undefined as never }));
    expect(day.categories.unknown.builds).toBe(1);
  });
});

describe('ranking the causes', () => {
  const day = (date: string, rows: Array<[string, number, number]>): FailureDay => {
    let d: FailureDay | null = null;
    for (const [category, builds, usd] of rows) {
      for (let i = 0; i < builds; i++) {
        d = foldFailure(d, date, entry({ category: category as never, realUsd: usd / builds }));
      }
    }
    return d!;
  };

  it('🔒 ranks by MONEY WASTED, because that is the question being asked', () => {
    const r = rankFailures([day('2026-09-12', [['timeout', 2, 1.0], ['dependency', 9, 0.1]])]);
    expect(r.causes[0].category).toBe('timeout');
    expect(r.causes[0].shareOfUsd).toBeCloseTo(1.0 / 1.1, 3);
    // The frequent-but-cheap cause is still there, and still second.
    expect(r.causes[1].category).toBe('dependency');
    expect(r.causes[1].builds).toBe(9);
  });

  it('falls back to COUNT when nothing measurable was spent, rather than an arbitrary order', () => {
    const r = rankFailures([day('2026-09-12', [['type', 1, 0], ['syntax', 5, 0]])]);
    expect(r.causes[0].category).toBe('syntax');
  });

  it('sums across days and reports how many it read', () => {
    const r = rankFailures([day('2026-09-12', [['type', 1, 0.5]]), day('2026-09-11', [['type', 2, 0.5]])]);
    expect(r.days).toBe(2);
    expect(r.builds).toBe(3);
    expect(r.usd).toBeCloseTo(1.0, 6);
    expect(r.causes[0].shareOfBuilds).toBe(1);
  });

  it('🔒 an UNCLASSIFIED majority says so about our CLASSIFIER, not about the builds', () => {
    // If unknown leads and the headline stays neutral, a reader takes the second row for the biggest
    // real problem — when the truth is that we cannot yet name the biggest one.
    const r = rankFailures([day('2026-09-12', [['unknown', 8, 1.0], ['type', 2, 0.1]])]);
    expect(r.causes[0].category).toBe('unknown');
    expect(r.headline).toContain('UNCLASSIFIED');
    expect(r.headline).toContain('classifier');
  });

  it('a classified leader gets a plain headline', () => {
    const r = rankFailures([day('2026-09-12', [['dependency', 8, 1.0]])]);
    expect(r.headline).toContain('dependency');
    expect(r.headline).not.toContain('UNCLASSIFIED');
  });

  it('🔒 an empty window says there is nothing recorded — never "all healthy"', () => {
    const r = rankFailures([]);
    expect(r.builds).toBe(0);
    expect(r.causes).toEqual([]);
    expect(r.headline).toBe('No failed builds recorded in this window.');
  });

  it('ignores junk days instead of throwing', () => {
    expect(() => rankFailures([null, undefined, {} as never])).not.toThrow();
    expect(rankFailures([null]).builds).toBe(0);
  });

  it('reports the frameworks, most first', () => {
    let d: FailureDay | null = null;
    d = foldFailure(d, '2026-09-12', entry({ framework: 'react' }));
    d = foldFailure(d, '2026-09-12', entry({ framework: 'react' }));
    d = foldFailure(d, '2026-09-12', entry({ framework: 'vue' }));
    expect(rankFailures([d]).frameworks[0]).toEqual({ framework: 'react', builds: 2 });
  });
});

describe('the wiring', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('🔒 records at the SETTLE, where the cost exists — not at the retrospective, where it does not', () => {
    // The retrospective classifies the failure but runs before the provider ledger is reconciled, so
    // it has no idea what the build cost — and a cause with no money against it cannot be ranked.
    const route = codeOf(read('src/server/routes/agentv3.ts'));
    const decide = route.indexOf('realCostRemainder: realCostRemainderForFailure');
    const record = route.indexOf('failureLedgerStore.record({');
    expect(decide).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(decide);
    expect(route).toContain('if (result.ok !== true) {');
  });

  it('🔒 prices the failure with the SAME call that decides the bill', () => {
    // Two pricings would eventually disagree about what one build cost, and only the admin's dashboard
    // would show it.
    const route = codeOf(read('src/server/routes/agentv3.ts'));
    expect(route).toContain('realProviderCostUsd(providerLedger.entries(), realCostRemainderForFailure)');
  });

  it('records only FAILED builds, and never awaits the write', () => {
    const route = codeOf(read('src/server/routes/agentv3.ts'));
    expect(route).toContain('void failureLedgerStore.record({');
    expect(route).not.toContain('await failureLedgerStore.record(');
  });

  it('🔒 the store returns an honest "we could not tell you" on a read failure', () => {
    const store = codeOf(read('src/server/AgentV3/FailureLedgerStore.ts'));
    expect(store).toMatch(/catch \{[\s\S]{0,200}complete: false/);
  });

  it('the admin route carries the ranking AND whether the read was complete', () => {
    const admin = read('src/server/routes/admin.ts');
    expect(admin).toContain('causes: causes?.ranking ?? null');
    expect(admin).toContain('causesComplete: causes?.complete === true');
  });

  it('🔒 the admin SEES it — a measurement nobody can read is not a measurement', () => {
    const ui = read('src/components/AdminDashboard.tsx');
    expect(ui).toContain('Why they failed — ranked by what it cost us');
    expect(ui).toContain('failureReport.causes.headline');
  });

  it('🔒 an unreadable ledger is shown as a gap, never as a clean week', () => {
    const ui = read('src/components/AdminDashboard.tsx');
    expect(ui).toContain('failureReport.causesComplete === false');
    expect(ui).toContain('this is not a clean record');
  });
});
