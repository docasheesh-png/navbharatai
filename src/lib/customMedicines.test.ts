import { describe, it, expect } from 'vitest';
import {
  validateCustomMedicine, computeCustomDose, loadCustomMedicines, saveCustomMedicine,
  deleteCustomMedicine, searchMedicines, CUSTOM_MEDICINES_KEY, type CustomMedicine,
} from './customMedicines';

const NOW = 1_790_000_000_000;
const med = (over: Partial<CustomMedicine> = {}): CustomMedicine => ({
  id: 'cm_test', name: 'Hydrocortisone', unit: 'mg/kg', dosePerKg: 2, route: 'IV', addedAt: NOW, ...over,
});
const makeStore = () => {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
};

describe('validation — computing from a bad entry must be impossible, with the reason said', () => {
  it('accepts a complete, sane entry', () => {
    const v = validateCustomMedicine({ name: 'Adrenaline', unit: 'mcg/kg', dosePerKg: 10, route: 'IV', mgPerMl: 0.1 }, NOW);
    expect(v.ok).toBe(true);
  });
  it('refuses a zero or negative dose', () => {
    for (const dosePerKg of [0, -2]) {
      const v = validateCustomMedicine({ name: 'X', unit: 'mg/kg', dosePerKg, route: 'IV' }, NOW);
      expect(v.ok).toBe(false);
    }
  });
  it('refuses a range whose top is below its bottom', () => {
    expect(validateCustomMedicine({ name: 'X', unit: 'mg/kg', dosePerKg: 5, dosePerKgMax: 2, route: 'IV' }, NOW).ok).toBe(false);
  });
  it('refuses a zero mg/mL — it divides the dose into a volume', () => {
    expect(validateCustomMedicine({ name: 'X', unit: 'mg/kg', dosePerKg: 1, route: 'IV', mgPerMl: 0 }, NOW).ok).toBe(false);
  });
  it('refuses a missing route and a missing name', () => {
    expect(validateCustomMedicine({ name: '', unit: 'mg/kg', dosePerKg: 1, route: 'IV' }, NOW).ok).toBe(false);
    expect(validateCustomMedicine({ name: 'X', unit: 'mg/kg', dosePerKg: 1, route: '' }, NOW).ok).toBe(false);
  });
});

describe('the arithmetic on the doctor’s own numbers', () => {
  it('a plain mg/kg dose, with the workings written out', () => {
    const r = computeCustomDose(med(), 1.7);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.line.amount).toBe('3.4 mg');
      expect(r.line.workings).toBe('2 mg/kg × 1.7 kg = 3.4 mg');
    }
  });

  it('THE PUMP NUMBER: mcg/kg/min with a concentration computes mL/hour', () => {
    // Noradrenaline 0.1 mcg/kg/min for a 10 kg child from a 4 mg-in-50 mL (0.08 mg/mL) syringe:
    // 1 mcg/min = 0.001 mg/min ÷ 0.08 = 0.0125 mL/min = 0.75 mL/hour. The number the pump takes.
    const nad = med({ name: 'Noradrenaline', unit: 'mcg/kg/min', dosePerKg: 0.1, mgPerMl: 0.08 });
    const r = computeCustomDose(nad, 10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.line.amount).toBe('1 mcg/min');
      expect(r.line.volume).toBe('0.75 mL/hour at 0.08 mg/mL');
    }
  });

  it('a dose RANGE stays a range, in amount and in volume', () => {
    const r = computeCustomDose(med({ dosePerKg: 1, dosePerKgMax: 2, mgPerMl: 10 }), 5);
    if (r.ok) {
      expect(r.line.amount).toBe('5–10 mg');
      expect(r.line.volume).toBe('0.5–1 mL at 10 mg/mL');
    }
  });

  it('the doctor’s own max dose CLIPS the result and SAYS so', () => {
    const r = computeCustomDose(med({ dosePerKg: 2, maxDoseMg: 100 }), 80);
    if (r.ok) {
      expect(r.line.amount).toBe('100 mg');
      expect(r.line.capped).toMatch(/Capped at your entered maximum/);
    }
  });

  it('mcg entries convert honestly against an mg cap', () => {
    // 500 mcg/kg × 4 kg = 2000 mcg = 2 mg; a 1 mg cap must clip it to 1000 mcg.
    const r = computeCustomDose(med({ unit: 'mcg/kg', dosePerKg: 500, maxDoseMg: 1 }), 4);
    if (r.ok) expect(r.line.amount).toBe('1000 mcg');
  });

  it('refuses a weight outside the wide guard — a typo is a typo at any age', () => {
    expect(computeCustomDose(med(), 300).ok).toBe(false);
    expect(computeCustomDose(med(), 0.1).ok).toBe(false);
  });

  it('every answer names its source: the doctor, with the date they entered it', () => {
    const r = computeCustomDose(med(), 2);
    if (r.ok) expect(r.line.sourceLine).toMatch(/your own entry for Hydrocortisone .*verify against your unit protocol/);
  });
});

describe('storage — the same hardening as vialMemory', () => {
  it('round-trips add / edit / delete', () => {
    const st = makeStore();
    saveCustomMedicine(med(), st);
    saveCustomMedicine(med({ id: 'cm_2', name: 'Adrenaline', unit: 'mcg/kg', dosePerKg: 10 }), st);
    expect(loadCustomMedicines(st).map((m) => m.name).sort()).toEqual(['Adrenaline', 'Hydrocortisone']);
    saveCustomMedicine(med({ dosePerKg: 4 }), st); // same id = edit, not duplicate
    expect(loadCustomMedicines(st)).toHaveLength(2);
    expect(loadCustomMedicines(st).find((m) => m.id === 'cm_test')?.dosePerKg).toBe(4);
    deleteCustomMedicine('cm_test', st);
    expect(loadCustomMedicines(st).map((m) => m.name)).toEqual(['Adrenaline']);
  });

  it('🔒 a damaged stored entry is dropped, never half-computed', () => {
    const st = makeStore();
    st.setItem(CUSTOM_MEDICINES_KEY, JSON.stringify([
      med(),                                              // good
      { ...med({ id: 'bad1' }), dosePerKg: -5 },          // negative dose
      { ...med({ id: 'bad2' }), mgPerMl: 0 },             // zero divisor
      { ...med({ id: 'bad3' }), route: '' },              // no route
      null, 'junk', 42,
    ]));
    expect(loadCustomMedicines(st).map((m) => m.id)).toEqual(['cm_test']);
  });

  it('corrupt storage returns [] rather than throwing mid-emergency', () => {
    const st = makeStore();
    st.setItem(CUSTOM_MEDICINES_KEY, 'not json');
    expect(loadCustomMedicines(st)).toEqual([]);
  });
});

describe('search — "Google jaisa", the doctor’s own medicines first', () => {
  const customs = [
    med({ id: 'c1', name: 'Adrenaline', unit: 'mcg/kg', dosePerKg: 10 }),
    med({ id: 'c2', name: 'Hydrocortisone' }),
  ];

  it('prefix finds it: "adr" → Adrenaline', () => {
    expect(searchMedicines('adr', customs)[0].label).toBe('Adrenaline');
  });

  it('a misspelling finds it: "hydrocortison", "adrenalin"', () => {
    expect(searchMedicines('hydrocortison', customs)[0].label).toBe('Hydrocortisone');
    expect(searchMedicines('adrenalin', customs)[0].label).toBe('Adrenaline');
  });

  it('chart drugs are searchable in the same box, misspelt included', () => {
    const hits = searchMedicines('aminophyline', customs);
    expect(hits.some((h) => h.label === 'Aminophylline')).toBe(true);
  });

  it('the doctor’s own entry outranks a chart drug on an equal match', () => {
    const withClash = [...customs, med({ id: 'c3', name: 'Gentamicin' })];
    const hits = searchMedicines('gentamicin', withClash);
    expect(hits[0].kind).toBe('custom');
  });

  it('nothing typed, nothing suggested; garbage matches nothing', () => {
    expect(searchMedicines('', customs)).toEqual([]);
    expect(searchMedicines('zzzzqqq', customs)).toEqual([]);
  });
});
