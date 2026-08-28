import { describe, it, expect } from 'vitest';
import { doseRateToPump, pumpToDoseRate, dripRate, dilutionPrep, rateToMgPerHour } from './erCalcs';

/**
 * Every number below is checkable by hand — that is the whole point of these tools. Where a case has a
 * textbook-obvious answer (10 kg, 0.1 mcg/kg/min, 0.08 mg/mL → 0.75 mL/h) it is pinned exactly.
 */

describe('dose rate → pump mL/hour (the forward conversion)', () => {
  it('the classic: 0.1 mcg/kg/min for 10 kg at 0.08 mg/mL = 0.75 mL/hour', () => {
    const r = doseRateToPump({ rate: 0.1, unit: 'mcg/kg/min', weightKg: 10, mgPerMl: 0.08 });
    expect('mlPerHour' in r && r.mlPerHour).toBe(0.75);
    if ('workings' in r) expect(r.workings).toContain('0.06 mg/hour');
  });

  it('non-weight units need no weight; per-kg units REFUSE without one', () => {
    const flat = doseRateToPump({ rate: 6, unit: 'mg/hr', mgPerMl: 2 });
    expect('mlPerHour' in flat && flat.mlPerHour).toBe(3);
    const perKg = doseRateToPump({ rate: 5, unit: 'mcg/kg/min', mgPerMl: 1 });
    expect('problem' in perKg && perKg.problem).toMatch(/weight/i);
  });

  it('refuses a missing/zero concentration rather than dividing by it', () => {
    expect('problem' in doseRateToPump({ rate: 1, unit: 'mg/hr', mgPerMl: 0 })).toBe(true);
    expect('problem' in doseRateToPump({ rate: 1, unit: 'mg/hr', mgPerMl: '' })).toBe(true);
  });

  it('rateToMgPerHour covers every unit exactly', () => {
    expect(rateToMgPerHour(0.1, 'mcg/kg/min', 10)).toBeCloseTo(0.06);
    expect(rateToMgPerHour(600, 'mcg/kg/hr', 10)).toBeCloseTo(6);
    expect(rateToMgPerHour(0.5, 'mg/kg/hr', 10)).toBeCloseTo(5);
    expect(rateToMgPerHour(6, 'mg/hr', null)).toBeCloseTo(6);
    expect(rateToMgPerHour(100, 'mcg/min', null)).toBeCloseTo(6);
  });
});

describe('pump mL/hour → running dose (the handover question)', () => {
  it('is the exact inverse of the forward conversion', () => {
    const r = pumpToDoseRate({ mlPerHour: 0.75, mgPerMl: 0.08, weightKg: 10 });
    expect('mcgPerKgPerMin' in r && r.mcgPerKgPerMin).toBeCloseTo(0.1);
  });

  it('asks for each missing number by name', () => {
    expect('problem' in pumpToDoseRate({ mlPerHour: '', mgPerMl: 1, weightKg: 10 })).toBe(true);
    expect('problem' in pumpToDoseRate({ mlPerHour: 1, mgPerMl: '', weightKg: 10 })).toBe(true);
    expect('problem' in pumpToDoseRate({ mlPerHour: 1, mgPerMl: 1, weightKg: '' })).toBe(true);
  });
});

describe('drip rate — a giving set and a watch', () => {
  it('500 mL over 4 hours on a 15-drop set = 31 drops/min, ~1 drop per 1.9 s', () => {
    const r = dripRate({ volumeMl: 500, overMinutes: 240, dropFactor: 15 });
    expect('dropsPerMin' in r && r.dropsPerMin).toBe(31);
    expect('secondsPerDrop' in r && r.secondsPerDrop).toBe(1.9);
  });

  it('a microdrip (60) makes drops/min equal mL/hour — the well-known identity holds', () => {
    const r = dripRate({ volumeMl: 100, overMinutes: 60, dropFactor: 60 });
    expect('dropsPerMin' in r && r.dropsPerMin).toBe(100);
  });
});

describe('dilution prep — how much stock, how much diluent', () => {
  it('4 mg in 50 mL from a 1 mg/mL stock: 4 mL stock + 46 mL diluent', () => {
    const r = dilutionPrep({ stockMgPerMl: 1, targetMgPerMl: 0.08, finalVolumeMl: 50 });
    expect('stockMl' in r && r.stockMl).toBe(4);
    expect('diluentMl' in r && r.diluentMl).toBe(46);
  });

  it('🔒 refuses a target STRONGER than the stock — diluent cannot concentrate a drug', () => {
    const r = dilutionPrep({ stockMgPerMl: 1, targetMgPerMl: 2, finalVolumeMl: 10 });
    expect('problem' in r && r.problem).toMatch(/STRONGER than the stock/);
  });
});

describe('what this module must NEVER contain', () => {
  it('no drug name with a number attached — doses belong to named sources, not to converters', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const src = readFileSync(join(process.cwd(), 'src/lib/erCalcs.ts'), 'utf8');
    // The one rule that lets these ship without a source chart: pure unit arithmetic only.
    expect(src).not.toMatch(/adrenaline|dopamine|noradrenaline|hydrocortisone|atropine/i);
  });
});

describe('WIRING — the Quick calcs live in the 💊 sheet, computed by the lib alone', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const sheet = readFileSync(join(process.cwd(), 'src/components/sda/DoseCalculator.tsx'), 'utf8');
  const calcs = readFileSync(join(process.cwd(), 'src/components/sda/QuickCalcs.tsx'), 'utf8');

  it('the sheet offers both tabs and renders the calcs panel', () => {
    expect(sheet).toContain('<CalcTabs tab={tab} onTab={setTab} />');
    expect(sheet).toContain("{tab === 'calcs' && <QuickCalcs />}");
  });

  it('the panel calls the four pure functions and never does arithmetic in JSX', () => {
    for (const fn of ['doseRateToPump', 'pumpToDoseRate', 'dripRate', 'dilutionPrep']) {
      expect(calcs).toContain(fn);
    }
    // No `*` or `/` maths on the entered values inside the component — the lib owns every formula.
    expect(calcs).not.toMatch(/Number\([^)]*\)\s*[*/]/);
  });

  it('every result shows its workings line, so the number can be checked against the order', () => {
    expect(calcs).toContain('workings={');
  });
});
