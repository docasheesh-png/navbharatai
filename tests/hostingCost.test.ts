import { describe, it, expect } from 'vitest';
import {
  hostingRates, hostingMarkupPct, hostingCostUsd, hostingBillableUsd, hostingBillingEnabled, hostingCostNote,
} from '../src/server/AgentV3/hostingCost';

/**
 * What a hosted app costs, and what the user pays (ROADMAP §11 slice 2, admin decision D5:
 * "hamara jo bhi kharcha ayega, usme 20+% add kar ke user se charge karenge").
 *
 * Two rules dominate, and both are inherited rather than invented:
 *   • sandboxCost.ts's law — a rate that is not explicitly set is never charged to a real person,
 *     because the only alternative is billing a placeholder;
 *   • D5's own condition — "our cost" is FOUR lines, and metering compute alone makes every
 *     bandwidth-heavy app a loss.
 */
const RATES = {
  NAVBHARAT_RATE_CPU_SECOND: '0.000024',
  NAVBHARAT_RATE_MEMORY_GIB_SECOND: '0.0000025',
  NAVBHARAT_RATE_MILLION_REQUESTS: '0.40',
  NAVBHARAT_RATE_EGRESS_GIB: '0.12',
  NAVBHARAT_RATE_BUILD_MINUTE: '0.003',
  NAVBHARAT_RATE_STORAGE_GIB_MONTH: '0.10',
} as unknown as NodeJS.ProcessEnv;
const ON = { ...RATES, NAVBHARAT_BILL_HOSTING: 'on' } as NodeJS.ProcessEnv;

describe('🔒 rates — no defaults, because a default here is a placeholder', () => {
  it('an unset rate is null, never a guessed number', () => {
    const r = hostingRates({} as NodeJS.ProcessEnv);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });

  it('junk is treated as unset rather than as zero-cost', () => {
    const r = hostingRates({ NAVBHARAT_RATE_EGRESS_GIB: 'cheap' } as unknown as NodeJS.ProcessEnv);
    expect(r.egressGib).toBeNull();
  });

  it('the markup is D5\'s 20% by default, and tunable', () => {
    expect(hostingMarkupPct({} as NodeJS.ProcessEnv)).toBe(20);
    expect(hostingMarkupPct({ NAVBHARAT_HOSTING_MARKUP_PCT: '35' } as unknown as NodeJS.ProcessEnv)).toBe(35);
  });
});

describe('🔴 all FOUR D5 cost lines are metered', () => {
  it('🔒 EGRESS is billed — the line whose absence makes every image-heavy app a loss', () => {
    const c = hostingCostUsd({ egressGib: 100 }, RATES);
    expect(c.lines.egress).toBeCloseTo(12, 6);
    expect(c.usd).toBeCloseTo(12, 6);
  });

  it('compute, build and storage are each billed too', () => {
    expect(hostingCostUsd({ cpuSeconds: 1000 }, RATES).lines.compute).toBeCloseTo(0.024, 6);
    expect(hostingCostUsd({ buildMinutes: 10 }, RATES).lines.build).toBeCloseTo(0.03, 6);
    expect(hostingCostUsd({ storageGibMonths: 2 }, RATES).lines.storage).toBeCloseTo(0.2, 6);
  });

  it('a real app sums all four', () => {
    const c = hostingCostUsd({
      cpuSeconds: 1000, memoryGibSeconds: 2000, requests: 500_000,
      egressGib: 5, buildMinutes: 4, storageGibMonths: 0.5,
    }, RATES);
    const expected = 0.000024 * 1000 + 0.0000025 * 2000 + 0.40 * 0.5 + 0.12 * 5 + 0.003 * 4 + 0.10 * 0.5;
    expect(c.usd).toBeCloseTo(expected, 6);
    expect(c.unbilled).toEqual([]);
  });

  it('🔒 an idle app costs nothing — the scale-to-zero promise, in money', () => {
    const c = hostingCostUsd({ cpuSeconds: 0, egressGib: 0, requests: 0 }, RATES);
    expect(c.usd).toBe(0);
    expect(hostingBillableUsd(c, ON)).toBe(0);
  });
});

describe('🔒 an unset rate bills ZERO and is NAMED — never a placeholder, never silent', () => {
  it('usage with no rate contributes nothing and is reported as unbilled', () => {
    const c = hostingCostUsd({ egressGib: 100, buildMinutes: 10 }, { NAVBHARAT_RATE_BUILD_MINUTE: '0.003' } as unknown as NodeJS.ProcessEnv);
    expect(c.lines.egress).toBe(0);
    expect(c.lines.build).toBeCloseTo(0.03, 6);
    expect(c.unbilled).toEqual(['egress']);
  });

  it('🔒 partial COMPUTE rates under-bill and say so — they never guess the missing meter', () => {
    const c = hostingCostUsd(
      { cpuSeconds: 1000, memoryGibSeconds: 2000 },
      { NAVBHARAT_RATE_CPU_SECOND: '0.000024' } as unknown as NodeJS.ProcessEnv,
    );
    expect(c.lines.compute).toBeCloseTo(0.024, 6);   // cpu only
    expect(c.unbilled).toContain('compute');
  });

  it('a line with a missing rate but ZERO usage is not flagged — there is nothing to bill', () => {
    expect(hostingCostUsd({ cpuSeconds: 1000 }, RATES).unbilled).toEqual([]);
    expect(hostingCostUsd({ egressGib: 0 }, {} as NodeJS.ProcessEnv).unbilled).toEqual([]);
  });

  it('🔒 no rates at all ⇒ nothing is charged, whatever the usage', () => {
    const c = hostingCostUsd({ cpuSeconds: 1e6, egressGib: 1e4 }, {} as NodeJS.ProcessEnv);
    expect(c.usd).toBe(0);
    expect(hostingBillableUsd(c, { NAVBHARAT_BILL_HOSTING: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('hostingBillableUsd — the D5 markup, behind a switch', () => {
  it('adds exactly 20% to the real cost', () => {
    const c = hostingCostUsd({ egressGib: 10 }, RATES);      // $1.20
    expect(hostingBillableUsd(c, ON)).toBeCloseTo(1.44, 6);
  });

  it('🔒 billing OFF charges nothing — the money path is inert until switched on', () => {
    expect(hostingBillingEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(hostingBillableUsd(hostingCostUsd({ egressGib: 10 }, RATES), RATES)).toBe(0);
  });

  it('🔒 zero cost is never rounded up to a minimum charge', () => {
    expect(hostingBillableUsd(hostingCostUsd({}, RATES), ON)).toBe(0);
    expect(hostingBillableUsd(null, ON)).toBe(0);
  });

  it('a tuned markup is honoured', () => {
    const c = hostingCostUsd({ egressGib: 10 }, RATES);
    expect(hostingBillableUsd(c, { ...ON, NAVBHARAT_HOSTING_MARKUP_PCT: '50' } as NodeJS.ProcessEnv)).toBeCloseTo(1.8, 6);
  });
});

describe('hostingCostNote — the admin sees the shape, and every gap', () => {
  it('names the per-line breakdown and the billed total', () => {
    const n = hostingCostNote(hostingCostUsd({ egressGib: 10, buildMinutes: 5 }, RATES), ON);
    expect(n).toContain('egress');
    expect(n).toContain('build');
    expect(n).toContain('+20%');
  });

  it('🔒 an unbilled line is called out — an invisible under-bill looks exactly like margin', () => {
    const c = hostingCostUsd({ egressGib: 100, buildMinutes: 5 }, { NAVBHARAT_RATE_BUILD_MINUTE: '0.003' } as unknown as NodeJS.ProcessEnv);
    expect(hostingCostNote(c, ON)).toMatch(/NOT billed \(no rate set\): egress/);
  });

  it('says plainly when NavBharatAI is absorbing the cost', () => {
    expect(hostingCostNote(hostingCostUsd({ egressGib: 10 }, RATES), RATES)).toMatch(/absorbed by NavBharatAI/);
  });

  it('nothing measured says exactly that', () => {
    expect(hostingCostNote(hostingCostUsd({}, RATES), ON)).toMatch(/nothing measured/i);
  });
});
