import { describe, it, expect } from 'vitest';
import { createUsageSink } from './UsageSink';
import { billedAmountUsd } from './pricing';

describe('UsageSink — build-level token accumulator (billing accounting fix)', () => {
  it('starts empty', () => {
    const sink = createUsageSink();
    expect(sink.total()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('accumulates tokens from many spending units (main + sub-agents + heal/fix)', () => {
    const sink = createUsageSink();
    sink.add({ inputTokens: 1000, outputTokens: 200 }); // fast lane
    sink.add({ inputTokens: 5000, outputTokens: 1500 }); // main agentic runner
    sink.add({ inputTokens: 40000, outputTokens: 9000 }); // a sub-agent (the big previously-dropped leak)
    sink.add({ inputTokens: 40000, outputTokens: 9000 }); // another sub-agent
    sink.add({ inputTokens: 800, outputTokens: 300 }); // a heal run whose result was discarded
    expect(sink.total()).toEqual({ inputTokens: 86800, outputTokens: 20000 });
  });

  it('ignores null/undefined and non-finite / negative values (never corrupts the total)', () => {
    const sink = createUsageSink();
    sink.add(null);
    sink.add(undefined);
    sink.add({ inputTokens: NaN, outputTokens: Infinity });
    sink.add({ inputTokens: -50, outputTokens: -10 });
    sink.add({ inputTokens: 100, outputTokens: 40 });
    expect(sink.total()).toEqual({ inputTokens: 100, outputTokens: 40 });
  });

  it('the whole build now bills more than a single runner would (the core of the fix)', () => {
    // Simulate: main runner spends a small share; sub-agents spend the bulk.
    const mainOnly = { inputTokens: 5000, outputTokens: 1500 };
    const sink = createUsageSink();
    sink.add(mainOnly);
    sink.add({ inputTokens: 80000, outputTokens: 18000 }); // sub-agents (were dropped before)
    const billedWholeBuild = billedAmountUsd(sink.total(), 'off');
    const billedMainOnly = billedAmountUsd(mainOnly, 'off');
    // Billing the whole build must exceed billing only the main runner's turns — the leak is closed.
    expect(billedWholeBuild).toBeGreaterThan(billedMainOnly);
  });
});
