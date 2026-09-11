/**
 * 🔒 A DERIVATION IS ONLY CHECKED WHEN IT CAN FAIL (admin's E2B dashboards, 2026-09-11).
 *
 * `E2B_USD_PER_HOUR = 0.083` was set in Cloud Run on 2026-08-13 and described in CLAUDE.md as "exactly
 * the measured rate". It was measured — as $172.08 ÷ 2,078.29 **vCPU-hours** — and then used as the
 * price of a **wall-clock** hour. The step that hid it: *"RAM-hours ÷ vCPU-hours is exactly 2.0, so
 * every sandbox is 1 vCPU + 2 GB"*. That ratio pins the sandbox's SHAPE (2 GB per vCPU) and is equally
 * true of the 2 vCPU + 4 GB machine `infra/e2b/build.mjs` actually builds, which the admin's own
 * console rows confirm ("2 Core / 4.0 GB"). On a two-vCPU template the two readings differ by 2×.
 *
 * Nobody was over-charged — the error under-states OUR cost, so paid builds recovered half the VM cost
 * and NavBharatAI absorbed the rest. What it broke is the admin's cost dashboard, which showed half the
 * real rupees on the panel used to ask why E2B is expensive.
 *
 * The first test is the one that matters: it is the check the original derivation never had.
 */
import { describe, it, expect } from 'vitest';
import {
  usdPerVcpuHour,
  usdPerGbHour,
  sandboxVcpu,
  sandboxRamGb,
  impliedUsdPerHour,
  sandboxUsdPerHour,
  rateIsConfigured,
  rateMismatch,
  rateMismatchNote,
  RATE_TOLERANCE,
} from '../src/server/AgentV3/sandboxRate';

const env = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv;

describe('the constants reproduce the admin real invoices', () => {
  // Two consecutive windows read off the admin's E2B usage dashboard. If a future price change makes
  // these fail, the constants are stale — update them against a NEW invoice, never to force a pass.
  const windows = [
    { label: 'Jul 14 – Aug 13 2026', vcpuHours: 2078.29, ramHours: 4156.57, invoiceUsd: 172.08 },
    { label: 'Aug 12 – Sep 11 2026', vcpuHours: 1064.36, ramHours: 2128.72, invoiceUsd: 88.13 },
  ];

  for (const w of windows) {
    it(`${w.label} reconciles to the cent`, () => {
      const predicted = w.vcpuHours * usdPerVcpuHour(env()) + w.ramHours * usdPerGbHour(env());
      expect(predicted).toBeCloseTo(w.invoiceUsd, 2);
    });
  }

  it('🔒 the ratio that fooled the original derivation is the SAME in both windows — so it can never pin the SIZE', () => {
    for (const w of windows) expect(w.ramHours / w.vcpuHours).toBeCloseTo(2.0, 3);
    // Which is exactly why the size must come from the template, not from the usage meters.
  });
});

describe('the rate is derived from the machine we actually run', () => {
  it('defaults mirror infra/e2b/build.mjs — 2 vCPU / 4 GB', () => {
    expect(sandboxVcpu(env())).toBe(2);
    expect(sandboxRamGb(env())).toBe(4);
  });

  it('a 2 vCPU / 4 GB sandbox costs $0.1656 per RUNNING hour', () => {
    expect(impliedUsdPerHour(env())).toBeCloseTo(0.1656, 4);
  });

  it('the old figure is exactly the per-vCPU price, which is half — the whole bug in one line', () => {
    expect(0.083 / impliedUsdPerHour(env())).toBeCloseTo(0.5, 2);
  });

  it('a template resize moves the rate, with no other change anywhere', () => {
    expect(impliedUsdPerHour(env({ E2B_SANDBOX_VCPU: '1', E2B_SANDBOX_RAM_GB: '2' }))).toBeCloseTo(0.0828, 4);
    expect(impliedUsdPerHour(env({ E2B_SANDBOX_VCPU: '4', E2B_SANDBOX_RAM_GB: '8' }))).toBeCloseTo(0.3312, 4);
  });

  it('an explicitly configured rate still wins — it may carry a plan discount we cannot see', () => {
    expect(sandboxUsdPerHour(env({ E2B_USD_PER_HOUR: '0.20' }))).toBe(0.20);
    expect(rateIsConfigured(env({ E2B_USD_PER_HOUR: '0.20' }))).toBe(true);
  });

  it('an unset or unusable rate falls back to the DERIVED one, never to a round placeholder', () => {
    for (const bad of [{}, { E2B_USD_PER_HOUR: '' }, { E2B_USD_PER_HOUR: 'free' }, { E2B_USD_PER_HOUR: '0' }, { E2B_USD_PER_HOUR: '-3' }]) {
      expect(sandboxUsdPerHour(env(bad as Record<string, string>))).toBeCloseTo(0.1656, 4);
      expect(rateIsConfigured(env(bad as Record<string, string>))).toBe(false);
    }
  });
});

describe('🔒 a configured rate that contradicts its machine must say so', () => {
  it('catches the exact value that is live in Cloud Run today', () => {
    const m = rateMismatch(env({ E2B_USD_PER_HOUR: '0.083' }));
    expect(m).not.toBeNull();
    expect(m!.ratio).toBeCloseTo(0.5, 2);
    expect(m!.implied).toBeCloseTo(0.1656, 4);
    // It must name the DIRECTION — an over-state and an under-state call for opposite responses.
    expect(m!.note).toMatch(/UNDER-states/);
    // And carry the value to set, so fixing it needs no second question.
    expect(m!.note).toContain('E2B_USD_PER_HOUR=0.1656');
    expect(m!.note).toContain('2 vCPU / 4 GB');
  });

  it('an OVER-stated rate is flagged too — a cost report that flatters nobody', () => {
    const m = rateMismatch(env({ E2B_USD_PER_HOUR: '0.60' }));
    expect(m!.note).toMatch(/OVER-states/);
  });

  it('stays silent when the rate and the machine agree', () => {
    expect(rateMismatch(env({ E2B_USD_PER_HOUR: '0.1656' }))).toBeNull();
    expect(rateMismatchNote(env({ E2B_USD_PER_HOUR: '0.1656' }))).toBe('');
  });

  it('stays silent for a plausible plan discount, and speaks for a whole multiple', () => {
    // Tolerance exists so a real discount does not cry wolf; shape errors are multiples, never 10%.
    const withinDiscount = 0.1656 * (1 - RATE_TOLERANCE + 0.02);
    expect(rateMismatch(env({ E2B_USD_PER_HOUR: String(withinDiscount) }))).toBeNull();
    const halfPrice = 0.1656 * 0.5;
    expect(rateMismatch(env({ E2B_USD_PER_HOUR: String(halfPrice) }))).not.toBeNull();
  });

  it('a DERIVED rate cannot disagree with itself, so nothing is reported', () => {
    expect(rateMismatch(env())).toBeNull();
    expect(rateMismatchNote(env())).toBe('');
  });

  it('the rate that WAS correct for a 1 vCPU machine is silent once the template says so', () => {
    // Proves the check tracks the machine rather than a hardcoded "0.083 is wrong" rule.
    expect(rateMismatch(env({ E2B_USD_PER_HOUR: '0.083', E2B_SANDBOX_VCPU: '1', E2B_SANDBOX_RAM_GB: '2' }))).toBeNull();
  });
});

describe('wiring — one rate, one answer', () => {
  const read = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').readFileSync(require('path').join(__dirname, '..', rel), 'utf8') as string;

  it('🔒 neither old module keeps a private default — that duplication WAS the drift', () => {
    for (const f of ['src/server/AgentV3/sandboxCost.ts', 'src/server/AgentV3/sandboxHandover.ts']) {
      const src = read(f);
      expect(src, f).toContain("export { sandboxUsdPerHour } from './sandboxRate'");
      // The two old defaults, gone as fallbacks.
      expect(src, f).not.toMatch(/Number\.isFinite\(\w+\) && \w+ >?= 0 \? \w+ : 0\.(10|083)/);
    }
  });

  it('the Monitor takes the warning from the SERVER, never from its own judgement', () => {
    expect(read('src/server/lib/metricsTimeline.ts')).toContain('sandboxRateNote: rateMismatchNote()');
    expect(read('src/components/admin/MonitorPanels.tsx')).toContain('data?.timeline?.summary?.sandboxRateNote');
  });

  it('the admin billing note carries it too, where the rate is quoted as fact', () => {
    expect(read('src/server/AgentV3/sandboxCost.ts')).toContain('rateMismatchNote(env)');
  });
});
